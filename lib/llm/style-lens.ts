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
 * `style_in_3d` over the Lens (D-096): coloring, transparency and isolation are assembled
 * as AIM chat lens rules and sent in one URL action (op `lens`, format in
 * `lib/viewer-lens.ts`). From the AIM graph only names (systems, storeys),
 * GUIDs of specific elements and zone ids are resolved here; evaluation and counts are done by the Lens in the viewer
 * over IFC, so they match what the user sees in the Lens panel.
 */

/** Specific elements go in the URL (~23 characters per GUID), a zone goes symbolically. */
export const LENS_GUID_CAP = 400;
const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : []);

/** Actions of `style_in_3d` that go through the Lens (hiding stays on the viewer hiding channel); `legend` = only the legend panel (D-119). */
export const LENS_STYLE_ACTIONS = new Set(["colorize", "transparent", "isolate", "xray", "legend"]);

/** `legend_size` of the tool (D-119); without a value `undefined`, for the legend action `compact` by default (D-125). */
export function legendSize(raw: unknown): LegendSize | undefined {
  const v = str(raw).toLowerCase();
  if (!v) return undefined;
  if (!(LEGEND_SIZES as readonly string[]).includes(v)) throw new StyleInputError(`legend_size musí byť ${LEGEND_SIZES.join(" alebo ")}.`);
  return v as LegendSize;
}

/** Spaces and zones: large volumes that full color turns into an opaque mass (D-139, #222). */
const SPACE_LIKE_TYPES = new Set(["ifcspace", "ifcspatialzone", "ifczone"]);
/** Other large elements that with full color cover what they surround (warning only). */
const BULKY_TYPES = new Set(["ifcslab", "ifcwall", "ifcwallstandardcase", "ifcroof", "ifccovering", "ifcplate", "ifccurtainwall"]);

const lowerTypes = (types: string[]): string[] => types.map((t) => t.toLowerCase());

export interface LensStyleOptions {
  /** IFC domains -> classes (shared with the selector in `tools.ts`). */
  domainTypes: Record<string, string[]>;
}

export interface GroupInfo {
  label: string;
  color?: string;
  systems?: string[];
  /** With several systems each with its type and member count (D-125, #177). */
  system_members?: { system: string; type: string | null; elements: number }[];
  warning?: string;
  /** Translucent color (D-139): the value requested by the model, or the default for spaces. */
  opacity?: number;
  /** Space rule (D-173): always translucent, possibly a clipped opacity or a split filter. */
  space_rule?: string;
  zones?: string[];
  storey?: string;
  document?: string;
  elements?: number;
}

/** Default translucency of spaces and zones for colorize; the viewer draws it with the fixed alpha of the transparent action (fork 0.3). */
const SPACE_DEFAULT_OPACITY = 0.3;
/** Rule (D-173, #298): a space is never colored with full color, a translucency cap, whatever opacity the model sends. */
export const SPACE_MAX_OPACITY = 0.35;

/** A colorize group is only from spaces / zones: by the filter classes, for specific elements by classes in the DB. */
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
    // Document elements go symbolically as a zone (D-104 step 4): the client downloads the GUIDs from /api/style-scope.
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

/** Max systems whose members are counted (each = a query to the graph). */
const MAX_DESCRIBED_SYSTEMS = 12;

/**
 * Several systems in one group (#177): `system_type` or a name takes all matches, also
 * those that do not belong to the group (Odpadné hospodárstvo (waste management) in VENTILATION). The answer lists each
 * system with its type and member count and warns the model to check the names.
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

/** Viewer ops before the lens: `clear_section=true` cancels the section in the same command (#177). */
function sectionPrefix(input: Record<string, unknown>): string {
  return input.clear_section === true ? `${SECTION_CLEAR_OP};` : "";
}

