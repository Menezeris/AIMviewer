import {
  CAMERA_PRESETS,
  SECTION_CLEAR_OP,
  SECTION_OFFSET_RANGE,
  cameraOp,
  sectionOp,
  viewModeOp,
  VIEW_MODES,
  type CameraPreset,
  type Projection,
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

export function planSection(
  input: Record<string, unknown>,
  floor: { label: string; guid: string } | null,
): ViewPlan {
  const action = String(input.action ?? "").trim();
  if (action === "clear") {
    return { ops: [SECTION_CLEAR_OP], label: "3D: zrušiť rez", result: { ok: true, section: "cleared" } };
  }
  if (action !== "set") throw new ViewInputError("action musí byť set alebo clear.");
  const orientation = String(input.orientation ?? "horizontal") as keyof typeof ORIENTATION_AXIS;
  const axis = ORIENTATION_AXIS[orientation];
  if (!axis) throw new ViewInputError("orientation musí byť horizontal, vertical_x alebo vertical_z.");
  const flipped = input.flipped === true;

  if (floor) {
    if (axis !== "y") throw new ViewInputError("Podlažie sa dá použiť len pri vodorovnom reze (orientation=horizontal).");
    const offsetM = num(input.offset_m) ?? 1.2;
    if (offsetM < SECTION_OFFSET_RANGE.min || offsetM > SECTION_OFFSET_RANGE.max) {
      throw new ViewInputError(`offset_m musí byť v rozsahu ${SECTION_OFFSET_RANGE.min} až ${SECTION_OFFSET_RANGE.max} m.`);
    }
    return {
      ops: [sectionOp({ storeyGuid: floor.guid, offsetM, flipped })],
      label: `3D: rez ${offsetM} m nad ${floor.label}`,
      result: { ok: true, section: { floor: floor.label, offset_m: offsetM, flipped } },
    };
  }
  const position = num(input.position_percent);
  if (position === undefined) {
    throw new ViewInputError("Zadaj floor (vodorovný rez nad podlažím) alebo position_percent (0-100).");
  }
  if (position < 0 || position > 100) throw new ViewInputError("position_percent musí byť 0-100.");
  return {
    ops: [sectionOp({ axis, position, flipped })],
    label: `3D: rez ${orientation} ${position} %`,
    result: { ok: true, section: { orientation, position_percent: position, flipped } },
  };
}

export function planCamera(input: Record<string, unknown>, targetGuids: string[]): ViewPlan {
  const preset = String(input.preset ?? "").trim() as CameraPreset;
  if (!(CAMERA_PRESETS as readonly string[]).includes(preset)) {
    throw new ViewInputError(`preset musí byť jeden z ${CAMERA_PRESETS.join(", ")}.`);
  }
  const proj = String(input.projection ?? "").trim();
  if (proj && proj !== "perspective" && proj !== "orthographic") {
    throw new ViewInputError("projection musí byť perspective alebo orthographic.");
  }
  return {
    ops: [cameraOp(preset, targetGuids, (proj || undefined) as Projection | undefined)],
    label: `3D: pohľad ${preset}${targetGuids.length ? ` na ${targetGuids.length} prvkov` : ""}`,
    result: { ok: true, camera: preset, ...(proj ? { projection: proj } : {}), targets: targetGuids.length },
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
    // Zloží existujúce ops: bez rezu, 3D, všetko viditeľné, bez farieb, izometria.
    return {
      ops: [SECTION_CLEAR_OP, viewModeOp("3d"), "show_all::", "reset_colors::", cameraOp("iso")],
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
