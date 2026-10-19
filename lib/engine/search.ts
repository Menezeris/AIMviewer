import type { EngineModel, EngineSession, EngineToolResult } from "./session";

/**
 * Full-text hľadanie priamo v IFC súbore (D-095) - `ifc_search`.
 *
 * `@ifc-lite/mcp` full-text nemá (`query_entities` vie len triedu a presné
 * podmienky psetov), preto vlastný tool podľa D-087 bod 3: dáta berie cez tools
 * balíka (`query_entities` + `get_entities_bulk`), hľadanie je naše. Index sa
 * postaví raz na parsovaný store (ten sa nemení, vzor `guidIndex` v `tools.ts`)
 * a nesie atribúty (Name, Description, ObjectType, Tag, LongName...), psety a
 * Qto výskytu aj z typu, klasifikácie a materiály - prvkov, priestorov, zón,
 * skupín, systémov aj typov (IfcTypeObject).
 */

export const SEARCH_FIELDS = ["attribute", "property", "quantity", "type_property", "classification", "material"] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

interface IndexedField {
  field: SearchField;
  /** Napr. `Description`, `Pset_DoorCommon.FireRating`, `Uniformat DD01`. */
  path: string;
  value: string;
  /** Normalizované `path value` - bez diakritiky, malé písmená. */
  norm: string;
  words: string[];
}

export interface IndexedEntity {
  model: string;
  express_id: number;
  global_id: string;
  ifc_type: string;
  name: string | null;
  fields: IndexedField[];
}

export interface SearchQuery {
  text: string;
  /** expressId povolených prvkov podľa modelu (filter ifc_types); undefined = všetky. */
  allowed?: Map<string, Set<number>>;
  fields?: SearchField[];
  fuzzy: boolean;
}

export interface SearchHit {
  model: string;
  global_id: string;
  ifc_type: string;
  name: string | null;
  score: number;
  match_kind: "exact" | "fuzzy";
  matched: Array<{ field: SearchField; path: string; value: string }>;
}

const BULK = 1000;
const PAGE = 10_000;
const MAX_VALUE_CHARS = 200;
const MAX_MATCHED = 5;
const INCLUDE = ["attributes", "properties", "quantities", "type_properties", "classifications", "materials"];

/** Bez diakritiky a malými písmenami (karuselové = KARUSELOVE). */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function wordsOf(norm: string): string[] {
  return norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function scalar(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function field(field: SearchField, path: string, value: string): IndexedField {
  const norm = normalizeText(`${path} ${value}`);
  return { field, path, value, norm, words: wordsOf(norm) };
}

type Rec = Record<string, unknown>;
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);

/** Psety v tvare balíka: [{name, properties:[{name, value}]}] alebo quantities:[...]. */
function psetFields(kind: SearchField, sets: unknown, inner: "properties" | "quantities"): IndexedField[] {
  const out: IndexedField[] = [];
  for (const set of arr(sets)) {
    const setName = scalar(set.name) ?? "";
    for (const p of arr(set[inner] ?? set.properties ?? set.quantities)) {
      const v = scalar(p.value);
      if (v !== null) out.push(field(kind, `${setName}.${scalar(p.name) ?? ""}`, v));
    }
  }
  return out;
}

function materialFields(m: unknown): IndexedField[] {
  if (!m || typeof m !== "object") return [];
  const o = m as Rec;
  const out: IndexedField[] = [];
  const name = scalar(o.name);
  if (name) out.push(field("material", "Material", name));
  for (const key of ["constituents", "layers", "profiles", "materials"]) {
    for (const c of arr(o[key])) {
      const v = [scalar(c.materialName), scalar(c.name), scalar(c.category)].filter(Boolean).join(" / ");
      if (v) out.push(field("material", key, v));
    }
  }
  return out;
}

export function entityFields(e: Rec): IndexedField[] {
  const out: IndexedField[] = [];
  for (const a of arr(e.attributes)) {
    const v = scalar(a.value);
    if (v !== null) out.push(field("attribute", scalar(a.name) ?? "", v));
  }
  // Atribúty, ktoré balík vráti mimo `attributes` (napr. ObjectType výskytu).
  for (const [k, path] of [["description", "Description"], ["objectType", "ObjectType"]] as const) {
    const v = scalar(e[k]);
    if (v && !out.some((f) => f.path === path)) out.push(field("attribute", path, v));
  }
  out.push(...psetFields("property", e.properties, "properties"));
  out.push(...psetFields("quantity", e.quantities, "quantities"));
  out.push(...psetFields("type_property", e.typeProperties, "properties"));
  for (const c of arr(e.classifications)) {
    const v = [scalar(c.identification), scalar(c.name), scalar(c.description)].filter(Boolean).join(" ");
    if (v) out.push(field("classification", scalar(c.system) ?? "Classification", v));
  }
  out.push(...materialFields(e.materials));
  return out;
}

function structured<T>(res: EngineToolResult): T {
  if (res.isError) throw new Error(res.content.map((c) => c.text ?? "").join(" ").trim() || "Motor vrátil chybu.");
  return (res.structuredContent ?? {}) as T;
}

async function allIds(session: EngineSession, modelId: string, types?: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = structured<{ truncated?: boolean; entities?: Array<{ expressId: number }> }>(
      await session.call("query_entities", { model_id: modelId, ...(types ? { types } : {}), limit: PAGE, offset, fields: ["globalId"] }),
    );
    for (const e of res.entities ?? []) ids.push(e.expressId);
    if (!res.truncated) break;
  }
  return ids;
}

