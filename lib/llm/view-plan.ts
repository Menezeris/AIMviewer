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
  panelsOp,
  VIEWER_PANELS,
  type PanelsRequest,
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

export function planViewMode(
  input: Record<string, unknown>,
  floor: { label: string; guid: string } | null,
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
  return {
    ops: [viewModeOp(mode, floor?.guid)],
    label: `Viewer: ${mode.toUpperCase()}${floor ? ` ${floor.label}` : ""}`,
    result: { ok: true, mode, ...(floor ? { floor: floor.label } : {}) },
  };
}

/**
 * Panely viewera (D-127): `panels` = {lens: "close", properties: "open", ...}, `all` len "close".
 * Bez `panels` null; chybný vstup = ViewInputError (model ho opraví).
 */
export function planPanels(input: Record<string, unknown>): { op: string; label: string; result: { panels: PanelsRequest } } | null {
  const raw = input.panels;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ViewInputError("panels = {lens|properties|underlays|documents|lists|model_tree|all: open|close|toggle}.");
  const out: PanelsRequest = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const known = (VIEWER_PANELS as readonly string[]).includes(k) || k === "all";
    if (!known) throw new ViewInputError(`panels: neznámy panel '${k}' (lens, properties, underlays, documents, lists, model_tree, all).`);
    if (!(PANEL_ACTIONS as readonly unknown[]).includes(v)) throw new ViewInputError(`panels.${k}: open, close alebo toggle.`);
    if (k === "all" && v !== "close") throw new ViewInputError("panels.all: len close (zatvorí všetky panely, okrem tých, ktoré správa otvára).");
    out[k as keyof PanelsRequest] = v as PanelsRequest[keyof PanelsRequest];
  }
  if (Object.keys(out).length === 0) throw new ViewInputError("panels: aspoň jeden panel.");
  const label = Object.entries(out).map(([k, v]) => `${k} ${v}`).join(", ");
  return { op: panelsOp(out), label: `Panely: ${label}`, result: { panels: out } };
}
