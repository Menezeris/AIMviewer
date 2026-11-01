import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { assembleIcdd, buildIndex, buildLinksets, sideFiles } from "./build";
import { DEFAULT_AIM_NAMESPACE, ISO_ONTOLOGY_FILES, type IcddPlan } from "./model";
import { compareStates, stateFromContainer, stateFromPlan } from "./roundtrip";
import { parseRdfXml } from "./rdf";
import { parseXml } from "./xml";
import { sha256 } from "./sha256";
import { decodeStepString, validateIcdd } from "./validate";

const ONTO_DIR = join(__dirname, "../../public/icdd/ontology");
const ontologies = Object.fromEntries(ISO_ONTOLOGY_FILES.map((f) => [f, readFileSync(join(ONTO_DIR, f), "utf8")]));

const G = {
  wall: "2O2Fr$t4X7Zf8NOew3FLOH",
  space: "0BTBFw6f90Nfh9rP1dlXrb",
  storeyA: "2VefEmfcj8sx0WLKr$GNnn",
  duct: "1hOSvn6df7F8_7GcBWlRGQ",
  storeyV: "0JLkyEBbbEZg_9L47b5QYb",
};

const ifc = (lines: string[]) =>
  strToU8(
    [
      "ISO-10303-21;",
      "HEADER;FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');ENDSEC;",
      "DATA;",
      ...lines,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n"),
  );
const ASR = ifc([
  `#1=IFCWALL('${G.wall}',$,'Stena',$,$,$,$,$,$);`,
  `#2=IFCSPACE('${G.space}',$,'1.01',$,$,$,$,$,$,$,$);`,
  `#3=IFCBUILDINGSTOREY('${G.storeyA}',$,'1NP',$,$,$,$,$,.ELEMENT.,0.);`,
  "#4=IFCDOCUMENTINFORMATION('D.1.1.09','V\\X2\\00FD\\X0\\pis skladieb',$,$,$,$,$,$,$,$,$,$,$,$,$,$,$);",
  "#5=IFCDOCUMENTREFERENCE('D-1-1-09.pdf#page=3','page=3','S1',$,#4);",
]);
const VZT = ifc([
  `#1=IFCDUCTSEGMENT('${G.duct}',$,'Potrubie',$,$,$,$,$,$);`,
  `#2=IFCBUILDINGSTOREY('${G.storeyV}',$,'1NP_VZT',$,$,$,$,$,.ELEMENT.,0.);`,
]);
const PDF = strToU8("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");

function plan(): IcddPlan {
  return {
    versionID: "2026-10-31_ASR-v079_VZT-v011_D1",
    versionDescription: "ASR v79, VZT v11, 1 dokument",
    createdAt: "2026-10-31T12:00:00Z",
    description: "Test",
    publisher: { name: "Assetin" },
    aimNamespace: DEFAULT_AIM_NAMESPACE,
    layers: ["documents-elements", "documents-identity", "derived-spatial", "federation"],
    skipped: {},
    warnings: [],
    payloads: [
      { id: "model:ASR", kind: "model", filename: "ASR_v079.ifc", name: "ASR", filetype: "ifc", format: "application/x-step", versionID: "79", sha256: sha256(ASR), url: "x", gzip: true, identification: "ASR", model: "ASR", status: "DRAFT", revisionNo: 79 },
      { id: "model:VZT", kind: "model", filename: "VZT_v011.ifc", name: "VZT", filetype: "ifc", format: "application/x-step", versionID: "11", sha256: sha256(VZT), url: "x", gzip: true, identification: "VZT", model: "VZT", status: "DRAFT", revisionNo: 11 },
      { id: "document:D.1.1.09", kind: "document", filename: "D-1-1-09.pdf", name: "D.1.1.09 Výpis skladieb", filetype: "pdf", format: "application/pdf", versionID: "1", sha256: sha256(PDF), url: "x", gzip: false, identification: "D.1.1.09", objectRef: "D-1-1-09" },
    ],
    links: [
      { kind: "IsElaboratedBy", from: { payload: "model:ASR", guid: G.wall, objectRef: "ST.01" }, to: { payload: "document:D.1.1.09", page: 3 }, source: "doc_upload (D-036)", ifcRelationship: "IfcRelAssociatesDocument" },
      { kind: "IsElaboratedBy", from: { payload: "model:VZT", guid: G.duct }, to: { payload: "document:D.1.1.09" }, source: "pdf_link (E4)" },
      { kind: "IsReferencedInSpatialStructure", from: { payload: "model:VZT", guid: G.duct }, to: { payload: "model:ASR", guid: G.space }, source: "derive:spatial_reference", role: "inside", rule: "element_in_space", basedOn: "ASR=79;VZT=11", ifcRelationship: "IfcRelReferencedInSpatialStructure" },
      { kind: "IsIdenticalTo", from: { payload: "model:VZT", guid: G.storeyV }, to: { payload: "model:ASR", guid: G.storeyA }, source: "ifc_storey_map:name_number", basedOn: "ASR=79;VZT=11" },
      { kind: "DocumentIsIdenticalTo", from: { payload: "model:ASR", ident: { field: "IfcDocumentInformation.Identification", value: "D.1.1.09" } }, to: { payload: "document:D.1.1.09" }, source: "ifc:ASR v79" },
      { kind: "DocumentIsIdenticalTo", from: { payload: "model:ASR", ident: { field: "IfcDocumentReference.Identification", value: "page=3" } }, to: { payload: "document:D.1.1.09", page: 3 }, source: "ifc:ASR v79" },
    ],
  };
}

const payloads = () =>
  new Map([
    ["model:ASR", ASR],
    ["model:VZT", VZT],
    ["document:D.1.1.09", PDF],
  ]);

const build = (p = plan()) => assembleIcdd({ plan: p, payloads: payloads(), ontologies });

/** Prebalí ZIP s úpravou súborov (mutácie). */
function mutate(zip: Uint8Array, fn: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(zip);
  fn(files);
  return zipSync(files);
}

describe("ICDD export (D-181)", () => {
  it("zloží kontajner, ktorý prejde kontrolou voči ontológiám ISO 21597 bez chyby", () => {
    const report = validateIcdd(build());
    expect(report.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats).toMatchObject({ documents: 3, linksets: 4, links: 6 });
  });

  it("má štruktúru Part 1: index, ontológie, payloady a linksety", () => {
    const names = Object.keys(unzipSync(build())).sort();
    expect(names).toEqual([
      "Ontology resources/Container.rdf",
      "Ontology resources/ExtendedLinkset.rdf",
      "Ontology resources/Linkset.rdf",
      "Ontology resources/aim.rdf",
      "Payload documents/ASR_v079.ifc",
      "Payload documents/D-1-1-09.pdf",
      "Payload documents/VZT_v011.ifc",
      "Payload triples/derived-spatial.rdf",
      "Payload triples/documents-elements.rdf",
      "Payload triples/documents-identity.rdf",
      "Payload triples/federation.rdf",
      "index.rdf",
    ]);
  });

  it("prečíta aj hlavičku Index.rdf (iný zápis) s varovaním", () => {
    const zip = mutate(build(), (f) => {
      f["Index.rdf"] = f["index.rdf"];
      delete f["index.rdf"];
    });
    const r = validateIcdd(zip);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.level === "warning").map((i) => i.code)).toContain("index_name");
  });

  it("väzba aim: má aj typ ls:DirectedBinaryLink, väzby els: len svoj typ (čítače bez inferencie RDFS)", () => {
    const ls = buildLinksets(plan());
    const LSNS = "https://standards.iso.org/iso/21597/-1/ed-1/en/Linkset#";
    const ELSNS = "https://standards.iso.org/iso/21597/-2/ed-1/en/ExtendedLinkset#";
    const typesOf = (rdf: string) => {
      const g = parseRdfXml(rdf);
      const links = new Set(g.filter((t) => t.p.endsWith("#hasToLinkElement") || t.p.endsWith("#hasLinkElement")).map((t) => (t.s as { v: string }).v));
      return [...links].map((s) => g.filter((t) => (t.s as { v: string }).v === s && t.p.endsWith("#type")).map((t) => (t.o as { v: string }).v).sort());
    };
    expect(typesOf(ls["derived-spatial"])).toEqual([[`${LSNS}DirectedBinaryLink`, `${DEFAULT_AIM_NAMESPACE}IsReferencedInSpatialStructure`]]);
    expect(typesOf(ls.federation)).toEqual([[`${ELSNS}IsIdenticalTo`]]);
    for (const t of typesOf(ls["documents-elements"])) expect(t).toEqual([`${ELSNS}IsElaboratedBy`]);
    // kontrola voči ontológiám ISO aj roundtrip s tým prejdú
    const report = validateIcdd(build());
    expect(report.ok).toBe(true);
    expect(compareStates(stateFromContainer(report.contents!, DEFAULT_AIM_NAMESPACE), stateFromPlan(plan())).same).toBe(true);
  });

  it("je deterministický: rovnaký plán = rovnaké bajty, poradie väzieb nehrá rolu", () => {
    const a = build();
    const p = plan();
    p.links.reverse();
    p.payloads.reverse();
    expect(sha256(build(p))).toBe(sha256(a));
  });

  it("index nesie podpis verzie, sha256 a typy ct:", () => {
    const idx = buildIndex(plan());
    expect(idx).toContain("ICDD-Part1-Container");
    expect(idx).toContain(sha256(ASR));
    expect(idx).toContain("SHA-256");
    expect(idx).toContain("Container#SecuredDocument");
    const ls = buildLinksets(plan());
    expect(ls["documents-elements"]).toContain("D-1-1-09.pdf#page=3");
    expect(ls["documents-elements"]).toContain("ExtendedLinkset#IsElaboratedBy");
    expect(ls["federation"]).toContain("ExtendedLinkset#IsIdenticalTo");
    expect(ls["derived-spatial"]).toContain("urn:x-aim:icdd#IsReferencedInSpatialStructure");
  });

  it("RDF/XML ide späť na tie isté trojice", () => {
    const idx = buildIndex(plan());
    const t = parseRdfXml(idx);
    expect(t.length).toBeGreaterThan(40);
    expect(t.some((x) => x.p.endsWith("Container#checksum") && x.o.t === "lit" && x.o.v === sha256(ASR))).toBe(true);
  });

  it("odmietne payload, ktorého sha256 nesedí s plánom", () => {
    const p = plan();
    p.payloads[0].sha256 = "0".repeat(64);
    expect(() => build(p)).toThrow(/sha256/);
  });
});

