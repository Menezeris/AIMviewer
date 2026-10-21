import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LEGEND_SIZES, lensOp, type LegendSize, type LensMode, type LensWire, type LensWireRule } from "@/lib/viewer-lens";
import { SECTION_CLEAR_OP } from "@/lib/viewer-ops";

import type { AskAction } from "./actions";
import { autoColorSpec, lensGroup, type ResolvedLensFilter } from "./lens-plan";
import { StyleInputError, describeFilter, documentPage, parseStyleGroups, pickFilter, type StyleFilter } from "./style-plan";
import { ScopeResolver } from "./style-scope";

/**
 * `style_in_3d` nad Lens (D-096): farbenie, priehľadnosť a izolácia sa zostavia
 * ako pravidlá AIM chat lens a pošlú jednou URL akciou (op `lens`, formát v
 * `lib/viewer-lens.ts`). Z grafu AIM sa tu riešia len mená (systémy, podlažia),
 * GUIDy konkrétnych prvkov a id zón; vyhodnotenie a počty robí Lens vo vieweri
 * nad IFC, takže sa zhodujú s tým, čo používateľ vidí v paneli Lens.
 */

/** Konkrétne prvky idú v URL (~23 znakov na GUID), zóna ide symbolicky. */
export const LENS_GUID_CAP = 400;
const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : []);

/** Akcie `style_in_3d`, ktoré idú cez Lens (skrytie ostáva na kanáli skrývania viewera); `legend` = len panel legendy (D-119). */
export const LENS_STYLE_ACTIONS = new Set(["colorize", "transparent", "isolate", "xray", "legend"]);

/** `legend_size` toolu (D-119); bez hodnoty `undefined`, pri akcii legend predvolene `compact` (D-125). */
export function legendSize(raw: unknown): LegendSize | undefined {
  const v = str(raw).toLowerCase();
  if (!v) return undefined;
  if (!(LEGEND_SIZES as readonly string[]).includes(v)) throw new StyleInputError(`legend_size musí byť ${LEGEND_SIZES.join(" alebo ")}.`);
  return v as LegendSize;
}

export interface LensStyleOptions {
  /** IFC domény -> triedy (zdieľané so selektorom v `tools.ts`). */
  domainTypes: Record<string, string[]>;
}

export interface GroupInfo {
  label: string;
  color?: string;
  systems?: string[];
  /** Pri viacerých systémoch každý s typom a počtom členov (D-125, #177). */
  system_members?: { system: string; type: string | null; elements: number }[];
  warning?: string;
  zones?: string[];
  storey?: string;
  document?: string;
  elements?: number;
}

export async function resolveFilter(
  scope: ScopeResolver,
  f: StyleFilter,
  opts: LensStyleOptions,
  info: GroupInfo,
  guidBudget: { left: number },
): Promise<ResolvedLensFilter> {
  const domain = str(f.domain).toLowerCase();
  if (domain && !(domain in opts.domainTypes)) {
    throw new StyleInputError(`domain musí byť jedna z: ${Object.keys(opts.domainTypes).join(", ")}.`);
  }
  const out: ResolvedLensFilter = {
    types: [...(domain ? opts.domainTypes[domain] : []), ...strList(f.ifc_types), ...(str(f.ifc_type) ? [str(f.ifc_type)] : [])],
  };
  if (str(f.predefined_type)) out.predefinedType = str(f.predefined_type);
  if (str(f.query)) out.query = str(f.query);
  if (str(f.model)) out.model = str(f.model);
  if (f.not_in_system === true) out.notInSystem = true;

  if (str(f.system) || str(f.system_type)) {
    const systems = await scope.pickSystems(f);
    const names = systems.map((s) => s.name).filter((n): n is string => !!n);
    if (names.length === 0) throw new StyleInputError("Vybrané systémy nemajú v modeli názov, Lens ich nevie vybrať.");
    out.systemNames = [...new Set(names)];
    info.systems = systems.map((s) => s.object_ref ?? s.name ?? s.id);
    if (systems.length > 1) await describeSystems(scope, systems, info);
  }
  if (str(f.storey)) {
    const floor = await scope.pickFloor(str(f.storey));
    const name = floor.name ?? floor.object_ref;
    if (!name) throw new StyleInputError(`Podlažie ${str(f.storey)} nemá v modeli názov.`);
    out.storeys = [name];
    info.storey = name;
  }
  if (str(f.zone)) {
    const zones = await scope.pickZones(str(f.zone));
    out.zoneIds = zones.map((z) => z.id);
    info.zones = zones.map((z) => z.object_ref ?? z.name ?? z.id);
  }
  const page = documentPage(f);
  if (str(f.document)) {
    // Prvky dokumentu ide symbolicky ako zóna (D-104 krok 4): GUIDy si klient stiahne z /api/style-scope.
    const doc = await scope.pickDocument(str(f.document));
    out.document = { id: doc.id, ...(page ? { page } : {}) };
    info.document = (doc.name ?? doc.object_ref ?? doc.id) + (page ? `, s. ${page}` : "");
  }
  const property = str(f.property);
  if (property) {
    const value = f.value === undefined || f.value === null ? "" : String(f.value).trim();
    if (!value) throw new StyleInputError("Pri property zadaj aj value - očakávanú hodnotu (napr. true).");
    out.property = { name: property, value, ...(str(f.pset) ? { pset: str(f.pset) } : {}) };
  }
  const explicit = await scope.explicitIds(f);
  const direct = strList(f.global_ids).filter((g) => IFC_GUID_RE.test(g));
  if (explicit !== null || direct.length > 0) {
    const fromIds = explicit && explicit.size > 0 ? await scope.guids([...explicit], "") : [];
    const guids = [...new Set([...direct, ...fromIds])];
    if (guids.length === 0) throw new StyleInputError("Žiadny z vybraných prvkov nemá IFC GUID - nie sú v 3D modeli.");
    if (guids.length > guidBudget.left) {
      throw new StyleInputError(
        `Priveľa konkrétnych prvkov (${guids.length}, strop ${LENS_GUID_CAP} na volanie) - vyber ich filtrom ` +
          "(ifc_type, storey, system, zone, document, property) namiesto vymenovania.",
      );
    }
    guidBudget.left -= guids.length;
    out.guids = guids;
    info.elements = guids.length;
  }
  return out;
}

