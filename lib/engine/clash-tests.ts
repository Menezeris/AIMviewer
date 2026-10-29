/**
 * Predvolené testy kolízií (D-164) a ich vstup. Bez závislostí motora, aby ich mohla
 * importovať definícia toolu aj testy.
 */

export const CLASH_ACTIONS = ["list", "run", "results", "bcf", "save", "delete", "compare", "review", "open", "from_viewer", "matrix"] as const;
export type ClashAction = (typeof CLASH_ACTIONS)[number];
/** Akcie, ktoré idú cez most do viewera (D-164, host PR3): potrebujú živý viewer. */
export const CLASH_VIEWER_ACTIONS: ReadonlySet<string> = new Set(["open", "from_viewer"]);

/** Kto zapisuje test, stav kolízie a BCF tému, keď to tool nedostane (ako `bcf_topic`). */
export const CLASH_AUTHOR = "Claude (MCP)";
export const CLASH_STATES = ["open", "resolved", "accepted"] as const;
export const CLASH_BUCKETS = ["added", "resolved", "persistent", "unretested"] as const;
export type ClashBucket = (typeof CLASH_BUCKETS)[number];

export const CLASH_GROUPS = ["storey", "system", "type_pair", "element", "rule", "cluster"] as const;
export type ClashGroupBy = (typeof CLASH_GROUPS)[number];

/** Jedna strana testu: výber prvkov filtrom (všetky podmienky naraz). */
export interface ClashSide {
  /** Selektor IFC tried upstream: `IfcDuct*|IfcPipe*`, `!IfcSpace`, `*`. */
  type: string;
  model?: string;
  /** Podlažie podľa štítku AIM (1NP, 2.NP...), v každom modeli normalizované. */
  storey?: string;
}

export interface ClashTest {
  code: string;
  name: string;
  description: string;
  a: ClashSide;
  /** Bez b = prvky strany a medzi sebou. */
  b?: ClashSide;
  mode: "hard" | "clearance";
  clearance_mm?: number;
  tolerance_mm?: number;
}

/** Nosné triedy ASR: LoadBearing sa nefiltruje (vnútorné priečky v nich ostávajú). */
export const STRUCTURAL_TYPES = "IfcWall*|IfcSlab*|IfcBeam*|IfcColumn*|IfcFooting*|IfcPile*|IfcMember*|IfcRoof*";

export const DEFAULT_TESTS: ClashTest[] = [
  {
    code: "VZT-NOSNE",
    name: "VZT x nosné konštrukcie",
    description: `Prienik prvkov VZT s nosnými triedami ASR (${STRUCTURAL_TYPES}); LoadBearing sa nefiltruje.`,
    a: { type: "*", model: "VZT" },
    b: { type: STRUCTURAL_TYPES, model: "ASR" },
    mode: "hard",
  },
  {
    code: "VZT-ASR",
    name: "VZT x ASR",
    description: "VZT voči celému ASR (bez IfcSpace) s odstupom 50 mm.",
    a: { type: "*", model: "VZT" },
    b: { type: "!IfcSpace", model: "ASR" },
    mode: "clearance",
    clearance_mm: 50,
  },
];

export const findTest = (nameOrCode: string): ClashTest | undefined => {
  const want = nameOrCode.trim().toLowerCase();
  return DEFAULT_TESTS.find((t) => t.code.toLowerCase() === want || t.name.toLowerCase() === want);
};
