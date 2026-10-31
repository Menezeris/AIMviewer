import { applyAffine, axisInModel, blockCenter, mergeRefAxes, type Affine, type AxisLine, type P2, type PageBlock, type PageLine, type RefAxis } from "./underlay-calibrate";

/**
 * Rovina rezu zo značky rezu na kalibrovanom pôdoryse (D-179, #284): rezná čiara má na oboch koncoch
 * rovnaké písmeno (A ... A), osi majú tiež dvojice popiskov na koncoch, ale v rade s ďalšími osami
 * (A až F hore aj dole). Koncové body značky sa prepočítajú cez `affine` strany do IFC (X, Y) a dajú
 * zvislú rovinu; osi a značky iných rezov, ktoré rovina pretína, dajú polohy po reze (popisky osí na
 * výkrese rezu). Čistá logika bez DB a motora.
 */

/** Kalibrovaný pôdorys: strana s affine do IFC (X, Y), text a čiary strany (pri výreze len z neho). */
export interface PlanSheet {
  ref: string;
  page: number;
  affine: Affine;
  pageSize: [number, number];
  blocks: PageBlock[];
  lines?: PageLine[];
  /** Výrez strany kalibrácie (hárok s viac pôdorysmi); blocks a lines sú už orezané. */
  region?: [number, number, number, number] | null;
}

const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

/** Rady osí strany v bodoch strany (pred kalibráciou): dvojice popiskov v rade aspoň 3 osí. */
export function pageAxisLines(pageSize: [number, number], blocks: PageBlock[], lines?: PageLine[]): AxisLine[] {
  return planLabelLines({ ref: "", page: 0, affine: IDENTITY, pageSize, blocks, lines })
    .filter((l) => l.kind === "axis")
    .map(({ text, a, b }) => ({ text, a, b }));
}

/** Polohy osí v IFC z kalibrovaných pôdorysov (medián cez výkresy); grid je spoločný pre všetky podlažia. */
export function refAxesFromSheets(sheets: PlanSheet[]): RefAxis[] {
  return mergeRefAxes(
    sheets.map((sh) =>
      planLabelLines(sh)
        .filter((l) => l.kind === "axis")
        .map((l) => ({ text: l.text, ...axisInModel(IDENTITY, l) })),
    ),
  );
}

/** Čiara medzi dvojicou rovnakých popiskov na pôdoryse, v IFC (X, Y). */
export interface LabelLine {
  text: string;
  kind: "section" | "axis";
  a: P2;
  b: P2;
}

/** Popisok osi alebo značky: 1 až 2 písmená, číslo do 2 cifier, aj s apostrofom (A', 1a). */
const LABEL_RE = /^(?:[A-Z]{1,2}'?|\d{1,2}[a-z]?'?)$/;
/** Najviac výskytov textu na strane (inak to nie je popisok osi, ale napr. číslo skladby). */
const MAX_OCCURRENCES = 6;
/** Dvojica pokrýva aspoň takú časť strany v smere čiary. */
const MIN_SPAN = 0.3;
/** Zarovnanie dvojice (kolmo na čiaru) a zhoda koncov v rade osí, podiel rozmeru strany. */
const ALIGN_TOL = 0.006;
const ROW_TOL = 0.0025;
/** Rad osí má aspoň toľko dvojíc s rovnakými koncami; menej = značka rezu. */
const GRID_MIN = 3;

interface PagePair {
  text: string;
  /** Orientácia na strane: v = zvislá čiara (rovnaké x), h = vodorovná. */
  dir: "v" | "h";
  a: P2;
  b: P2;
}

/** Dvojice rovnakých popiskov zarovnané zvislo alebo vodorovne cez veľkú časť strany. */
function pagePairs(sheet: PlanSheet): PagePair[] {
  const [W, H] = sheet.pageSize;
  const byText = new Map<string, P2[]>();
  for (const b of sheet.blocks) {
    const t = b.t.trim();
    if (!LABEL_RE.test(t)) continue;
    const list = byText.get(t) ?? [];
    list.push(blockCenter(b, sheet.pageSize));
    byText.set(t, list);
  }
  const out: PagePair[] = [];
  for (const [text, pts] of byText) {
    if (pts.length < 2 || pts.length > MAX_OCCURRENCES) continue;
    const cands: (PagePair & { span: number })[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const [p, q] = [pts[i], pts[j]];
        if (Math.abs(p[0] - q[0]) < ALIGN_TOL * W && Math.abs(p[1] - q[1]) > MIN_SPAN * H) {
          const [a, b] = p[1] > q[1] ? [p, q] : [q, p];
          cands.push({ text, dir: "v", a, b, span: Math.abs(p[1] - q[1]) });
        } else if (Math.abs(p[1] - q[1]) < ALIGN_TOL * H && Math.abs(p[0] - q[0]) > MIN_SPAN * W) {
          const [a, b] = p[0] < q[0] ? [p, q] : [q, p];
          cands.push({ text, dir: "h", a, b, span: Math.abs(p[0] - q[0]) });
        }
      }
    }
    // Každý výskyt najviac v jednej dvojici, dlhšie dvojice prvé.
    const used = new Set<P2>();
    for (const c of cands.sort((x, y) => y.span - x.span)) {
      if (used.has(c.a) || used.has(c.b)) continue;
      used.add(c.a);
      used.add(c.b);
      out.push({ text: c.text, dir: c.dir, a: c.a, b: c.b });
    }
  }
  return out;
}

