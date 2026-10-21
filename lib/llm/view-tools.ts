import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveTargetsToGuids } from "@/lib/engine/aim-lookup";
import { normalizeStoreyLabel } from "@/lib/engine/storey";
import { CAMERA_PRESETS, PANEL_ACTIONS, VIEWER_PANELS } from "@/lib/viewer-ops";
import { CAMERA_FITS, CAMERA_RANGES } from "@/lib/viewer-camera";

import type { AskAction } from "./actions";
import type { ToolDefinition } from "./provider";
import { planCamera } from "./camera-plan";
import { SECTION_CAPS, planSectionCap } from "../viewer-section-cap";
import { DOMAIN_IFC_TYPES } from "./ifc-selector";
import { ViewInputError, planPanels, planSection, planViewMode, type SectionFloor, type ViewPlan } from "./view-plan";
import { SECTION_SHIFT_RANGE } from "../views/plan";

/**
 * UI tools pohľadu (D-083 fáza 1): rez, kamera, režim 3D/2D/Split. Vydávajú
 * viewer ops (`lib/viewer-ops.ts`) tou istou cestou ako style_in_3d - URL akcia,
 * živý kanál (D-079) a záložný odkaz. Podlažie cestuje ako IFC GUID podlažia;
 * výšku rezu prepočíta viewer zo svojej elevácie (jedna pravda o súradniciach).
 */

const MAX_TARGETS = 100;
const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

const floorProp = {
  type: "string",
  description: "Podlažie: object_ref alebo názov (1NP, 2.NP, 3. NP) alebo objects.id",
};

