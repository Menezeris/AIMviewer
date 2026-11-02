/**
 * Tvar overenia výmer pre viewer (D-185 UI, fork `apps/viewer/src/aim/verify-protocol.ts`, záväzný): z riadkov
 * `v_verification_latest` alebo z čerstvého behu poskladá `VerifyElementWire` jedného prvku. Čistá logika bez DB.
 *
 * Pravidlá (návrh fork PR #227, časť 4):
 * - na veličinu a rodinu receptu (`space.height.slabs`) len najvyšší `registry_version` (potom najnovší beh);
 * - hlavný recept prvý (register: `check` = kontrolný, Height: `space.height.slabs` hlavný), stav veličiny = hlavný recept;
 * - veličiny, ktoré v súbore nie sú (`file_value` null), sa vynechajú;
 * - `spec.url` z `spec_ref`, `ref` buniek = `object_ref` výskytu podľa GUID (doplní volajúci mapou).
 */

import {
  SPACE_METHODS,
  methodOfRecipe,
  netVolumeTolerance,
  recipeFamily,
  recipeRank,
  targetRank,
  toleranceAbs,
  UNIT_OF_KIND,
  type QuantityMethod,
} from "./quantity-methods";
import type { VerificationInputs } from "./types";

export type VerifyStatus = "green" | "yellow" | "red" | "grey";
export type VerifyUnit = "m" | "m2" | "m3";

export interface VerifyCellWire {
  key: string;
  label: string;
  value: number;
  unit: string;
  global_id?: string;
  ref?: string;
}

export interface VerifyRecipeWire {
  recipe: string;
  status: VerifyStatus;
  explanation: string;
  method?: string;
  computed_value: number | null;
  expression?: string;
  cells: VerifyCellWire[];
  formula_text?: string;
  note?: string;
  anchors: { global_id: string; role: string; z_m?: number }[];
  segments?: { a: [number, number, number]; b: [number, number, number] }[];
}

export interface VerifyTargetWire {
  target: string;
  status: VerifyStatus;
  unit: VerifyUnit;
  file_value: number | null;
  computed_value: number | null;
  tolerance: { text: string; abs: number | null };
  definition?: string;
  spec?: { label: string; url: string };
  file_meta?: { method_of_measurement?: string; formula?: string };
  recipes: VerifyRecipeWire[];
}

export interface VerifyElementWire {
  version: 1;
  global_id: string;
  model: string;
  revision: number;
  current_revision: number;
  stale: boolean;
  checked_at: string;
  registry_version: number;
  engine?: string;
  help_href?: string;
  targets: VerifyTargetWire[];
}

export interface VerifyRunAllWire {
  check: string;
  model?: string;
  revision?: number;
  elements: number;
  counts: Record<VerifyStatus, number>;
}

/** Riadok výsledku receptu: stĺpce `v_verification_latest` (aj čerstvý beh v tom istom tvare). */
export interface VerifyRow {
  model: string;
  revision: number | null;
  global_id: string;
  target: string;
  recipe: string;
  status: VerifyStatus;
  file_value: number | null;
  computed_value: number | null;
  method: string;
  definition: string | null;
  spec_ref: string | null;
  tolerance: string | null;
  formula: string | null;
  note: string | null;
  anchors: Array<{ global_id: string; role: string; z_m?: number }> | null;
  registry_version: number;
  checked_at: string;
  engine?: string | null;
  stale?: boolean | null;
  explanation?: string | null;
  inputs?: VerificationInputs | null;
}

/** Stránka hosta "Ako to funguje?" (D-185: recepty, stavy, tolerancie). */
export const VERIFY_HELP_HREF = "/overenie";

/** Kontrola v ribbone viewera (zatiaľ jediná). */
export const VERIFY_CHECK_SPACES = "space_quantities";

const SPEC_RE = /^([^@\s]+)@([0-9a-f]{7,40}):(\S+?\.xml)#(\w+)$/i;

/** `buildingSMART/IFC4.3.x-development@d71e140:reference_schemas/psd/X.xml#Name` -> odkaz na GitHub a menovka. */
export function specLink(specRef: string | null | undefined): { label: string; url: string } | undefined {
  const m = specRef ? SPEC_RE.exec(specRef) : null;
  if (!m) return undefined;
  const [, repo, commit, path, name] = m;
  const file = path.split("/").pop()!.replace(/\.xml$/i, "");
  return { label: `${file}.${name}, IFC 4.3`, url: `https://github.com/${repo}/blob/${commit}/${path}` };
}

const later = (a: VerifyRow, b: VerifyRow) =>
  b.registry_version - a.registry_version || (b.checked_at > a.checked_at ? 1 : b.checked_at < a.checked_at ? -1 : 0);

/** Na veličinu a rodinu receptu najvyšší `registry_version`, pri zhode najnovší beh. */
export function pickLatestRecipes(rows: readonly VerifyRow[]): VerifyRow[] {
  const best = new Map<string, VerifyRow>();
  for (const r of rows) {
    const k = `${r.target}\u0000${recipeFamily(r.recipe)}`;
    const cur = best.get(k);
    if (!cur || later(cur, r) > 0) best.set(k, r);
  }
  return [...best.values()];
}

