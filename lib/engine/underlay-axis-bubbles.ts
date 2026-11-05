import { blockCenter, type AxisLine, type P2, type PageBlock, type RefAxis } from "./underlay-calibrate";

/**
 * Floor plan grids from rows of bubbles (D-184 addendum, #170): grid labels (A to F, 1 to 4) on a page without complete pairs
 * in the page direction. It also finds a rotated floor plan (SF.01: 19° on the sheet) and a detail where a grid is at one end only
 * (TP.01 1NP, 4NP). Pure logic without DB and engine.
 *
 * Row of bubbles = at least 2 different labels of the same grid family (letters = grids of the plane X, numbers = grids of the plane Y per
 * references from other drawings) on one straight line, whose distance on the page at known scale matches
 * the spacing of the same grids in the model (within `SPACING_TOL_M`). A grid is perpendicular to its row of bubbles, so the row also gives the
 * rotation of the grid network on the page. A family without its own row (TP.01 1NP: grid C) gets the direction perpendicular to the row of the other
 * family (the network is orthogonal).
 */

/** At most this many occurrences of a label in the watched region (otherwise it is not a grid label but e.g. an assembly number). */
const MAX_OCCURRENCES = 6;
/** A bubble belongs to a row when it is within this many page points of the row line. */
const ROW_DIST_PT = 6;
/** Spacing of bubbles in a row against the spacing of grids in the model (m). */
const SPACING_TOL_M = 0.3;
/** Rows agree in the network rotation within this many degrees. */
const ANGLE_TOL_DEG = 1;
/** Length of the synthetic grid line (page points): the direction for `axisInModel`, position = bubble. */
const AXIS_LEN_PT = 100;

export interface BubbleGrid {
  /** Page grids: bubble and grid direction (a = bubble, b = bubble + direction). */
  lines: AxisLine[];
  /** Network rotation on the page (degrees, 0 to 180): direction of the row of letter bubbles (X grids). */
  gridDeg: number;
  /** Rows of bubbles (labels in order). */
  rows: string[];
}

interface Label {
  text: string;
  dir: "x" | "y";
  at: number;
  p: P2;
}

const mod180 = (d: number) => ((d % 180) + 180) % 180;
const angDiff = (a: number, b: number) => Math.abs(mod180(a - b + 90) - 90);

/**
 * Rows of grid bubbles of a page (region) at known scale `s` (m per page point). `refs` are grid positions from other
 * calibrated drawings; a label that is not among them is ignored. Null without a row of at least 2 bubbles.
 */
