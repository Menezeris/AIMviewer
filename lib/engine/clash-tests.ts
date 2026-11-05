/**
 * Default clash tests (D-164) and their input. Without engine dependencies, so that both the
 * tool definition and tests can import them.
 */

export const CLASH_ACTIONS = ["list", "run", "results", "bcf", "save", "delete", "compare", "review", "open", "from_viewer", "matrix"] as const;
export type ClashAction = (typeof CLASH_ACTIONS)[number];
/** Actions that go through the bridge into the viewer (D-164, host PR3): they need a live viewer. */
export const CLASH_VIEWER_ACTIONS: ReadonlySet<string> = new Set(["open", "from_viewer"]);

/** Who writes the test, the clash status and the BCF topic when the tool does not get it (like `bcf_topic`). */
export const CLASH_AUTHOR = "Claude (MCP)";
export const CLASH_STATES = ["open", "resolved", "accepted"] as const;
export const CLASH_BUCKETS = ["added", "resolved", "persistent", "unretested"] as const;
export type ClashBucket = (typeof CLASH_BUCKETS)[number];

export const CLASH_GROUPS = ["storey", "system", "type_pair", "element", "rule", "cluster"] as const;
export type ClashGroupBy = (typeof CLASH_GROUPS)[number];

/** One side of a test: element selection by a filter (all conditions at once). */
export interface ClashSide {
  /** Upstream IFC class selector: `IfcDuct*|IfcPipe*`, `!IfcSpace`, `*`. */
  type: string;
  model?: string;
  /** Storey by AIM label (1NP, 2.NP...), normalized in each model. */
  storey?: string;
  /** Load-bearing filter (`Pset_*Common.LoadBearing` from the occurrence, otherwise from the type): true | false | unknown (no value). */
  load_bearing?: "true" | "false" | "unknown";
}

export interface ClashTest {
  code: string;
  name: string;
  description: string;
  a: ClashSide;
  /** Without b = elements of the side among themselves. */
  b?: ClashSide;
  mode: "hard" | "clearance";
  clearance_mm?: number;
  tolerance_mm?: number;
}

/** Classes that can be load-bearing; whether they are is decided by `load_bearing` of side b (D-164 addendum 2026-10-31). */
export const STRUCTURAL_TYPES = "IfcWall*|IfcSlab*|IfcBeam*|IfcColumn*|IfcFooting*|IfcPile*|IfcMember*|IfcRoof*";

/**
 * Classes without a solid that `VZT-ASR` never treats as an obstacle (D-164 addendum 2026-10-31, #292):
 * spaces and spatial zones (air), openings and virtual elements (void, the penetration is handled by the host wall),
 * duct ports (connection points). A selector made only of exclusions is an AND (upstream `matchesSelector`).
 */
export const NON_SOLID_EXCLUDES = ["IfcSpace", "IfcSpatialZone", "IfcOpeningElement", "IfcVirtualElement", "IfcDistributionPort"] as const;
const exclude = (...extra: string[]) => [...NON_SOLID_EXCLUDES, ...extra].map((c) => `!${c}`).join("|");

export const DEFAULT_TESTS: ClashTest[] = [
  {
    code: "VZT-NOSNE",
    name: "VZT x nosné konštrukcie",
    description: `Prienik prvkov VZT s prvkami ASR tried ${STRUCTURAL_TYPES}, ktoré majú LoadBearing = true (z výskytu, inak z typu).`,
    a: { type: "*", model: "VZT" },
    b: { type: STRUCTURAL_TYPES, model: "ASR", load_bearing: "true" },
    mode: "hard",
  },
  {
    code: "VZT-ASR",
    name: "VZT x ASR",
    description: "VZT voči telesám ASR s odstupom 50 mm; bez IfcSpace, IfcSpatialZone, IfcOpeningElement, IfcVirtualElement a IfcDistributionPort (na oboch stranách). Dvere, okná, krytiny a ostatné prvky ASR sa berú.",
    a: { type: exclude(), model: "VZT" },
    b: { type: exclude(), model: "ASR" },
    mode: "clearance",
    clearance_mm: 50,
  },
];

/**
 * Default tests that fit a project (D-189): both sides name models the project has. A project
 * without ASR or VZT gets none; no code may assume a model code exists.
 */
export function defaultTestsFor(models: readonly string[]): ClashTest[] {
  const has = (m?: string) => !m || models.includes(m);
  return DEFAULT_TESTS.filter((t) => has(t.a.model) && has(t.b?.model));
}

export const findTest = (nameOrCode: string): ClashTest | undefined => {
  const want = nameOrCode.trim().toLowerCase();
  return DEFAULT_TESTS.find((t) => t.code.toLowerCase() === want || t.name.toLowerCase() === want);
};
