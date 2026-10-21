import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/data/pagination";
import { fetchDocumentObjectRows } from "@/lib/data/object-documents";
import { normalizeStoreyLabel } from "@/lib/engine/storey";

import type { AskAction } from "./actions";
import {
  SCOPED_GUID_CAP,
  StyleInputError,
  allocateCap,
  documentPage,
  intersectSets,
  matchesAttributes,
  matchesProperty,
  parseStyleGroups,
  pickNamed,
  styleOp,
  type CandidateRow,
  type NamedRow,
  type StyleFilter,
} from "./style-plan";

/**
 * Rozšírený `style_in_3d` (D-096): systém, zóna a podlažie ako filtre (členovia
 * sa rozbalia v grafe AIM), všetky kritériá ako AND, viac skupín s vlastnou
 * farbou v jednom volaní a počty na skupinu. Čistá logika je v `style-plan.ts`.
 *
 * Členstvo: systém a IfcGroup = `rel_assigns_to_group` (člen -> skupina,
 * rekurzívne cez vnorené skupiny); IfcZone a IfcSpatialZone = miestnosti a vždy
 * aj prvky v nich alebo dotýkajúce sa ich (contained + referenced); podlažie = miestnosti podlažia a prvky natívne
 * na podlaží alebo v jeho miestnostiach (bez odvodených referencií, aby prvok
 * nepatril na dve podlažia); dokument = objekty, ktorých sa týka, aj zdedené cez
 * nositeľa (`v_object_documents`, D-104 krok 4), voliteľne len jedna strana.
 */

