import {
  MAX_SECTION_TARGETS,
  SECTION_CLEAR_OP,
  SECTION_COORDINATE_LIMIT,
  sectionGizmoOp,
  SECTION_FITS,
  SECTION_OFFSET_RANGE,
  cameraOp,
  sectionOp,
  viewModeOp,
  VIEW_MODES,
  PANEL_ACTIONS,
  PANEL_SIDES,
  PANEL_WIDTH_PCT,
  panelsOp,
  planPositionOp,
  underlays3dOp,
  panelScrollOp,
  panelZoomOp,
  PANEL_ITEM_MAX,
  PANEL_NAME,
  PANEL_SCROLLS,
  PANEL_ZOOM_RANGE,
  PANEL_ZOOM_STEPS,
  type PanelAction,
  type PanelLayoutRequest,
  type PanelSide,
  type PanelsRequest,
  type PanelScrollTarget,
  type PanelZoom,
  type SectionFit,
  type ViewMode,
} from "../viewer-ops";

/**
 * Čistá logika tools pohľadu (D-083 fáza 1): vstup toolu + dohľadané GUID
 * podlažia a cieľov -> viewer ops a odpoveď pre model. Dohľadanie v DB robí
 * `view-tools.ts`; tu sa nič nečíta ani nezapisuje.
 */

export interface ViewPlan {
  ops: string[];
  label: string;
  result: Record<string, unknown>;
}

export class ViewInputError extends Error {}

const ORIENTATION_AXIS = { horizontal: "y", vertical_x: "x", vertical_z: "z" } as const;

