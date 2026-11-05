/**
 * Tests, runs, clashes and clash state of the clash check (D-164): rows of the tables
 * `clash_tests`, `clash_runs`, `clash_results`, `clash_reviews` and the storage interface.
 * The carrier of a clash state is the pair test + `clash_key` (upstream `clashReviewKey`), not the run.
 */

export type ClashOrigin = "default" | "chat" | "viewer";
export type ReviewStatus = "open" | "resolved" | "accepted";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["open", "resolved", "accepted"];

/** One side of a test rule (upstream class selector, model, storey by AIM label). */
export interface ClashSideDef {
  type: string;
  model?: string;
  storey?: string;
  load_bearing?: "true" | "false" | "unknown";
}

export interface ClashRuleDef {
  /** Stable rule id = test code (it is part of `clash_key`). */
  id: string;
  a: ClashSideDef;
  b?: ClashSideDef;
}

export interface ClashSettingsDef {
  mode: "hard" | "clearance";
  clearance_mm?: number;
  tolerance_mm?: number;
}

export interface ClashTestRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  origin: ClashOrigin;
  rules: ClashRuleDef[];
  settings: ClashSettingsDef;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClashTestWrite {
  code: string;
  name: string;
  description: string | null;
  origin: ClashOrigin;
  rules: ClashRuleDef[];
  settings: ClashSettingsDef;
  created_by: string | null;
}

/** Elements the run verified (keys `model:GlobalId`); without them the comparison does not say "resolved". */
export interface ClashCoverage {
  a: string[];
  b: string[] | null;
}

export interface ClashRunRow {
  id: string;
  test_id: string | null;
  test_code: string | null;
  rules_snapshot: Record<string, unknown>;
  models: Record<string, unknown>;
  engine: string;
  trigger: "chat" | "viewer";
  completeness: Record<string, unknown>;
  summary: Record<string, unknown>;
  coverage: ClashCoverage | null;
  /** Input signature `{model: revision}` (D-183 K1); missing before the K1 migration, `{}` = unknown. */
  model_revisions?: Record<string, number> | null;
  created_by: string | null;
  created_at: string;
}

export interface ClashRunWrite {
  test_id: string | null;
  test_code: string | null;
  rules_snapshot: Record<string, unknown>;
  models: Record<string, unknown>;
  engine: string;
  trigger: "chat" | "viewer";
  completeness: Record<string, unknown>;
  summary: Record<string, unknown>;
  coverage: ClashCoverage | null;
  /** Input signature (D-183 point 11); without it the `clash_runs_stamp` trigger fills it in from `models`. */
  model_revisions?: Record<string, number>;
  created_by: string | null;
}

export interface ClashResultRow {
  clash_key: string;
  rule: string;
  status: "hard" | "clearance";
  severity: "critical" | "major" | "minor" | "info";
  /** m; negative = penetration depth. */
  distance: number;
  a_guid: string;
  a_model: string;
  a_ifc_type: string | null;
  a_name: string | null;
  b_guid: string;
  b_model: string;
  b_ifc_type: string | null;
  b_name: string | null;
  storey: string | null;
  /** [x, y, z] v IFC svete (m, Z hore). */
  center: number[] | null;
  /** Ako ich dal engine (Y hore); na obnovu behu. */
  point: number[] | null;
  bounds: number[][] | null;
}

export interface ClashReviewRow {
  test_id: string;
  clash_key: string;
  status: ReviewStatus;
  comment: string | null;
  bcf_topic_id: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface ClashStore {
  listTests(): Promise<ClashTestRow[]>;
  testByCode(code: string): Promise<ClashTestRow | null>;
  /** Creates a test or overwrites an existing one by `code`. */
  upsertTest(row: ClashTestWrite): Promise<ClashTestRow>;
  /** Deletes a test together with its runs, clashes and clash states. */
  deleteTest(id: string): Promise<void>;
  /** What deleting a test removes (for confirmation). */
  testStats(id: string): Promise<{ runs: number; reviews: number; topics: number }>;
  /** The last saved run of each test. */
  lastRuns(testIds: string[]): Promise<Map<string, ClashRunRow>>;
  /** Runs of a test, newest first. */
  runs(testId: string, limit: number): Promise<ClashRunRow[]>;
  run(id: string): Promise<ClashRunRow | null>;
  results(runId: string): Promise<ClashResultRow[]>;
  /** Saves a run and its clashes; on error also cancels the header. Returns the run id. */
  saveRun(run: ClashRunWrite, results: ClashResultRow[]): Promise<string>;
  /** All clash states of a test. */
  reviews(testId: string): Promise<ClashReviewRow[]>;
  /** Sets the status (and the note when given; otherwise it stays) on the clashes of a test; returns the count. */
  setReviews(testId: string, keys: string[], patch: { status: ReviewStatus; comment?: string }, by: string): Promise<number>;
  /** Attaches a BCF topic to clash states; does not change the status or note (a new clash is `open`). */
  linkTopic(testId: string, keys: string[], topicId: string): Promise<void>;
  /** BCF topic numbers (`model_tasks.number`) by id. */
  topicNumbers(topicIds: string[]): Promise<Map<string, number>>;
}

/** Gateway to the BCF layer (D-099, `BcfStore.create`): creates the Clash topic; `notify` announces the change to viewers. */
export interface ClashBcfPort {
  create(row: {
    title: string;
    description: string;
    topic_type: string;
    priority: string;
    labels: string[];
    model: string | null;
    components: string[];
    viewpoint: Record<string, unknown>;
    author: string;
  }): Promise<{ id: string; number: number }>;
  notify?(): Promise<void>;
}
