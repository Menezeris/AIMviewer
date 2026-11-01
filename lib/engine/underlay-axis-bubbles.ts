import { blockCenter, type AxisLine, type P2, type PageBlock, type RefAxis } from "./underlay-calibrate";

/**
 * Osi pôdorysu z radov bublín (D-184 dodatok, #170): popisky osí (A až F, 1 až 4) na strane bez úplných dvojíc
 * v smere strany. Nájde aj natočený pôdorys (SF.01: 19° na hárku) a výsek, kde je os len na jednom konci
 * (TP.01 1NP, 4NP). Čistá logika bez DB a motora.
 *
 * Rad bublín = aspoň 2 rôzne popisky tej istej rodiny osí (písmená = osi roviny X, čísla = osi roviny Y podľa
 * referencií z iných výkresov) na jednej priamke, ktorých vzdialenosť na strane pri známej mierke sedí s
 * rozostupom tých istých osí v modeli (do `SPACING_TOL_M`). Os je kolmá na svoj rad bublín, takže z radu je aj
 * natočenie siete osí na strane. Rodina bez vlastného radu (TP.01 1NP: os C) dostane smer kolmý na rad druhej
 * rodiny (sieť je pravouhlá).
 */

/** Najviac výskytov popisku v sledovanom výreze (inak to nie je popisok osi, ale napr. číslo skladby). */
const MAX_OCCURRENCES = 6;
/** Bublina patrí do radu, keď je od priamky radu do toľko bodov strany. */
const ROW_DIST_PT = 6;
/** Rozostup bublín v rade proti rozostupu osí v modeli (m). */
const SPACING_TOL_M = 0.3;
/** Rady sa zhodujú v natočení siete do toľko stupňov. */
const ANGLE_TOL_DEG = 1;
/** Dĺžka syntetickej čiary osi (body strany): smer pre `axisInModel`, poloha = bublina. */
const AXIS_LEN_PT = 100;

export interface BubbleGrid {
  /** Osi strany: bublina a smer osi (a = bublina, b = bublina + smer). */
  lines: AxisLine[];
  /** Natočenie siete na strane (stupne, 0 až 180): smer radu bublín písmen (osi X). */
  gridDeg: number;
  /** Rady bublín (popisky v poradí). */
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
 * Rady bublín osí strany (výrezu) pri známej mierke `s` (m na bod strany). `refs` sú polohy osí z iných
 * kalibrovaných výkresov; popisok, ktorý medzi nimi nie je, sa ignoruje. Null bez radu aspoň 2 bublín.
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
    // Popisok v oboch smeroch (os aj iná os s rovnakým menom) je nejednoznačný.
    if (!r || dup.has(t) || (counts.get(t) ?? 0) > MAX_OCCURRENCES) continue;
    labels.push({ text: t, dir: r.dir, at: r.at, p: blockCenter(b, pageSize) });
  }

  // Rady: priamka cez dve bubliny rôznych osí tej istej rodiny s rozostupom ako v modeli, k nej ďalšie bubliny.
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
        // Smer radu tak, aby poloha osi rástla po rade (znamienko z dvojice a -> b).
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
    // Najväčšie rady prvé; bublina je najviac v jednom rade.
    const used = new Set<Label>();
    for (const f of found.sort((x, y) => y.members.length - x.members.length)) {
      if (f.members.some((m) => used.has(m))) continue;
      f.members.forEach((m) => used.add(m));
      rows.push({ dir, ...f });
    }
  }
  if (rows.length === 0) return null;

  // Natočenie siete: rad písmen (osi X) má smer siete, rad čísel je naň kolmý. Zhoda väčšiny bublín.
  const grid = (r: (typeof rows)[number]) => mod180(r.dir === "x" ? r.deg : r.deg + 90);
  let best: { deg: number; n: number } | null = null;
  for (const r of rows) {
    const n = rows.filter((q) => angDiff(grid(q), grid(r)) <= ANGLE_TOL_DEG).reduce((acc, q) => acc + q.members.length, 0);
    if (!best || n > best.n) best = { deg: grid(r), n };
  }
  let gridDeg = best!.deg;
  // Rady jednej rodiny z toho istého pôdorysu majú rovnaký posun (poloha bubliny po smere radu - poloha osi);
  // rad s iným posunom je zo susedného pôdorysu, ktorý zasahuje do výrezu (natočené pôdorysy SF.01).
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
  // Natočenie siete = vážený priemer radov (váha = počet bublín), nie natočenie jedného radu.
  let sw = 0;
  let sd = 0;
  for (const r of kept) {
    const d = grid(r);
    sd += (d + Math.round((gridDeg - d) / 180) * 180) * r.members.length;
    sw += r.members.length;
  }
  if (sw > 0) gridDeg = mod180(sd / sw);
  // Os rodiny x (písmená) je kolmá na rad písmen, os rodiny y je v smere radu písmen.
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
  // Rodina bez radu: jej bubliny (každý popisok najviac 2-krát, oba konce osi) so smerom kolmým na sieť.
  for (const dir of ["x", "y"] as const) {
    if (kept.some((r) => r.dir === dir)) continue;
    for (const l of labels) if (l.dir === dir && (counts.get(l.text) ?? 0) <= 2) add(l);
  }
  return { lines, gridDeg: +gridDeg.toFixed(3), rows: kept.map((r) => r.members.map((m) => m.text).join("")) };
}
