/**
 * Import späť a roundtrip (D-181, Samuel 30. 10.: "export -> import -> rovnaký stav"). Kontajner sa prečíta
 * na kanonické väzby (typ, konce ako súbor + GlobalId / strana, pôvod, rola, pravidlo, revízie) a porovná
 * so stavom AIM (plán z DB). Rovnaký stav = rovnaké payloady (meno, sha256) a 0 rozdielov vo väzbách.
 * Zápis importovaného kontajnera do DB je ďalší krok (pripravená migrácia, D-181 bod 7).
 */

import { endKey, linkKey } from "./build";
import { CT, ELS, LAYER_OF, LS, type IcddPlan, type LinkKind } from "./model";
import { type Graph, type Term } from "./rdf";
import type { IcddContents } from "./validate";

export interface CanonicalLink {
  key: string;
  kind: LinkKind;
  layer: string;
}

export interface CanonicalState {
  versionID: string | null;
  /** filename -> sha256 */
  payloads: Map<string, string>;
  links: Map<string, CanonicalLink>;
}

export interface RoundtripDiff {
  same: boolean;
  payloadsOnlyInContainer: string[];
  payloadsOnlyInAim: string[];
  payloadsChanged: string[];
  linksOnlyInContainer: string[];
  linksOnlyInAim: string[];
  counts: { containerLinks: number; aimLinks: number; payloads: number };
}

const KIND_BY_TYPE = (aimNs: string): Record<string, LinkKind> => ({
  [`${ELS}IsElaboratedBy`]: "IsElaboratedBy",
  [`${ELS}IsIdenticalTo`]: "IsIdenticalTo",
  [`${aimNs}IsReferencedInSpatialStructure`]: "IsReferencedInSpatialStructure",
});

/** Namespace AIM z kontajnera: ontológia, ktorá deklaruje `IsReferencedInSpatialStructure`. */
export function detectAimNamespace(c: IcddContents, fallback: string): string {
  for (const t of c.data.triples) {
    if (t.o.t === "iri" && t.o.v.endsWith("IsReferencedInSpatialStructure")) return t.o.v.slice(0, -"IsReferencedInSpatialStructure".length);
  }
  return fallback;
}

/** Koniec väzby prečítaný z kontajnera: súbor v `Payload documents/` + GlobalId / Identification / strana. */
export interface ContainerEnd {
  file: string;
  guid: string | null;
  ident: { field: string; value: string } | null;
  page: number | null;
}

/** Väzba prečítaná z linksetu kontajnera (vstup roundtripu aj importu). */
export interface ContainerLink {
  /** Meno súboru linksetu bez `.rdf` (vrstva). */
  layer: string;
  kind: LinkKind;
  from: ContainerEnd;
  to: ContainerEnd;
  relationshipId: string | null;
  source: string | null;
  role: string | null;
  rule: string | null;
  basedOn: string | null;
  ifcRelationship: string | null;
}

/** Linkset z indexu: meno súboru a značka `aim:exchange` (null = bez značky, napr. cudzí nástroj). */
export interface ContainerLinkset {
  layer: string;
  exchange: string | null;
}

export function readContainerLinksets(c: IcddContents, aimNamespace: string): ContainerLinkset[] {
  const out: ContainerLinkset[] = [];
  for (const t of c.index.triples) {
    if (t.p !== `${CT}filename` || t.o.t !== "lit") continue;
    if (!c.index.types(t.s).includes(`${CT}Linkset`)) continue;
    out.push({ layer: t.o.v.replace(/\.rdf$/, ""), exchange: c.index.str(t.s, `${aimNamespace}exchange`) ?? null });
  }
  return out.sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));
}