function num(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** Podlažie pre rez: label, GUID a IfcBuildingStorey.Elevation z AIM DB (jednotky modelu). */
export interface SectionFloor {
  label: string;
  guid: string;
  elevation?: number | null;
}

export function planSection(
  input: Record<string, unknown>,
  floor: SectionFloor | null,
  targetGuids: string[] = [],
): ViewPlan {
  const action = String(input.action ?? "").trim();
  if (action === "clear") {
    return { ops: [SECTION_CLEAR_OP], label: "3D: zrušiť rez", result: { ok: true, section: "cleared" } };
  }
  const showWidget = typeof input.show_widget === "boolean" ? input.show_widget : undefined;
  if (action === "widget") {
    // Len widget aktívneho rezu, rez ostáva (#63).
    if (showWidget === undefined) throw new ViewInputError("action=widget potrebuje show_widget (true/false).");
    return {
      ops: [sectionGizmoOp(showWidget)],
      label: showWidget ? "3D: zobraziť widget rezu" : "3D: skryť widget rezu",
      result: { ok: true, section: { show_widget: showWidget } },
    };
  }
  if (action !== "set") throw new ViewInputError("action musí byť set, clear alebo widget.");
  const gizmo = showWidget === undefined ? {} : { showGizmo: showWidget };
  const widgetOut = showWidget === undefined ? {} : { show_widget: showWidget };
  const orientation = String(input.orientation ?? "horizontal") as keyof typeof ORIENTATION_AXIS;
  const axis = ORIENTATION_AXIS[orientation];
  if (!axis) throw new ViewInputError("orientation musí byť horizontal, vertical_x alebo vertical_z.");
  const flipped = input.flipped === true;
  const fitRaw = input.fit === undefined ? undefined : String(input.fit);
  const coordinate = num(input.coordinate_m);
  const hasTargets = input.target_ids_or_refs !== undefined || input.global_ids !== undefined;
  const modes = [floor, hasTargets || fitRaw !== undefined ? true : null, coordinate, num(input.position_percent)]
    .filter((v) => v !== null && v !== undefined).length;
  if (modes > 1) {
    throw new ViewInputError("Zadaj len jedno: floor, cieľ (target_ids_or_refs/global_ids + fit), coordinate_m alebo position_percent.");
  }

  if (hasTargets || fitRaw !== undefined) {
    // Rez cez prvky (D-085): viewer zoberie ich obálku a rovinu dá do stredu.
    const fit = (fitRaw ?? "center") as SectionFit;
    if (!(SECTION_FITS as readonly string[]).includes(fit)) throw new ViewInputError("fit musí byť along, across alebo center.");
    if (targetGuids.length === 0) throw new ViewInputError("Cieľ rezu sa nenašiel alebo nemá IFC GUID (target_ids_or_refs / global_ids).");
    const guids = targetGuids.slice(0, MAX_SECTION_TARGETS);
    const auto = fit === "along" || fit === "across";
    if (!auto && input.orientation === undefined) {
      throw new ViewInputError("fit=center potrebuje orientation (horizontal, vertical_x alebo vertical_z).");
    }
    const label = auto ? `3D: rez ${fit === "along" ? "pozdĺž" : "naprieč"} vybraných prvkov` : `3D: rez ${orientation} stredom vybraných prvkov`;
    return {
      ops: [sectionOp({ guids, fit, ...(auto ? {} : { axis }), flipped, ...gizmo })],
      label,
      result: { ok: true, section: { fit, ...(auto ? {} : { orientation }), targets: guids.length, flipped, ...widgetOut } },
    };
  }

  if (coordinate !== undefined) {
    if (Math.abs(coordinate) > SECTION_COORDINATE_LIMIT) throw new ViewInputError("coordinate_m je mimo rozsahu.");
    const crosses = { y: "IFC Z (výška)", x: "IFC X", z: "IFC Y" }[axis];
    return {
      ops: [sectionOp({ axis, coordinate, flipped, ...gizmo })],
      label: `3D: rez ${orientation} na ${crosses} = ${coordinate} m`,
      result: { ok: true, section: { orientation, coordinate_m: coordinate, crosses, flipped, ...widgetOut } },
    };
  }

  if (floor) {
    if (axis !== "y") throw new ViewInputError("Podlažie sa dá použiť len pri vodorovnom reze (orientation=horizontal).");
    const offsetM = num(input.offset_m) ?? 1.2;
    if (offsetM < SECTION_OFFSET_RANGE.min || offsetM > SECTION_OFFSET_RANGE.max) {
      throw new ViewInputError(`offset_m musí byť v rozsahu ${SECTION_OFFSET_RANGE.min} až ${SECTION_OFFSET_RANGE.max} m.`);
    }
    return {
      ops: [sectionOp({ storeyGuid: floor.guid, offsetM, flipped, ...gizmo })],
      label:
        offsetM >= 0
          ? `3D: rez ${offsetM} m nad ${floor.label}`
          : `3D: rez ${-offsetM} m pod úrovňou ${floor.label}`,
      result: {
        ok: true,
        section: {
          floor: floor.label,
          offset_m: offsetM,
          flipped,
          ...widgetOut,
          // D-092: viewer počíta výšku sám; elevácia z AIM DB slúži na kontrolu jeho polohy roviny.
          ...(floor.elevation != null ? { floor_elevation_model_units: floor.elevation } : {}),
        },
      },
    };
  }
  const position = num(input.position_percent);
  if (position === undefined) {
    throw new ViewInputError(
      "Zadaj floor (vodorovný rez nad podlažím), cieľ s fit (rez cez prvok), coordinate_m (súradnica IFC) alebo position_percent (0-100).",
    );
  }
  if (position < 0 || position > 100) throw new ViewInputError("position_percent musí byť 0-100.");
  return {
    ops: [sectionOp({ axis, position, flipped, ...gizmo })],
    label: `3D: rez ${orientation} ${position} %`,
    result: { ok: true, section: { orientation, position_percent: position, flipped, ...widgetOut } },
  };
}

/**
 * Podklady PDF v 3D (D-133 doplnok): `underlays_3d` = true zobrazí, false skryje v 3D plátne. Je to stav
 * viewera, nie `visible` kalibrácie (to sa ukladá do DB a skrýva aj 2D). Bez parametra null.
 */
export function planUnderlays3d(input: Record<string, unknown>): { op: string; label: string; result: { underlays_3d: boolean } } | null {
  const raw = input.underlays_3d;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "boolean") throw new ViewInputError("underlays_3d: true (zobraziť podklady PDF v 3D) alebo false (skryť).");
  return { op: underlays3dOp(raw), label: `Podklady v 3D: ${raw ? "zapnuté" : "vypnuté"}`, result: { underlays_3d: raw } };
}