export const VIEW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "set_section",
    description:
      "UI AKCIA: rez modelom v 3D. Vodorovný rez nad podlažím = floor + offset_m (výška nad úrovňou " +
      "podlažia v m, default 1,2 = pôdorysný rez; záporná = pod úrovňou). Pod podhľadom podlažia = " +
      "floor + relative_to=ceiling + offset_m (-0.05 = 5 cm pod podhľadom miestností podlažia; server " +
      "vezme ich FinishCeilingHeight). Rez cez prvok (aj kódom ako SD04.0001) = " +
      "target_ids_or_refs alebo global_ids + fit: along (zvislo pozdĺž dlhšej strany prvku, napr. po " +
      "dĺžke ramena schodiska), across (zvislo naprieč), center (stredom prvku na zadanej orientation). " +
      "Presná poloha = orientation + coordinate_m v súradniciach IFC (vertical_x reže na IFC X, " +
      "vertical_z na IFC Y, horizontal na IFC Z - výške); súradnice dá get_viewer_state(bounds). position_percent " +
      "(0-100 % obálky celej scény, nie budovy) len ako posledná možnosť. action=clear rez zruší. Čistý pohľad bez widgetu rezu = " +
      "show_widget=false (pri set) alebo action=widget, show_widget=false (rez ostáva). Rezná plocha = cap_style " +
      "(hatch = šrafa, solid = plná výplň, none = bez plochy, ostanú obrysy) a cap_color; aktívny rez bez zmeny " +
      "polohy = action=widget + cap_style ('vypni šrafu' = action=widget, cap_style=none alebo solid). Príklad 'ukáž strop " +
      "nad miestnosťou na 2NP, kade idú potrubia': set_section(floor=3NP, offset_m=-0.4) + " +
      "style_in_3d(hide, ifc_type=IfcCovering) + set_camera(preset=top, target=miestnosť).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear", "widget"], description: "widget = len zobraziť/skryť widget aktívneho rezu (show_widget)" },
        orientation: { type: "string", enum: ["horizontal", "vertical_x", "vertical_z"], description: "Default horizontal" },
        floor: floorProp,
        offset_m: { type: "number", description: "Výška rezu nad úrovňou podlažia v metroch (-5 až 20, default 1,2); s relative_to=ceiling posun od podhľadu (-0.05 = 5 cm pod podhľadom)" },
        relative_to: {
          type: "string",
          enum: ["floor", "ceiling"],
          description: "S floor: ceiling = offset_m sa ráta od podhľadu miestností podlažia (Qto FinishCeilingHeight, server ho zistí sám)",
        },
        position_percent: {
          type: "number",
          description: "Poloha rezu 0-100 % obálky celej scény (všetky viditeľné modely, nie len budova), len ako posledná možnosť",
        },
        target_ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: `Rez cez tieto prvky: objects.id alebo object_ref (max ${MAX_TARGETS})`,
        },
        global_ids: { type: "array", items: { type: "string" }, description: "Rez cez prvky podľa IFC GlobalId (z ifc_* toolov)" },
        fit: {
          type: "string",
          enum: ["along", "across", "center"],
          description: "S cieľom: along = pozdĺž, across = naprieč (zvislý rez, os volí viewer), center = stredom na orientation",
        },
        coordinate_m: { type: "number", description: "Poloha roviny v IFC súradniciach (m) na osi orientation" },
        flipped: { type: "boolean", description: "Otočiť stranu rezu" },
        show_widget: {
          type: "boolean",
          description: "false = skryť widget rezu (rovina a jej obrys) pre čistý pohľad, rez ostáva aktívny; true = zobraziť",
        },
        cap_style: {
          type: "string",
          enum: [...SECTION_CAPS],
          description: "Rezná plocha: hatch = šrafa, solid = plná výplň, none = bez plochy (viewer si voľbu pamätá)",
        },
        cap_color: { type: "string", description: "Farba výplne reznej plochy #rrggbb (bez cap_style = solid)" },
      },
      required: ["action"],
    },
  },
  {
    name: "set_camera",
    description:
      "UI AKCIA: kamera v 3D. preset = smer pohľadu (top/bottom/front/back/left/right/iso; fit_all = celý " +
      "model; section = kolmo na aktívny rez, ako tlačidlo Set view; keep = zachovať smer, default). fit = čo " +
      "zarámovať pri danom smere: visible (viditeľné, aj izolované prvky), selection (výber vo vieweri). Cieľ " +
      "prvkami (target_ids_or_refs alebo global_ids) alebo filtrom ako style_in_3d (ifc_type, ifc_types, " +
      "domain, model) zarámuje kameru naň. Relatívne kroky od aktuálneho pohľadu, vždy v SAMOSTATNOM volaní " +
      "bez presetu, fit, cieľa a projection: zoom_percent (+ priblíž, - oddiaľ), orbit_h_deg (+ doľava), " +
      "orbit_v_deg (+ viac zhora), pan_x_percent/pan_y_percent (% pohľadu, + doprava/hore). projection " +
      "orthographic = bez perspektívy (pôdorys, fasáda). Príklady: 'oddiaľ o 15 %' = zoom_percent=-15; " +
      "'izolované VZT v iso na celú obrazovku' = preset=iso, fit=visible, projection=perspective; 'rez " +
      "schodiskom kolmo' = set_section cez schodisko, potom preset=section, fit=visible. Polohu kamery po " +
      "zmene over cez get_viewer_state.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: [...CAMERA_PRESETS], description: "Smer pohľadu; default keep (zachovať)" },
        fit: { type: "string", enum: [...CAMERA_FITS], description: "Čo zarámovať bez cieľa; s cieľom sa rámuje naň" },
        target_ids_or_refs: { type: "array", items: { type: "string" }, description: `objects.id alebo object_ref (max ${MAX_TARGETS})` },
        global_ids: { type: "array", items: { type: "string" }, description: "IFC GlobalId z výsledku ifc_* toolov" },
        ifc_type: { type: "string", description: "Cieľ filtrom: jedna IFC trieda (napr. IfcStairFlight)" },
        ifc_types: { type: "array", items: { type: "string" }, description: "Cieľ filtrom: viac IFC tried" },
        domain: { type: "string", enum: Object.keys(DOMAIN_IFC_TYPES), description: "Cieľ filtrom: celá profesia" },
        model: { type: "string", description: "Cieľ filtrom: súbor federácie (VZT, ASR)" },
        zoom_percent: {
          type: "number",
          description: `Relatívny zoom v % (${CAMERA_RANGES.zoomPercent.min} až ${CAMERA_RANGES.zoomPercent.max}): + priblíži, - oddiali`,
        },
        orbit_h_deg: { type: "number", description: "Otočenie okolo cieľa vodorovne v stupňoch (-180 až 180), + = doľava" },
        orbit_v_deg: { type: "number", description: "Otočenie zvislo v stupňoch (-89 až 89), + = viac zhora" },
        pan_x_percent: { type: "number", description: "Posun pohľadu v % šírky (-100 až 100), + = doprava" },
        pan_y_percent: { type: "number", description: "Posun pohľadu v % výšky (-100 až 100), + = hore" },
        projection: { type: "string", enum: ["perspective", "orthographic"] },
      },
    },
  },
  {
    name: "set_view_mode",
    description:
      "UI AKCIA: prepne viewer medzi 3D, 2D (pôdorys podlažia) a Split (2D + 3D vedľa seba). 2D s " +
      "kalibrovaným výkresom ukáže PDF pôdorys, inak model zhora s rezom 1,2 m nad podlahou; miestnosti " +
      "ofarbené cez style_in_3d sú v ňom vyplnené farbou a popísané názvom. Na " +
      "prehliadku budovy podlažie po podlaží volaj mode=2d s floor postupne (krok na pokyn používateľa). " +
      "reset=true s mode=3d vráti pôvodný pohľad (bez rezu, farieb, skrytia, výberu a zvýraznenia, izometria). " +
      "ULOŽENÝ POHĽAD: saved_view=meno obnoví pohľad uložený cez saved_view (režim, rez, izolácia, skrytie, " +
      "kamera; mode netreba); 'ako minule' = saved_view='Posledný pohľad'; section_offset_m posunie rez po jeho " +
      "osi ('o meter nižšie' = -1). Zoznam: get_viewer_state(saved_views=true). PANELY: panels otvorí, zavrie alebo " +
      "prepne panely (lens, properties, underlays, documents, lists, model_tree; all=close = čistý pohľad, " +
      "napr. {all: 'close', properties: 'open'} = všetko okrem vlastností), aj bez mode; výsledok vráti stav " +
      "všetkých panelov (open, where left/right/bottom/floating, size).",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["3d", "2d", "split"] },
        floor: floorProp,
        reset: { type: "boolean", description: "S mode=3d: zruší rez, farby, skrytie, výber a zvýraznenie a vráti kameru" },
        saved_view: { type: "string", description: "Meno uloženého pohľadu na obnovu (bez mode)" },
        panels: {
          type: "object",
          description: "Panely: {panel: open|close|toggle}; all len close",
          properties: Object.fromEntries(
            [...VIEWER_PANELS, "all"].map((k) => [k, { type: "string", enum: k === "all" ? ["close"] : [...PANEL_ACTIONS] }]),
          ),
        },
        section_offset_m: {
          type: "number",
          description: `So saved_view: posun rezu po jeho osi v m (${SECTION_SHIFT_RANGE.min} až ${SECTION_SHIFT_RANGE.max}, záporné = nižšie)`,
        },
      },
    },
  },
];

