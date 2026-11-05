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
 * Pure logic of the view tools (D-083 phase 1): tool input + looked-up GUIDs
 * of storeys and targets -> viewer ops and the answer for the model. Looking up in the DB is done by
 * `view-tools.ts`; nothing is read or written here.
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

/** Storey for the section: label, GUID and IfcBuildingStorey.Elevation from the AIM DB (model units). */
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
    // Only the widget of the active section, the section stays (#63).
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
    // Section through elements (D-085): the viewer takes their envelope and puts the plane in the middle.
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
          // D-092: the viewer computes the height itself; the elevation from the AIM DB serves to check the position of its plane.
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
 * PDF underlays in 3D (D-133 addendum): `underlays_3d` = true shows, false hides in the 3D canvas. It is a state
 * of the viewer, not the `visible` of the calibration (that is stored in the DB and hides 2D too). Without the parameter null.
 */
export function planUnderlays3d(input: Record<string, unknown>): { op: string; label: string; result: { underlays_3d: boolean } } | null {
  const raw = input.underlays_3d;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "boolean") throw new ViewInputError("underlays_3d: true (zobraziť podklady PDF v 3D) alebo false (skryť).");
  return { op: underlays3dOp(raw), label: `Podklady v 3D: ${raw ? "zapnuté" : "vypnuté"}`, result: { underlays_3d: raw } };
}

/**
 * Position and direction of the camera on a calibrated PDF (D-161 point 8, #282): `plan_position` = true shows a dot and a sector
 * of the view direction on the PDF in a tab or tile, false hides. Viewer state; read via `get_viewer_state.plan_position`.
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
  /** Storey drawing chosen by the host for mode=split (D-176); without it the viewer chooses. */
  drawing?: { documentId: string; name: string; discipline: string | null; chosen_by: "discipline" | "preference"; alternatives: { name: string; discipline: string | null }[] } | null,
): ViewPlan {
  const mode = String(input.mode ?? "").trim() as ViewMode;
  if (!(VIEW_MODES as readonly string[]).includes(mode)) throw new ViewInputError("mode musí byť 3d, 2d alebo split.");
  if (input.reset === true) {
    if (mode !== "3d") throw new ViewInputError("reset platí len s mode=3d.");
    // Composes the existing ops: no section, 3D, everything visible, no colors, no selection (D-102), isometric.
    return {
      ops: [SECTION_CLEAR_OP, viewModeOp("3d"), "show_all::", "reset_colors::", "clear_selection::", "clear_focus::", cameraOp("iso")],
      label: "3D: pôvodný pohľad",
      result: { ok: true, reset: true },
    };
  }
  // D-161: 2D is not a mode. `2d` = camera from above and a section on the ordinary 3D, `split` = the same and tiles 3D | PDF drawing.
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

/** `panel_layout` (D-172, #320): {panel, width_pct?, side?}, at least one of the last two. */
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
 * Viewer panels (D-127, D-150): `panels` = {lens: "close", bcf: "open", ...}, `all` only "close". The name is the panel id
 * from the fork registry; the shape of the name is checked by the host, existence by the viewer (unknown ones it reports in `APPLIED`, the list is in
 * `view_state.panels`). D-172 (#320): `panel_layout` = {panel, width_pct?, side?} sets the width and side of a panel in the same
 * message (`panels` is then optional, at least one of the two). Without both null; bad input = ViewInputError (the model fixes it).
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

/** Panel_scroll as a string (D-146, properties panel) or an object {panel, to | item | percent} (D-150). */
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
 * Scrolling the panel content (D-146, D-150): `panel_scroll` = up | down | top | bottom (properties panel), or
 * {panel, to | item | percent}: to an item by text or a position in %. Without it null; bad input = ViewInputError.
 */
export function planPanelScroll(input: Record<string, unknown>): { op: string; label: string; result: { panel_scroll: PanelScrollTarget | string } } | null {
  const raw = input.panel_scroll;
  if (raw === undefined || raw === null || raw === "") return null;
  const target = scrollTargetOf(raw);
  const panel = target.panel ?? "properties";
  const what = target.direction ?? (target.item !== undefined ? `na '${target.item}'` : `na ${target.percent} %`);
  return { op: panelScrollOp(target), label: `Panel ${panel}: ${what}`, result: { panel_scroll: typeof raw === "string" ? raw.trim() : target } };
}

/** Zoom of the panel content (D-150): `panel_zoom` = {panel?, zoom: in | out | reset | 0.5 to 2.5}. Without it null. */
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