const codes = (zip: Uint8Array) => validateIcdd(zip).issues.filter((i) => i.level === "error").map((i) => i.code);

describe("ICDD kontrola - mutácie ju musia zhodiť", () => {

  it("zmenený obsah payloadu = chyba checksum", () => {
    expect(codes(mutate(build(), (f) => void (f["Payload documents/D-1-1-09.pdf"] = strToU8("%PDF-iné"))))).toContain("checksum");
  });

  it("chýbajúci payload a súbor mimo indexu", () => {
    const z = mutate(build(), (f) => {
      delete f["Payload documents/VZT_v011.ifc"];
      f["Payload documents/navyse.pdf"] = PDF;
    });
    expect(codes(z)).toEqual(expect.arrayContaining(["missing_payload", "unlisted_payload"]));
  });

  it("GlobalId, ktorý v pribalenom IFC nie je", () => {
    const z = mutate(build(), (f) => {
      f["Payload documents/ASR_v079.ifc"] = ifc([`#3=IFCBUILDINGSTOREY('${G.storeyA}',$,'1NP',$,$,$,$,$,.ELEMENT.,0.);`]);
      // checksum by tiež spadol; prepočítame ho v indexe, aby sa ukázala práve referenčná integrita
      const idx = strFromU8(f["index.rdf"]).replace(sha256(ASR), sha256(f["Payload documents/ASR_v079.ifc"]));
      f["index.rdf"] = strToU8(idx);
    });
    const c = codes(z);
    expect(c).toContain("link_guid");
    expect(c).not.toContain("checksum");
  });

  it("chýbajúci vydavateľ (ct:publishedBy presne 1) a neznámy term ct:", () => {
    const z = mutate(build(), (f) => {
      const idx = strFromU8(f["index.rdf"])
        .replace(/\s*<ct:publishedBy [^>]*\/>/, "")
        .replace(/ct:versionDescription>/g, "ct:versionDesc>");
      f["index.rdf"] = strToU8(idx);
    });
    const issues = validateIcdd(z).issues.filter((i) => i.level === "error");
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["ontology_cardinality", "ontology_undeclared_term"]));
    expect(issues.find((i) => i.code === "ontology_cardinality")?.message).toMatch(/publishedBy/);
  });

  it("link bez cieľa (DirectedBinaryLink má práve jeden hasToLinkElement)", () => {
    const z = mutate(build(), (f) => {
      const ls = strFromU8(f["Payload triples/derived-spatial.rdf"]).replace(/\s*<ls:hasToLinkElement [^>]*\/>/, "");
      f["Payload triples/derived-spatial.rdf"] = strToU8(ls);
    });
    expect(validateIcdd(z).issues.some((i) => i.code === "ontology_cardinality" && /hasToLinkElement/.test(i.message))).toBe(true);
  });

  it("chýbajúca ontológia Part 1 a linkset mimo indexu", () => {
    const z = mutate(build(), (f) => {
      delete f["Ontology resources/Linkset.rdf"];
      f["Payload triples/extra.rdf"] = f["Payload triples/federation.rdf"];
    });
    expect(codes(z)).toEqual(expect.arrayContaining(["layout", "unlisted_linkset"]));
  });

  it("strana mimo súboru dokumentu", () => {
    const z = mutate(build(), (f) => {
      const ls = strFromU8(f["Payload triples/documents-elements.rdf"]).replace("D-1-1-09.pdf#page=3", "iny.pdf#page=3");
      f["Payload triples/documents-elements.rdf"] = strToU8(ls);
    });
    expect(codes(z)).toContain("link_uri");
  });
});