function toleranceOf(target: string, method: QuantityMethod | null, file: number | null, byTarget: Map<string, VerifyRow[]>): number | null {
  if (file == null || !method) return null;
  if (method === SPACE_METHODS.net_volume) {
    const gv = byTarget.get(SPACE_METHODS.gross_volume.target)?.[0]?.file_value;
    return gv != null ? Math.round(netVolumeTolerance(gv, file).abs_m3 * 1e6) / 1e6 : null;
  }
  void target;
  return toleranceAbs(method.kind, file);
}

function recipeWire(r: VerifyRow, refs: ReadonlyMap<string, string>): VerifyRecipeWire {
  const reg = methodOfRecipe(r.recipe);
  const cells = (r.inputs?.cells ?? []).map((c) => {
    const ref = c.global_id ? refs.get(c.global_id) : undefined;
    return { key: c.key, label: c.label, value: c.value, unit: c.unit, ...(c.global_id ? { global_id: c.global_id } : {}), ...(ref ? { ref } : {}) };
  });
  return {
    recipe: r.recipe,
    status: r.status,
    explanation: r.explanation || reg?.explanation || r.method,
    method: r.method,
    computed_value: r.computed_value,
    ...(r.inputs?.expression ? { expression: r.inputs.expression } : {}),
    cells,
    ...(r.formula ? { formula_text: r.formula } : {}),
    ...(r.note ? { note: r.note } : {}),
    anchors: r.anchors ?? [],
  };
}

export interface ElementWireOptions {
  /** Aktuálna revízia modelu (`model_revisions.is_current`); null = neznáma (stale len z pohľadu). */
  currentRevision: number | null;
  /** GUID -> `object_ref` výskytu (bunky a kotvy). */
  refs?: ReadonlyMap<string, string>;
  helpHref?: string;
}

/** Riadky jedného prvku -> `VerifyElementWire`; null, keď prvok nemá žiadny riadok. */
export function elementWire(rows: readonly VerifyRow[], opts: ElementWireOptions): VerifyElementWire | null {
  if (rows.length === 0) return null;
  const picked = pickLatestRecipes(rows);
  const refs = opts.refs ?? new Map<string, string>();
  const byTarget = new Map<string, VerifyRow[]>();
  for (const r of picked) byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r]);
  for (const list of byTarget.values()) list.sort((a, b) => recipeRank(a.recipe) - recipeRank(b.recipe));

  const targets: VerifyTargetWire[] = [];
  for (const [target, list] of [...byTarget.entries()].sort((a, b) => targetRank(a[0]) - targetRank(b[0]))) {
    const main = list[0];
    // Rozhodnutie 2 (Samuel 2. 11.): veličina, ktorá v súbore nie je, sa nezobrazuje.
    if (main.file_value == null) continue;
    const reg = methodOfRecipe(main.recipe);
    const unit: VerifyUnit = reg ? UNIT_OF_KIND[reg.kind] : "m";
    const fileMeta = main.inputs?.file_meta;
    targets.push({
      target,
      status: main.status,
      unit,
      file_value: main.file_value,
      computed_value: main.computed_value,
      tolerance: { text: main.tolerance ?? "", abs: toleranceOf(target, reg, main.file_value, byTarget) },
      ...(main.definition || reg?.definition ? { definition: main.definition || reg!.definition } : {}),
      ...(specLink(main.spec_ref ?? reg?.spec_ref) ? { spec: specLink(main.spec_ref ?? reg?.spec_ref)! } : {}),
      ...(fileMeta && (fileMeta.method_of_measurement || fileMeta.formula) ? { file_meta: fileMeta } : {}),
      recipes: list.map((r) => recipeWire(r, refs)),
    });
  }

  const newest = [...picked].sort((a, b) => (b.checked_at > a.checked_at ? 1 : b.checked_at < a.checked_at ? -1 : 0))[0];
  const revisions = picked.map((r) => r.revision).filter((x): x is number => typeof x === "number");
  const revision = revisions.length ? Math.min(...revisions) : 0;
  const current = opts.currentRevision ?? revision;
  return {
    version: 1,
    global_id: newest.global_id,
    model: newest.model,
    revision,
    current_revision: current,
    stale: picked.some((r) => r.stale === true) || (opts.currentRevision != null && revision < opts.currentRevision),
    checked_at: newest.checked_at,
    registry_version: Math.max(...picked.map((r) => r.registry_version)),
    ...(newest.engine ? { engine: newest.engine } : {}),
    ...(opts.helpHref ? { help_href: opts.helpHref } : {}),
    targets,
  };
}

/** GUID buniek a kotiev (na doplnenie `object_ref`). */
export function referencedGuids(rows: readonly VerifyRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    for (const c of r.inputs?.cells ?? []) if (c.global_id) out.add(c.global_id);
    for (const a of r.anchors ?? []) if (a.global_id) out.add(a.global_id);
  }
  return [...out];
}

/** Počty stavov veličín, ktoré viewer ukáže (hlavný recept, len veličiny zo súboru). */
export function visibleCounts(elements: readonly VerifyElementWire[]): Record<VerifyStatus, number> {
  const c: Record<VerifyStatus, number> = { green: 0, yellow: 0, red: 0, grey: 0 };
  for (const e of elements) for (const t of e.targets) c[t.status]++;
  return c;
}