export const VIEW_TOOL_NAMES = new Set(VIEW_TOOL_DEFINITIONS.map((t) => t.name));

/** `cap_style` / `cap_color` (D-120); chybný vstup = ViewInputError. */
function sectionCapPlan(input: Record<string, unknown>) {
  const cap = planSectionCap(input);
  if (cap && "error" in cap) throw new ViewInputError(cap.error);
  return cap;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Podlažie AIM (object_ref, názov s normalizáciou, alebo UUID) -> label, aktívny GUID, elevácia. */
async function resolveFloor(raw: unknown): Promise<SectionFloor | null> {
  const want = typeof raw === "string" ? raw.trim() : "";
  if (!want) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("v_floors").select("id, object_ref, name, elevation");
  if (error) throw new Error(error.message);
  const floors = (data ?? []) as { id: string; object_ref: string | null; name: string | null; elevation: number | null }[];
  const norm = normalizeStoreyLabel(want);
  const floor = floors.find(
    (f) =>
      (UUID_RE.test(want) && f.id === want) ||
      normalizeStoreyLabel(f.object_ref ?? "") === norm ||
      normalizeStoreyLabel(f.name ?? "") === norm,
  );
  if (!floor) {
    throw new ViewInputError(
      `Podlažie '${want}' neexistuje. Dostupné: ${floors.map((f) => f.object_ref ?? f.name).join(", ")}.`,
    );
  }
  const { data: g, error: ge } = await supabase
    .from("ifc_guid_history")
    .select("ifc_guid")
    .eq("object_id", floor.id)
    .is("valid_until", null)
    .limit(1);
  if (ge) throw new Error(ge.message);
  const guid = (g?.[0] as { ifc_guid?: string } | undefined)?.ifc_guid;
  if (!guid) throw new ViewInputError(`Podlažie ${floor.object_ref ?? floor.name} nemá IFC GUID - nie je v 3D modeli.`);
  return { label: floor.object_ref ?? floor.name ?? want, guid, elevation: floor.elevation };
}

export async function resolveTargets(input: Record<string, unknown>): Promise<string[]> {
  const refs = Array.isArray(input.target_ids_or_refs)
    ? (input.target_ids_or_refs as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
    : [];
  const direct = Array.isArray(input.global_ids)
    ? (input.global_ids as unknown[]).filter((v): v is string => typeof v === "string" && IFC_GUID_RE.test(v.trim())).map((v) => v.trim())
    : [];
  const out = new Set(direct);
  if (refs.length > 0) {
    const map = await resolveTargetsToGuids(refs.slice(0, MAX_TARGETS));
    const missing = refs.filter((r) => !map.has(r));
    if (missing.length === refs.length && direct.length === 0) {
      throw new ViewInputError(`Ciele nemajú IFC GUID alebo neexistujú: ${missing.slice(0, 5).join(", ")}.`);
    }
    for (const g of map.values()) out.add(g);
  }
  return [...out].slice(0, MAX_TARGETS);
}

/** Vykoná tool pohľadu; vráti odpoveď pre model a pridá URL akciu. */
export async function execViewTool(
  name: string,
  input: Record<string, unknown>,
  push: (action: AskAction) => void,
): Promise<Record<string, unknown>> {
  let plan: ViewPlan;
  const cap = name === "set_section" ? sectionCapPlan(input) : null;
  if (cap && input.action === "widget" && typeof input.show_widget !== "boolean") {
    // Len vzhľad reznej plochy aktívneho rezu (D-120).
    plan = { ops: [], label: "3D", result: { ok: true } };
  } else if (name === "set_section") {
    const floor = input.action === "set" ? await resolveFloor(input.floor) : null;
    const targets = input.action === "set" && (input.target_ids_or_refs || input.global_ids) ? await resolveTargets(input) : [];
    if (input.relative_to === "ceiling") {
      if (!floor) throw new ViewInputError("relative_to=ceiling potrebuje floor (podlažie, ktorého podhľad).");
      const { storeyCeiling } = await import("@/lib/engine/ceiling");
      const ceiling = await storeyCeiling(floor.label);
      if (!ceiling) throw new ViewInputError(`Miestnosti podlažia ${floor.label} nemajú Qto FinishCeilingHeight - zadaj offset_m priamo.`);
      const offset = typeof input.offset_m === "number" && Number.isFinite(input.offset_m) ? input.offset_m : 0;
      plan = planSection({ ...input, offset_m: Math.round((ceiling.height_m + offset) * 1000) / 1000 }, floor, targets);
      plan.result = { ...plan.result, ceiling: { ...ceiling, offset_from_ceiling_m: offset } };
    } else {
      plan = planSection(input, floor, targets);
    }
  } else if (name === "set_camera") {
    plan = planCamera(input, await resolveTargets(input));
  } else if (name === "set_view_mode" && typeof input.saved_view === "string" && input.saved_view.trim() !== "") {
    const [{ restoreSavedView }, { defaultSavedViewDeps }] = await Promise.all([import("@/lib/views/tools"), import("@/lib/views/runtime")]);
    plan = await restoreSavedView(input, defaultSavedViewDeps());
  } else if (name === "set_view_mode") {
    // D-127: samotné panely nepotrebujú režim.
    const panelsOnly = input.panels !== undefined && input.mode === undefined && input.reset !== true;
    plan = panelsOnly ? { ops: [], label: "", result: { ok: true } } : planViewMode(input, input.reset === true ? null : await resolveFloor(input.floor));
  } else {
    throw new Error(`Neznámy tool pohľadu '${name}'.`);
  }
  if (cap) plan = { ops: [...plan.ops, cap.op], label: `${plan.label}, ${cap.label}`, result: { ...plan.result, ...cap.result } };
  // Panely (D-127) idú po režime aj po obnove uloženého pohľadu.
  const panels = name === "set_view_mode" ? planPanels(input) : null;
  if (panels) {
    plan = {
      ops: [...plan.ops, panels.op],
      label: plan.label ? `${plan.label}, ${panels.label}` : panels.label,
      result: { ...plan.result, ...panels.result },
    };
  }
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(plan.ops.join(";"))}&r=${Date.now().toString(36)}`,
    label: plan.label,
  });
  return plan.result;
}