/**
 * Dorovná dvojicu na čiaru strany: rovnobežné úsečky medzi popiskami do 6 pt od spojnice
 * (rezná čiara, os) posunú spojnicu na ich priemernú polohu; bez nich ostane stred popiskov.
 */
function snapToLines(p: PagePair, lines: PageLine[] | undefined): PagePair {
  if (!lines?.length) return p;
  const k = p.dir === "v" ? 0 : 1;
  const along = 1 - k;
  const at = (p.a[k] + p.b[k]) / 2;
  const lo = Math.min(p.a[along], p.b[along]);
  const hi = Math.max(p.a[along], p.b[along]);
  let sum = 0;
  let len = 0;
  for (const s of lines) {
    if (Math.abs(s[k] - s[k + 2]) > 0.5) continue;
    const c = (s[k] + s[k + 2]) / 2;
    if (Math.abs(c - at) > 6) continue;
    const m = (s[along] + s[along + 2]) / 2;
    if (m < lo || m > hi) continue;
    const l = Math.abs(s[along] - s[along + 2]);
    sum += c * l;
    len += l;
  }
  if (len < 0.1 * (hi - lo)) return p;
  const c = sum / len;
  const move = (q: P2): P2 => (k === 0 ? [c, q[1]] : [q[0], c]);
  return { ...p, a: move(p.a), b: move(p.b) };
}

/** Čiary popiskov pôdorysu v IFC: rady osí (aspoň 3 dvojice s rovnakými koncami) a značky rezov. */
export function planLabelLines(sheet: PlanSheet): LabelLine[] {
  const pairs = pagePairs(sheet);
  const [W, H] = sheet.pageSize;
  const sameRow = (p: PagePair, q: PagePair) => {
    if (p.dir !== q.dir) return false;
    const k = p.dir === "v" ? 1 : 0;
    const tol = ROW_TOL * (k === 1 ? H : W);
    return Math.abs(p.a[k] - q.a[k]) < tol && Math.abs(p.b[k] - q.b[k]) < tol;
  };
  const out: LabelLine[] = [];
  for (const p of pairs) {
    const kind = pairs.filter((q) => sameRow(p, q)).length >= GRID_MIN ? "axis" : "section";
    // Značka rezu je písmeno (A, B'), samotné číslo mimo radu osí je kód skladby či prvku.
    if (kind === "section" && !/[A-Z]/.test(p.text)) continue;
    const s = snapToLines(p, sheet.lines);
    out.push({ text: p.text, kind, a: applyAffine(sheet.affine, s.a), b: applyAffine(sheet.affine, s.b) });
  }
  return out;
}

