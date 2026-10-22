import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LEGEND_SIZES, MAX_CONTEXT_STOREYS, lensOp, type LegendSize, type LensMode, type LensWire, type LensWireRule } from "@/lib/viewer-lens";
import { normalizeStoreyLabel } from "@/lib/engine/storey";
import { SECTION_CLEAR_OP } from "@/lib/viewer-ops";

import type { AskAction } from "./actions";
import { autoColorSpec, lensGroup, type ResolvedLensFilter } from "./lens-plan";
import { StyleInputError, describeFilter, documentPage, ignoredGroupKeys, parseStyleGroups, pickFilter, type StyleFilter } from "./style-plan";
import { lensPriorityOrder } from "./style-overlap";
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

/** Priestory a zóny: veľké objemy, ktoré plná farba zmení na nepriehľadnú hmotu (D-139, #222). */
const SPACE_LIKE_TYPES = new Set(["ifcspace", "ifcspatialzone", "ifczone"]);
/** Ďalšie veľké prvky, ktoré pri plnej farbe zakryjú to, čo obklopujú (len varovanie). */
const BULKY_TYPES = new Set(["ifcslab", "ifcwall", "ifcwallstandardcase", "ifcroof", "ifccovering", "ifcplate", "ifccurtainwall"]);

const lowerTypes = (types: string[]): string[] => types.map((t) => t.toLowerCase());

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
  /** Priesvitná farba (D-139): hodnota, ktorú žiadal model, alebo predvolená pre priestory. */
  opacity?: number;
  opacity_default?: string;
  zones?: string[];
  storey?: string;
  document?: string;
  elements?: number;
}

/** Predvolená priesvitnosť priestorov a zón pri colorize; viewer ju kreslí fixnou alfou akcie transparent (fork 0,3). */
const SPACE_DEFAULT_OPACITY = 0.3;

