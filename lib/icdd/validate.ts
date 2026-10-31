/**
 * Kontrola kontajnera ICDD (D-181, plán #350 časť 3.5): štruktúra ZIP podľa ISO 21597-1, index a súbory
 * jeden k jednému, sha256 payloadov, súlad s pribalenými ontológiami (ct:, ls:, els:, aim:) a referenčná
 * integrita linksetov (dokument v indexe, GlobalId v pribalenom IFC, strana PDF). Beží nad obsahom ZIP,
 * takže kontroluje aj cudzí kontajner pri importe.
 */

import { unzipSync } from "fflate";

import {
  CT,
  DIR_DOCUMENTS,
  DIR_ONTOLOGY,
  DIR_TRIPLES,
  INDEX_FILE,
  ISO,
  ISO_ONTOLOGY_FILES,
  LS,
} from "./model";
import { checkAgainstOntology, loadOntology, type OntologyIssue } from "./ontology";
import { Graph, iri, parseRdfXml, RDF_TYPE, type Term, type Triple } from "./rdf";
import { readIfcx } from "./ifcx";
import { sha256 } from "./sha256";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  where: string;
  message: string;
}

export interface IcddContents {
  files: Record<string, Uint8Array>;
  index: Graph;
  /** Linksety podľa mena súboru v `Payload triples/`. */
  linksets: Record<string, Triple[]>;
  /** Index + linksety spolu (linky odkazujú na dokumenty v indexe). */
  data: Graph;
  container: Term | null;
  /** Dokumenty v indexe podľa IRI. */
  documents: Map<string, { iri: string; filename?: string; filetype?: string; checksum?: string; internal: boolean; generated: boolean }>;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  stats: { documents: number; linksets: number; links: number; triples: number };
  contents: IcddContents | null;
}

const dec = new TextDecoder();