describe("ICDD roundtrip (export -> import -> rovnaký stav)", () => {
  it("prečítaný kontajner = stav AIM, 0 rozdielov", () => {
    const report = validateIcdd(build());
    const fromZip = stateFromContainer(report.contents!, DEFAULT_AIM_NAMESPACE);
    const diff = compareStates(fromZip, stateFromPlan(plan()));
    expect(diff.same).toBe(true);
    expect(diff.counts).toEqual({ containerLinks: 6, aimLinks: 6, payloads: 3 });
    expect(fromZip.versionID).toBe("2026-10-31_ASR-v079_VZT-v011_D1");
  });

  it("zmena v AIM po exporte (nová väzba, iná rola, nová revízia PDF) sa ukáže ako rozdiel", () => {
    const zip = build();
    const p = plan();
    p.links[2].role = "partial";
    p.links.push({ kind: "IsElaboratedBy", from: { payload: "model:ASR", guid: G.space }, to: { payload: "document:D.1.1.09", page: 4 }, source: "pdf_link (E4)" });
    p.payloads[2].sha256 = "f".repeat(64);
    const diff = compareStates(stateFromContainer(validateIcdd(zip).contents!, DEFAULT_AIM_NAMESPACE), stateFromPlan(p));
    expect(diff.same).toBe(false);
    expect(diff.linksOnlyInContainer).toHaveLength(1);
    expect(diff.linksOnlyInAim).toHaveLength(2);
    expect(diff.payloadsChanged).toEqual(["D-1-1-09.pdf"]);
  });

  it("IsIdenticalTo nezávisí od poradia koncov", () => {
    const p = plan();
    const l = p.links[3];
    [l.from, l.to] = [l.to, l.from];
    const diff = compareStates(stateFromContainer(validateIcdd(build()).contents!, DEFAULT_AIM_NAMESPACE), stateFromPlan(p));
    expect(diff.same).toBe(true);
  });
});

