import { applyAffine, axisInModel, blockCenter, mergeRefAxes, type Affine, type AxisLine, type P2, type PageBlock, type PageLine, type RefAxis } from "./underlay-calibrate";

/**
 * Section plane from a section mark on a calibrated floor plan (D-179, #284): the section line has the same letter at both ends
 * (A ... A), grids also have pairs of labels at the ends, but in a row with other grids
 * (A to F both above and below). The end points of the mark are converted via the page `affine` to IFC (X, Y) and give
 * a vertical plane; grids and marks of other sections that the plane intersects give positions along the cut (grid labels
 * on the section drawing). Pure logic without DB and engine.
 */

/** Calibrated floor plan: a page with affine to IFC (X, Y), the page text and lines (for a region only from it). */
export interface PlanSheet {
  ref: string;
  page: number;
  affine: Affine;
  pageSize: [number, number];
  blocks: PageBlock[];
  lines?: PageLine[];
  /** Region of the calibration page (sheet with several floor plans); blocks and lines are already clipped. */
  region?: [number, number, number, number] | null;
}

const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

/** Rows of grids of the page in page points (before calibration): pairs of labels in a row of at least 3 grids. */
export function pageAxisLines(pageSize: [number, number], blocks: PageBlock[], lines?: PageLine[]): AxisLine[] {
  return planLabelLines({ ref: "", page: 0, affine: IDENTITY, pageSize, blocks, lines })
    .filter((l) => l.kind === "axis")
    .map(({ text, a, b }) => ({ text, a, b }));
}

/** Grid positions in IFC from calibrated floor plans (median over drawings); the grid is shared by all storeys. */
export function refAxesFromSheets(sheets: PlanSheet[]): RefAxis[] {
  return mergeRefAxes(
    sheets.map((sh) =>
      planLabelLines(sh)
        .filter((l) => l.kind === "axis")
        .map((l) => ({ text: l.text, ...axisInModel(IDENTITY, l) })),
    ),
  );
}

/** Line between a pair of equal labels on a floor plan, in IFC (X, Y). */
export interface LabelLine {
  text: string;
  kind: "section" | "axis";
  a: P2;
  b: P2;
}

/** Grid or mark label: 1 to 2 letters, a number up to 2 digits, also with an apostrophe (A', 1a). */
const LABEL_RE = /^(?:[A-Z]{1,2}'?|\d{1,2}[a-z]?'?)$/;
/** At most this many occurrences of a text on a page (otherwise it is not a grid label but e.g. an assembly number). */
const MAX_OCCURRENCES = 6;
/** The pair covers at least this part of the page in the line direction. */
const MIN_SPAN = 0.3;
/** Alignment of a pair (perpendicular to the line) and match of ends in a row of grids, share of the page dimension. */
const ALIGN_TOL = 0.006;
const ROW_TOL = 0.0025;
/** A row of grids has at least this many pairs with equal ends; fewer = a section mark. */
const GRID_MIN = 3;

interface PagePair {
  text: string;
  /** Orientation on the page: v = vertical line (equal x), h = horizontal. */
  dir: "v" | "h";
  a: P2;
  b: P2;
}

/** Pairs of equal labels aligned vertically or horizontally across a large part of the page. */
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
    // Each occurrence in at most one pair, longer pairs first.
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
 * Snaps a pair to a page line: parallel segments between labels within 6 pt of the connecting line
 * (section line, grid) move the connecting line to their mean position; without them the centre of the labels stays.
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

/** Floor plan label lines in IFC: rows of grids (at least 3 pairs with equal ends) and section marks. */
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
    // A section mark is a letter (A, B'), a bare number outside a row of grids is an assembly or element code.
    if (kind === "section" && !/[A-Z]/.test(p.text)) continue;
    const s = snapToLines(p, sheet.lines);
    out.push({ text: p.text, kind, a: applyAffine(sheet.affine, s.a), b: applyAffine(sheet.affine, s.b) });
  }
  return out;
}

