import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveTargetsToGuids } from "@/lib/engine/aim-lookup";
import { normalizeStoreyLabel } from "@/lib/engine/storey";
import { CAMERA_PRESETS } from "@/lib/viewer-ops";

import type { AskAction } from "./actions";
import type { ToolDefinition } from "./provider";
import { ViewInputError, planCamera, planSection, planViewMode, type SectionFloor, type ViewPlan } from "./view-plan";

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
      "podlažia v m, default 1,2 = pôdorysný rez; záporná = pod úrovňou). Rez cez prvok = " +
      "target_ids_or_refs alebo global_ids + fit: along (zvislo pozdĺž dlhšej strany prvku, napr. po " +
      "dĺžke ramena schodiska), across (zvislo naprieč), center (stredom prvku na zadanej orientation). " +
      "Presná poloha = orientation + coordinate_m v súradniciach IFC (vertical_x reže na IFC X, " +
      "vertical_z na IFC Y, horizontal na IFC Z - výške); súradnice dá get_bounds. position_percent " +
      "(0-100 % rozmeru modelu) len ako posledná možnosť. action=clear rez zruší. Príklad 'ukáž strop " +
      "nad miestnosťou na 2NP, kade idú potrubia': set_section(floor=3NP, offset_m=-0.4) + " +
      "style_in_3d(hide, ifc_type=IfcCovering) + set_camera(preset=top, target=miestnosť).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear"] },
        orientation: { type: "string", enum: ["horizontal", "vertical_x", "vertical_z"], description: "Default horizontal" },
        floor: floorProp,
        offset_m: { type: "number", description: "Výška rezu nad úrovňou podlažia v metroch (-5 až 20, default 1,2)" },
        position_percent: { type: "number", description: "Poloha rezu 0-100 % rozmeru modelu (bez podlažia, pre zvislé rezy)" },
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
      },
      required: ["action"],
    },
  },
  {
    name: "set_camera",
    description:
      "UI AKCIA: nastaví pohľad kamery v 3D - top/bottom/front/back/left/right, iso (izometria) alebo " +
      "fit_all (celý model). S cieľom (target_ids_or_refs alebo global_ids) zarámuje kameru na prvky, " +
      "napr. miestnosť. projection orthographic = bez perspektívy (vhodné pre top/front).",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: [...CAMERA_PRESETS] },
        target_ids_or_refs: { type: "array", items: { type: "string" }, description: `objects.id alebo object_ref (max ${MAX_TARGETS})` },
        global_ids: { type: "array", items: { type: "string" }, description: "IFC GlobalId z výsledku ifc_* toolov" },
        projection: { type: "string", enum: ["perspective", "orthographic"] },
      },
      required: ["preset"],
    },
  },
  {
    name: "set_view_mode",
    description:
      "UI AKCIA: prepne viewer medzi 3D, 2D (pôdorys podlažia) a Split (2D + 3D vedľa seba). 2D s " +
      "kalibrovaným výkresom ukáže PDF pôdorys, inak model zhora s rezom 1,2 m nad podlahou. Na " +
      "prehliadku budovy podlažie po podlaží volaj mode=2d s floor postupne (krok na pokyn používateľa). " +
      "reset=true s mode=3d vráti pôvodný pohľad (bez rezu, farieb a skrytia, izometria).",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["3d", "2d", "split"] },
        floor: floorProp,
        reset: { type: "boolean", description: "S mode=3d: zruší rez, farby, skrytie a vráti kameru" },
      },
      required: ["mode"],
    },
  },
];

export const VIEW_TOOL_NAMES = new Set(VIEW_TOOL_DEFINITIONS.map((t) => t.name));

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
  if (name === "set_section") {
    const floor = input.action === "set" ? await resolveFloor(input.floor) : null;
    const targets = input.action === "set" && (input.target_ids_or_refs || input.global_ids) ? await resolveTargets(input) : [];
    plan = planSection(input, floor, targets);
  } else if (name === "set_camera") {
    plan = planCamera(input, await resolveTargets(input));
  } else if (name === "set_view_mode") {
    plan = planViewMode(input, input.reset === true ? null : await resolveFloor(input.floor));
  } else {
    throw new Error(`Neznámy tool pohľadu '${name}'.`);
  }
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(plan.ops.join(";"))}&r=${Date.now().toString(36)}`,
    label: plan.label,
  });
  return plan.result;
}