/**
 * X-ray with a storey filter (#187): without `context_storey` the translucent context is the WHOLE model (all storeys,
 * ASR and VZT), so a view from above overlaps the storeys and the floor plan is unreadable. `context_storey` (fork,
 * `APPLY_LENS xrayStoreys`) hides the other storeys; the model is warned about it.
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
 * `context_storey` (D-140, #187): storeys that remain in the X-ray context (normalized label from the AIM graph).
 * Applies only with action=xray; an unknown storey is an error with an offer.
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

/** Short lens version tag: pairs the sent lens with the counts question. */
export function lensRev(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Executes `style_in_3d` through the Lens; adds one URL action and returns the answer for the model
 * together with `rev`, by which the server asks the viewer for counts after sending.
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

  // Legend only (D-119, D-125): a small card, the Lens panel as a large window or back, the lens stays.
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
    // The call filter limits colors, legend and counts to these elements (D-119, #135); without a filter the viewer
    // takes the visible elements on isolation or hiding.
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
    // An isolated (X-ray) group without a color keeps its original look (only the isolation / ghost channel of the viewer).
    let a: LensWireRule["a"] = action === "transparent" ? "transparent" : g.color ? "colorize" : "isolate";
    if (a === "colorize") {
      // Transparency (D-139, #222): opacity < 1 = translucent variant; without opacity spaces and zones get it
      // (by filter classes, for ids_or_refs by classes of the elements in the DB). A space (D-173, #298) never gets
      // full color: opacity=1 and higher values are clipped to SPACE_MAX_OPACITY, a mixed list of classes is split into two rules.
      const spaceLike = await isSpaceLike(scope, g.filter, filter.types, filter.guids?.length ?? 0);
      const lt = lowerTypes(filter.types);
      const spaceTypes = filter.types.filter((t) => SPACE_LIKE_TYPES.has(t.toLowerCase()));
      if (!spaceLike && !filter.guids?.length && spaceTypes.length > 0 && spaceTypes.length < lt.length) {
        rules.push({ n: `${g.label} (priestory)`, a: "transparent", ...(g.color ? { c: `#${g.color}` } : {}), g: [lensGroup({ ...filter, types: spaceTypes })] });
        filter.types = filter.types.filter((t) => !SPACE_LIKE_TYPES.has(t.toLowerCase()));
        info.space_rule = `priestory a zóny z filtra (${spaceTypes.join(", ")}) idú ako samostatné priesvitné pravidlo, plná farba platí len pre ostatné`;
      }
      if (spaceLike) {
        a = "transparent";
        info.opacity = Math.min(g.opacity ?? SPACE_DEFAULT_OPACITY, SPACE_MAX_OPACITY);
        info.space_rule = g.opacity !== undefined && g.opacity > SPACE_MAX_OPACITY
          ? `priestor sa nefarbí plnou farbou, opacity ${g.opacity} orezaná na ${SPACE_MAX_OPACITY}`
          : "priestory a zóny sú vždy len priesvitné (plná farba sa nepoužije)";
      } else if (g.opacity !== undefined && g.opacity < 1) {
        a = "transparent";
        info.opacity = g.opacity;
      } else {
        const rest = lowerTypes(filter.types);
        if (rest.length > 0 && rest.every((t) => BULKY_TYPES.has(t))) bulkyOpaque.push(g.label);
        else hasOtherColored = true;
      }
    } else if (a === "transparent" && g.opacity !== undefined) {
      info.opacity = (await isSpaceLike(scope, g.filter, filter.types, filter.guids?.length ?? 0)) ? Math.min(g.opacity, SPACE_MAX_OPACITY) : g.opacity;
    }
    rules.push({ n: g.label, a, ...(g.color ? { c: `#${g.color}` } : {}), g: [lensGroup(filter)] });
    infos.push(info);
  }
  const context = await resolveContextStoreys(scope, input, action);
  const wire: LensWire = {
    // The Lens colors by the first match: the last group of the call goes first and wins on overlap (D-138, #221).
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
