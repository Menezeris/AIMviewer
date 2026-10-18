import {
  CAMERA_PRESETS,
  cameraOp,
  cameraSelOp,
  type CameraPreset,
  type OpsSelector,
  type Projection,
} from "../viewer-ops";
import { CAMERA_FITS, CAMERA_RANGES, type CameraFit, type CameraMove } from "../viewer-camera";

import { DOMAIN_IFC_TYPES, sanitizeIfcType, sanitizeModelName } from "./ifc-selector";
import { ViewInputError, type ViewPlan } from "./view-plan";

/**
 * Čistá logika `set_camera` (D-083, rozšírenie D-094): preset, fit, cieľ (GUIDy
 * alebo selektor ako `style_in_3d`) a relatívne kroky -> op `camera`/`camera_sel`
 * a odpoveď pre model. Dohľadanie cieľov v DB robí `view-tools.ts`.
 */

const FIT_LABEL: Record<CameraFit, string> = {
  visible: "na viditeľné",
  selection: "na výber",
  targets: "na cieľ",
  model: "na celý model",
  none: "bez zmeny výrezu",
};

function rangeNum(raw: unknown, name: string, range: { min: number; max: number }): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < range.min || raw > range.max) {
    throw new ViewInputError(`${name} musí byť číslo v rozsahu ${range.min} až ${range.max}.`);
  }
  return raw === 0 ? undefined : raw;
}

/** Filter cieľa (ifc_type / ifc_types / domain / model) -> selektor, ktorý rozloží viewer. */
function cameraSelector(input: Record<string, unknown>): OpsSelector | null {
  const domain = String(input.domain ?? "").trim().toLowerCase();
  if (domain && !(domain in DOMAIN_IFC_TYPES)) {
    throw new ViewInputError(`domain musí byť jedna z: ${Object.keys(DOMAIN_IFC_TYPES).join(", ")}.`);
  }
  const multi = Array.isArray(input.ifc_types) ? (input.ifc_types as unknown[]).map(sanitizeIfcType).filter(Boolean) : [];
  const single = sanitizeIfcType(input.ifc_type);
  const types = domain ? DOMAIN_IFC_TYPES[domain] : multi.length > 0 ? multi : single ? [single] : [];
  const model = sanitizeModelName(input.model);
  if (types.length === 0 && !model) return null;
  return { ...(types.length > 0 ? { types } : {}), ...(model ? { model } : {}) };
}

function hasItems(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0;
}

