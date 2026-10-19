/**
 * Čistá logika rozšíreného `style_in_3d` (D-096): skupiny s vlastnou farbou,
 * AND kritériá a stavba viewer ops. Dohľadanie členov systému, zóny a podlažia
 * v DB robí `style-scope.ts`; tu sa nič nečíta ani nezapisuje.
 */

export class StyleInputError extends Error {}

/** Max skupín v jednom volaní. */
export const MAX_STYLE_GROUPS = 12;
/**
 * Max GUIDov spolu za všetky skupiny jedného volania: ~23 znakov na GUID v URL,
 * akcia klienta smie mať najviac 16 000 znakov (`isSafeViewerUrl`), rezerva na
 * ďalšie akcie toho istého kola.
 */
export const SCOPED_GUID_CAP = 500;

const HEX6 = /^[0-9a-f]{6}$/;

/** Kľúče filtra, ktoré smie niesť top-level vstup aj skupina. */
export const FILTER_KEYS = [
  "ids_or_refs",
  "global_ids",
  "ifc_type",
  "ifc_types",
  "domain",
  "predefined_type",
  "property",
  "value",
  "pset",
  "query",
  "model",
  "system",
  "system_type",
  "not_in_system",
  "zone",
  "storey",
] as const;

/** Kritériá, ktoré vyžadujú rozbalenie členov v DB (D-096). */
const SCOPE_KEYS = ["system", "system_type", "not_in_system", "zone", "storey"] as const;

export type StyleFilter = Partial<Record<(typeof FILTER_KEYS)[number], unknown>>;

export interface StyleGroup {
  label: string;
  color: string;
  filter: StyleFilter;
}

const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== false && !(typeof v === "string" && v.trim() === "") &&
  !(Array.isArray(v) && v.length === 0);

/** Ide o rozšírený režim (systém, zóna, podlažie alebo skupiny)? */
export function needsScopedStyle(input: Record<string, unknown>): boolean {
  return Array.isArray(input.groups) || SCOPE_KEYS.some((k) => present(input[k]));
}

function pickFilter(src: Record<string, unknown>): StyleFilter {
  const out: StyleFilter = {};
  for (const k of FILTER_KEYS) if (present(src[k])) out[k] = src[k];
  return out;
}

