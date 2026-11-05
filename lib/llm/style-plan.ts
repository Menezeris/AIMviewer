/**
 * Pure logic of the extended `style_in_3d` (D-096): groups with their own color,
 * AND criteria and building viewer ops. Looking up the members of a system, zone and storey
 * in the DB is done by `style-scope.ts`; nothing is read or written here.
 */

export class StyleInputError extends Error {}

/** Max groups in one call. */
export const MAX_STYLE_GROUPS = 12;
/**
 * Max GUIDs in total across all groups of one call: ~23 characters per GUID in the URL,
 * a client action may have at most 16 000 characters (`isSafeViewerUrl`), a reserve for
 * other actions of the same round.
 */
export const SCOPED_GUID_CAP = 500;

const HEX6 = /^[0-9a-f]{6}$/;
/** Actions where a group has a color (Lens, D-096); with isolation and X-ray the color is optional. */
const COLOR_ACTIONS = new Set(["colorize", "transparent", "isolate", "xray"]);

/** Filter keys that the top-level input and a group may carry. */
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
  "document",
  "page",
] as const;

/** Criteria that require expanding members in the DB (D-096, document D-104). */
const SCOPE_KEYS = ["system", "system_type", "not_in_system", "zone", "storey", "document"] as const;

export type StyleFilter = Partial<Record<(typeof FILTER_KEYS)[number], unknown>>;

export interface StyleGroup {
  label: string;
  color: string;
  filter: StyleFilter;
  /** Color transparency 0.05-1 (D-139); without a value the host decides by the kind of elements. */
  opacity?: number;
}

/** `opacity` of the tool (D-139): 0.05-1, without a value `undefined`. */
export function parseOpacity(raw: unknown, where: string): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0.05 || n > 1) throw new StyleInputError(`${where} musí byť číslo 0.05 až 1 (1 = plná farba).`);
  return n;
}

const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== false && !(typeof v === "string" && v.trim() === "") &&
  !(Array.isArray(v) && v.length === 0);

/** Is it the extended mode (system, zone, storey, document or groups)? */
export function needsScopedStyle(input: Record<string, unknown>): boolean {
  return Array.isArray(input.groups) || SCOPE_KEYS.some((k) => present(input[k]));
}

export function pickFilter(src: Record<string, unknown>): StyleFilter {
  const out: StyleFilter = {};
  for (const k of FILTER_KEYS) if (present(src[k])) out[k] = src[k];
  // The model writes `floor` (like set_section, set_view_mode); the storey filter is called `storey` (#219).
  if (out.storey === undefined && present(src.floor)) out.storey = src.floor;
  return out;
}

/** Group keys that are neither a filter nor label/color: pickFilter drops them, so they must be reported (#219). */
export function ignoredGroupKeys(input: Record<string, unknown>): string[] {
  if (!Array.isArray(input.groups)) return [];
  const known = new Set<string>([...FILTER_KEYS, "label", "color", "floor"]);
  const out = new Set<string>();
  for (const g of input.groups) {
    if (g && typeof g === "object" && !Array.isArray(g)) {
      for (const k of Object.keys(g)) if (!known.has(k)) out.add(k);
    }
  }
  return [...out];
}

/** `page` of the filter (D-104 step 4): a positive integer (also as text); meaningless without a document. */
export function documentPage(f: StyleFilter): number | undefined {
  if (f.page === undefined || f.page === null || f.page === "") return undefined;
  const page = Number(f.page);
  if (!Number.isInteger(page) || page < 1) throw new StyleInputError("page musí byť číslo strany od 1.");
  if (typeof f.document !== "string" || !f.document.trim()) throw new StyleInputError("page platí len spolu s document.");
  return page;
}