export function readContainerLinks(c: IcddContents, aimNamespace: string): ContainerLink[] {
  const g: Graph = c.data;
  const kinds = KIND_BY_TYPE(aimNamespace);
  const end = (e: Term | undefined | null): ContainerEnd => {
    if (!e) return { file: "?", guid: null, ident: null, page: null };
    const doc = g.value(e, `${LS}hasDocument`);
    const d = doc && doc.t === "iri" ? c.documents.get(doc.v) : undefined;
    const file = d?.filename ?? "?";
    const id = g.value(e, `${LS}hasIdentifier`);
    let guid: string | null = null;
    let ident: { field: string; value: string } | null = null;
    let page: number | null = null;
    if (id) {
      if (g.types(id).includes(`${LS}StringBasedIdentifier`)) {
        const value = g.str(id, `${LS}identifier`) ?? "";
        const field = g.str(id, `${LS}identifierField`) ?? "GlobalId";
        if (field === "GlobalId") guid = value || null;
        else ident = { field, value };
      }
      const u = g.str(id, `${LS}uri`);
      const m = u ? /#page=(\d+)$/.exec(decodeURI(u)) : null;
      if (m) page = Number(m[1]);
    }
    return { file, guid, ident, page };
  };
  const opt = (s: Term, local: string) => g.str(s, `${aimNamespace}${local}`) ?? null;

  const links: ContainerLink[] = [];
  for (const [layerFile, triples] of Object.entries(c.linksets)) {
    const layer = layerFile.replace(/\.rdf$/, "");
    const subjects = new Map<string, Term>();
    for (const t of triples) if (t.s.t === "iri") subjects.set(t.s.v, t.s);
    for (const s of subjects.values()) {
      let kind = g.types(s).map((t) => kinds[t]).find(Boolean);
      if (!kind) continue;
      // identita dokumentov a podlaží je tá istá trieda els:IsIdenticalTo, líši sa vrstvou (LAYER_OF)
      if (kind === "IsIdenticalTo" && layer === LAYER_OF.DocumentIsIdenticalTo) kind = "DocumentIsIdenticalTo";
      let a: ContainerEnd;
      let b: ContainerEnd;
      if (kind === "IsIdenticalTo" || kind === "DocumentIsIdenticalTo") {
        const els = g.values(s, `${LS}hasLinkElement`).map(end);
        els.sort((x, y) => (endKey(x) < endKey(y) ? -1 : endKey(x) > endKey(y) ? 1 : 0));
        a = els[0] ?? end(null);
        b = els[1] ?? end(null);
      } else {
        a = end(g.value(s, `${LS}hasFromLinkElement`));
        b = end(g.value(s, `${LS}hasToLinkElement`));
      }
      links.push({
        layer,
        kind,
        from: a,
        to: b,
        relationshipId: opt(s, "relationshipId"),
        source: opt(s, "source"),
        role: opt(s, "role"),
        rule: opt(s, "derivationRule"),
        basedOn: opt(s, "basedOnRevision"),
        ifcRelationship: opt(s, "ifcRelationship"),
      });
    }
  }
  return links;
}

/** Kanonický kľúč väzby z kontajnera; rovnaký tvar ako `linkKey` pri exporte. */
export function containerLinkKey(l: Omit<ContainerLink, "layer">): string {
  return [
    l.kind,
    endKey(l.from),
    endKey(l.to),
    l.source ?? "",
    l.role ?? "",
    l.rule ?? "",
    l.basedOn ?? "",
    l.ifcRelationship ?? "",
    l.relationshipId ?? "",
  ].join(" ");
}

export function stateFromContainer(c: IcddContents, aimNamespace: string): CanonicalState {
  const payloads = new Map<string, string>();
  // súbory generované z väzieb (IFCX, xlsx) nie sú stav AIM; ich obsah kryjú väzby linksetov
  for (const d of c.documents.values()) if (d.filename && !d.generated) payloads.set(d.filename, d.checksum ?? "");
  const links = new Map<string, CanonicalLink>();
  for (const l of readContainerLinks(c, aimNamespace)) {
    const key = containerLinkKey(l);
    links.set(key, { key, kind: l.kind, layer: l.layer });
  }
  const versionID = c.container ? (c.index.str(c.container, `${CT}versionID`) ?? null) : null;
  return { versionID, payloads, links };
}

export function stateFromPlan(plan: IcddPlan): CanonicalState {
  const links = new Map<string, CanonicalLink>();
  for (const l of plan.links) {
    const key = linkKey(plan, l);
    links.set(key, { key, kind: l.kind, layer: LAYER_OF[l.kind] });
  }
  return { versionID: plan.versionID, payloads: new Map(plan.payloads.map((p) => [p.filename, p.sha256])), links };
}

export function compareStates(container: CanonicalState, aim: CanonicalState): RoundtripDiff {
  const onlyIn = <T>(a: Map<string, T>, b: Map<string, T>) => [...a.keys()].filter((k) => !b.has(k)).sort();
  const payloadsChanged = [...container.payloads.keys()]
    .filter((k) => aim.payloads.has(k) && aim.payloads.get(k) !== container.payloads.get(k))
    .sort();
  const d: RoundtripDiff = {
    same: false,
    payloadsOnlyInContainer: onlyIn(container.payloads, aim.payloads),
    payloadsOnlyInAim: onlyIn(aim.payloads, container.payloads),
    payloadsChanged,
    linksOnlyInContainer: onlyIn(container.links, aim.links),
    linksOnlyInAim: onlyIn(aim.links, container.links),
    counts: { containerLinks: container.links.size, aimLinks: aim.links.size, payloads: container.payloads.size },
  };
  d.same =
    !d.payloadsOnlyInContainer.length &&
    !d.payloadsOnlyInAim.length &&
    !d.payloadsChanged.length &&
    !d.linksOnlyInContainer.length &&
    !d.linksOnlyInAim.length;
  return d;
}
