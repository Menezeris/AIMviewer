import { autoRotateOp } from "../viewer-ops";
import {
  AUTO_ROTATE_ACTIONS,
  AUTO_ROTATE_DIRECTIONS,
  AUTO_ROTATE_SPEED,
  type AutoRotateAction,
  type AutoRotateDirection,
} from "../viewer-camera";

import { ViewInputError, type ViewPlan } from "./view-plan";

/**
 * Čistá logika `set_camera auto_rotate` (D-154): plynulé otáčanie kamery okolo cieľa dokola, kým ho používateľ alebo
 * príkaz nezastaví. Jedno volanie = jedna zmena: s presetom, cieľom ani relatívnym krokom sa nekombinuje, lebo každý
 * ďalší pohyb kamery otáčanie zastaví (fork ho vníma ako zásah).
 */

/** Polia, ktoré s `auto_rotate` nejdú (pohyb kamery inak). */
const MOTION_FIELDS = [
  "preset", "fit", "projection", "zoom_percent", "orbit_h_deg", "orbit_v_deg", "pan_x_percent", "pan_y_percent",
  "margin_percent", "area", "target_ids_or_refs", "global_ids", "ifc_type", "ifc_types", "domain", "model",
] as const;

const given = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** `auto_rotate` zo vstupu: null = parameter nie je, inak plán otáčania. */
export function planAutoRotate(input: Record<string, unknown>): ViewPlan | null {
  if (!given(input.auto_rotate)) {
    if (given(input.speed_deg_s) || given(input.direction)) {
      throw new ViewInputError("speed_deg_s a direction patria k auto_rotate=start.");
    }
    return null;
  }
  const action = typeof input.auto_rotate === "string" ? input.auto_rotate.trim() : "";
  if (!(AUTO_ROTATE_ACTIONS as readonly string[]).includes(action)) {
    throw new ViewInputError(`auto_rotate musí byť jedna z hodnôt ${AUTO_ROTATE_ACTIONS.join(", ")}.`);
  }
  const clash = MOTION_FIELDS.filter((k) => given(input[k]));
  if (clash.length > 0) {
    throw new ViewInputError(
      `auto_rotate daj v samostatnom volaní set_camera (bez ${clash.join(", ")}); najprv nastav pohľad, potom spusti otáčanie.`,
    );
  }
  if (action === "stop") {
    if (given(input.speed_deg_s) || given(input.direction)) throw new ViewInputError("speed_deg_s a direction patria k auto_rotate=start.");
    return {
      ops: [autoRotateOp("stop")],
      label: "3D: zastavenie otáčania",
      result: { ok: true, auto_rotate: "stop", note: "Odoslané do viewera; ak sa nič netočilo, nič sa nezmení." },
    };
  }

  const speedRaw = input.speed_deg_s;
  const range = AUTO_ROTATE_SPEED;
  if (given(speedRaw) && (typeof speedRaw !== "number" || !Number.isFinite(speedRaw) || speedRaw < range.min || speedRaw > range.max)) {
    throw new ViewInputError(`speed_deg_s musí byť číslo v rozsahu ${range.min} až ${range.max} (stupne za sekundu, default ${range.default}).`);
  }
  const speed = given(speedRaw) ? (speedRaw as number) : range.default;
  const dirRaw = given(input.direction) ? String(input.direction).trim() : "left";
  if (!(AUTO_ROTATE_DIRECTIONS as readonly string[]).includes(dirRaw)) {
    throw new ViewInputError(`direction musí byť jedna z hodnôt ${AUTO_ROTATE_DIRECTIONS.join(", ")}.`);
  }
  const direction = dirRaw as AutoRotateDirection;
  const start: AutoRotateAction = "start";
  return {
    ops: [autoRotateOp(start, speed, direction)],
    label: `3D: otáčanie dokola ${direction === "left" ? "doľava" : "doprava"}, ${speed} °/s`,
    result: {
      ok: true,
      auto_rotate: start,
      speed_deg_s: speed,
      direction,
      note:
        "Odoslané do viewera. Točí sa okolo cieľa aktuálneho pohľadu, kým používateľ nezasiahne (ťah, koliesko, dotyk, Esc), " +
        "kým nepríde auto_rotate=stop alebo iný príkaz kamery. Staršia verzia viewera správu ignoruje.",
    },
  };
}
