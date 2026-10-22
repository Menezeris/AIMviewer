import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveTargetsToGuids } from "@/lib/engine/aim-lookup";
import { normalizeStoreyLabel } from "@/lib/engine/storey";
import { CAMERA_PRESETS, PANEL_ACTIONS, PANEL_SCROLLS, VIEWER_PANELS } from "@/lib/viewer-ops";
import { AUTO_ROTATE_ACTIONS, AUTO_ROTATE_DIRECTIONS, AUTO_ROTATE_SPEED, CAMERA_AREAS, CAMERA_FITS, CAMERA_RANGES, DEFAULT_MARGIN_PERCENT } from "@/lib/viewer-camera";

import type { AskAction } from "./actions";
import type { ToolDefinition } from "./provider";
import { planCamera } from "./camera-plan";
import { HATCH_PATTERNS, HATCH_RANGES, SECTION_CAPS, planSectionCap } from "../viewer-section-cap";
import { DOMAIN_IFC_TYPES } from "./ifc-selector";
import { ViewInputError, planPanelScroll, planPanels, planSection, planViewMode, type SectionFloor, type ViewPlan } from "./view-plan";
import { SECTION_SHIFT_RANGE } from "../views/plan";
import { hasTabParams, planViewTabs } from "./view-tabs";