export function bubbleAxes(pageSize: P2, blocks: PageBlock[], refs: RefAxis[], s: number): BubbleGrid | null {
  const refBy = new Map<string, RefAxis>();
  const dup = new Set<string>();
  for (const r of refs) {
    if (refBy.has(r.text)) dup.add(r.text);
    refBy.set(r.text, r);
  }
  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(b.t.trim(), (counts.get(b.t.trim()) ?? 0) + 1);
  const labels: Label[] = [];
  for (const b of blocks) {
    const t = b.t.trim();
    const r = refBy.get(t);
    // A label in both directions (a grid and another grid with the same name) is ambiguous.
    if (!r || dup.has(t) || (counts.get(t) ?? 0) > MAX_OCCURRENCES) continue;
    labels.push({ text: t, dir: r.dir, at: r.at, p: blockCenter(b, pageSize) });
  }

  // Rows: a line through two bubbles of different grids of the same family with a spacing as in the model, further bubbles onto it.
  const rows: { dir: "x" | "y"; deg: number; members: Label[] }[] = [];
  for (const dir of ["x", "y"] as const) {
    const fam = labels.filter((l) => l.dir === dir);
    const found: { deg: number; members: Label[] }[] = [];
    for (let i = 0; i < fam.length; i++) {
      for (let j = i + 1; j < fam.length; j++) {
        const [a, b] = [fam[i], fam[j]];
        if (a.text === b.text) continue;
        const L = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
        if (!(L > 0) || Math.abs(L * s - Math.abs(b.at - a.at)) > SPACING_TOL_M) continue;
        const u: P2 = [(b.p[0] - a.p[0]) / L, (b.p[1] - a.p[1]) / L];
        // Row direction so that the grid position grows along the row (sign from the pair a -> b).
        const sign = Math.sign(b.at - a.at) || 1;
        const members: Label[] = [];
        const texts = new Set<string>();
        for (const c of fam) {
          const dx = c.p[0] - a.p[0];
          const dy = c.p[1] - a.p[1];
          if (Math.abs(dx * u[1] - dy * u[0]) > ROW_DIST_PT) continue;
          const along = (dx * u[0] + dy * u[1]) * s * sign;
          if (Math.abs(along - (c.at - a.at)) > SPACING_TOL_M || texts.has(c.text)) continue;
          texts.add(c.text);
          members.push(c);
        }
        if (members.length < 2) continue;
        const key = members.map((m) => m.text).sort().join(",");
        if (found.some((f) => f.members.map((m) => m.text).sort().join(",") === key && f.members.every((m) => members.includes(m)))) continue;
        found.push({ deg: mod180((Math.atan2(u[1], u[0]) * 180) / Math.PI), members });
      }
    }
    // Largest rows first; a bubble is in at most one row.
    const used = new Set<Label>();
    for (const f of found.sort((x, y) => y.members.length - x.members.length)) {
      if (f.members.some((m) => used.has(m))) continue;
      f.members.forEach((m) => used.add(m));
      rows.push({ dir, ...f });
    }
  }
  if (rows.length === 0) return null;

  // Network rotation: the row of letters (X grids) has the network direction, the row of numbers is perpendicular to it. Majority of bubbles agree.
  const grid = (r: (typeof rows)[number]) => mod180(r.dir === "x" ? r.deg : r.deg + 90);
  let best: { deg: number; n: number } | null = null;
  for (const r of rows) {
    const n = rows.filter((q) => angDiff(grid(q), grid(r)) <= ANGLE_TOL_DEG).reduce((acc, q) => acc + q.members.length, 0);
    if (!best || n > best.n) best = { deg: grid(r), n };
  }
  let gridDeg = best!.deg;
  // Rows of one family from the same floor plan have the same shift (bubble position along the row direction - grid position);
  // a row with another shift is from a neighbouring floor plan reaching into the region (rotated floor plans SF.01).
  const offsetOf = (r: (typeof rows)[number]) => {
    const d = ((r.dir === "x" ? gridDeg : gridDeg + 90) * Math.PI) / 180;
    const proj = r.members.map((m) => (m.p[0] * Math.cos(d) + m.p[1] * Math.sin(d)) * s);
    const [a, b] = [r.members[0], r.members[r.members.length - 1]];
    const sign = Math.sign((proj[r.members.length - 1] - proj[0]) * (b.at - a.at)) || 1;
    const vals = r.members.map((m, i) => proj[i] - sign * m.at).sort((x, y) => x - y);
    return { sign, off: vals[vals.length >> 1] };
  };
  const kept: typeof rows = [];
  for (const dir of ["x", "y"] as const) {
    const fam = rows.filter((r) => r.dir === dir && angDiff(grid(r), gridDeg) <= ANGLE_TOL_DEG).map((r) => ({ r, ...offsetOf(r) }));
    let pick: typeof fam = [];
    for (const f of fam) {
      const same = fam.filter((g) => g.sign === f.sign && Math.abs(g.off - f.off) <= 2 * SPACING_TOL_M);
      const n = same.reduce((acc, g) => acc + g.r.members.length, 0);
      if (n > pick.reduce((acc, g) => acc + g.r.members.length, 0)) pick = same;
    }
    kept.push(...pick.map((g) => g.r));
  }
  // Network rotation = weighted mean of rows (weight = number of bubbles), not the rotation of a single row.
  let sw = 0;
  let sd = 0;
  for (const r of kept) {
    const d = grid(r);
    sd += (d + Math.round((gridDeg - d) / 180) * 180) * r.members.length;
    sw += r.members.length;
  }
  if (sw > 0) gridDeg = mod180(sd / sw);
  // A grid of family x (letters) is perpendicular to the row of letters, a grid of family y is in the direction of the row of letters.
  const axisDir = (dir: "x" | "y"): P2 => {
    const d = ((dir === "x" ? gridDeg + 90 : gridDeg) * Math.PI) / 180;
    return [Math.cos(d), Math.sin(d)];
  };
  const lines: AxisLine[] = [];
  const add = (l: Label) => {
    const d = axisDir(l.dir);
    lines.push({ text: l.text, a: l.p, b: [l.p[0] + d[0] * AXIS_LEN_PT, l.p[1] + d[1] * AXIS_LEN_PT] });
  };
  for (const r of kept) r.members.forEach(add);
  // A family without a row: its bubbles (each label at most 2 times, both ends of the grid) with a direction perpendicular to the network.
  for (const dir of ["x", "y"] as const) {
    if (kept.some((r) => r.dir === dir)) continue;
    for (const l of labels) if (l.dir === dir && (counts.get(l.text) ?? 0) <= 2) add(l);
  }
  return { lines, gridDeg: +gridDeg.toFixed(3), rows: kept.map((r) => r.members.map((m) => m.text).join("")) };
}