function normColor(raw: unknown): string {
  return String(raw ?? "").trim().replace(/^#/, "").toLowerCase();
}

/** Short description of the filter for the group label. */
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
  if (f.document) parts.push(`dokument ${f.document}${f.page ? `, s. ${f.page}` : ""}`);
  if (f.property) parts.push(`${f.property}=${f.value ?? ""}`);
  if (f.query) parts.push(`"${f.query}"`);
  if (f.model) parts.push(`model ${f.model}`);
  return parts.join(", ") || "výber";
}

/**
 * Tool input -> groups. Without `groups` it is one group from the top-level filter.
 * With `groups` the top-level filter applies to all groups (AND) and a group
 * refines or overrides it with its own keys.
 */
export function parseStyleGroups(input: Record<string, unknown>, action: string): StyleGroup[] {
  const base = pickFilter(input);
  const colorOf = (raw: unknown, where: string): string => {
    if (!COLOR_ACTIONS.has(action)) return "";
    const c = normColor(raw);
    // Isolated elements keep their original look until someone asks for a color (Samuel, 2026-10-19).
    if (!c && (action === "isolate" || action === "xray")) return "";
    if (!HEX6.test(c)) throw new StyleInputError(`${where} musí byť hex RRGGBB (napr. ef4444 pre červenú).`);
    return c;
  };
  if (!Array.isArray(input.groups)) {
    const opacity = parseOpacity(input.opacity, "opacity");
    return [{ label: describeFilter(base), color: colorOf(input.color, "color"), filter: base, ...(opacity !== undefined ? { opacity } : {}) }];
  }
  if (!COLOR_ACTIONS.has(action)) {
    throw new StyleInputError("groups platí len s action=colorize, transparent, isolate alebo xray (každá skupina má vlastnú farbu).");
  }
  const raw = input.groups as unknown[];
  if (raw.length === 0) throw new StyleInputError("groups je prázdne - zadaj aspoň jednu skupinu {color, filter}.");
  if (raw.length > MAX_STYLE_GROUPS) throw new StyleInputError(`Najviac ${MAX_STYLE_GROUPS} skupín v jednom volaní.`);
  return raw.map((g, i) => {
    if (!g || typeof g !== "object" || Array.isArray(g)) {
      throw new StyleInputError(`groups[${i}] musí byť objekt {label, color, ...filter}.`);
    }
    const obj = g as Record<string, unknown>;
    const color = colorOf(obj.color, `groups[${i}].color`);
    const filter = { ...base, ...pickFilter(obj) };
    if (Object.keys(filter).length === 0) {
      throw new StyleInputError(`groups[${i}] nemá žiadny filter (system, zone, storey, ifc_type...).`);
    }
    const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim().slice(0, 60) : describeFilter(filter);
    const opacity = parseOpacity(obj.opacity ?? input.opacity, `groups[${i}].opacity`);
    return { label, color, filter, ...(opacity !== undefined ? { opacity } : {}) };
  });
}

/** Intersection of sets (AND); `null` = criterion not given. All null -> null. */
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
  /** IFC ObjectType, e.g. "Přiváděný vzduch" (supply air) for a system (optional). */
  user_defined_type?: string | null;
}

/**
 * Selection of nodes by id, object_ref, name or ObjectType: first an exact match
 * (case-insensitive), otherwise all that contain the text ("Prívod" (supply) =
 * Prívod-1NP, Prívod-2NP, ...; "Přiváděný vzduch" = all systems with this ObjectType).
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

/** Attribute filters over a candidate (ifc_type(s)/domain, predefined_type, query). */
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
 * Value of a pset property (effective properties with inheritance from the type): exact
 * case-insensitive text match, the property key also case-insensitive;
 * `pset` narrows the search to one pset.
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
 * Splits the GUID cap among groups: each gets at least an equal share, the unused
 * share of smaller groups goes to larger ones. Returns how many GUIDs of each group go into ops.
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

/** Viewer op in the D-066 wire format `<op>:<arg>:<guid.guid...>`. */
export function styleOp(action: string, color: string, guids: string[]): string {
  return `${action}:${action === "colorize" ? color : ""}:${guids.join(".")}`;
}
