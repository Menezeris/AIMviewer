/**
 * Testy, behy, kolízie a stav kolízie kontroly kolízií (D-164): riadky tabuliek
 * `clash_tests`, `clash_runs`, `clash_results`, `clash_reviews` a rozhranie úložiska.
 * Nositeľ stavu kolízie je dvojica test + `clash_key` (upstream `clashReviewKey`), nie beh.
 */

export type ClashOrigin = "default" | "chat" | "viewer";
export type ReviewStatus = "open" | "resolved" | "accepted";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["open", "resolved", "accepted"];

/** Jedna strana pravidla testu (selektor tried upstream, model, podlažie podľa štítku AIM). */
export interface ClashSideDef {
  type: string;
  model?: string;
  storey?: string;
  load_bearing?: "true" | "false" | "unknown";
}

export interface ClashRuleDef {
  /** Stabilné id pravidla = kód testu (je súčasťou `clash_key`). */
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

/** Prvky, ktoré beh overil (kľúče `model:GlobalId`); bez nich porovnanie nepovie "vyriešené". */
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
  /** Podpis vstupu `{model: revízia}` (D-183 K1); chýba pred migráciou K1, `{}` = neznámy. */
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
  /** Podpis vstupu (D-183 bod 11); bez neho ho doplní trigger `clash_runs_stamp` z `models`. */
  model_revisions?: Record<string, number>;
  created_by: string | null;
}

export interface ClashResultRow {
  clash_key: string;
  rule: string;
  status: "hard" | "clearance";
  severity: "critical" | "major" | "minor" | "info";
  /** m; záporné = hĺbka prieniku. */
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
  /** Vytvorí test alebo prepíše existujúci podľa `code`. */
  upsertTest(row: ClashTestWrite): Promise<ClashTestRow>;
  /** Zmaže test aj jeho behy, kolízie a stavy kolízií. */
  deleteTest(id: string): Promise<void>;
  /** Čo zmazanie testu odstráni (na potvrdenie). */
  testStats(id: string): Promise<{ runs: number; reviews: number; topics: number }>;
  /** Posledný uložený beh každého z testov. */
  lastRuns(testIds: string[]): Promise<Map<string, ClashRunRow>>;
  /** Behy testu, najnovšie prvé. */
  runs(testId: string, limit: number): Promise<ClashRunRow[]>;
  run(id: string): Promise<ClashRunRow | null>;
  results(runId: string): Promise<ClashResultRow[]>;
  /** Uloží beh a jeho kolízie; pri chybe zruší aj hlavičku. Vráti id behu. */
  saveRun(run: ClashRunWrite, results: ClashResultRow[]): Promise<string>;
  /** Všetky stavy kolízií testu. */
  reviews(testId: string): Promise<ClashReviewRow[]>;
  /** Nastaví stav (a poznámku, keď je zadaná; inak ostane) kolíziám testu; vráti počet. */
  setReviews(testId: string, keys: string[], patch: { status: ReviewStatus; comment?: string }, by: string): Promise<number>;
  /** Pripojí k stavom kolízií BCF tému; stav a poznámku nemení (nová kolízia je `open`). */
  linkTopic(testId: string, keys: string[], topicId: string): Promise<void>;
  /** Čísla BCF tém (`model_tasks.number`) podľa id. */
  topicNumbers(topicIds: string[]): Promise<Map<string, number>>;
}

/** Brána k BCF vrstve (D-099, `BcfStore.create`): založí tému Clash; `notify` oznámi zmenu viewerom. */
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