const IN_CHUNK = 100;
const CLOSURE_DEPTH = 6;
/** Strop kandidátov bez množinového kritéria (len trieda/predefined/query). */
const ATTRIBUTE_ONLY_CAP = 5000;
/** Typy uzlov, ktoré majú v 3D geometriu, ktorú má zmysel farbiť. */
const STYLABLE_OBJECT_TYPES = new Set(["asset", "space", "spatial_zone"]);
const GROUPISH_TYPES = ["zone", "spatial_zone", "group"];
const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TypedRow extends NamedRow {
  object_type: string;
  predefined_type: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : [];

export interface ScopedStyleOptions {
  /** IFC domény -> triedy (zdieľané s množinovým selektorom v `tools.ts`). */
  domainTypes: Record<string, string[]>;
}

export class ScopeResolver {
  private systems?: TypedRow[];
  private groupish?: TypedRow[];
  private floors?: NamedRow[];
  private documents?: TypedRow[];
  private allSystemMembers?: Set<string>;

  constructor(private readonly db: SupabaseClient) {}

  /** `.in()` po dávkach s úplným stránkovaním každej dávky. */
  private async fetchIn<T>(
    table: string,
    select: string,
    col: string,
    values: string[],
    opts: { activeOnly?: boolean; order?: string } = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < values.length; i += IN_CHUNK) {
      const chunk = values.slice(i, i + IN_CHUNK);
      out.push(
        ...(await fetchAllPages<T>((from, to) => {
          let q = this.db.from(table).select(select).in(col, chunk);
          if (opts.activeOnly !== false) q = q.is("valid_until", null);
          return q.order(opts.order ?? "id").range(from, to) as unknown as PromiseLike<{
            data: T[] | null;
            error: { message: string } | null;
          }>;
        })),
      );
    }
    return out;
  }

  private async nodesOfTypes(types: string[]): Promise<TypedRow[]> {
    return fetchAllPages<TypedRow>((from, to) =>
      this.db
        .from("objects")
        .select("id, object_type, object_ref, name, predefined_type, user_defined_type")
        .in("object_type", types)
        .is("valid_until", null)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: TypedRow[] | null; error: { message: string } | null }>,
    );
  }

  /** Členovia skupín (rel_assigns_to_group člen -> skupina), rekurzívne. */
  private async closure(rootIds: string[]): Promise<Set<string>> {
    const seen = new Set(rootIds);
    const members = new Set<string>();
    let frontier = rootIds;
    for (let depth = 0; depth < CLOSURE_DEPTH && frontier.length > 0; depth++) {
      const rows = await this.fetchIn<{ from_id: string }>("rel_assigns_to_group", "id, from_id", "to_id", frontier);
      const next: string[] = [];
      for (const r of rows) {
        members.add(r.from_id);
        if (!seen.has(r.from_id)) {
          seen.add(r.from_id);
          next.push(r.from_id);
        }
      }
      frontier = next;
    }
    return members;
  }

  /** Systémy podľa `system` (id, ref, názov, ObjectType) a `system_type` (predefined_type alebo ObjectType). */
  async pickSystems(f: StyleFilter): Promise<TypedRow[]> {
    this.systems ??= await this.nodesOfTypes(["system"]);
    const want = str(f.system);
    const type = str(f.system_type).toUpperCase();
    let picked = want ? pickNamed(this.systems, want) : this.systems;
    if (type) {
      picked = picked.filter(
        (s) => (s.predefined_type ?? "").toUpperCase() === type || (s.user_defined_type ?? "").toUpperCase() === type,
      );
    }
    if (picked.length === 0) {
      const avail = this.systems.map(
        (s) => `${s.object_ref ?? s.name} (${[s.predefined_type, s.user_defined_type].filter(Boolean).join(", ") || "-"})`,
      );
      throw new StyleInputError(
        `Systém ${[want, type].filter(Boolean).join(" / ")} sa nenašiel. Dostupné: ${avail.slice(0, 25).join(", ")}.`,
      );
    }
    return picked;
  }

  /** Počet členov každého systému zvlášť (D-125): koľko prvkov pridal do farbenia. */
  async systemMemberCounts(systems: TypedRow[]): Promise<number[]> {
    return Promise.all(systems.map(async (s) => (await this.closure([s.id])).size));
  }

  async systemMembers(f: StyleFilter): Promise<{ ids: Set<string>; matched: string[] }> {
    const picked = await this.pickSystems(f);
    return {
      ids: await this.closure(picked.map((s) => s.id)),
      matched: picked.map((s) => s.object_ref ?? s.name ?? s.id),
    };
  }

  async anySystemMembers(): Promise<Set<string>> {
    if (!this.allSystemMembers) {
      this.systems ??= await this.nodesOfTypes(["system"]);
      this.allSystemMembers = await this.closure(this.systems.map((s) => s.id));
    }
    return this.allSystemMembers;
  }

  /** Zóny (IfcZone, IfcSpatialZone, IfcGroup) podľa id, object_ref alebo názvu. */
  async pickZones(want: string): Promise<TypedRow[]> {
    this.groupish ??= await this.nodesOfTypes(GROUPISH_TYPES);
    const picked = pickNamed(this.groupish, want);
    if (picked.length === 0) {
      const zones = this.groupish.filter((z) => z.object_type === "zone").map((z) => z.object_ref ?? z.name);
      throw new StyleInputError(
        `Zóna '${want}' sa nenašla (IfcZone, IfcSpatialZone ani IfcGroup). IfcZone v modeli: ${zones.slice(0, 25).join(", ")}.`,
      );
    }
    return picked;
  }

  async zoneMembers(want: string): Promise<{ ids: Set<string>; matched: string[] }> {
    const picked = await this.pickZones(want);
    return { ids: await this.zoneMemberIds(picked), matched: picked.map((z) => z.object_ref ?? z.name ?? z.id) };
  }

  async zoneMemberIds(picked: TypedRow[]): Promise<Set<string>> {
    const groupIds = picked.filter((z) => z.object_type !== "spatial_zone").map((z) => z.id);
    const spatialIds = picked.filter((z) => z.object_type === "spatial_zone").map((z) => z.id);

    // Zóna = jej miestnosti (aj cez vnorené zóny) a VŽDY aj prvky v nich alebo tie, ktoré
    // sa ich dotýkajú (contained + referenced inside/partial, D-080). Priamo z hrán, nie cez
    // v_zone_elements, aby výsledok nezávisel od prepínača pravidla element_in_zone (Samuel).
    const ids = groupIds.length > 0 ? await this.closure(groupIds) : new Set<string>();
    for (const id of spatialIds) ids.add(id);
    const containers = [...ids];
    for (const rel of ["rel_contained_in_spatial_structure", "rel_referenced_in_spatial_structure"]) {
      const rows = await this.fetchIn<{ from_id: string }>(rel, "id, from_id", "to_id", containers);
      for (const r of rows) ids.add(r.from_id);
    }
    return ids;
  }

  /**
   * Dokument podľa id, object_ref alebo názvu (aj jeho časti, napr. 'D.1.1.03'); odkaz
   * na časť dokumentu (strana skladby) len podľa id alebo presného object_ref.
   */
  async pickDocument(want: string): Promise<TypedRow> {
    this.documents ??= await this.nodesOfTypes(["document", "document_reference"]);
    const docs = this.documents.filter((d) => d.object_type === "document");
    const w = want.trim().toLowerCase();
    const ref = this.documents.find(
      (d) => d.object_type === "document_reference" && (d.id.toLowerCase() === w || (d.object_ref ?? "").toLowerCase() === w),
    );
    if (ref) return ref;
    const picked = pickNamed(docs, want);
    if (picked.length === 1) return picked[0];
    const label = (d: TypedRow) => d.name ?? d.object_ref ?? d.id;
    if (picked.length === 0) {
      throw new StyleInputError(`Dokument '${want}' sa nenašiel. Hľadaj ho cez search_documents (vráti id a object_ref).`);
    }
    throw new StyleInputError(
      `Dokument '${want}' je nejednoznačný (${picked.length}): ${picked.slice(0, 10).map(label).join(", ")} - zadaj id alebo object_ref.`,
    );
  }

  /** Objekty, ktorých sa dokument (alebo jeho strana) týka, aj zdedené cez nositeľa. */
  async documentMembers(want: string, page: number | undefined): Promise<{ doc: TypedRow; ids: Set<string> }> {
    const doc = await this.pickDocument(want);
    const rows = await fetchDocumentObjectRows(doc, page);
    return { doc, ids: new Set(rows.filter((r) => STYLABLE_OBJECT_TYPES.has(r.object_type)).map((r) => r.object_id)) };
  }

  /** Podlažie podľa id, object_ref alebo názvu (1NP = 1.NP = 1 NP). */
  async pickFloor(want: string): Promise<NamedRow> {
    this.floors ??= await fetchAllPages<NamedRow>((from, to) =>
      this.db
        .from("objects")
        .select("id, object_ref, name")
        .eq("object_type", "floor")
        .is("valid_until", null)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: NamedRow[] | null; error: { message: string } | null }>,
    );
    const norm = normalizeStoreyLabel(want);
    const floor = this.floors.find(
      (f) =>
        (UUID_RE.test(want) && f.id === want) ||
        normalizeStoreyLabel(f.object_ref ?? "") === norm ||
        normalizeStoreyLabel(f.name ?? "") === norm,
    );
    if (!floor) {
      throw new StyleInputError(
        `Podlažie '${want}' neexistuje. Dostupné: ${this.floors.map((f) => f.object_ref ?? f.name).join(", ")}.`,
      );
    }
    return floor;
  }

  async storeyMembers(want: string): Promise<{ ids: Set<string>; label: string }> {
    const floor = await this.pickFloor(want);
    const spaces = (await this.fetchIn<{ from_id: string }>("rel_aggregates", "id, from_id", "to_id", [floor.id])).map(
      (r) => r.from_id,
    );
    const ids = new Set(spaces);
    const contained = await this.fetchIn<{ from_id: string }>(
      "rel_contained_in_spatial_structure",
      "id, from_id",
      "to_id",
      [floor.id, ...spaces],
    );
    for (const r of contained) ids.add(r.from_id);
    return { ids, label: floor.object_ref ?? floor.name ?? want };
  }

  async explicitIds(f: StyleFilter): Promise<Set<string> | null> {
    const refs = strList(f.ids_or_refs);
    const guids = strList(f.global_ids).filter((g) => IFC_GUID_RE.test(g));
    if (refs.length === 0 && guids.length === 0) return null;
    const ids = new Set<string>();
    const uuids = refs.filter((r) => UUID_RE.test(r));
    for (const r of uuids) ids.add(r);
    const byRef = await this.fetchIn<{ id: string }>("objects", "id", "object_ref", refs.filter((r) => !UUID_RE.test(r)));
    for (const r of byRef) ids.add(r.id);
    const byGuid = await this.fetchIn<{ object_id: string }>("ifc_guid_history", "object_id", "ifc_guid", guids, {
      order: "object_id",
    });
    for (const r of byGuid) if (r.object_id) ids.add(r.object_id);
    return ids;
  }

  /** Kandidáti len z atribútov (bez množinového kritéria): trieda / predefined / query. */
  async attributeCandidates(types: string[], predefinedType: string, query: string): Promise<Set<string>> {
    if (types.length === 0 && !predefinedType && !query) {
      throw new StyleInputError(
        "Zadaj aspoň jedno kritérium výberu: system, system_type, zone, storey, document, ids_or_refs, ifc_type(s)/domain, predefined_type alebo query.",
      );
    }
    const rows = await fetchAllPages<{ id: string }>((from, to) => {
      let q = this.db.from("objects").select("id").is("valid_until", null);
      if (types.length > 0) q = q.in("ifc_type", types);
      if (predefinedType) q = q.ilike("predefined_type", predefinedType);
      if (query) {
        const safe = query.replace(/[,()*%]/g, " ");
        q = q.or(`name.ilike.%${safe}%,object_ref.ilike.%${safe}%`);
      }
      return q.order("id").range(from, to) as unknown as PromiseLike<{
        data: { id: string }[] | null;
        error: { message: string } | null;
      }>;
    });
    return new Set(rows.slice(0, ATTRIBUTE_ONLY_CAP).map((r) => r.id));
  }

  async rows(ids: string[]): Promise<(CandidateRow & { object_type: string })[]> {
    return this.fetchIn("objects", "id, object_type, object_ref, name, ifc_type, predefined_type", "id", ids);
  }

  async effectiveProperties(ids: string[]): Promise<Map<string, unknown>> {
    const rows = await this.fetchIn<{ id: string; properties: unknown }>("v_asset_effective", "id, properties", "id", ids, {
      activeOnly: false,
    });
    const out = new Map(rows.map((r) => [r.id, r.properties]));
    // v_asset_effective nesie len assety; miestnosti a zóny majú psety priamo na objects.
    const rest = ids.filter((id) => !out.has(id));
    for (const r of await this.fetchIn<{ id: string; properties: unknown }>("objects", "id, properties", "id", rest)) {
      out.set(r.id, r.properties);
    }
    return out;
  }

  async guids(ids: string[], model: string): Promise<string[]> {
    const rows = await this.fetchIn<{ ifc_guid: string; source: string | null }>(
      "ifc_guid_history",
      "ifc_guid, source",
      "object_id",
      ids,
      { order: "ifc_guid" },
    );
    const suffix = model ? `:${model.toLowerCase()}` : "";
    const out = new Set<string>();
    for (const r of rows) {
      if (!r.ifc_guid) continue;
      if (suffix && !(r.source ?? "").toLowerCase().endsWith(suffix)) continue;
      out.add(r.ifc_guid);
    }
    return [...out];
  }
}