export function planCamera(input: Record<string, unknown>, targetGuids: string[]): ViewPlan {
  const presetRaw = String(input.preset ?? "").trim();
  const preset = (presetRaw || "keep") as CameraPreset;
  if (!(CAMERA_PRESETS as readonly string[]).includes(preset)) {
    throw new ViewInputError(`preset musí byť jeden z ${CAMERA_PRESETS.join(", ")}.`);
  }
  const proj = String(input.projection ?? "").trim();
  if (proj && proj !== "perspective" && proj !== "orthographic") {
    throw new ViewInputError("projection musí byť perspective alebo orthographic.");
  }
  const projection = (proj || undefined) as Projection | undefined;

  const selector = cameraSelector(input);
  const targetGiven = hasItems(input.target_ids_or_refs) || hasItems(input.global_ids);
  if (selector && targetGiven) {
    throw new ViewInputError("Cieľ zadaj buď prvkami (target_ids_or_refs/global_ids), alebo filtrom (ifc_type(s)/domain/model), nie oboma.");
  }
  const hasTarget = selector !== null || targetGuids.length > 0;

  const fitRaw = input.fit === undefined || input.fit === null ? "" : String(input.fit).trim();
  if (fitRaw && !(CAMERA_FITS as readonly string[]).includes(fitRaw)) {
    throw new ViewInputError(`fit musí byť jeden z ${CAMERA_FITS.join(", ")}.`);
  }
  const fit = (fitRaw || undefined) as CameraFit | undefined;
  if (fit === "targets" && !hasTarget) {
    throw new ViewInputError("fit=targets potrebuje cieľ: target_ids_or_refs, global_ids alebo filter ifc_type(s)/domain/model.");
  }
  if (fit && fit !== "targets" && hasTarget) {
    throw new ViewInputError(`S cieľom sa rámuje naň (fit=targets); fit=${fit} použi bez cieľa.`);
  }
  if (fit && preset === "fit_all") {
    throw new ViewInputError("fit_all už rámuje celý model; na iný výrez daj preset (alebo keep) a fit.");
  }

  const move: CameraMove = fit ? { fit } : {};
  const z = rangeNum(input.zoom_percent, "zoom_percent", CAMERA_RANGES.zoomPercent);
  const oh = rangeNum(input.orbit_h_deg, "orbit_h_deg", CAMERA_RANGES.orbitH);
  const ov = rangeNum(input.orbit_v_deg, "orbit_v_deg", CAMERA_RANGES.orbitV);
  const px = rangeNum(input.pan_x_percent, "pan_x_percent", CAMERA_RANGES.pan);
  const py = rangeNum(input.pan_y_percent, "pan_y_percent", CAMERA_RANGES.pan);
  if (z !== undefined) move.zoomPercent = z;
  if (oh !== undefined) move.orbitH = oh;
  if (ov !== undefined) move.orbitV = ov;
  if (px !== undefined) move.panX = px;
  if (py !== undefined) move.panY = py;
  const relative = [z, oh, ov, px, py].some((v) => v !== undefined);
  if (preset === "keep" && !fit && !hasTarget && !relative && !projection) {
    throw new ViewInputError(
      "Nič na zmenu: zadaj preset, fit, cieľ, zoom_percent, orbit_h_deg/orbit_v_deg, pan_x_percent/pan_y_percent alebo projection.",
    );
  }

  const op = selector ? cameraSelOp(preset, selector, projection, move) : cameraOp(preset, targetGuids, projection, move);

  const parts: string[] = [
    preset === "keep" ? "3D: kamera" : preset === "section" ? "3D: pohľad kolmo na rez" : `3D: pohľad ${preset}`,
  ];
  if (selector) parts.push(`na ${selector.types ? selector.types.slice(0, 3).join("+") : ""}${selector.model ? ` v ${selector.model}` : ""}`.trim());
  else if (targetGuids.length > 0) parts.push(`na vybrané prvky (${targetGuids.length})`);
  if (fit && fit !== "targets") parts.push(FIT_LABEL[fit]);
  if (move.orbitH !== undefined || move.orbitV !== undefined) parts.push(`otočenie ${move.orbitH ?? 0}°/${move.orbitV ?? 0}°`);
  if (move.zoomPercent !== undefined) parts.push(move.zoomPercent > 0 ? `priblíženie ${move.zoomPercent} %` : `oddialenie ${-move.zoomPercent} %`);
  if (move.panX !== undefined || move.panY !== undefined) parts.push("posun");

  return {
    ops: [op],
    label: parts.join(", "),
    result: {
      ok: true,
      camera: preset,
      ...(projection ? { projection } : {}),
      ...(fit ? { fit } : {}),
      targets: targetGuids.length,
      ...(selector ? { selector: { ...(selector.types ? { ifc_types: selector.types } : {}), ...(selector.model ? { model: selector.model } : {}) } } : {}),
      ...(move.zoomPercent !== undefined ? { zoom_percent: move.zoomPercent } : {}),
      ...(move.orbitH !== undefined ? { orbit_h_deg: move.orbitH } : {}),
      ...(move.orbitV !== undefined ? { orbit_v_deg: move.orbitV } : {}),
      ...(move.panX !== undefined ? { pan_x_percent: move.panX } : {}),
      ...(move.panY !== undefined ? { pan_y_percent: move.panY } : {}),
      note: "Odoslané do viewera; novú polohu a cieľ kamery over cez get_viewer_state.",
    },
  };
}
