import { selectionGuids, type ViewerSelection } from "../live/selection-summary";
import { ViewInputError, type ViewPlan } from "../llm/view-plan";
import type { BridgeViewpoint, ViewerCamera } from "../viewer-camera";
import {
  SECTION_AXES,
  SECTION_CLEAR_OP,
  SECTION_COORDINATE_LIMIT,
  VIEW_MODES,
  poseOp,
  sectionOp,
  selectOp,
  viewModeOp,
  type Projection,
  type SectionAxis,
  type ViewMode,
} from "../viewer-ops";

/**
 * Čistá logika uložených pohľadov (D-122): odpoveď `view_state` -> záznam,
 * záznam -> opis pre model a viewer ops obnovy. DB a živý kanál sú v `tools.ts`
 * a `runtime.ts`; tu sa nič nečíta ani nezapisuje.
 */

/** Rovnaký strop ako HIDE/ISOLATE v moste forku: obnova = jedna správa na kanál. */
export const MAX_VIEW_GUIDS = 600;
/** Posun rezu pri obnove ("o meter nižšie"), m. */
export const SECTION_SHIFT_RANGE = { min: -50, max: 50 } as const;
/** Meno riadku `kind = 'last'`; tak ho nájde aj obnova podľa mena. */
export const LAST_VIEW_NAME = "Posledný pohľad";
const LAST_ALIASES = new Set(["posledny pohlad", "posledny", "last", "posledný pohľad", "posledný"]);

export const isLastName = (name: string) => LAST_ALIASES.has(name.trim().toLowerCase());

/** Rez, ako ho vracia `view_state` (os hosta: y = výška = IFC Z). */
export interface SavedSection {
  axis: SectionAxis;
  crosses?: string;
  position_percent?: number;
  coordinate?: number;
  flipped?: boolean;
  show_gizmo?: boolean;
}

/** `viewpoint` uloženého pohľadu: rovnaký tvar ako `model_tasks.viewpoint` (D-099). */
export interface SavedViewpoint {
  frame: string;
  units: string;
  mode: ViewMode | null;
  storey_guid: string | null;
  storey_label?: string | null;
  camera: ViewerCamera | null;
  section: SavedSection | null;
  selection_count: number;
  hidden_count: number;
  isolated_count: number | null;
}

