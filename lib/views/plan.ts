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
  type Projection,
  type SectionAxis,
  type ViewMode,
} from "../viewer-ops";
import { sectionBoxOp, type Box3 } from "../viewer-tabs";
import { viewActivateOp, type ViewWire } from "../viewer-views";

import { wireOfRow } from "./wire";

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

/** Druh pohľadu (D-132), od D-161 už len v starých riadkoch; nové parametre `view_type` sa ignorujú. */
export type ViewType = "3d" | "plan" | "section" | "detail";

/** Rez, ako ho vracia `view_state` (os hosta: y = výška = IFC Z). */
export interface SavedSection {
  /** Chýba pri reznom boxe (D-132). */
  axis?: SectionAxis;
  /** Rezný box v IFC svete (D-132) namiesto roviny. */
  box?: Box3;
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
  /** D-132: druh pohľadu, zamknutá kamera a väzba na podklad (dokument + strana, kalibrácia je v `_georef`). */
  view_type?: ViewType;
  locked?: boolean;
  underlay?: { document_id: string; page: number } | null;
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

const vec = (v: unknown) =>
  isObj(v) && [v.x, v.y, v.z].every((c) => typeof c === "number" && Number.isFinite(c)) ? { x: v.x as number, y: v.y as number, z: v.z as number } : null;

function sectionOf(raw: unknown): SavedSection | null {
  if (isObj(raw) && isObj(raw.box)) {
    // Rezný box (D-132): obálka v IFC svete.
    const min = vec(raw.box.min);
    const max = vec(raw.box.max);
    return min && max ? { box: { min, max }, ...(typeof raw.show_gizmo === "boolean" ? { show_gizmo: raw.show_gizmo } : {}) } : null;
  }
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

const vec3 = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });

/** Pohľad z Presentation (D-161) pre model: kamera, rezy a košík bez zoznamov GUID. */
function describeWire(row: SavedViewRow, wire: ViewWire) {
  const cam = wire.camera;
  const basket = wire.basket.scope === "all"
    ? { scope: "all", hidden: wire.basket.hidden_guids.length }
    : { scope: "guids", guids: wire.basket.guids.length, ...(wire.basket.truncated ? { truncated: true } : {}) };
  return {
    name: row.name,
    ...(row.kind === "last" ? { last: true } : {}),
    id: wire.id,
    order: wire.order,
    description: row.description,
    camera: cam ? { projection: cam.projection, position: vec3(cam.position), target: vec3(cam.target) } : null,
    section: wire.section
      ? {
          active: wire.section.active,
          planes: wire.section.planes.map((p) => ({
            axis: p.axis,
            ...(p.coordinate !== undefined ? { coordinate: p.coordinate } : { position_percent: p.position_percent }),
            enabled: p.enabled,
            flipped: p.flipped,
            ...(p.box ? { box: true } : {}),
          })),
        }
      : null,
    objects: wire.objects,
    basket,
    transition_ms: wire.transition_ms,
    source: wire.source,
    model_revisions: row.model_revisions,
    author: row.author,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
  };
}

