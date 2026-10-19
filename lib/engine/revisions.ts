/**
 * Revízie IFC modelov pre `ifc_models` (D-109): riadky `model_revisions` (D-086)
 * zúžené na to, čo Claude potrebuje na otázku "je toto najnovšie VZT?" - číslo,
 * základ, dátum, autor, obsah (sha256, veľkosť), recept a výsledok poistky.
 * Čisté funkcie bez DB; čítanie je v `lib/data/model-revisions.ts`.
 */

/** Riadok `model_revisions`, ako ho vráti DB. */
export interface ModelRevisionRow {
  model: string;
  revision: number;
  parent_revision: number | null;
  is_current: boolean;
  sha256: string;
  size_bytes: number;
  recipe_ref: string | null;
  summary: string | null;
  author: string | null;
  guard: unknown;
  created_at: string;
}

/** Načíta revízie modelov, najnovšie prvé; `perModel` = koľko na model. */
export type RevisionSource = (models: string[], perModel: number) => Promise<ModelRevisionRow[]>;

/** GUIDov pridaných/odobratých vypíše najviac toľko; počet je vždy celý. */
const MAX_GUIDS = 20;

const vnnn = (n: number) => `v${String(n).padStart(3, "0")}`;

function guardSummary(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as { ok?: unknown; errors?: unknown; schema?: unknown; objects?: unknown; added?: unknown; removed?: unknown; class_delta?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const added = list(g.added);
  const removed = list(g.removed);
  const errors = list(g.errors);
  return {
    ...(typeof g.ok === "boolean" ? { ok: g.ok } : {}),
    ...(typeof g.schema === "string" ? { schema: g.schema } : {}),
    ...(typeof g.objects === "number" ? { objects: g.objects } : {}),
    added: added.length,
    removed: removed.length,
    ...(added.length ? { added_guids: added.slice(0, MAX_GUIDS) } : {}),
    ...(removed.length ? { removed_guids: removed.slice(0, MAX_GUIDS) } : {}),
    ...(g.class_delta && typeof g.class_delta === "object" && Object.keys(g.class_delta).length ? { class_delta: g.class_delta } : {}),
    ...(errors.length ? { errors } : {}),
  };
}

/** Revízia pre odpoveď toolu. */
export function shapeRevision(row: ModelRevisionRow): Record<string, unknown> {
  const guard = guardSummary(row.guard);
  return {
    revision: row.revision,
    label: vnnn(row.revision),
    ...(row.parent_revision !== null ? { parent: row.parent_revision } : {}),
    current: row.is_current,
    published_at: row.created_at,
    ...(row.author ? { author: row.author } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    ...(row.recipe_ref ? { recipe: row.recipe_ref } : {}),
    // Úplný zoznam zmien (aj modify) je v repe OCB, v DB nie (D-086).
    changes_file: `Menezeris/OCB: zmeny/${row.model}/${vnnn(row.revision)}.json`,
    ...(guard ? { guard } : {}),
  };
}

/** Aktuálna revízia a (voliteľne) história modelu z riadkov, najnovšie prvé. */
export function revisionsFor(
  model: string,
  rows: readonly ModelRevisionRow[],
  history: number,
): { current: Record<string, unknown> | null; history?: Record<string, unknown>[] } {
  const own = rows.filter((r) => r.model === model).sort((a, b) => b.revision - a.revision);
  const current = own.find((r) => r.is_current) ?? null;
  return {
    current: current ? shapeRevision(current) : null,
    ...(history > 0 ? { history: own.slice(0, history).map(shapeRevision) } : {}),
  };
}