/**
 * Poloha a smer kamery na kalibrovanom PDF (D-161 bod 8, #282): `plan_position` = true zobrazí bodku a výsek
 * smeru pohľadu na PDF v záložke alebo dlaždici, false skryje. Stav viewera; čítanie `get_viewer_state.plan_position`.
 */
export function planPlanPosition(input: Record<string, unknown>): { op: string; label: string; result: { plan_position: boolean } } | null {
  const raw = input.plan_position;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "boolean") throw new ViewInputError("plan_position: true (ukázať polohu a smer kamery na PDF) alebo false (skryť).");
  return { op: planPositionOp(raw), label: `Poloha na PDF: ${raw ? "zapnutá" : "vypnutá"}`, result: { plan_position: raw } };
}

export function planViewMode(
  input: Record<string, unknown>,
  floor: { label: string; guid: string } | null,
  /** Výkres podlažia vybraný hostom pre mode=split (D-176); bez neho vyberá viewer. */
  drawing?: { documentId: string; name: string; discipline: string | null; chosen_by: "discipline" | "preference"; alternatives: { name: string; discipline: string | null }[] } | null,
): ViewPlan {
  const mode = String(input.mode ?? "").trim() as ViewMode;
  if (!(VIEW_MODES as readonly string[]).includes(mode)) throw new ViewInputError("mode musí byť 3d, 2d alebo split.");
  if (input.reset === true) {
    if (mode !== "3d") throw new ViewInputError("reset platí len s mode=3d.");
    // Zloží existujúce ops: bez rezu, 3D, všetko viditeľné, bez farieb, bez výberu (D-102), izometria.
    return {
      ops: [SECTION_CLEAR_OP, viewModeOp("3d"), "show_all::", "reset_colors::", "clear_selection::", "clear_focus::", cameraOp("iso")],
      label: "3D: pôvodný pohľad",
      result: { ok: true, reset: true },
    };
  }
  // D-161: 2D nie je režim. `2d` = kamera zhora a rez na bežnom 3D, `split` = to isté a dlaždice 3D | výkres PDF.
  const note = {
    "3d": "Perspektívna kamera na bežnom 3D.",
    "2d": "Pohľad zhora na podlažie na bežnom 3D (ortografická kamera, vodorovný rez 1,2 m nad podlahou alebo uložený pohľad podlažia); bez zámku, orbit a nástroje fungujú.",
    split: "Pohľad zhora na podlažie a dlaždice 3D | výkres PDF podlažia; ak podlažie nemá výkres, viewer to nahlási v problémoch.",
  }[mode];
  return {
    ops: [viewModeOp(mode, floor?.guid, mode === "split" ? drawing?.documentId : undefined)],
    label: mode === "3d" ? "Viewer: 3D" : `Viewer: pohľad zhora${mode === "split" ? " + výkres" : ""}${floor ? ` ${floor.label}` : ""}`,
    result: {
      ok: true,
      mode,
      ...(floor ? { floor: floor.label } : {}),
      ...(mode === "split" && drawing
        ? { drawing: { name: drawing.name, discipline: drawing.discipline, chosen_by: drawing.chosen_by, alternatives: drawing.alternatives } }
        : {}),
      note,
    },
  };
}

/** `panel_layout` (D-172, #320): {panel, width_pct?, side?}, aspoň jedno z posledných dvoch. */
function panelLayoutOf(raw: unknown): PanelLayoutRequest {
  const hint = `panel_layout = {panel, width_pct: ${PANEL_WIDTH_PCT.min} až ${PANEL_WIDTH_PCT.max}, side: ${PANEL_SIDES.join(" | ")}} (aspoň jedno z width_pct a side).`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ViewInputError(hint);
  const o = raw as Record<string, unknown>;
  if (typeof o.panel !== "string" || !PANEL_NAME.test(o.panel)) throw new ViewInputError("panel_layout.panel: meno panela (get_viewer_state, panels).");
  if (o.width_pct === undefined && o.side === undefined) throw new ViewInputError(hint);
  const out: PanelLayoutRequest = { panel: o.panel };
  if (o.width_pct !== undefined) {
    const w = o.width_pct;
    if (typeof w !== "number" || !Number.isFinite(w) || w < PANEL_WIDTH_PCT.min || w > PANEL_WIDTH_PCT.max) {
      throw new ViewInputError(`panel_layout.width_pct: číslo ${PANEL_WIDTH_PCT.min} až ${PANEL_WIDTH_PCT.max} (% šírky okna viewera).`);
    }
    out.widthPct = w;
  }
  if (o.side !== undefined) {
    if (typeof o.side !== "string" || !(PANEL_SIDES as readonly string[]).includes(o.side)) throw new ViewInputError(`panel_layout.side: ${PANEL_SIDES.join(", ")}.`);
    out.side = o.side as PanelSide;
  }
  return out;
}