describe("sha256", () => {
  it("zhoda s Node crypto", async () => {
    const { createHash } = await import("node:crypto");
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
      expect(sha256(b)).toBe(createHash("sha256").update(b).digest("hex"));
    }
  });
});

describe("ICDD identita dokumentov a pôvod väzieb (D-181 bod 3)", () => {
  it("identita IfcDocumentInformation / IfcDocumentReference <-> PDF ako els:IsIdenticalTo s Identification", () => {
    const ls = buildLinksets(plan())["documents-identity"];
    expect(ls).toContain("ExtendedLinkset#IsIdenticalTo");
    expect(ls).toContain("<ls:identifierField>IfcDocumentInformation.Identification</ls:identifierField>");
    expect(ls).toContain("<ls:identifier>page=3</ls:identifier>");
  });

  it("Identification, ktorá v pribalenom IFC nie je, kontrolu zhodí", () => {
    const z = mutate(build(), (f) => {
      const ls = strFromU8(f["Payload triples/documents-identity.rdf"]).replace("<ls:identifier>D.1.1.09</ls:identifier>", "<ls:identifier>D.9.9.99</ls:identifier>");
      f["Payload triples/documents-identity.rdf"] = strToU8(ls);
    });
    expect(codes(z)).toContain("link_ifc_document");
  });

  it("väzba nesie IFC vzťah, aim.rdf odkazuje na jeho definíciu v IFC 4.3", () => {
    expect(buildLinksets(plan())["derived-spatial"]).toContain("<aim:ifcRelationship>IfcRelReferencedInSpatialStructure</aim:ifcRelationship>");
    const onto = strFromU8(unzipSync(build())["Ontology resources/aim.rdf"]);
    expect(onto).toContain("IFC4_3/HTML/lexical/IfcRelAssociatesDocument.htm");
    expect(onto).toContain("IFC4_3/HTML/lexical/IfcRelReferencedInSpatialStructure.htm");
  });

  it("STEP reťazce sa dekódujú (\\X2\\, '')", () => {
    expect(decodeStepString("V\\X2\\00FD\\X0\\pis O''Neil")).toBe("Výpis O'Neil");
  });
});