/** Section letter from a document: `..._REZ-A`, `Rez B - ...`, `REZ C-C`. */
export function sectionMarkFromName(...names: (string | null | undefined)[]): string | null {
  for (const n of names) {
    const m = n ? /(?:^|[^a-z])rez[\s_-]*([a-z]{1,2}\d?)(?:[\s_-]*\1)?(?![a-z\d])/i.exec(n) : null;
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export interface SectionFromPlans {
  mark: string;
  /** Plane point (foot of the perpendicular from the IFC origin) and the direction of the section line (unit). */
  at: P2;
  dir: P2;
  /** Axis-aligned plane (direction deviation under 0.05 degrees): axis x = plane X = coordinate. */
  axis: { axis: "x" | "y"; coordinate_m: number } | null;
  /** Floor plans with the mark: deviation from the resulting line (perpendicular, mm; angle) and whether they were used. */
  plans: { ref: string; page: number; offset_mm: number; angle_deg: number; used: boolean }[];
  /** Largest deviation of the used floor plans from the resulting line (mm). */
  spread_mm: number;
  /** Position of grids and other sections along the cut (m from `at` in direction `dir`), key = label. */
  axes: Record<string, number>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** A floor plan farther from the match (perpendicular) is not used: another drawing with the same letter or a coarser calibration (PBR 1:100). */
const OUTLIER_M = 0.1;
const SNAP_DEG = 0.05;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Plane of the section `mark` from all calibrated floor plans that have the mark: direction and position as
 * the median (a floor plan off the match by more than 10 cm drops out, returned with `used: false`), grids and other marks
 * intersected by the plane as the position along the cut. Null if no floor plan has the mark.
 */
export function sectionFromPlans(mark: string, sheets: PlanSheet[]): SectionFromPlans | null {
  const hits: { sheet: PlanSheet; line: LabelLine; all: LabelLine[] }[] = [];
  for (const sheet of sheets) {
    const all = planLabelLines(sheet);
    const line = all.find((l) => l.kind === "section" && l.text === mark);
    if (line) hits.push({ sheet, line, all });
  }
  if (hits.length === 0) return null;
  // Direction unified (positive larger component), so that angles can be compared.
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
    // Direction (0, 1): normal (-1, 0), offset = -X.
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

  // Grids and other marks: the intersection of their line with the section line, position along the cut (m from `at`). A grid takes precedence
  // over a section mark with the same letter (grid B and section B): on the section drawing the grids are in a row above the section.
  const pos = new Map<string, { axis: number[]; section: number[] }>();
  hits.forEach((h, i) => {
    if (!used[i]) return;
    for (const l of h.all) {
      if (l.kind === "section" && l.text === mark) continue;
      const d: P2 = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
      const den = d[0] * n[0] + d[1] * n[1];
      const L = Math.hypot(d[0], d[1]);
      if (Math.abs(den) < 0.2 * L) continue; // almost parallel to the section
      const t = (off - (l.a[0] * n[0] + l.a[1] * n[1])) / den;
      if (t < -0.05 || t > 1.05) continue; // the line does not cross the section
      const p: P2 = [l.a[0] + t * d[0], l.a[1] + t * d[1]];
      const entry = pos.get(l.text) ?? { axis: [], section: [] };
      entry[l.kind].push((p[0] - at[0]) * dir[0] + (p[1] - at[1]) * dir[1]);
      pos.set(l.text, entry);
    }
  });
  const axes: Record<string, number> = {};
  for (const [text, e] of pos) {
    const us = e.axis.length ? e.axis : e.section;
    // The same label at two places along the cut is ambiguous: dropped.
    if (Math.max(...us) - Math.min(...us) > 0.2) continue;
    axes[text] = r3(median(us));
  }
  return { mark, at, dir: [r3(dir[0]) || 0, r3(dir[1]) || 0], axis, plans, spread_mm: spread, axes };
}