/**
 * Panely viewera (D-127, D-150): `panels` = {lens: "close", bcf: "open", ...}, `all` len "close". Meno je id panela
 * z registra forku; tvar mena kontroluje host, existenciu viewer (neznáme nahlási v `APPLIED`, zoznam je vo
 * `view_state.panels`). D-172 (#320): `panel_layout` = {panel, width_pct?, side?} nastaví šírku a stranu panela v tej
 * istej správe (`panels` je potom voliteľné, aspoň jedno z dvoch). Bez oboch null; chybný vstup = ViewInputError (model ho opraví).
 */
export function planPanels(input: Record<string, unknown>): { op: string; label: string; result: { panels?: PanelsRequest; panel_layout?: { panel: string; width_pct?: number; side?: PanelSide } } } | null {
  const raw = input.panels;
  const rawLayout = input.panel_layout;
  const hasPanels = raw !== undefined && raw !== null;
  const hasLayout = rawLayout !== undefined && rawLayout !== null;
  if (!hasPanels && !hasLayout) return null;
  const out: PanelsRequest = {};
  if (hasPanels) {
    if (typeof raw !== "object" || Array.isArray(raw)) throw new ViewInputError("panels = {<panel>|all: open|close|toggle}, mená panelov vráti get_viewer_state (panels).");
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!PANEL_NAME.test(k)) throw new ViewInputError(`panels: neplatné meno panela '${k}' (panely a skratky vráti get_viewer_state, napr. lens, properties, bcf, lists, model_tree).`);
      if (!(PANEL_ACTIONS as readonly unknown[]).includes(v)) throw new ViewInputError(`panels.${k}: open, close alebo toggle.`);
      if (k === "all" && v !== "close") throw new ViewInputError("panels.all: len close (zatvorí všetky panely, okrem tých, ktoré správa otvára).");
      out[k] = v as PanelAction;
    }
    if (Object.keys(out).length === 0 && !hasLayout) throw new ViewInputError("panels: aspoň jeden panel.");
  }
  const layout = hasLayout ? panelLayoutOf(rawLayout) : undefined;
  const parts = [
    ...Object.entries(out).map(([k, v]) => `${k} ${v}`),
    ...(layout ? [`${layout.panel}${layout.widthPct !== undefined ? ` šírka ${layout.widthPct} %` : ""}${layout.side ? ` strana ${layout.side}` : ""}`] : []),
  ];
  const resultLayout = layout ? { panel: layout.panel, ...(layout.widthPct !== undefined ? { width_pct: layout.widthPct } : {}), ...(layout.side ? { side: layout.side } : {}) } : undefined;
  return {
    op: panelsOp(Object.keys(out).length > 0 ? out : undefined, layout),
    label: `Panely: ${parts.join(", ")}`,
    result: { ...(Object.keys(out).length > 0 ? { panels: out } : {}), ...(resultLayout ? { panel_layout: resultLayout } : {}) },
  };
}

