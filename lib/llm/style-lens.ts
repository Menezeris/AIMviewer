import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lensOp, type LensMode, type LensWire, type LensWireRule } from "@/lib/viewer-lens";

import type { AskAction } from "./actions";
import { autoColorSpec, lensGroup, type ResolvedLensFilter } from "./lens-plan";
import { StyleInputError, parseStyleGroups, type StyleFilter } from "./style-plan";
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

/** Akcie `style_in_3d`, ktoré idú cez Lens (skrytie ostáva na kanáli skrývania viewera). */
export const LENS_STYLE_ACTIONS = new Set(["colorize", "transparent", "isolate"]);

export interface LensStyleOptions {
  /** IFC domény -> triedy (zdieľané so selektorom v `tools.ts`). */
  domainTypes: Record<string, string[]>;
}

interface GroupInfo {
  label: string;
  color: string;
  systems?: string[];
  zones?: string[];
  storey?: string;
  elements?: number;
}

async function resolveFilter(
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
          "(ifc_type, storey, system, zone, property) namiesto vymenovania.",
      );
    }
    guidBudget.left -= guids.length;
    out.guids = guids;
    info.elements = guids.length;
  }
  return out;
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

  if (colorBy) {
    if (action !== "colorize") throw new StyleInputError("color_by platí len s action=colorize.");
    if (Array.isArray(input.groups)) throw new StyleInputError("color_by a groups sa nekombinujú - farby určí hodnota.");
    const ac = autoColorSpec(colorBy, str(input.color_by_key));
    push({
      type: "navigate",
      url: `/ifc?ops=${encodeURIComponent(lensOp("replace", { ac }, rev))}&r=${Date.now().toString(36)}`,
      label: `3D: farby podľa ${colorBy}`,
    });
    return {
      rev,
      result: { ok: true, applied: action, lens: "AIM chat", color_by: colorBy, auto_color: ac },
    };
  }

  const groups = parseStyleGroups(input, action);
  const scope = new ScopeResolver(getSupabaseAdmin());
  const budget = { left: LENS_GUID_CAP };
  const lensAction = action === "transparent" ? "transparent" : "colorize";
  const rules: LensWireRule[] = [];
  const infos: GroupInfo[] = [];
  for (const g of groups) {
    const info: GroupInfo = { label: g.label, color: `#${g.color}` };
    const filter = await resolveFilter(scope, g.filter, opts, info, budget);
    rules.push({ n: g.label, a: lensAction, c: `#${g.color}`, g: [lensGroup(filter)] });
    infos.push(info);
  }
  const wire: LensWire = { r: rules, ...(action === "isolate" ? { i: 1 as const } : {}) };
  const verb = { colorize: "ofarbenie", transparent: "priehľadnosť", isolate: "izolácia" }[action] ?? action;
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(lensOp(mode, wire, rev))}&r=${Date.now().toString(36)}`,
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
      ...(action === "isolate" ? { isolated: "ostatné prvky sú skryté pravidlom Ostatné (skryté)" } : {}),
    },
  };
}