interface ResolvedGroup {
  guids: string[];
  systems?: string[];
  zones?: string[];
  storey?: string;
  document?: string;
}


async function resolveGroup(
  scope: ScopeResolver,
  f: StyleFilter,
  opts: ScopedStyleOptions,
): Promise<ResolvedGroup> {
  const out: ResolvedGroup = { guids: [] };
  const sets: (Set<string> | null)[] = [];

  if (str(f.system) || str(f.system_type)) {
    const s = await scope.systemMembers(f);
    sets.push(s.ids);
    out.systems = s.matched;
  }
  if (str(f.zone)) {
    const z = await scope.zoneMembers(str(f.zone));
    sets.push(z.ids);
    out.zones = z.matched;
  }
  if (str(f.storey)) {
    const s = await scope.storeyMembers(str(f.storey));
    sets.push(s.ids);
    out.storey = s.label;
  }
  const page = documentPage(f);
  if (str(f.document)) {
    const d = await scope.documentMembers(str(f.document), page);
    sets.push(d.ids);
    out.document = (d.doc.name ?? d.doc.object_ref ?? d.doc.id) + (page ? `, s. ${page}` : "");
  }
  sets.push(await scope.explicitIds(f));

  const domain = str(f.domain).toLowerCase();
  if (domain && !(domain in opts.domainTypes)) {
    throw new StyleInputError(`domain musí byť jedna z: ${Object.keys(opts.domainTypes).join(", ")}.`);
  }
  const types = [
    ...(domain ? opts.domainTypes[domain] : []),
    ...strList(f.ifc_types),
    ...(str(f.ifc_type) ? [str(f.ifc_type)] : []),
  ];
  const predefinedType = str(f.predefined_type);
  const query = str(f.query);

  let candidates = intersectSets(sets);
  if (candidates === null) candidates = await scope.attributeCandidates(types, predefinedType, query);
  if (candidates.size === 0) return out;

  let rows = (await scope.rows([...candidates])).filter(
    (r) => STYLABLE_OBJECT_TYPES.has(r.object_type) && matchesAttributes(r, { types, predefinedType, query }),
  );

  const property = str(f.property);
  if (property) {
    const value = f.value === undefined || f.value === null ? "" : String(f.value);
    if (!value.trim()) throw new StyleInputError("Pri property zadaj aj value - očakávanú hodnotu (napr. true).");
    const props = await scope.effectiveProperties(rows.map((r) => r.id));
    rows = rows.filter((r) => matchesProperty(props.get(r.id), property, value, str(f.pset) || undefined));
  }
  if (f.not_in_system === true) {
    const inSystem = await scope.anySystemMembers();
    rows = rows.filter((r) => !inSystem.has(r.id));
  }
  out.guids = await scope.guids(
    rows.map((r) => r.id),
    str(f.model).replace(/[:;~.]/g, ""),
  );
  return out;
}

