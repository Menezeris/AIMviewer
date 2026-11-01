// Prototyp k docs/research/vlastnosti-povod-a-overenie.md (výskum, nie produkčný kód).
// Bez závislostí: `node docs/research/prototyp/povod-overenie.mjs`.
//
// 1. Overenie Qto podľa VÝZNAMU veličiny (nie len objem a pôdorys ako dnes ifc_measure):
//    každá veličina má metódu nad meshom (ktoré plochy, ktorá os) a výsledok nesie
//    "dôkaz" = zoznam trojuholníkov / úsečku, ktorú by viewer zvýraznil.
// 2. Dočasná vlastnosť "plocha debnenia" stropnej dosky: spodné plochy dosky mínus
//    kontakt s hornými plochami podpier (steny, stĺpy) + čelá (bočné plochy).
//    Kontakt sa ráta vzorkovaním mriežkou (bod v trojuholníku), čo je jednoduché
//    a overiteľné; v produkcii by to bola presná 2D booleovská operácia (clipper).
//
// Geometria je v osiach IFC (Z hore, metre), ako mesh motora po toWorld (D-112, D-124).

const COS2 = Math.cos((2 * Math.PI) / 180);

// ── mesh pomocníci ───────────────────────────────────────────────────────────

/** Extrúzia obdĺžnika [x0,y0,x1,y1] s voliteľným obdĺžnikovým otvorom, od z0 do z1. */
function extrudeRect(name, cls, [x0, y0, x1, y1], z0, z1, hole) {
  const P = [];
  const T = [];
  const v = (x, y, z) => (P.push(x, y, z), P.length / 3 - 1);
  const quad = (a, b, c, d) => T.push(a, b, c, a, c, d); // a-b-c-d proti smeru hodín pri pohľade z normály
  const ring = (r) => [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
  ];
  const outer = ring([x0, y0, x1, y1]);
  if (!hole) {
    const b = outer.map(([x, y]) => v(x, y, z0));
    const t = outer.map(([x, y]) => v(x, y, z1));
    quad(t[0], t[1], t[2], t[3]); // hore (+z)
    quad(b[0], b[3], b[2], b[1]); // dole (-z)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(b[i], b[j], t[j], t[i]); // boky von
    }
  } else {
    const inner = ring(hole);
    const ob = outer.map(([x, y]) => v(x, y, z0));
    const ot = outer.map(([x, y]) => v(x, y, z1));
    const ib = inner.map(([x, y]) => v(x, y, z0));
    const it = inner.map(([x, y]) => v(x, y, z1));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(ot[i], ot[j], it[j], it[i]); // hore: rám
      quad(ob[i], ib[i], ib[j], ob[j]); // dole: rám
      quad(ob[i], ob[j], ot[j], ot[i]); // vonkajšie boky
      quad(ib[j], ib[i], it[i], it[j]); // boky otvoru (normála do otvoru)
    }
  }
  return { name, cls, positions: Float64Array.from(P), indices: Uint32Array.from(T) };
}

function tri(m, t) {
  const p = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  const a = p(m.indices[t]);
  const b = p(m.indices[t + 1]);
  const c = p(m.indices[t + 2]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const len = Math.hypot(...n);
  return { a, b, c, area: len / 2, n: len ? n.map((x) => x / len) : [0, 0, 0], id: t / 3 };
}

const tris = (m) => Array.from({ length: m.indices.length / 3 }, (_, i) => tri(m, i * 3));
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

function volume(m) {
  return Math.abs(sum(tris(m).map(({ a, b, c }) => (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6)));
}

function bbox(m) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k], m.positions[i]);
    max[k] = Math.max(max[k], m.positions[i]);
  }
  return { min, max };
}

/** Trojuholníky s normálou v smere dir (do 2 stupňov) = "plochy" pre dôkaz vo vieweri. */
const facing = (m, dir) => tris(m).filter((t) => t.n[0] * dir[0] + t.n[1] * dir[1] + t.n[2] * dir[2] > COS2);

// ── 1. overenie Qto podľa významu ────────────────────────────────────────────

/**
 * Metódy výpočtu = čitateľný "recept" pre pôvod vypočítanej hodnoty. Každá vráti
 * hodnotu v jednotke Qto (lineárne v mm ako v našich súboroch, plochy m2, objemy m3)
 * a dôkaz (trojuholníky alebo úsečka), ktorý by viewer zvýraznil.
 */