/** Panel_scroll ako reťazec (D-146, panel vlastností) alebo objekt {panel, to | item | percent} (D-150). */
function scrollTargetOf(raw: unknown): PanelScrollTarget {
  if (typeof raw === "string") {
    if (!(PANEL_SCROLLS as readonly string[]).includes(raw.trim())) throw new ViewInputError(`panel_scroll: ${PANEL_SCROLLS.join(", ")}.`);
    return { direction: raw.trim() as (typeof PANEL_SCROLLS)[number] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ViewInputError(`panel_scroll: ${PANEL_SCROLLS.join(", ")} alebo {panel, to | item | percent}.`);
  const o = raw as Record<string, unknown>;
  if (o.panel !== undefined && !(typeof o.panel === "string" && PANEL_NAME.test(o.panel))) throw new ViewInputError("panel_scroll.panel: meno panela (get_viewer_state, panels).");
  const given = [o.to, o.item, o.percent].filter((v) => v !== undefined);
  if (given.length !== 1) throw new ViewInputError("panel_scroll: práve jedno z to (up, down, top, bottom), item (text položky), percent (0 až 100).");
  const panel = o.panel as string | undefined;
  if (o.to !== undefined) {
    if (typeof o.to !== "string" || !(PANEL_SCROLLS as readonly string[]).includes(o.to.trim())) throw new ViewInputError(`panel_scroll.to: ${PANEL_SCROLLS.join(", ")}.`);
    return { direction: o.to.trim() as (typeof PANEL_SCROLLS)[number], ...(panel ? { panel } : {}) };
  }
  if (o.item !== undefined) {
    if (typeof o.item !== "string" || o.item.trim().length === 0 || o.item.trim().length > PANEL_ITEM_MAX) throw new ViewInputError(`panel_scroll.item: text položky, 1 až ${PANEL_ITEM_MAX} znakov.`);
    return { item: o.item.trim(), ...(panel ? { panel } : {}) };
  }
  if (typeof o.percent !== "number" || !Number.isFinite(o.percent) || o.percent < 0 || o.percent > 100) throw new ViewInputError("panel_scroll.percent: číslo 0 až 100 (0 = začiatok, 100 = koniec).");
  return { percent: o.percent, ...(panel ? { panel } : {}) };
}

/**
 * Posun obsahu panela (D-146, D-150): `panel_scroll` = up | down | top | bottom (panel vlastností), alebo
 * {panel, to | item | percent}: na položku podľa textu alebo polohu v %. Bez neho null; chybný vstup = ViewInputError.
 */
export function planPanelScroll(input: Record<string, unknown>): { op: string; label: string; result: { panel_scroll: PanelScrollTarget | string } } | null {
  const raw = input.panel_scroll;
  if (raw === undefined || raw === null || raw === "") return null;
  const target = scrollTargetOf(raw);
  const panel = target.panel ?? "properties";
  const what = target.direction ?? (target.item !== undefined ? `na '${target.item}'` : `na ${target.percent} %`);
  return { op: panelScrollOp(target), label: `Panel ${panel}: ${what}`, result: { panel_scroll: typeof raw === "string" ? raw.trim() : target } };
}

/** Zoom obsahu panela (D-150): `panel_zoom` = {panel?, zoom: in | out | reset | 0,5 až 2,5}. Bez neho null. */
export function planPanelZoom(input: Record<string, unknown>): { op: string; label: string; result: { panel_zoom: { panel?: string; zoom: PanelZoom } } } | null {
  const raw = input.panel_zoom;
  if (raw === undefined || raw === null) return null;
  const hint = `panel_zoom = {panel?, zoom: ${PANEL_ZOOM_STEPS.join(" | ")} | číslo ${PANEL_ZOOM_RANGE.min} až ${PANEL_ZOOM_RANGE.max}}.`;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ViewInputError(hint);
  const o = raw as Record<string, unknown>;
  if (o.panel !== undefined && !(typeof o.panel === "string" && PANEL_NAME.test(o.panel))) throw new ViewInputError("panel_zoom.panel: meno panela (get_viewer_state, panels).");
  const z = o.zoom;
  const ok = (typeof z === "string" && (PANEL_ZOOM_STEPS as readonly string[]).includes(z)) || (typeof z === "number" && Number.isFinite(z) && z >= PANEL_ZOOM_RANGE.min && z <= PANEL_ZOOM_RANGE.max);
  if (!ok) throw new ViewInputError(hint);
  const panel = o.panel as string | undefined;
  const zoom = z as PanelZoom;
  return { op: panelZoomOp(zoom, panel), label: `Panel ${panel ?? "properties"}: zoom ${zoom}`, result: { panel_zoom: { ...(panel ? { panel } : {}), zoom } } };
}