/** Písmeno rezu z dokumentu: `..._REZ-A`, `Rez B - ...`, `REZ C-C`. */
export function sectionMarkFromName(...names: (string | null | undefined)[]): string | null {
  for (const n of names) {
    const m = n ? /(?:^|[^a-z])rez[\s_-]*([a-z]{1,2}\d?)(?:[\s_-]*\1)?(?![a-z\d])/i.exec(n) : null;
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export interface SectionFromPlans {
  mark: string;
  /** Bod roviny (päta kolmice z počiatku IFC) a smer reznej čiary (jednotkový). */
  at: P2;
  dir: P2;
  /** Os zarovnaná rovina (odchýlka smeru pod 0,05 stupňa): axis x = rovina X = coordinate. */
  axis: { axis: "x" | "y"; coordinate_m: number } | null;
  /** Pôdorysy so značkou: odchýlka od výslednej čiary (kolmo, mm; uhol) a či sa použili. */
  plans: { ref: string; page: number; offset_mm: number; angle_deg: number; used: boolean }[];
  /** Najväčšia odchýlka použitých pôdorysov od výslednej čiary (mm). */
  spread_mm: number;
  /** Poloha osí a iných rezov po reze (m od `at` v smere `dir`), kľúč = popisok. */
  axes: Record<string, number>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Pôdorys ďalej od zhody (kolmo) sa nepoužije: iný výkres s rovnakým písmenom alebo hrubšia kalibrácia (PBR 1:100). */
const OUTLIER_M = 0.1;
const SNAP_DEG = 0.05;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Rovina rezu `mark` zo všetkých kalibrovaných pôdorysov, na ktorých značka je: smer a poloha ako
 * medián (pôdorys mimo zhody o viac než 10 cm vypadne, vráti sa s `used: false`), osi a ostatné značky
 * pretnuté rovinou ako poloha po reze. Null, ak značku nemá žiadny pôdorys.
 */
export function sectionFromPlans(mark: string, sheets: PlanSheet[]): SectionFromPlans | null {
  const hits: { sheet: PlanSheet; line: LabelLine; all: LabelLine[] }[] = [];
  for (const sheet of sheets) {
    const all = planLabelLines(sheet);
    const line = all.find((l) => l.kind === "section" && l.text === mark);
    if (line) hits.push({ sheet, line, all });
  }
  if (hits.length === 0) return null;
  // Smer zjednotený (kladná väčšia zložka), aby sa uhly dali porovnať.
  const dirOf = (l: LabelLine): P2 => {
    let d: P2 = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
    const L = Math.hypot(d[0], d[1]);
    d = [d[0] / L, d[1] / L];
    const big = Math.abs(d[0]) >= Math.abs(d[1]) ? d[0] : d[1];
    return big < 0 ? [-d[0], -d[1]] : d;
  };
  const angles = hits.map((h) => Math.atan2(dirOf(h.line)[1], dirOf(h.line)[0]));
  const ang0 = median(angles);
  const n0: P2 = [-Math.sin(ang0), Math.cos(ang0)];
  const offs = hits.map((h) => ((h.line.a[0] + h.line.b[0]) / 2) * n0[0] + ((h.line.a[1] + h.line.b[1]) / 2) * n0[1]);
  const off0 = median(offs);
  const used = hits.map((_, i) => Math.abs(offs[i] - off0) <= OUTLIER_M);
  let ang = median(angles.filter((_, i) => used[i]));
  let off = median(offs.filter((_, i) => used[i]));
  let axis: SectionFromPlans["axis"] = null;
  const deg = (ang * 180) / Math.PI;
  if (Math.abs(deg) < SNAP_DEG) {
    ang = 0;
    axis = { axis: "y", coordinate_m: r3(off) };
  } else if (Math.abs(Math.abs(deg) - 90) < SNAP_DEG) {
    ang = Math.PI / 2;
    // Smer (0, 1): normála (-1, 0), offset = -X.
    axis = { axis: "x", coordinate_m: r3(-off) };
  }
  const dir: P2 = [Math.cos(ang), Math.sin(ang)];
  const n: P2 = [-dir[1], dir[0]];
  if (axis) off = axis.axis === "y" ? axis.coordinate_m : -axis.coordinate_m;
  const at: P2 = [r3(n[0] * off) || 0, r3(n[1] * off) || 0];

  const plans = hits.map((h, i) => ({
    ref: h.sheet.ref,
    page: h.sheet.page,
    offset_mm: Math.round((offs[i] - off) * 1000),
    angle_deg: +(((angles[i] - ang) * 180) / Math.PI).toFixed(3),
    used: used[i],
  }));
  const spread = Math.max(...plans.filter((p) => p.used).map((p) => Math.abs(p.offset_mm)));

  // Osi a iné značky: priesečník ich čiary s reznou čiarou, poloha po reze (m od `at`). Os má prednosť
  // pred značkou rezu s rovnakým písmenom (os B aj rez B): na výkrese rezu sú osi v rade nad rezom.
  const pos = new Map<string, { axis: number[]; section: number[] }>();
  hits.forEach((h, i) => {
    if (!used[i]) return;
    for (const l of h.all) {
      if (l.kind === "section" && l.text === mark) continue;
      const d: P2 = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
      const den = d[0] * n[0] + d[1] * n[1];
      const L = Math.hypot(d[0], d[1]);
      if (Math.abs(den) < 0.2 * L) continue; // takmer rovnobežná s rezom
      const t = (off - (l.a[0] * n[0] + l.a[1] * n[1])) / den;
      if (t < -0.05 || t > 1.05) continue; // čiara rez nepretína
      const p: P2 = [l.a[0] + t * d[0], l.a[1] + t * d[1]];
      const entry = pos.get(l.text) ?? { axis: [], section: [] };
      entry[l.kind].push((p[0] - at[0]) * dir[0] + (p[1] - at[1]) * dir[1]);
      pos.set(l.text, entry);
    }
  });
  const axes: Record<string, number> = {};
  for (const [text, e] of pos) {
    const us = e.axis.length ? e.axis : e.section;
    // Ten istý popisok na dvoch miestach po reze je nejednoznačný: preč.
    if (Math.max(...us) - Math.min(...us) > 0.2) continue;
    axes[text] = r3(median(us));
  }
  return { mark, at, dir: [r3(dir[0]) || 0, r3(dir[1]) || 0], axis, plans, spread_mm: spread, axes };
}