async function buildIndex(session: EngineSession, m: EngineModel): Promise<IndexedEntity[]> {
  // Výskyty, priestory, zóny a skupiny + typy (query_entities bez triedy typy nevracia).
  const ids = [...new Set([...(await allIds(session, m.id)), ...(await allIds(session, m.id, ["IfcTypeObject"]))])];
  const out: IndexedEntity[] = [];
  for (let i = 0; i < ids.length; i += BULK) {
    const res = structured<{ entities?: Record<string, Rec> }>(
      await session.call("get_entities_bulk", { model_id: m.id, express_ids: ids.slice(i, i + BULK), include: INCLUDE }),
    );
    for (const [gid, e] of Object.entries(res.entities ?? {})) {
      const ref = (e.ref ?? {}) as Rec;
      out.push({
        model: m.id,
        express_id: typeof ref.expressId === "number" ? ref.expressId : 0,
        global_id: scalar(e.globalId) ?? gid,
        ifc_type: scalar(e.type) ?? "",
        name: scalar(e.name),
        fields: entityFields(e),
      });
    }
  }
  return out;
}

const indexes = new WeakMap<object, Promise<IndexedEntity[]>>();

/** Index modelu - raz na parsovaný store, súbežné volania čakajú na jedno postavenie. */
export function searchIndex(session: EngineSession, m: EngineModel): Promise<IndexedEntity[]> {
  let p = indexes.get(m.store);
  if (!p) {
    p = buildIndex(session, m);
    indexes.set(m.store, p);
    p.catch(() => indexes.delete(m.store));
  }
  return p;
}

/** Riadky Levenshteina sa recyklujú: fuzzy hľadanie ich volá milión ráz na otázku (D-102). */
let rowA = new Int32Array(64);
let rowB = new Int32Array(64);

/** Levenshtein s horným stropom (rýchly výstup, keď je slovo ďaleko). */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (rowA.length <= b.length) {
    rowA = new Int32Array(b.length + 1);
    rowB = new Int32Array(b.length + 1);
  }
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[b.length];
}

/**
 * Preklep sa toleruje len v slovách. Token s číslicou je kód alebo číslo
 * (SD04, 0001, 3.02): fuzzy by z neho spravil iný prvok (SD03), preto len presne (D-102).
 */
const allowedEdits = (token: string) => (/\d/.test(token) ? 0 : token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0);

/** 2 = presná zhoda slova/prefixu, 1 = fuzzy, 0 = nič. */
function tokenMatch(token: string, f: IndexedField, fuzzy: boolean): number {
  if (f.words.some((w) => w.startsWith(token))) return 2;
  if (token.length >= 3 && f.norm.includes(token)) return 2;
  const max = fuzzy ? allowedEdits(token) : 0;
  if (max === 0) return 0;
  // Preklep v slove aj v jeho začiatku (prenajimatelne vs. prenajímateľné).
  return f.words.some(
    (w) => editDistance(token, w, max) <= max || (w.length > token.length && editDistance(token, w.slice(0, token.length), max) <= max),
  )
    ? 1
    : 0;
}

/** Váha poľa: meno a popis sú silnejší dôkaz než ľubovoľná hodnota psetu. */
function weight(f: IndexedField): number {
  if (f.field === "attribute" && ["Name", "Description", "LongName", "ObjectType"].includes(f.path)) return 1.5;
  return f.field === "quantity" ? 0.5 : 1;
}