/** Najviac systémov, ktorým sa rátajú členovia (každý = dopyt do grafu). */
const MAX_DESCRIBED_SYSTEMS = 12;

/**
 * Viac systémov v jednej skupine (#177): `system_type` alebo meno zoberie všetky zhody, aj
 * tie, ktoré k skupine nepatria (Odpadné hospodárstvo vo VENTILATION). Odpoveď vypíše každý
 * systém s typom a počtom členov a varuje, aby model skontroloval názvy.
 */
async function describeSystems(scope: ScopeResolver, systems: Awaited<ReturnType<ScopeResolver["pickSystems"]>>, info: GroupInfo) {
  const shown = systems.slice(0, MAX_DESCRIBED_SYSTEMS);
  const counts = await scope.systemMemberCounts(shown);
  info.system_members = shown.map((s, i) => ({
    system: s.object_ref ?? s.name ?? s.id,
    type: [s.predefined_type, s.user_defined_type].filter(Boolean).join(" / ") || null,
    elements: counts[i],
  }));
  info.warning =
    `Filter zobral ${systems.length} systémov. Over podľa názvov, či všetky patria do skupiny '${info.label}'; ` +
    "ak nie, zúž ju cez system=<presný názov> a povedz používateľovi, ktoré systémy si vynechal.";
}

/** Ops viewera pred lens: `clear_section=true` zruší rez v tom istom príkaze (#177). */
function sectionPrefix(input: Record<string, unknown>): string {
  return input.clear_section === true ? `${SECTION_CLEAR_OP};` : "";
}