/** Uložený pohľad pre model: čo obsahuje, bez zoznamov GUID. Bez `mode` (D-161: režim 2D neexistuje). */
export function describeView(row: SavedViewRow) {
  const wire = wireOfRow(row);
  if (wire) return describeWire(row, wire);
  const vp = row.viewpoint;
  const cam = vp.camera;
  return {
    name: row.name,
    ...(row.kind === "last" ? { last: true } : {}),
    description: row.description,
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

/** Posun rezu pohľadu z Presentation po jeho osi (`section_offset_m`); chyba = ViewInputError. */
function wireSectionShift(row: SavedViewRow, wire: ViewWire, offset: number): { op: string; section: ViewWire["section"] } {
  const plane = wire.section?.planes[wire.section.active];
  if (!plane || !wire.section) throw new ViewInputError(`Pohľad '${row.name}' nemá rez, section_offset_m sa nedá použiť; nastav rez cez set_section.`);
  if (plane.box) throw new ViewInputError(`Pohľad '${row.name}' má rezný box, section_offset_m sa naň nedá použiť.`);
  if (plane.coordinate === undefined) throw new ViewInputError(`Rez pohľadu '${row.name}' nemá súradnicu, section_offset_m sa nedá použiť; nastav rez cez set_section.`);
  const coordinate = round3(plane.coordinate + offset);
  if (Math.abs(coordinate) > SECTION_COORDINATE_LIMIT) throw new ViewInputError("Rez po posune je mimo rozsahu modelu.");
  const planes = wire.section.planes.map((p, i) => (i === wire.section!.active ? { ...p, coordinate } : p));
  // Percento patrí pôvodnej súradnici; po posune by klamalo (súradnica pri obnove vyhráva).
  return {
    op: sectionOp({ axis: plane.axis, coordinate, flipped: plane.flipped, showGizmo: plane.show_gizmo }),
    section: { ...wire.section, planes },
  };
}

/**
 * Pohľad z Presentation (D-161) -> aktivácia vo vieweri (kamera, rez a košík robí upstream aktivátor),
 * voliteľne s posunom rezu po aktivácii.
 */
function planRestoreWire(row: SavedViewRow, wire: ViewWire, offset: number): { plan: ViewPlan; restored: CapturedState } {
  const ops = [viewActivateOp({ id: wire.id })];
  let section = wire.section;
  if (offset) {
    const shifted = wireSectionShift(row, wire, offset);
    ops.push(shifted.op);
    section = shifted.section;
  }
  return {
    plan: {
      ops,
      label: `Pohľad: ${row.name}${offset ? ` (rez ${offset > 0 ? "+" : ""}${offset} m)` : ""}`,
      result: {
        ok: true,
        restored: row.name,
        view: { id: wire.id, name: row.name },
        section,
        ...(offset ? { section_offset_m: offset } : {}),
        objects: wire.objects,
        note: "Pohľad otvorený v Presentation (kamera, rez, košík ako izolácia); zapísaný ako 'Posledný pohľad'. Stav po príkaze (view, camera, section) vráti viewer.",
      },
    },
    // "Posledný pohľad" nesie pohľad z Presentation ako ho má riadok: `viewpoint.id` je pôvodný pohľad.
    restored: { viewpoint: { ...wire, section } as unknown as SavedViewpoint, selection: [], hidden: [], isolated: null },
  };
}

/**
 * Uložený pohľad -> viewer ops obnovy. Pohľad z Presentation (D-161) sa aktivuje vo vieweri. Starý riadok (D-122,
 * D-132, záloha): najprv čistý stav (ako `set_view_mode reset`), rez (s posunom `section_offset_m` po osi rezu),
 * izolácia, skrytie, výber jedného prvku a nakoniec presná póza kamery, aby ju rez neprepísal; bez záložky a
 * zámku, na bežnom 3D plátne. Vráti aj stav, ktorý sa zapíše ako "Posledný pohľad".
 */
export function planRestore(row: SavedViewRow, offsetRaw: unknown): { plan: ViewPlan; restored: CapturedState } {
  let offset = 0;
  if (offsetRaw !== undefined && offsetRaw !== null) {
    if (typeof offsetRaw !== "number" || !Number.isFinite(offsetRaw) || offsetRaw < SECTION_SHIFT_RANGE.min || offsetRaw > SECTION_SHIFT_RANGE.max) {
      throw new ViewInputError(`section_offset_m musí byť číslo ${SECTION_SHIFT_RANGE.min} až ${SECTION_SHIFT_RANGE.max} (m, záporné = nižšie / späť po osi rezu).`);
    }
    offset = offsetRaw;
  }
  const wire = wireOfRow(row);
  if (wire) return planRestoreWire(row, wire, offset);
  const vp = row.viewpoint;
  const s = vp.section;
  if (offset !== 0 && (!s || (s.coordinate === undefined && !s.box))) {
    throw new ViewInputError(`Pohľad '${row.name}' nemá rez so súradnicou, section_offset_m sa nedá použiť; nastav rez cez set_section.`);
  }
  // Starý pôdorys (`mode: 2d`) bol pohľad zhora s rezom nad podlažím; teraz je to obyčajná kamera a rez.
  const plan2d = vp.mode === "2d" && vp.storey_guid;
  const ops = [SECTION_CLEAR_OP, "show_all::", "reset_colors::", "clear_selection::", "clear_focus::"];
  let section: SavedSection | null = s;
  if (s?.box) {
    if (offset) throw new ViewInputError(`Pohľad '${row.name}' má rezný box, section_offset_m sa naň nedá použiť.`);
    ops.push(sectionBoxOp(s.box));
  } else if (plan2d && !s) {
    ops.push(sectionOp({ storeyGuid: vp.storey_guid ?? undefined, offsetM: 1.2 }));
  } else if (s?.axis && s.coordinate !== undefined) {
    const coordinate = round3(s.coordinate + offset);
    if (Math.abs(coordinate) > SECTION_COORDINATE_LIMIT) throw new ViewInputError("Rez po posune je mimo rozsahu modelu.");
    section = { ...s, coordinate };
    // Percento patrí pôvodnej súradnici; po posune by v poslednom pohľade klamalo (súradnica pri obnove vyhráva).
    if (offset) delete section.position_percent;
    ops.push(sectionOp({ axis: s.axis, coordinate, flipped: s.flipped, showGizmo: s.show_gizmo }));
  } else if (s?.axis && s.position_percent !== undefined) {
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
        section,
        ...(offset ? { section_offset_m: offset } : {}),
        isolated: row.isolated ? row.isolated.length : null,
        hidden: row.hidden.length,
        camera: Boolean(pose),
        ...(notes.length ? { notes } : {}),
        note: "Starý uložený pohľad (pred D-161) obnovený na 3D plátne; zapísaný ako 'Posledný pohľad'. Upravený pohľad ulož cez saved_view(action=save), uloží sa do Presentation.",
      },
    },
    restored: { viewpoint: { ...vp, section }, selection: row.selection, hidden: row.hidden, isolated: row.isolated },
  };
}