/** Rozbalí ZIP a prečíta index a linksety; chyby čítania idú do `issues`. */
export function readIcdd(zip: Uint8Array, issues: ValidationIssue[] = []): IcddContents | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch (e) {
    issues.push({ level: "error", code: "zip", where: "", message: `nie je platný ZIP: ${String(e)}` });
    return null;
  }
  const parse = (path: string): Triple[] | null => {
    try {
      return parseRdfXml(dec.decode(files[path]));
    } catch (e) {
      issues.push({ level: "error", code: "rdf_parse", where: path, message: String(e instanceof Error ? e.message : e) });
      return null;
    }
  };
  if (!files[INDEX_FILE]) {
    issues.push({ level: "error", code: "layout", where: INDEX_FILE, message: "chýba index.rdf v koreni kontajnera" });
    return null;
  }
  const indexTriples = parse(INDEX_FILE) ?? [];
  const index = new Graph(indexTriples);
  const linksets: Record<string, Triple[]> = {};
  for (const path of Object.keys(files).sort()) {
    if (path.startsWith(DIR_TRIPLES) && path.length > DIR_TRIPLES.length && !path.endsWith("/")) {
      linksets[path.slice(DIR_TRIPLES.length)] = parse(path) ?? [];
    }
  }
  const data = new Graph([...indexTriples, ...Object.values(linksets).flat()]);
  const containers = index.allSubjects().filter((s) => index.types(s).includes(`${CT}ContainerDescription`));
  const container = containers[0] ?? null;
  if (containers.length !== 1)
    issues.push({ level: "error", code: "index", where: INDEX_FILE, message: `index má ${containers.length} ct:ContainerDescription (má 1)` });

  const documents: IcddContents["documents"] = new Map();
  const generated = new Set(
    indexTriples.filter((t) => t.s.t === "iri" && /[#/]generatedFrom$/.test(t.p)).map((t) => (t.s as { v: string }).v),
  );
  if (container) {
    for (const d of index.values(container, `${CT}containsDocument`)) {
      if (d.t !== "iri") continue;
      const types = index.types(d);
      documents.set(d.v, {
        iri: d.v,
        filename: index.str(d, `${CT}filename`),
        filetype: index.str(d, `${CT}filetype`),
        checksum: index.str(d, `${CT}checksum`),
        internal: types.includes(`${CT}InternalDocument`),
        generated: generated.has(d.v),
      });
    }
  }
  return { files, index, linksets, data, container, documents };
}

const GUID_RE = /=\s*IFC[A-Z0-9_]+\s*\(\s*'([0-9A-Za-z_$]{22})'/g;

/** GlobalId všetkých IfcRoot v STEP súbore (prvý atribút entity). */
export function ifcGlobalIds(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(GUID_RE)) out.add(m[1]);
  return out;
}

export function validateIcdd(zip: Uint8Array): ValidationReport {
  const issues: ValidationIssue[] = [];
  const c = readIcdd(zip, issues);
  if (!c) return { ok: false, issues, stats: { documents: 0, linksets: 0, links: 0, triples: 0 }, contents: null };
  const err = (code: string, where: string, message: string) => issues.push({ level: "error", code, where, message });
  const warn = (code: string, where: string, message: string) => issues.push({ level: "warning", code, where, message });

  // 1. štruktúra
  for (const path of Object.keys(c.files)) {
    if (path === INDEX_FILE || path.endsWith("/")) continue;
    if (![DIR_ONTOLOGY, DIR_DOCUMENTS, DIR_TRIPLES].some((d) => path.startsWith(d)))
      warn("layout", path, "súbor mimo priečinkov ISO 21597-1");
  }
  const ontoFiles = Object.keys(c.files).filter((p) => p.startsWith(DIR_ONTOLOGY) && p.endsWith(".rdf"));
  for (const f of ISO_ONTOLOGY_FILES.slice(0, 2)) {
    if (!c.files[`${DIR_ONTOLOGY}${f}`]) err("layout", `${DIR_ONTOLOGY}${f}`, "chýba povinná ontológia Part 1");
  }

  // 2. index <-> súbory, sha256
  const listed = new Set<string>();
  for (const d of c.documents.values()) {
    if (!d.internal) continue;
    if (!d.filename) continue; // kardinalitu hlási kontrola ontológie
    const path = `${DIR_DOCUMENTS}${d.filename}`;
    listed.add(path);
    const data = c.files[path];
    if (!data) {
      err("missing_payload", path, "dokument z indexu v kontajneri nie je");
      continue;
    }
    if (d.checksum) {
      const algo = c.index.str(iri(d.iri), `${CT}checksumAlgorithm`);
      if (algo && algo.toUpperCase().replace("-", "") !== "SHA256") warn("checksum", path, `algoritmus ${algo} sa nekontroluje`);
      else if (sha256(data) !== d.checksum.toLowerCase()) err("checksum", path, "sha256 súboru nesedí s ct:checksum");
    }
  }
  for (const path of Object.keys(c.files)) {
    if (path.startsWith(DIR_DOCUMENTS) && !path.endsWith("/") && !listed.has(path))
      err("unlisted_payload", path, "súbor v Payload documents nie je v indexe");
  }
  const linksetFiles = new Set<string>();
  if (c.container) {
    for (const l of c.index.values(c.container, `${CT}containsLinkset`)) {
      const f = c.index.str(l, `${CT}filename`);
      if (!f) continue;
      linksetFiles.add(f);
      if (!c.files[`${DIR_TRIPLES}${f}`]) err("missing_linkset", `${DIR_TRIPLES}${f}`, "linkset z indexu v kontajneri nie je");
    }
  }
  for (const f of Object.keys(c.linksets)) {
    if (!linksetFiles.has(f)) err("unlisted_linkset", `${DIR_TRIPLES}${f}`, "linkset nie je v indexe");
  }

  // 3. ontológie
  const ontoTriples: Triple[][] = [];
  for (const p of ontoFiles) {
    try {
      ontoTriples.push(parseRdfXml(dec.decode(c.files[p])));
    } catch (e) {
      err("rdf_parse", p, String(e instanceof Error ? e.message : e));
    }
  }
  const onto = loadOntology(ontoTriples);
  for (const must of [ISO.Container, ISO.Linkset]) {
    if (!onto.ontologyIris.has(must)) err("ontology", DIR_ONTOLOGY, `pribalené ontológie neobsahujú ${must}`);
  }
  const usesEls = c.data.triples.some((t) => t.o.t === "iri" && t.o.v.startsWith(`${ISO.ExtendedLinkset}#`));
  if (usesEls && !onto.ontologyIris.has(ISO.ExtendedLinkset))
    err("ontology", DIR_ONTOLOGY, "linksety používajú typy Part 2, ale ExtendedLinkset.rdf nie je pribalený");
  const label = (t: Term) => (t.t === "iri" ? t.v : `_:${t.v}`);
  const ontoIssues: OntologyIssue[] = checkAgainstOntology(onto, c.data, label);
  for (const i of ontoIssues.slice(0, 200)) issues.push({ level: i.level, code: `ontology_${i.code}`, where: i.subject, message: i.message });
  if (ontoIssues.length > 200) err("ontology_more", "", `a ďalších ${ontoIssues.length - 200} chýb voči ontológii`);

  // 4. referenčná integrita linksetov
  const guidCache = new Map<string, Set<string>>();
  const guidsOf = (filename: string): Set<string> | null => {
    const path = `${DIR_DOCUMENTS}${filename}`;
    if (!c.files[path]) return null;
    let s = guidCache.get(path);
    if (!s) {
      s = ifcGlobalIds(dec.decode(c.files[path]));
      guidCache.set(path, s);
    }
    return s;
  };
  let links = 0;
  const elements = c.data.allSubjects().filter((s) => c.data.types(s).includes(`${LS}LinkElement`));
  for (const s of c.data.allSubjects()) {
    if (c.data.values(s, `${LS}hasLinkElement`).length || c.data.values(s, `${LS}hasFromLinkElement`).length) links++;
  }
  let missingGuid = 0;
  for (const e of elements) {
    const doc = c.data.value(e, `${LS}hasDocument`);
    const d = doc && doc.t === "iri" ? c.documents.get(doc.v) : undefined;
    if (!d) {
      err("link_document", label(e), "ls:hasDocument neukazuje na dokument v indexe");
      continue;
    }
    const id = c.data.value(e, `${LS}hasIdentifier`);
    if (!id) continue;
    const types = c.data.types(id);
    if (types.includes(`${LS}StringBasedIdentifier`)) {
      const v = c.data.str(id, `${LS}identifier`);
      const field = c.data.str(id, `${LS}identifierField`);
      if (v && field === "GlobalId" && d.filetype?.toLowerCase() === "ifc" && d.filename) {
        const set = guidsOf(d.filename);
        if (set && !set.has(v)) {
          if (missingGuid++ < 50) err("link_guid", label(e), `GlobalId ${v} nie je v ${d.filename}`);
        }
      }
    } else if (types.includes(`${LS}URIBasedIdentifier`)) {
      const u = c.data.str(id, `${LS}uri`);
      const m = u ? /^(.*)#page=(\d+)$/.exec(decodeURI(u)) : null;
      if (!m) warn("link_uri", label(e), `URI ${u} nie je tvaru <súbor>#page=N`);
      else if (m[1] !== d.filename || Number(m[2]) < 1) err("link_uri", label(e), `URI ${u} neukazuje na stranu ${d.filename}`);
    }
  }
  if (missingGuid > 50) err("link_guid", "", `a ďalších ${missingGuid - 50} GlobalId mimo IFC`);

  // 5. súbory navyše generované z linksetov (IFCX) musia s nimi súhlasiť
  for (const d of c.documents.values()) {
    if (!d.generated || d.filetype !== "ifcx" || !d.filename) continue;
    const path = `${DIR_DOCUMENTS}${d.filename}`;
    if (!c.files[path]) continue;
    try {
      const x = readIfcx(dec.decode(c.files[path]));
      if (x.links !== links) err("ifcx_links", path, `IFCX má ${x.links} väzieb, linksety ${links}`);
      const ifcGuids = new Set<string>();
      for (const doc of c.documents.values()) if (doc.filetype === "ifc" && doc.filename) for (const g of guidsOf(doc.filename) ?? []) ifcGuids.add(g);
      const bad = x.paths.filter((p) => !ifcGuids.has(p));
      if (bad.length) err("ifcx_path", path, `${bad.length} ciest IFCX nie je GlobalId v pribalených IFC (napr. ${bad[0]})`);
    } catch (e) {
      err("ifcx_parse", path, String(e instanceof Error ? e.message : e));
    }
  }
  if (!c.container) err("index", INDEX_FILE, "bez ct:ContainerDescription");
  else if (!c.index.values(c.container, RDF_TYPE).length) err("index", INDEX_FILE, "kontajner bez typu");

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    stats: { documents: c.documents.size, linksets: Object.keys(c.linksets).length, links, triples: c.data.triples.length },
    contents: c,
  };
}