function normColor(raw: unknown): string {
  return String(raw ?? "").trim().replace(/^#/, "").toLowerCase();
}

/** Krátky popis filtra pre štítok skupiny. */
export function describeFilter(f: StyleFilter): string {
  const parts: string[] = [];
  const types = Array.isArray(f.ifc_types) ? (f.ifc_types as unknown[]).map(String) : [];
  if (f.ifc_type) types.unshift(String(f.ifc_type));
  if (types.length) parts.push(types.slice(0, 2).join("+") + (types.length > 2 ? "…" : ""));
  if (f.domain) parts.push(String(f.domain));
  if (f.predefined_type) parts.push(String(f.predefined_type));
  if (f.system) parts.push(`systém ${f.system}`);
  if (f.system_type) parts.push(`typ systému ${f.system_type}`);
  if (f.not_in_system) parts.push("bez systému");
  if (f.zone) parts.push(`zóna ${f.zone}`);
  if (f.storey) parts.push(String(f.storey));
  if (f.property) parts.push(`${f.property}=${f.value ?? ""}`);
  if (f.query) parts.push(`"${f.query}"`);
  if (f.model) parts.push(`model ${f.model}`);
  return parts.join(", ") || "výber";
}

/**
 * Vstup toolu -> skupiny. Bez `groups` je to jedna skupina z top-level filtra.
 * S `groups` platí top-level filter pre všetky skupiny (AND) a skupina ho
 * spresní alebo prepíše vlastnými kľúčmi.
 */
export function parseStyleGroups(input: Record<string, unknown>, action: string): StyleGroup[] {
  const base = pickFilter(input);
  if (!Array.isArray(input.groups)) {
    const color = action === "colorize" ? normColor(input.color) : "";
    if (action === "colorize" && !HEX6.test(color)) {
      throw new StyleInputError("color musí byť hex RRGGBB (napr. ef4444 pre červenú).");
    }
    return [{ label: describeFilter(base), color, filter: base }];
  }
  if (action !== "colorize") {
    throw new StyleInputError("groups platí len s action=colorize (každá skupina má vlastnú farbu).");
  }
  const raw = input.groups as unknown[];
  if (raw.length === 0) throw new StyleInputError("groups je prázdne - zadaj aspoň jednu skupinu {color, filter}.");
  if (raw.length > MAX_STYLE_GROUPS) throw new StyleInputError(`Najviac ${MAX_STYLE_GROUPS} skupín v jednom volaní.`);
  return raw.map((g, i) => {
    if (!g || typeof g !== "object" || Array.isArray(g)) {
      throw new StyleInputError(`groups[${i}] musí byť objekt {label, color, ...filter}.`);
    }
    const obj = g as Record<string, unknown>;
    const color = normColor(obj.color);
    if (!HEX6.test(color)) throw new StyleInputError(`groups[${i}].color musí byť hex RRGGBB.`);
    const filter = { ...base, ...pickFilter(obj) };
    if (Object.keys(filter).length === 0) {
      throw new StyleInputError(`groups[${i}] nemá žiadny filter (system, zone, storey, ifc_type...).`);
    }
    const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim().slice(0, 60) : describeFilter(filter);
    return { label, color, filter };
  });
}

/** Prienik množín (AND); `null` = kritérium nezadané. Všetky null -> null. */
export function intersectSets(sets: (Set<string> | null)[]): Set<string> | null {
  const given = sets.filter((s): s is Set<string> => s !== null);
  if (given.length === 0) return null;
  given.sort((a, b) => a.size - b.size);
  const [first, ...rest] = given;
  return new Set([...first].filter((v) => rest.every((s) => s.has(v))));
}

export interface NamedRow {
  id: string;
  object_ref: string | null;
  name: string | null;
  /** IFC ObjectType, napr. "Přiváděný vzduch" pri systéme (voliteľné). */
  user_defined_type?: string | null;
}

/**
 * Výber uzlov podľa id, object_ref, názvu alebo ObjectType: najprv presná zhoda
 * (bez ohľadu na veľkosť písmen), inak všetky, ktoré text obsahujú ("Prívod" =
 * Prívod-1NP, Prívod-2NP, ...; "Přiváděný vzduch" = všetky systémy s týmto ObjectType).
 */
export function pickNamed<T extends NamedRow>(rows: T[], want: string): T[] {
  const w = want.trim().toLowerCase();
  if (!w) return [];
  const fields = (r: T) => [r.object_ref, r.name, r.user_defined_type].map((v) => (v ?? "").toLowerCase());
  const exact = rows.filter((r) => r.id.toLowerCase() === w || fields(r).includes(w));
  if (exact.length > 0) return exact;
  return rows.filter((r) => fields(r).some((f) => f.includes(w)));
}

export interface CandidateRow {
  id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  predefined_type: string | null;
}

/** Atribútové filtre nad kandidátom (ifc_type(s)/domain, predefined_type, query). */
export function matchesAttributes(row: CandidateRow, f: { types: string[]; predefinedType: string; query: string }): boolean {
  if (f.types.length > 0 && !f.types.some((t) => t.toLowerCase() === (row.ifc_type ?? "").toLowerCase())) return false;
  if (f.predefinedType && f.predefinedType.toLowerCase() !== (row.predefined_type ?? "").toLowerCase()) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = [row.name, row.object_ref, row.ifc_type, row.predefined_type].map((v) => (v ?? "").toLowerCase());
    if (!hay.some((h) => h.includes(q))) return false;
  }
  return true;
}

/**
 * Hodnota vlastnosti psetu (efektívne properties s dedičnosťou z typu): presná
 * zhoda textu bez ohľadu na veľkosť písmen, kľúč vlastnosti tiež bez ohľadu na
 * veľkosť; `pset` zúži hľadanie na jeden pset.
 */
export function matchesProperty(
  properties: unknown,
  property: string,
  value: string,
  pset?: string,
): boolean {
  if (!properties || typeof properties !== "object") return false;
  const want = value.trim().toLowerCase();
  const key = property.toLowerCase();
  for (const [psetName, props] of Object.entries(properties as Record<string, unknown>)) {
    if (psetName.startsWith("_")) continue;
    if (pset && psetName.toLowerCase() !== pset.toLowerCase()) continue;
    if (!props || typeof props !== "object") continue;
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (k.toLowerCase() === key && v !== null && v !== undefined && String(v).toLowerCase() === want) return true;
    }
  }
  return false;
}

/**
 * Rozdelí strop GUIDov medzi skupiny: každá dostane aspoň rovnaký diel, nevyužitý
 * diel menších skupín pripadne väčším. Vráti, koľko GUIDov z každej skupiny ide do ops.
 */
export function allocateCap(sizes: number[], cap = SCOPED_GUID_CAP): number[] {
  const out = sizes.map(() => 0);
  let left = cap;
  let open = sizes.map((_, i) => i).filter((i) => sizes[i] > 0);
  while (left > 0 && open.length > 0) {
    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      const take = Math.min(share, sizes[i] - out[i], left);
      out[i] += take;
      left -= take;
      if (left === 0) break;
    }
    open = open.filter((i) => out[i] < sizes[i]);
  }
  return out;
}

/** Op viewera v D-066 wire formáte `<op>:<arg>:<guid.guid…>`. */
export function styleOp(action: string, color: string, guids: string[]): string {
  return `${action}:${action === "colorize" ? color : ""}:${guids.join(".")}`;
}