/** Krátka značka verzie lens: páruje odoslanú lens s otázkou na počty. */
export function lensRev(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Vykoná `style_in_3d` cez Lens; pridá jednu URL akciu a vráti odpoveď pre model
 * spolu s `rev`, podľa ktorej sa server po odoslaní spýta viewera na počty.
 */
export async function execLensStyle(
  action: string,
  input: Record<string, unknown>,
  push: (a: AskAction) => void,
  opts: LensStyleOptions,
): Promise<{ result: Record<string, unknown>; rev: string }> {
  const mode: LensMode = str(input.mode) === "replace" ? "replace" : "add";
  const rev = lensRev();
  const colorBy = str(input.color_by);
  const legend = legendSize(input.legend_size);

  // Len legenda (D-119, D-125): malá karta, panel Lens ako veľké okno alebo späť, lens ostane.
  if (action === "legend") {
    const size = legend ?? "compact";
    push({
      type: "navigate",
      url: `/ifc?ops=${encodeURIComponent(lensOp("add", { l: size }, rev))}&r=${Date.now().toString(36)}`,
      label: { compact: "3D: legenda AIM chat", large: "3D: veľká legenda", normal: "3D: legenda späť do panelu" }[size],
    });
    return {
      rev,
      result: {
        ok: true,
        applied: action,
        legend_size: size,
        note: {
          compact: "Malá karta vo vieweri ukazuje len legendu AIM chat lens (farba, názov, počet); panel Lens je zavretý.",
          large: "Panel Lens je veľké plávajúce okno, legenda v ňom nie je orezaná; legend_size=normal ho vráti do lišty.",
          normal: "Panel Lens je späť v lište.",
        }[size],
      },
    };
  }

  if (colorBy) {
    if (action !== "colorize") throw new StyleInputError("color_by platí len s action=colorize.");
    if (Array.isArray(input.groups)) throw new StyleInputError("color_by a groups sa nekombinujú - farby určí hodnota.");
    const ac = autoColorSpec(colorBy, str(input.color_by_key));
    // Filter volania obmedzí farby, legendu aj počty na tieto prvky (D-119, #135); bez filtra viewer
    // pri izolácii alebo skrytí vezme viditeľné prvky.
    const filter = pickFilter(input);
    const info: GroupInfo = { label: describeFilter(filter) };
    const scoped = Object.keys(filter).length > 0;
    const s = scoped
      ? [lensGroup(await resolveFilter(new ScopeResolver(getSupabaseAdmin()), filter, opts, info, { left: LENS_GUID_CAP }))]
      : undefined;
    push({
      type: "navigate",
      url: `/ifc?ops=${encodeURIComponent(sectionPrefix(input) + lensOp("replace", { ac, ...(s ? { s } : {}), ...(legend ? { l: legend } : {}) }, rev))}&r=${Date.now().toString(36)}`,
      label: `3D: farby podľa ${colorBy}${scoped ? ` - ${info.label}` : ""}`,
    });
    return {
      rev,
      result: {
        ok: true,
        applied: action,
        lens: "AIM chat",
        color_by: colorBy,
        auto_color: ac,
        scope: scoped
          ? { filter: info, note: "farby, legenda a počty len pre prvky filtra" }
          : { note: "bez filtra: pri izolácii alebo skrytí len viditeľné prvky, inak celý model" },
        ...(legend ? { legend_size: legend } : {}),
        ...(input.clear_section === true ? { section_cleared: true } : {}),
      },
    };
  }

  const groups = parseStyleGroups(input, action);
  const scope = new ScopeResolver(getSupabaseAdmin());
  const budget = { left: LENS_GUID_CAP };
  const rules: LensWireRule[] = [];
  const infos: GroupInfo[] = [];
  for (const g of groups) {
    const info: GroupInfo = { label: g.label, ...(g.color ? { color: `#${g.color}` } : {}) };
    const filter = await resolveFilter(scope, g.filter, opts, info, budget);
    // Izolovaná (X-ray) skupina bez farby ostane v pôvodnom vzhľade (len kanál izolácie / ghost viewera).
    const a = action === "transparent" ? "transparent" : g.color ? "colorize" : "isolate";
    rules.push({ n: g.label, a, ...(g.color ? { c: `#${g.color}` } : {}), g: [lensGroup(filter)] });
    infos.push(info);
  }
  const wire: LensWire = {
    r: rules,
    ...(legend ? { l: legend } : {}),
    ...(action === "isolate" ? { i: 1 as const } : {}),
    ...(action === "xray" ? { x: 1 as const } : {}),
  };
  const verb = { colorize: "ofarbenie", transparent: "priehľadnosť", isolate: "izolácia", xray: "X-ray" }[action] ?? action;
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(sectionPrefix(input) + lensOp(mode, wire, rev))}&r=${Date.now().toString(36)}`,
    label: groups.length > 1 ? `3D: ${verb} ${groups.length} skupín (Lens)` : `3D: ${verb} - ${groups[0].label}`,
  });
  return {
    rev,
    result: {
      ok: true,
      applied: action,
      lens: "AIM chat",
      mode,
      groups: infos,
      ...(input.clear_section === true ? { section_cleared: true } : {}),
      ...(infos.some((i) => i.warning) ? { warnings: infos.filter((i) => i.warning).map((i) => i.warning) } : {}),
      ...(action === "isolate"
        ? { isolated: "viewer zobrazí len tieto prvky; bez farby ostanú v pôvodnom vzhľade, show_all izoláciu zruší" }
        : {}),
      ...(action === "xray"
        ? { xray: "tieto prvky ostanú plné v pôvodnom vzhľade, zvyšok modelu priesvitný (X-ray context); show_all ho zruší" }
        : {}),
    },
  };
}