const METHODS = {
  "Qto_WallBaseQuantities.Height": {
    method: "bbox.z (spodná po hornú hranu telesa Body)",
    unit: "mm",
    run: (m) => {
      const b = bbox(m);
      return { value: (b.max[2] - b.min[2]) * 1000, evidence: { segment: [[b.min[0], b.min[1], b.min[2]], [b.min[0], b.min[1], b.max[2]]] } };
    },
  },
  "Qto_WallBaseQuantities.NetSideArea": {
    method: "plocha jednej bočnej strany = súčet trojuholníkov s normálou +y osi steny (líce)",
    unit: "m2",
    run: (m, ax) => {
      const f = facing(m, ax.depth);
      return { value: sum(f.map((t) => t.area)), evidence: { triangles: f.map((t) => t.id) } };
    },
  },
  "Qto_WallBaseQuantities.NetFootPrintArea": {
    method: "súčet trojuholníkov s normálou -z (spodná plocha telesa)",
    unit: "m2",
    run: (m) => {
      const f = facing(m, [0, 0, -1]);
      return { value: sum(f.map((t) => t.area)), evidence: { triangles: f.map((t) => t.id) } };
    },
  },
  "Qto_WallBaseQuantities.NetVolume": {
    method: "objem uzavretého meshu (znamienkové štvorsteny)",
    unit: "m3",
    run: (m) => ({ value: volume(m), evidence: { triangles: "all", closed: true } }),
  },
};

function verify(m, ax, qto, tolRel = 0.005) {
  return Object.entries(qto).map(([key, fileValue]) => {
    const def = METHODS[key];
    if (!def) return { key, file: fileValue, status: "bez_metody" };
    const { value, evidence } = def.run(m, ax);
    const dev = fileValue ? (value - fileValue) / fileValue : null;
    const status = dev === null ? "?" : Math.abs(dev) <= tolRel ? "zhoda" : "odchylka";
    return { key, file: fileValue, geometry: +value.toFixed(4), unit: def.unit, deviation_pct: dev === null ? null : +(dev * 100).toFixed(3), status, method: def.method, evidence_size: Array.isArray(evidence.triangles) ? evidence.triangles.length : evidence.segment ? "úsečka" : evidence.triangles };
  });
}

// ── 2. plocha debnenia dosky ─────────────────────────────────────────────────