/**
 * Vykoná rozšírený `style_in_3d`; vráti odpoveď pre model a pridá jednu URL
 * akciu so všetkými operáciami (jedna navigácia = žiadna sa neprepíše).
 */
export async function execScopedStyle(
  action: string,
  input: Record<string, unknown>,
  push: (a: AskAction) => void,
  opts: ScopedStyleOptions,
): Promise<Record<string, unknown>> {
  const groups = parseStyleGroups(input, action);
  const scope = new ScopeResolver(getSupabaseAdmin());
  const resolved: ResolvedGroup[] = [];
  for (const g of groups) resolved.push(await resolveGroup(scope, g.filter, opts));

  const total = resolved.reduce((n, r) => n + r.guids.length, 0);
  if (total === 0) {
    throw new StyleInputError(
      "Kritériám nezodpovedá žiadny prvok s IFC GUID (podmienky sa kombinujú ako AND) - " +
        "uvoľni filter alebo over členov cez list_relations / query_view." +
        (resolved.some((r) => r.systems) ? ` Zhodné systémy: ${resolved.flatMap((r) => r.systems ?? []).join(", ")}.` : ""),
    );
  }
  const take = allocateCap(
    resolved.map((r) => r.guids.length),
    SCOPED_GUID_CAP,
  );
  const ops: string[] = [];
  resolved.forEach((r, i) => {
    if (take[i] > 0) ops.push(styleOp(action, groups[i].color, r.guids.slice(0, take[i])));
  });
  const applied = take.reduce((a, b) => a + b, 0);
  const verb = { colorize: "ofarbenie", hide: "skrytie", show: "zobrazenie", isolate: "izolácia" }[action] ?? action;
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(ops.join(";"))}&r=${Date.now().toString(36)}`,
    label:
      groups.length > 1
        ? `3D: ${verb} ${groups.length} skupín (${applied} prvkov)`
        : `3D: ${verb} ${applied} prvkov - ${groups[0].label}`,
  });

  const summary = resolved.map((r, i) => ({
    label: groups[i].label,
    ...(groups[i].color ? { color: `#${groups[i].color}` } : {}),
    elements: r.guids.length,
    ...(take[i] < r.guids.length ? { applied: take[i] } : {}),
    ...(r.systems ? { systems: r.systems } : {}),
    ...(r.zones ? { zones: r.zones } : {}),
    ...(r.storey ? { storey: r.storey } : {}),
    ...(r.document ? { document: r.document } : {}),
  }));
  const note =
    applied < total
      ? `Do 3D išlo ${applied} z ${total} prvkov (strop ${SCOPED_GUID_CAP} na volanie) - zúž filter alebo rozdeľ na viac volaní.`
      : undefined;
  if (groups.length === 1 && !Array.isArray(input.groups)) {
    const { label: _label, ...one } = summary[0];
    void _label;
    return { ok: true, applied: action, ...one, ...(note ? { note } : {}) };
  }
  return {
    ok: true,
    applied: action,
    groups: summary,
    total_elements: total,
    ...(summary.some((s) => s.elements === 0) ? { empty_groups: summary.filter((s) => s.elements === 0).map((s) => s.label) } : {}),
    ...(note ? { note } : {}),
  };
}