export function searchEntities(index: IndexedEntity[], q: SearchQuery): SearchHit[] {
  const phrase = normalizeText(q.text).trim();
  const tokens = [...new Set(wordsOf(phrase))];
  if (tokens.length === 0) return [];
  const kinds = q.fields && q.fields.length > 0 ? new Set(q.fields) : null;
  const hits: SearchHit[] = [];
  for (const e of index) {
    const allowed = q.allowed?.get(e.model);
    if (q.allowed && (!allowed || !allowed.has(e.express_id))) continue;
    const fields = kinds ? e.fields.filter((f) => kinds.has(f.field)) : e.fields;
    let score = 0;
    let fuzzyUsed = false;
    const matched = new Set<IndexedField>();
    let all = true;
    for (const t of tokens) {
      let exact = 0;
      let fuzzyBest = 0;
      for (const f of fields) {
        const m = tokenMatch(t, f, q.fuzzy);
        if (m === 0) continue;
        matched.add(f);
        if (m === 2) exact += weight(f);
        else fuzzyBest = Math.max(fuzzyBest, weight(f) / 2);
      }
      if (exact === 0 && fuzzyBest === 0) {
        all = false;
        break;
      }
      if (exact > 0) score += exact;
      else {
        fuzzyUsed = true;
        score += fuzzyBest;
      }
    }
    if (!all) continue;
    const phraseFields = tokens.length > 1 ? [...matched].filter((f) => f.norm.includes(phrase)) : [];
    score += phraseFields.length * 2;
    const ordered = [...phraseFields, ...[...matched].filter((f) => !phraseFields.includes(f)).sort((a, b) => weight(b) - weight(a))];
    hits.push({
      model: e.model,
      global_id: e.global_id,
      ifc_type: e.ifc_type,
      name: e.name,
      score: Math.round(score * 100) / 100,
      match_kind: fuzzyUsed ? "fuzzy" : "exact",
      matched: ordered.slice(0, MAX_MATCHED).map((f) => ({
        field: f.field,
        path: f.path,
        value: f.value.length > MAX_VALUE_CHARS ? `${f.value.slice(0, MAX_VALUE_CHARS)}...` : f.value,
      })),
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.ifc_type.localeCompare(b.ifc_type) || (a.name ?? "").localeCompare(b.name ?? ""));
}

/** expressId prvkov zadaných tried vrátane podtried (cez `query_entities` balíka), raz na store a triedy. */
const typeIds = new WeakMap<object, Map<string, Promise<Set<number>>>>();
export function idsOfTypes(session: EngineSession, m: EngineModel, types: string[]): Promise<Set<number>> {
  let byKey = typeIds.get(m.store);
  if (!byKey) typeIds.set(m.store, (byKey = new Map()));
  const key = [...types].sort().join(",");
  let p = byKey.get(key);
  if (!p) {
    p = allIds(session, m.id, types).then((ids) => new Set(ids));
    byKey.set(key, p);
    p.catch(() => byKey.delete(key));
  }
  return p;
}

/** Presné meno alebo Tag -> prvky; kód ako SD04.0001 tak nejde cez fuzzy prechod indexu (D-102). */
export type NameIndex = Map<string, IndexedEntity[]>;
const nameIndexes = new WeakMap<object, Promise<NameIndex>>();

export const nameKey = (s: string) => normalizeText(s).trim();

export function nameIndex(session: EngineSession, m: EngineModel): Promise<NameIndex> {
  let p = nameIndexes.get(m.store);
  if (!p) {
    p = searchIndex(session, m).then(buildNameIndex);
    nameIndexes.set(m.store, p);
    p.catch(() => nameIndexes.delete(m.store));
  }
  return p;
}

export function buildNameIndex(entities: IndexedEntity[]): NameIndex {
  const out: NameIndex = new Map();
  const add = (k: string, e: IndexedEntity) => {
    if (!k) return;
    const list = out.get(k);
    if (!list) out.set(k, [e]);
    else if (!list.includes(e)) list.push(e);
  };
  for (const e of entities) {
    if (e.name) add(nameKey(e.name), e);
    for (const f of e.fields) if (f.field === "attribute" && f.path === "Tag") add(nameKey(f.value), e);
  }
  return out;
}

/** Vyzerá ako kód prvku (SD04.0001, VV.03.01.040, PD02.31.07), nie ako slová. */
export function looksLikeCode(text: string): boolean {
  const t = text.trim();
  return /^[\p{L}]{1,6}[\p{L}\d]*([._-]\d+)+$/u.test(t) || /^[\p{L}]{1,6}\d+$/u.test(t);
}

/** Zásahy presného mena ako výsledok hľadania (najvyššie skóre, match_kind exact). */
export function exactNameHits(entities: IndexedEntity[], allowed?: Map<string, Set<number>>): SearchHit[] {
  return entities
    .filter((e) => !allowed || allowed.get(e.model)?.has(e.express_id))
    .map((e) => ({
      model: e.model,
      global_id: e.global_id,
      ifc_type: e.ifc_type,
      name: e.name,
      score: 100,
      match_kind: "exact" as const,
      matched: [{ field: "attribute" as const, path: "Name", value: e.name ?? "" }],
    }));
}