describe("ICDD xlsx výpis (D-181 bod 9)", () => {
  const withExtras = (): IcddPlan => ({ ...plan(), extras: ["xlsx"] });

  it("xlsx nejde do kontajnera, ale vedľa neho; kontrola aj roundtrip prejdú, IFCX nie je", () => {
    const zip = build(withExtras());
    const files = unzipSync(zip);
    expect(Object.keys(files).some((f) => f.endsWith(".xlsx"))).toBe(false);
    expect(sha256(zip)).toBe(sha256(build(plan())));
    expect(sideFiles(withExtras()).map((f) => f.filename)).toEqual(["AIM_2026-10-31_ASR-v079_VZT-v011_D1_aim-layer.xlsx"]);
    expect(sideFiles(plan())).toEqual([]);
    expect(Object.keys(files).some((f) => f.endsWith(".ifcx"))).toBe(false);
    const report = validateIcdd(zip);
    expect(report.issues.filter((i) => i.level === "error")).toEqual([]);
    const diff = compareStates(stateFromContainer(report.contents!, DEFAULT_AIM_NAMESPACE), stateFromPlan(withExtras()));
    expect(diff.same).toBe(true);
    expect(sha256(build(withExtras()))).toBe(sha256(zip));
  });

  it("xlsx: platný SpreadsheetML, hárok súborov a hárok na vrstvu s riadkami väzieb", () => {
    const x = unzipSync(sideFiles(withExtras())[0].bytes);
    const wb = parseXml(strFromU8(x["xl/workbook.xml"]));
    const names = (wb.children.find((c) => typeof c !== "string" && c.name === "sheets") as { children: { attrs: Record<string, string> }[] }).children.map((c) => c.attrs.name);
    expect(names).toEqual(["files", "documents-elements", "documents-identity", "derived-spatial", "federation"]);
    const rows = (n: number) => (strFromU8(x[`xl/worksheets/sheet${n}.xml`]).match(/<row /g) ?? []).length;
    expect([rows(1), rows(2), rows(3), rows(4), rows(5)]).toEqual([4, 3, 3, 2, 2]);
    expect(strFromU8(x["xl/worksheets/sheet3.xml"])).toContain("IfcDocumentReference.Identification=page=3");
  });
});