/** Skupina colorize je len z priestorov / zón: podľa tried filtra, pri konkrétnych prvkoch podľa tried v DB. */
async function isSpaceLike(scope: ScopeResolver, f: StyleFilter, types: string[], guidCount: number): Promise<boolean> {
  const lt = lowerTypes(types);
  if (lt.length > 0) return lt.every((t) => SPACE_LIKE_TYPES.has(t));
  if (guidCount === 0) return false;
  const ids = await scope.explicitIds(f);
  if (!ids || ids.size === 0) return false;
  const rows = await scope.rows([...ids]);
  return rows.length > 0 && rows.every((r) => SPACE_LIKE_TYPES.has((r.ifc_type ?? "").toLowerCase()) || r.object_type === "space");
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

/**
 * X-ray s filtrom podlažia (#187): bez `context_storey` je priesvitný kontext CELÝ model (všetky podlažia,
 * ASR aj VZT), takže pohľad zhora prekrýva podlažia a pôdorys je nečitateľný. `context_storey` (fork,
 * `APPLY_LENS xrayStoreys`) ostatné podlažia skryje; model na to upozorní.
 */
export function xrayStoreyWarning(storeys: string[], sectionCleared: boolean): string {
  const list = storeys.join(", ");
  return (
    `X-ray s podlažím ${list}: priesvitný kontext je celý model (všetky podlažia, ASR aj VZT), pôdorys zhora bude ` +
    `prekrytý. Ak používateľ chce čitateľný pôdorys ${list}, zopakuj volanie s context_storey=${storeys[0]} ` +
    "(ostatné podlažia sa skryjú, kontext ostane len toto) a vodorovným rezom (set_section tesne nad horný okraj " +
    "prvkov) odstráň, čo je nad ním" +
    (sectionCleared ? " (clear_section=true zrušil doterajší rez)." : ".")
  );
}

/**
 * `context_storey` (D-140, #187): podlažia, ktoré ostanú v kontexte X-ray (normalizovaný štítok z grafu AIM).
 * Platí len s action=xray; neznáme podlažie je chyba s ponukou.
 */
export async function resolveContextStoreys(
  scope: ScopeResolver,
  input: Record<string, unknown>,
  action: string,
): Promise<{ labels: string[]; names: string[] }> {
  const raw = Array.isArray(input.context_storey) ? strList(input.context_storey) : str(input.context_storey) ? [str(input.context_storey)] : [];
  if (raw.length === 0) return { labels: [], names: [] };
  if (action !== "xray") throw new StyleInputError("context_storey platí len s action=xray (kontext X-ray len pre zvolené podlažie).");
  if (raw.length > MAX_CONTEXT_STOREYS) throw new StyleInputError(`context_storey: najviac ${MAX_CONTEXT_STOREYS} podlaží.`);
  const floors = await Promise.all(raw.map((w) => scope.pickFloor(w)));
  const names = floors.map((f) => f.object_ref ?? f.name ?? "").filter(Boolean);
  const labels = [...new Set(floors.map((f) => normalizeStoreyLabel(f.name ?? f.object_ref ?? "")).filter(Boolean))];
  if (labels.length === 0) throw new StyleInputError("Podlažie z context_storey nemá v modeli názov.");
  return { labels, names };
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
  const bulkyOpaque: string[] = [];
  let hasOtherColored = false;
  for (const g of groups) {
    const info: GroupInfo = { label: g.label, ...(g.color ? { color: `#${g.color}` } : {}) };
    const filter = await resolveFilter(scope, g.filter, opts, info, budget);
    // Izolovaná (X-ray) skupina bez farby ostane v pôvodnom vzhľade (len kanál izolácie / ghost viewera).
    let a: LensWireRule["a"] = action === "transparent" ? "transparent" : g.color ? "colorize" : "isolate";
    if (a === "colorize") {
      // Priehľadnosť (D-139, #222): opacity < 1 = priesvitná varianta; bez opacity ju dostanú priestory a zóny
      // (podľa tried filtra, pri ids_or_refs podľa tried prvkov v DB), opacity=1 vynúti plnú farbu.
      const spaceLike = g.opacity === undefined && (await isSpaceLike(scope, g.filter, filter.types, filter.guids?.length ?? 0));
      if ((g.opacity !== undefined && g.opacity < 1) || spaceLike) {
        a = "transparent";
        info.opacity = g.opacity ?? SPACE_DEFAULT_OPACITY;
        if (spaceLike) info.opacity_default = "priestory a zóny sú predvolene priesvitné (opacity=1 = plná farba)";
      } else {
        const lt = lowerTypes(filter.types);
        if (lt.length > 0 && lt.every((t) => BULKY_TYPES.has(t))) bulkyOpaque.push(g.label);
        else hasOtherColored = true;
      }
    } else if (a === "transparent" && g.opacity !== undefined) {
      info.opacity = g.opacity;
    }
    rules.push({ n: g.label, a, ...(g.color ? { c: `#${g.color}` } : {}), g: [lensGroup(filter)] });
    infos.push(info);
  }
  const context = await resolveContextStoreys(scope, input, action);
  const wire: LensWire = {
    // Lens farbí prvou zhodou: posledná skupina volania ide dopredu a vyhrá pri prekrytí (D-138, #221).
    r: lensPriorityOrder(rules),
    ...(legend ? { l: legend } : {}),
    ...(action === "isolate" ? { i: 1 as const } : {}),
    ...(action === "xray" ? { x: 1 as const } : {}),
    ...(action === "xray" && context.labels.length > 0 ? { cs: context.labels } : {}),
  };
  const warnings: string[] = infos.flatMap((i) => (i.warning ? [i.warning] : []));
  const ignored = ignoredGroupKeys(input);
  if (ignored.length > 0) {
    warnings.push(
      `Kľúče ${ignored.join(", ")} v groups nie sú filter a boli ignorované - skupina je širšia, než si chcel. ` +
        "Podlažie sa volá storey (alias floor), ďalšie filtre: ifc_type, predefined_type, system, zone, property...",
    );
  }
  if (mode === "replace" && action !== "transparent") {
    warnings.push(
      "mode=replace zrušil doterajšie pravidlá Lens (farby, priehľadnosť z predošlých volaní). Ak majú ostať, " +
        "použi mode=add (predvolené) alebo ich daj ako groups s farbou do toho istého volania.",
    );
  }
  if (groups.length > 1 && action === "colorize") {
    warnings.push(
      "Pri prekrytí vyhráva neskoršia skupina v groups (a novšie volanie s mode=add): konkrétnu trasu alebo výnimku " +
        "daj ako poslednú skupinu. Pravidlo bez zásahu odpoveď nahlási s dôvodom.",
    );
  }
  if (action === "xray") {
    const storeys = [...new Set(infos.flatMap((i) => (i.storey ? [i.storey] : [])))];
    if (storeys.length > 0 && context.labels.length === 0) warnings.push(xrayStoreyWarning(storeys, input.clear_section === true));
  }
  if (bulkyOpaque.length > 0 && (hasOtherColored || groups.length > 1)) {
    warnings.push(
      `Plne ofarbené veľké prvky (${bulkyOpaque.join(", ")}) môžu zakryť ostatné farby v tomto volaní. ` +
        "Daj im opacity=0.3 (priesvitné) alebo ich nefarb a zvýrazni len to, čo je vnútri.",
    );
  }
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
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(action === "isolate"
        ? { isolated: "viewer zobrazí len tieto prvky; bez farby ostanú v pôvodnom vzhľade, show_all izoláciu zruší" }
        : {}),
      ...(action === "xray"
        ? {
            xray:
              context.labels.length > 0
                ? `tieto prvky ostanú plné, kontext je len podlažie ${context.names.join(", ")} (priesvitné), ostatné podlažia sú skryté; ` +
                  "clear_isolation alebo show_all ich vráti. Prvky mimo podlaží (terén, budova) ostanú priesvitné"
                : "tieto prvky ostanú plné v pôvodnom vzhľade, zvyšok modelu priesvitný (X-ray context); show_all ho zruší",
            ...(context.labels.length > 0 ? { context_storey: context.names } : {}),
          }
        : {}),
    },
  };
}