export interface SavedViewRow {
  id: string;
  kind: "saved" | "last";
  name: string;
  description: string | null;
  viewpoint: SavedViewpoint;
  selection: string[];
  hidden: string[];
  isolated: string[] | null;
  model_revisions: Record<string, number>;
  author: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

/** Stav viewera, ktorý sa ukladá (bez mena, autora a časov). */
export type CapturedState = Pick<SavedViewRow, "viewpoint" | "selection" | "hidden" | "isolated">;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const guidList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((g): g is string => typeof g === "string" && g !== ""))].slice(0, MAX_VIEW_GUIDS) : [];
const count = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function sectionOf(raw: unknown): SavedSection | null {
  if (!isObj(raw) || !(SECTION_AXES as readonly unknown[]).includes(raw.axis)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const s: SavedSection = { axis: raw.axis as SectionAxis };
  if (typeof raw.crosses === "string") s.crosses = raw.crosses;
  if (n(raw.position_percent) !== undefined) s.position_percent = n(raw.position_percent);
  if (n(raw.coordinate) !== undefined) s.coordinate = n(raw.coordinate);
  if (typeof raw.flipped === "boolean") s.flipped = raw.flipped;
  if (typeof raw.show_gizmo === "boolean") s.show_gizmo = raw.show_gizmo;
  return s;
}

/**
 * Odpoveď `view_state` (D-085) -> stav na uloženie a poznámky, čo sa uložiť nedalo.
 * Starší viewer nevracia `hidden_guids`/`isolated_guids` (fork D-122): skrytie a
 * izolácia sa potom neuložia, len to povieme.
 */
export function captureFromState(result: unknown): { state: CapturedState; notes: string[] } {
  const r = isObj(result) ? result : {};
  const sel = (isObj(r.selection) ? r.selection : {}) as ViewerSelection;
  const selection = selectionGuids(sel).slice(0, MAX_VIEW_GUIDS);
  const hiddenCount = count(r.hidden_count, 0);
  const isolatedCount = typeof r.isolated_count === "number" ? r.isolated_count : null;
  const notes: string[] = [];
  const hidden = guidList(r.hidden_guids);
  let isolated: string[] | null = Array.isArray(r.isolated_guids) ? guidList(r.isolated_guids) : null;
  if (hiddenCount > 0 && !Array.isArray(r.hidden_guids)) notes.push(`viewer nevrátil GUIDy ${hiddenCount} skrytých prvkov (starší viewer), skrytie sa neuložilo`);
  else if (hiddenCount > hidden.length) notes.push(`skrytých je ${hiddenCount}, uložilo sa prvých ${hidden.length}`);
  if (isolatedCount !== null && r.isolated_guids === undefined) {
    notes.push(`viewer nevrátil GUIDy ${isolatedCount} izolovaných prvkov (starší viewer), izolácia sa neuložila`);
    isolated = null;
  } else if (isolated && isolatedCount !== null && isolatedCount > isolated.length) {
    notes.push(`izolovaných je ${isolatedCount}, uložilo sa prvých ${isolated.length}`);
  }
  const selCount = count(sel.count, selection.length);
  if (selCount > selection.length) notes.push(`vybraných je ${selCount}, uložilo sa prvých ${selection.length}`);
  const mode = (VIEW_MODES as readonly unknown[]).includes(r.mode) ? (r.mode as ViewMode) : null;
  return {
    state: {
      viewpoint: {
        frame: typeof r.frame === "string" ? r.frame : "ifc_world",
        units: typeof r.units === "string" ? r.units : "m",
        mode,
        storey_guid: typeof r.storey_guid === "string" ? r.storey_guid : null,
        camera: isObj(r.camera) ? (r.camera as unknown as ViewerCamera) : null,
        section: sectionOf(r.section),
        selection_count: selCount,
        hidden_count: hiddenCount,
        isolated_count: isolatedCount,
      },
      selection,
      hidden,
      isolated,
    },
    notes,
  };
}

/** Uložený pohľad pre model: čo obsahuje, bez zoznamov GUID. */
export function describeView(row: SavedViewRow) {
  const vp = row.viewpoint;
  const cam = vp.camera;
  return {
    name: row.name,
    ...(row.kind === "last" ? { last: true } : {}),
    description: row.description,
    mode: vp.mode,
    storey: vp.storey_label ?? vp.storey_guid,
    section: vp.section,
    camera: cam ? { projection: cam.projection ?? null, position: cam.position, target: cam.target } : null,
    selection: row.selection.length,
    hidden: row.hidden.length,
    isolated: row.isolated ? row.isolated.length : null,
    model_revisions: row.model_revisions,
    author: row.author,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function cameraPose(cam: ViewerCamera | null): { vp: BridgeViewpoint; projection?: Projection } | null {
  if (!cam || !isObj(cam.position) || !isObj(cam.target)) return null;
  const up = cam.up && Math.hypot(cam.up.x, cam.up.y, cam.up.z) > 1e-6 ? cam.up : { x: 0, y: 0, z: 1 };
  const ortho = cam.projection === "orthographic";
  return {
    vp: { position: cam.position, target: cam.target, up, ...(ortho && cam.ortho_size ? { orthoSize: cam.ortho_size } : {}) },
    projection: ortho ? "orthographic" : cam.projection === "perspective" ? "perspective" : undefined,
  };
}

/**
 * Uložený pohľad -> viewer ops obnovy. Poradie: najprv čistý stav (ako
 * `set_view_mode reset`), režim, rez (s posunom `section_offset_m` po osi rezu),
 * izolácia, skrytie, výber jedného prvku a nakoniec presná póza kamery, aby ju
 * režim ani rez neprepísali. Vráti aj stav, ktorý sa zapíše ako "Posledný pohľad".
 */
export function planRestore(row: SavedViewRow, offsetRaw: unknown): { plan: ViewPlan; restored: CapturedState } {
  let offset = 0;
  if (offsetRaw !== undefined && offsetRaw !== null) {
    if (typeof offsetRaw !== "number" || !Number.isFinite(offsetRaw) || offsetRaw < SECTION_SHIFT_RANGE.min || offsetRaw > SECTION_SHIFT_RANGE.max) {
      throw new ViewInputError(`section_offset_m musí byť číslo ${SECTION_SHIFT_RANGE.min} až ${SECTION_SHIFT_RANGE.max} (m, záporné = nižšie / späť po osi rezu).`);
    }
    offset = offsetRaw;
  }
  const vp = row.viewpoint;
  const s = vp.section;
  if (offset !== 0 && (!s || s.coordinate === undefined)) {
    throw new ViewInputError(`Pohľad '${row.name}' nemá rez so súradnicou, section_offset_m sa nedá použiť; nastav rez cez set_section.`);
  }
  const mode: ViewMode = vp.mode ?? "3d";
  const ops = [
    SECTION_CLEAR_OP,
    viewModeOp(mode, mode !== "3d" ? (vp.storey_guid ?? undefined) : undefined),
    "show_all::",
    "reset_colors::",
    "clear_selection::",
    "clear_focus::",
  ];
  let section: SavedSection | null = s;
  if (s && s.coordinate !== undefined) {
    const coordinate = round3(s.coordinate + offset);
    if (Math.abs(coordinate) > SECTION_COORDINATE_LIMIT) throw new ViewInputError("Rez po posune je mimo rozsahu modelu.");
    section = { ...s, coordinate };
    ops.push(sectionOp({ axis: s.axis, coordinate, flipped: s.flipped, showGizmo: s.show_gizmo }));
  } else if (s && s.position_percent !== undefined) {
    ops.push(sectionOp({ axis: s.axis, position: s.position_percent, flipped: s.flipped, showGizmo: s.show_gizmo }));
  }
  if (row.isolated && row.isolated.length > 0) ops.push(`isolate::${row.isolated.join(".")}`);
  if (row.hidden.length > 0) ops.push(`hide::${row.hidden.join(".")}`);
  // Výber vo vieweri je jeden prvok (D-082); väčší výber ostane len v zázname.
  if (row.selection.length === 1) ops.push(selectOp(row.selection[0]));
  const pose = cameraPose(vp.camera);
  if (pose) ops.push(poseOp(pose.vp, pose.projection));

  const notes: string[] = [];
  if (row.selection.length > 1) notes.push(`výber ${row.selection.length} prvkov sa neobnovuje (viewer vyberá jeden prvok)`);
  if (!pose) notes.push("pohľad nemá kameru, ostáva aktuálna");
  return {
    plan: {
      ops,
      label: `Pohľad: ${row.name}${offset ? ` (rez ${offset > 0 ? "+" : ""}${offset} m)` : ""}`,
      result: {
        ok: true,
        restored: row.name,
        mode,
        section,
        ...(offset ? { section_offset_m: offset } : {}),
        isolated: row.isolated ? row.isolated.length : null,
        hidden: row.hidden.length,
        camera: Boolean(pose),
        ...(notes.length ? { notes } : {}),
        note: "Odoslané do viewera; zapísané ako 'Posledný pohľad'. Upravený pohľad ulož cez saved_view(action=save).",
      },
    },
    restored: { viewpoint: { ...vp, section }, selection: row.selection, hidden: row.hidden, isolated: row.isolated },
  };
}