/** `view` je to isté ako `saved_view` (D-132); prázdne = žiadny pohľad. */
const savedViewName = (input: Record<string, unknown>): string | undefined => {
  const v = typeof input.view === "string" && input.view.trim() ? input.view : input.saved_view;
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};

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
      "vezme výšku z geometrie podhľadov, Qto len ako zálohu; zdroj a nezhodu uvedie v ceiling). Rez cez prvok (aj kódom ako SD04.0001) = " +
      "target_ids_or_refs alebo global_ids + fit: along (zvislo pozdĺž dlhšej strany prvku, napr. po " +
      "dĺžke ramena schodiska), across (zvislo naprieč), center (stredom prvku na zadanej orientation). " +
      "Presná poloha = orientation + coordinate_m v súradniciach IFC (vertical_x reže na IFC X, " +
      "vertical_z na IFC Y, horizontal na IFC Z - výške); súradnice dá get_viewer_state(bounds). position_percent " +
      "(0-100 % obálky celej scény, nie budovy) len ako posledná možnosť. action=clear rez zruší. Čistý pohľad bez widgetu rezu = " +
      "show_widget=false (pri set) alebo action=widget, show_widget=false (rez ostáva). Rezná plocha = cap_style " +
      "(hatch = šrafa, solid = plná výplň, none = bez plochy, ostanú obrysy) a cap_color; šrafa = hatch_pattern " +
      "(predvolene diagonal 45°), hatch_angle_deg, hatch_spacing_px, hatch_line_width_px; aktívny rez bez zmeny " +
      "polohy = action=widget + cap_style ('vypni šrafu' = action=widget, cap_style=none alebo solid). Rezný box okolo " +
      "prvkov (detail, napr. 'výstuž stĺpa S12') = box=true + cieľ (+ margin_m, default 0,5 m). Príklad 'ukáž strop " +
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
          description: "S floor: ceiling = offset_m sa ráta od podhľadu miestností podlažia (výška z geometrie IfcCovering CEILING podlažia, záloha Qto FinishCeilingHeight; server ju zistí sám)",
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
        box: { type: "boolean", description: "S action=set a cieľom: rezný box okolo obálky prvkov namiesto roviny (D-132)" },
        margin_m: { type: "number", description: "S box: okraj boxu na každú stranu v m (0 až 20, default 0,5)" },
        hatch_pattern: {
          type: "string",
          enum: [...HATCH_PATTERNS],
          description: "Vzor šrafy (bez cap_style = hatch): diagonal (predvolený), diagonal_reverse, cross = mriežka, crosshatch = krížom 45°, horizontal, vertical, dots, brick, insulation",
        },
        hatch_angle_deg: {
          type: "number",
          description: `Uhol šrafy v stupňoch (${HATCH_RANGES.angleDeg.min} až ${HATCH_RANGES.angleDeg.max}, ako pole Uhol v paneli rezu; diagonal default 45), len diagonal, diagonal_reverse, cross, crosshatch`,
        },
        hatch_spacing_px: {
          type: "number",
          description: `Rozstup čiar šrafy v pixeloch obrazovky (${HATCH_RANGES.spacingPx.min} až ${HATCH_RANGES.spacingPx.max}, default 8)`,
        },
        hatch_line_width_px: {
          type: "number",
          description: `Hrúbka čiary šrafy v pixeloch (${HATCH_RANGES.widthPx.min} až ${HATCH_RANGES.widthPx.max}, default 1)`,
        },
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
      "domain, model) zarámuje kameru naň s okrajom margin_percent (default 40 %); s preset=section najprv kolmo " +
      "na rez, potom rámovanie cieľa. area (left/right/top/bottom podľa obrazu, front/back bližšie/ďalej) " +
      "zarámuje len cieľové prvky (alebo výber pri fit=selection) v tej tretine. Potvrdenie viewera vráti koncovú " +
      "kameru a visible (stred, šírka a výška záberu v m). Relatívne kroky od aktuálneho pohľadu, vždy v SAMOSTATNOM volaní " +
      "bez presetu, fit, cieľa a projection: zoom_percent (+ priblíž, - oddiaľ), orbit_h_deg (+ doľava), " +
      "orbit_v_deg (+ viac zhora), pan_x_percent/pan_y_percent (% pohľadu, + doprava/hore). projection " +
      "orthographic = bez perspektívy (pôdorys, fasáda). Príklady: 'oddiaľ o 15 %' = zoom_percent=-15; " +
      "'izolované VZT v iso na celú obrazovku' = preset=iso, fit=visible, projection=perspective; 'rez " +
      "schodiskom kolmo' = set_section cez schodisko, potom preset=section, fit=visible; 'atika vľavo v reze' = " +
      "set_section + search_objects(PARAPET) + set_camera(preset=section, target_ids_or_refs=atiky, area=left). " +
      "OTÁČANIE DOKOLA (prezentácia): auto_rotate=start plynulo a nepretržite otáča kameru okolo cieľa aktuálneho pohľadu, " +
      "speed_deg_s (default 10 °/s) a direction left|right (left = ako kladné orbit_h_deg: kamera obieha doľava, model sa zdanlivo točí doprava); samostatné volanie, najprv nastav " +
      "pohľad. Zastaví ho auto_rotate=stop, ťah, koliesko alebo dotyk používateľa a každý iný príkaz kamery. " +
      "'Točí sa to pomaličky dokola' = auto_rotate=start, speed_deg_s=5; opakované orbit_h_deg netreba.",
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
        auto_rotate: {
          type: "string",
          enum: [...AUTO_ROTATE_ACTIONS],
          description: "start = plynulé otáčanie dokola, stop = zastaviť; samostatné volanie bez presetu, cieľa a krokov",
        },
        speed_deg_s: {
          type: "number",
          description: `Rýchlosť otáčania v °/s (${AUTO_ROTATE_SPEED.min} až ${AUTO_ROTATE_SPEED.max}, default ${AUTO_ROTATE_SPEED.default}), len s auto_rotate=start`,
        },
        direction: {
          type: "string",
          enum: [...AUTO_ROTATE_DIRECTIONS],
          description: "Smer otáčania, default left (kamera obieha cieľ doľava ako kladné orbit_h_deg), len s auto_rotate=start",
        },
        margin_percent: {
          type: "number",
          description: `Okraj okolo cieľa v % jeho veľkosti (${CAMERA_RANGES.marginPercent.min} až ${CAMERA_RANGES.marginPercent.max}, s cieľom default ${DEFAULT_MARGIN_PERCENT}); tenký prvok = väčší okraj`,
        },
        area: {
          type: "string",
          enum: [...CAMERA_AREAS],
          description: "Len časť cieľa (alebo výberu) podľa smeru pohľadu: left/right/top/bottom na obrazovke, front/back bližšie/ďalej od kamery",
        },
      },
    },
  },
  {
    name: "set_view_mode",
    description:
      "UI AKCIA: záložky vieweru (D-132, ako v Revite): každý pohľad je záložka na celú plochu. mode=3d = záložka 3D, " +
      "mode=2d + floor = pôdorys podlažia v záložke, mode=split = pôdorys vedľa 3D (s kalibrovaným podkladom). 2D s " +
      "kalibrovaným výkresom ukáže PDF pôdorys, inak model zhora s rezom 1,2 m nad podlahou; miestnosti " +
      "ofarbené cez style_in_3d sú v ňom vyplnené farbou a popísané názvom. Na " +
      "prehliadku budovy podlažie po podlaží volaj mode=2d s floor postupne (krok na pokyn používateľa). " +
      "reset=true s mode=3d vráti pôvodný pohľad (bez rezu, farieb, skrytia, výberu a zvýraznenia, izometria). " +
      "ULOŽENÝ POHĽAD: view (alebo saved_view)=meno ho otvorí do vlastnej záložky (rez alebo box, zamknutá kamera, " +
      "izolácia, skrytie; mode netreba); 'ako minule' = view='Posledný pohľad'; section_offset_m posunie rez po jeho " +
      "osi ('o meter nižšie' = -1). Zoznam: get_viewer_state(saved_views=true). ZÁLOŽKY: tab=menovka prepne " +
      "('späť na 3D' = tab='3D'), beside=menovka dá záložku vedľa aktívnej (dokument vedľa 3D alebo pohľadu; none " +
      "zruší), close_tab=menovka alebo all zavrie. Otvorené záložky (tabs) vráti stav po príkaze aj get_viewer_state. " +
      "Dokument do záložky = open_drawing(target=tab). PANELY: panels otvorí, zavrie alebo " +
      "prepne panely (lens, properties, underlays, documents, lists, model_tree; all=close = čistý pohľad, " +
      "napr. {all: 'close', properties: 'open'} = všetko okrem vlastností), aj bez mode; výsledok vráti stav " +
      "všetkých panelov (open, where left/right/bottom/floating, size). POSUN PANELA VLASTNOSTÍ: panel_scroll=down|up " +
      "(o 80 % výšky) | top | bottom na pokyn 'posuň dole', 'hore', 'na začiatok', 'na koniec' (aj bez mode; s " +
      "panels={properties:'open'} ho najprv otvorí); výber prvku a riadok vlastnosti ide cez show_in_3d (highlight).",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["3d", "2d", "split"] },
        floor: floorProp,
        reset: { type: "boolean", description: "S mode=3d: zruší rez, farby, skrytie, výber a zvýraznenie a vráti kameru" },
        saved_view: { type: "string", description: "Meno uloženého pohľadu na obnovu (bez mode); to isté ako view" },
        view: { type: "string", description: "Meno uloženého pohľadu: otvorí ho do záložky (bez mode)" },
        tab: { type: "string", description: "Prepnúť na otvorenú záložku: '3D', menovka pôdorysu, pohľadu alebo dokumentu" },
        beside: { type: "string", description: "Záložka vedľa aktívnej (napr. dokument vedľa 3D); 'none' = aktívna na celú plochu" },
        close_tab: { type: "string", description: "Zavrieť záložku (menovka) alebo 'all' (ostane 3D)" },
        panels: {
          type: "object",
          description: "Panely: {panel: open|close|toggle}; all len close",
          properties: Object.fromEntries(
            [...VIEWER_PANELS, "all"].map((k) => [k, { type: "string", enum: k === "all" ? ["close"] : [...PANEL_ACTIONS] }]),
          ),
        },
        panel_scroll: {
          type: "string",
          enum: [...PANEL_SCROLLS],
          description: "Posun panela vlastností: down/up o stranu, top/bottom na začiatok/koniec",
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
  } else if (name === "set_section" && input.action === "set" && input.box === true) {
    const { planSectionBox } = await import("./view-tabs");
    plan = planSectionBox(input, await resolveTargets(input));
  } else if (name === "set_section") {
    const floor = input.action === "set" ? await resolveFloor(input.floor) : null;
    const targets = input.action === "set" && (input.target_ids_or_refs || input.global_ids) ? await resolveTargets(input) : [];
    if (input.relative_to === "ceiling") {
      if (!floor) throw new ViewInputError("relative_to=ceiling potrebuje floor (podlažie, ktorého podhľad).");
      const { storeyCeiling } = await import("@/lib/engine/ceiling");
      const ceiling = await storeyCeiling(floor.label);
      if (!ceiling) throw new ViewInputError(`Podlažie ${floor.label} nemá IfcCovering CEILING ani miestnosti s Qto FinishCeilingHeight - zadaj offset_m priamo.`);
      const offset = typeof input.offset_m === "number" && Number.isFinite(input.offset_m) ? input.offset_m : 0;
      // D-140: záporný offset = pod podhľadom (od jeho spodku), inak nad ním (od horného okraja).
      const reference = offset < 0 ? ceiling.bottom_m : ceiling.top_m;
      plan = planSection({ ...input, offset_m: Math.round((reference + offset) * 1000) / 1000 }, floor, targets);
      plan.result = {
        ...plan.result,
        ceiling: { ...ceiling, reference: offset < 0 ? "bottom" : "top", reference_m: reference, offset_from_ceiling_m: offset },
      };
    } else {
      plan = planSection(input, floor, targets);
    }
  } else if (name === "set_camera") {
    plan = planCamera(input, await resolveTargets(input));
  } else if (name === "set_view_mode" && hasTabParams(input)) {
    plan = planViewTabs(input);
  } else if (name === "set_view_mode" && savedViewName(input)) {
    const [{ restoreSavedView }, { defaultSavedViewDeps }] = await Promise.all([import("@/lib/views/tools"), import("@/lib/views/runtime")]);
    plan = await restoreSavedView({ ...input, saved_view: savedViewName(input) }, defaultSavedViewDeps());
  } else if (name === "set_view_mode") {
    // D-127: samotné panely nepotrebujú režim.
    const panelsOnly = (input.panels !== undefined || input.panel_scroll !== undefined) && input.mode === undefined && input.reset !== true;
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
  // Posun panela vlastností (D-146) ide po panelih, aby sa najprv otvoril.
  const scroll = name === "set_view_mode" ? planPanelScroll(input) : null;
  if (scroll) {
    plan = {
      ops: [...plan.ops, scroll.op],
      label: plan.label ? `${plan.label}, ${scroll.label}` : scroll.label,
      result: { ...plan.result, ...scroll.result },
    };
  }
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(plan.ops.join(";"))}&r=${Date.now().toString(36)}`,
    label: plan.label,
  });
  return plan.result;
}
