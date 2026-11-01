/**
 * Výpis AIM vrstvy ako tabuľka xlsx (D-181, Samuel 31. 10.: "napríklad keby je tam nejaký súbor xlsx"):
 * voliteľný súbor `<kontajner>_aim-layer.xlsx` vedľa `.icdd` (do kontajnera nejde, audit ICDD 1. 11.), hárok na vrstvu
 * linksetu + hárok súborov. Vlastný malý zapisovač
 * SpreadsheetML (OOXML, ISO/IEC 29500) cez fflate: bez ďalšej závislosti, deterministický (pevný čas v ZIP).
 */

import { zipSync, type Zippable } from "fflate";

import { LAYER_OF, type IcddPlan, type Layer } from "./model";
import { escapeXml } from "./xml";

export const XLSX_FILE = "aim-layer.xlsx";

type Cell = string | number | null | undefined;

const colName = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === "") return "";
          const ref = `${colName(c)}${r + 1}`;
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Zapíše zošit z hárkov (meno -> riadky, prvý riadok = hlavička). */
export function writeXlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
  const enc = new TextEncoder();
  const t = new Date(1980, 0, 1);
  const files: Zippable = {};
  const put = (p: string, s: string) => (files[p] = [enc.encode(s), { level: 6, mtime: t }]);
  const ns = "http://schemas.openxmlformats.org";
  put(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`,
  );
  put(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  put(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  );
  sheets.forEach((s, i) => put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));
  const sorted: Zippable = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];
  return zipSync(sorted);
}

const HEADER = ["from_file", "from_global_id", "from_object_ref", "to_file", "to_global_id", "to_page", "source", "role", "rule", "based_on", "ifc_relationship"];

/** Výpis AIM vrstvy z plánu: hárok `files` + hárok na každú vrstvu linksetu. */
export function buildAimXlsx(plan: IcddPlan): Uint8Array {
  const file = new Map(plan.payloads.map((p) => [p.id, p.filename]));
  const byLayer = new Map<Layer, Cell[][]>(plan.layers.map((l) => [l, []]));
  for (const l of plan.links) {
    byLayer.get(LAYER_OF[l.kind])?.push([
      file.get(l.from.payload),
      l.from.guid ?? (l.from.ident ? `${l.from.ident.field}=${l.from.ident.value}` : null),
      l.from.objectRef,
      file.get(l.to.payload),
      l.to.guid,
      l.to.page,
      l.source,
      l.role,
      l.rule,
      l.basedOn,
      l.ifcRelationship,
    ]);
  }
  const k = (r: Cell[]) => r.map((c) => String(c ?? "")).join("\u0000");
  const sheets = [
    {
      name: "files",
      rows: [
        ["filename", "kind", "name", "version_id", "sha256", "status", "identification"],
        ...[...plan.payloads]
          .sort((a, b) => (a.filename < b.filename ? -1 : 1))
          .map((p) => [p.filename, p.kind, p.name, p.versionID, p.sha256, p.status, p.identification] as Cell[]),
      ],
    },
    ...plan.layers.map((layer) => ({ name: layer, rows: [HEADER, ...(byLayer.get(layer) ?? []).sort((a, b) => (k(a) < k(b) ? -1 : 1))] })),
  ];
  return writeXlsx(sheets);
}
