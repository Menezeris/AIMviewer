// Spike k overovaču výmer (docs/research/overovac-vymer-spike.md): presné zdrojové
// parametre extrúzie IfcSpace z @ifc-lite/geometry 7.8.1 (extractExtrusionDefinitions,
// bez tesselácie) vedľa base quantities zo súboru. Len číta, nič nezapisuje.
//
// Použitie (balík nainštalovaný mimo repa, napr. v scratchpade):
//   NODE_PATH=<dir>/node_modules node docs/research/prototyp/spike-extrusion-spaces.mjs <súbor.ifc>
// Testovacie dáta: verejný model AC20-FZK-Haus (KIT), v repe Menezeris/ifc-lite
// apps/viewer/public/_fixtures/AC20-FZK-Haus.ifc. Produkčné IFC sem nepatria (D-135).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : import.meta.url);
const { GeometryProcessor } = await import(require.resolve("@ifc-lite/geometry"));

const file = process.argv[2];
if (!file) throw new Error("chýba cesta k IFC");
const bytes = readFileSync(file);
const text = bytes.toString("latin1");

// ── minimálny STEP index (len na spike) ─────────────────────────────────────
const ents = new Map();
for (const m of text.matchAll(/^#(\d+)\s*=\s*([A-Z0-9_]+)\((.*)\);\s*$/gm)) ents.set(+m[1], { type: m[2], args: m[3] });
const refs = (s) => [...s.matchAll(/#(\d+)/g)].map((x) => +x[1]);
const str = (s) => (s.match(/^'((?:[^']|'')*)'/) || [])[1];
const splitTop = (s) => {
  const out = [];
  let depth = 0, cur = "", q = false;
  for (const c of s) {
    if (c === "'") q = !q;
    if (!q && c === "(") depth++;
    if (!q && c === ")") depth--;
    if (!q && c === "," && depth === 0) (out.push(cur), (cur = ""));
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
};

// Jednotky: dĺžka (SI prefix) pre prevod hodnôt zo súboru.
let lengthScale = 1;
for (const e of ents.values()) {
  if (e.type === "IFCSIUNIT" && /\.LENGTHUNIT\./.test(e.args)) lengthScale = /\.MILLI\./.test(e.args) ? 0.001 : /\.CENTI\./.test(e.args) ? 0.01 : 1;
}

const spaces = [...ents].filter(([, e]) => e.type === "IFCSPACE").map(([id, e]) => {
  const a = splitTop(e.args);
  return { id, guid: str(a[0]), name: str(a[2]), longName: str(a[7]) };
});

// Qto na miestnosti cez IfcRelDefinesByProperties.
const qtoBySpace = new Map();
for (const e of ents.values()) {
  if (e.type !== "IFCRELDEFINESBYPROPERTIES") continue;
  const a = splitTop(e.args);
  const related = refs(a[4]);
  const def = ents.get(refs(a[5])[0]);
  if (!def || def.type !== "IFCELEMENTQUANTITY") continue;
  const d = splitTop(def.args);
  const set = { name: str(d[2]), method: str(d[4]) ?? null, q: {} };
  for (const qid of refs(d[5])) {
    const q = ents.get(qid);
    if (!q) continue;
    const qa = splitTop(q.args);
    set.q[str(qa[0])] = { cls: q.type, value: Number(qa[3]), formula: qa[4] && qa[4] !== "$" ? str(qa[4]) : null };
  }
  for (const r of related) (qtoBySpace.get(r) ?? qtoBySpace.set(r, []).get(r)).push(set);
}

// ── extrúzie ────────────────────────────────────────────────────────────────
const gp = new GeometryProcessor({ enableInstancing: false });
const origLog = console.log;
console.log = () => undefined;
await gp.init();
const defs = gp.extractExtrusionDefinitions(new Uint8Array(bytes), Uint32Array.from(spaces.map((s) => s.id)));
console.log = origLog;
const byKey = new Map(defs.sources.map((s) => [JSON.stringify(s.key), s]));

const colMul = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
const r3 = (v, d = 3) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

const rows = [];
for (const s of spaces) {
  const inst = defs.instances[s.id] ?? [];
  const qsets = qtoBySpace.get(s.id) ?? [];
  const q = Object.assign({}, ...qsets.map((x) => x.q));
  const parts = inst.map((i) => {
    const src = byKey.get(JSON.stringify(i.source));
    const ex = src?.source;
    const nq = src?.nominal_quantities;
    // Spodok extrúzie v IFC svete: počiatok Position (lokálne súradnice profilu) cez world_from_source.
    const origin = ex?.position_matrix && i.world_from_source ? colMul(i.world_from_source, colMul(ex.position_matrix, [0, 0, 0, 1]).concat(1)) : null;
    const loops = ex?.profile?.loops ?? [];
    return {
      status: i.status.type,
      modified: i.source_modified,
      area_m2: nq ? nq.profile_area * lengthScale ** 2 : null,
      height_m: nq ? nq.projected_height * lengthScale : null,
      volume_m3: nq ? nq.nominal_volume * lengthScale ** 3 : null,
      perimeter_m: loops.filter((l) => l.kind === "outer").reduce((t, l) => t + l.perimeter, 0) * lengthScale,
      inner_loops: loops.filter((l) => l.kind === "inner").length,
      base_z: origin ? origin[2] : null,
    };
  });
  const sum = (k) => (parts.length && parts.every((p) => p[k] != null) ? parts.reduce((t, p) => t + p[k], 0) : null);
  const v = (n) => (q[n] ? q[n].value * (q[n].cls === "IFCQUANTITYLENGTH" ? lengthScale : 1) : null);
  const dev = (calc, file) => (calc == null || file == null || file === 0 ? null : r3(((calc - file) / file) * 100, 2));
  rows.push({
    space: `${s.name} ${s.longName ?? ""}`.trim(),
    parts: parts.length,
    modified: parts.some((p) => p.modified),
    method: qsets.map((x) => x.method).filter(Boolean).join(" | ") || null,
    area_calc: r3(sum("area_m2")),
    GrossFloorArea: r3(v("GrossFloorArea")),
    NetFloorArea: r3(v("NetFloorArea")),
    dA_pct: dev(sum("area_m2"), v("GrossFloorArea") ?? v("NetFloorArea")),
    perim_calc: r3(sum("perimeter_m")),
    GrossPerimeter: r3(v("GrossPerimeter")),
    height_calc: r3(parts[0]?.height_m),
    Height: r3(v("Height") ?? v("FinishCeilingHeight")),
    vol_calc: r3(sum("volume_m3")),
    GrossVolume: r3(v("GrossVolume")),
    NetVolume: r3(v("NetVolume")),
    dV_pct: dev(sum("volume_m3"), v("GrossVolume")),
    base_z: r3(parts[0]?.base_z),
  });
}

console.log(`súbor: ${file}\nschéma: ${defs.schema}, dĺžková jednotka: ${lengthScale} m, zdrojov extrúzií: ${defs.sources.length}, diagnostika: ${defs.diagnostics.length}`);
console.table(rows);
const spaceIds = new Set(spaces.map((s) => s.id));
const names = new Set([...qtoBySpace].filter(([id]) => spaceIds.has(id)).flatMap(([, sets]) => sets.flatMap((x) => Object.keys(x.q))));
console.log("veličiny na miestnostiach:", [...names].join(", "));
if (defs.diagnostics.length) console.log("diagnostika:", defs.diagnostics.slice(0, 5));
gp.dispose();