function inTri2([px, py], { a, b, c }) {
  const d = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [px, py];
  const d1 = d(p, a, b);
  const d2 = d(p, b, c);
  const d3 = d(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Debnenie spodku = spodné plochy dosky, ktoré nie sú v kontakte s hornou plochou
 * podpery (vo výške spodku dosky +- tolZ). Vzorky v strede buniek mriežky h x h,
 * globálne zarovnanej, aby sa susedné trojuholníky nezapočítali dvakrát.
 */
function formwork(slab, supports, { h = 0.01, tolZ = 0.002, edges = true } = {}) {
  const bottoms = facing(slab, [0, 0, -1]);
  const tops = supports.flatMap((s) => facing(s, [0, 0, 1]).map((t) => ({ ...t, owner: s.name })));
  // Bod na spoločnej hrane dvoch trojuholníkov sa ráta raz (kľúč bunky).
  const seen = new Set();
  let total = 0;
  const contact = new Map();
  for (const t of bottoms) {
    const z = t.a[2];
    const cand = tops.filter((u) => Math.abs(u.a[2] - z) <= tolZ);
    const xs = [t.a[0], t.b[0], t.c[0]];
    const ys = [t.a[1], t.b[1], t.c[1]];
    for (let i = Math.floor(Math.min(...xs) / h); i <= Math.ceil(Math.max(...xs) / h); i++) {
      for (let j = Math.floor(Math.min(...ys) / h); j <= Math.ceil(Math.max(...ys) / h); j++) {
        const p = [(i + 0.5) * h, (j + 0.5) * h];
        if (!inTri2(p, t) || seen.has(`${i},${j}`)) continue;
        seen.add(`${i},${j}`);
        total++;
        const hit = cand.find((u) => inTri2(p, u));
        if (hit) contact.set(hit.owner, (contact.get(hit.owner) ?? 0) + 1);
      }
    }
  }
  const cell = h * h;
  const bottomExact = sum(bottoms.map((t) => t.area));
  const contactArea = sum([...contact.values()]) * cell;
  // Čelá a boky otvorov: všetky zvislé plochy dosky (normála kolmá na z).
  const sides = tris(slab).filter((t) => Math.abs(t.n[2]) < 1 - COS2);
  const sideArea = sum(sides.map((t) => t.area));
  return {
    bottom_exact_m2: +bottomExact.toFixed(4),
    bottom_sampled_m2: +(total * cell).toFixed(4),
    contact_m2: Object.fromEntries([...contact].map(([k, n]) => [k, +(n * cell).toFixed(4)])),
    bottom_formwork_m2: +(bottomExact - contactArea).toFixed(4),
    edge_formwork_m2: edges ? +sideArea.toFixed(4) : 0,
    formwork_m2: +(bottomExact - contactArea + (edges ? sideArea : 0)).toFixed(4),
    evidence: { bottom_triangles: bottoms.map((t) => t.id), side_triangles: sides.map((t) => t.id), grid_m: h, tol_z_m: tolZ },
  };
}

// ── scenár ───────────────────────────────────────────────────────────────────

// Stena ako SN02.03.0011 (ASR v79): dĺžka 2,35 m, hrúbka 0,15 m, výška 3,95 m, od z = 9,05.
const wall = extrudeRect("SN02.03.0011", "IfcWall", [0, 0, 2.35, 0.15], 9.05, 13.0);
const wallAxes = { width: [1, 0, 0], depth: [0, 1, 0] };
const wallQto = {
  "Qto_WallBaseQuantities.Height": 3950,
  "Qto_WallBaseQuantities.NetSideArea": 9.2825,
  "Qto_WallBaseQuantities.NetFootPrintArea": 0.3525,
  "Qto_WallBaseQuantities.NetVolume": 1.392375,
  "Qto_WallBaseQuantities.Width": 150,
};
console.log("\n1) Overenie Qto steny podľa významu veličiny (hodnoty Qto z ASR v79):");
console.table(verify(wall, wallAxes, wallQto));

// Doska 6 x 4 x 0,25 m s otvorom 1 x 1 m, spodok z = 4,60; pod ňou nosná stena, priečka a stĺp.
const slab = extrudeRect("SD-test", "IfcSlab", [0, 0, 6, 4], 4.6, 4.85, [4, 1, 5, 2]);
const shear = extrudeRect("SN-nosna", "IfcWall", [0, 0, 6, 0.25], -0.3, 4.6); // pod okrajom dosky
const column = extrudeRect("SL-stlp", "IfcColumn", [2.75, 1.75, 3.25, 2.25], -0.3, 4.6);
const partition = extrudeRect("SN-pricka", "IfcWall", [0, 3, 3, 3.1], -0.3, 4.6); // priečka po strop
const parapet = extrudeRect("SN-parapet", "IfcWall", [0, 3.9, 6, 4], -0.3, 0.4); // nedotýka sa

console.log("\n2a) Debnenie dosky, podpery = nosná stena + stĺp (priečka sa murije po betonáži):");
const fw = formwork(slab, [shear, column, parapet]);
console.log({ ...fw, evidence: { ...fw.evidence, bottom_triangles: fw.evidence.bottom_triangles.length, side_triangles: fw.evidence.side_triangles.length } });
console.log("   kontrola rukou: spodok 24 - 1 (otvor) = 23; kontakt 6 x 0,25 + 0,5 x 0,5 = 1,75; spodok debnenia 21,25;");
console.log("   čelá 2 x (6 + 4) x 0,25 = 5,0 + boky otvoru 4 x 1 x 0,25 = 1,0 -> spolu 27,25 m2");

console.log("\n2b) To isté, ale aj priečka ako podpera (iné pravidlo = iná hodnota, preto pravidlo patrí do pôvodu):");
const fw2 = formwork(slab, [shear, column, partition, parapet]);
console.log({ bottom_formwork_m2: fw2.bottom_formwork_m2, contact_m2: fw2.contact_m2, formwork_m2: fw2.formwork_m2 });

console.log("\n2c) Citlivosť na mriežku (presnosť vzorkovania):");
for (const h of [0.1, 0.05, 0.02, 0.01]) {
  const r = formwork(slab, [shear, column], { h });
  console.log(`   h = ${h} m: kontakt ${sum(Object.values(r.contact_m2)).toFixed(4)} m2, spodok vzorkovaný ${r.bottom_sampled_m2} (presne ${r.bottom_exact_m2})`);
}

// Pôvod výsledku tak, ako by sa uložil do cache (návrh v správe, kap. 5).
console.log("\n3) Záznam pôvodu dočasnej vlastnosti (návrh):");
console.log(
  JSON.stringify(
    {
      element: "SD-test",
      quantity: "AIM_Formwork.FormworkArea",
      value: fw.formwork_m2,
      unit: "m2",
      provenance: {
        kind: "computed",
        rule: { id: "formwork.slab.v1", params: { supports: ["IfcWall[LoadBearing=true]", "IfcColumn"], edges: true, tol_z_m: 0.002, grid_m: 0.01 } },
        inputs: [{ model: "ASR", revision: 79, global_ids: ["SD-test", "SN-nosna", "SL-stlp"], representation: "Body" }],
        engine: { package: "@ifc-lite/geometry", version: "7.8.1", tessellation: "default" },
        accuracy_m2: "+-(obvod kontaktu x grid / 2)",
      },
    },
    null,
    2,
  ),
);
