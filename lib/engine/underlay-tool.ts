import { mergeCalibration, toGeorefV2, type GeorefCalibration, type GeorefPlane, type MergeResult } from "../data/georef";

import type { MeshElement } from "./measure";
import {
  AXES_TOLERANCE_MM,
  CalibrationError,
  applyAffine,
  checkAxes,
  checkRotation,
  checkScale,
  cropToRegion,
  PT_M,
  ROTATION_TOLERANCE_DEG,
  pageScaleFromText,
  calibratePairs,
  calibratePlan,
  calibrateSection,
  fitSimilarity,
  footprintCentroid,
  type Affine,
  type AxesCheck,
  type AxisLine,
  type CalibrationResult,
  type P2,
  type PageBlock,
  type PageLine,
  type PageRegion,
  type Plane,
  type RefAxis,
} from "./underlay-calibrate";
import { bubbleAxes } from "./underlay-axis-bubbles";
import { ifcPositions, modelCut, planPlane, sectionPlane } from "./underlay-model";
import { pageAxisLines, refAxesFromSheets, sectionFromPlans, sectionMarkFromName, type PlanSheet, type SectionFromPlans } from "./underlay-section-mark";
import { CALIBRATE_UNDERLAY_MODES, DEFAULT_MAX_ERROR_MM, PLAN_CUT_M, type Mode } from "./underlay-tool-def";

/**
 * `calibrate_underlay` (D-133): automatic calibration of a drawing underlay (PDF page) under the
 * IFC model - floor plan to the storey, vertical section to the section plane. The result goes into `_georef` v2
 * of the document (list of calibrations, `lib/data/georef.ts`). The logic is here, the dependencies (DB, IFC
 * engine) in `underlay-runtime.ts`, so that it can be tested without them.
 */

export { CALIBRATE_UNDERLAY_TOOL } from "./underlay-tool-def";

export interface UnderlayDocument {
  id: string;
  object_ref: string | null;
  name: string | null;
  /** Raw `properties._georef` (v1, v2 or nothing). */
  georef: unknown;
  /** Storeys the document is linked to (IFC GUID and name). */
  floors: { guid: string; name: string }[];
}

export interface UnderlayPage {
  blocks: PageBlock[];
  lines: { size: P2; segs: PageLine[] } | null;
  /** Page size in points (`document_pages.page_size`, D-158); null = ETL before D-158. */
  pageSize?: P2 | null;
}

export interface UnderlayModel {
  id: string;
  elements: MeshElement[];
  /** Floor plan: storey, its height (m, from the parser, like the viewer) and IfcSpace (GUID). */
  storey?: { guid: string; name: string; z?: number | null; spaceGuids: string[] };
  /** Section: heights of all storeys (IfcBuildingStorey.Elevation from the parser, IFC Z in m) for pairing the marks (D-179). */
  storeys?: { name: string; z: number }[];
}

export interface UnderlayDeps {
  document: (ref: string) => Promise<UnderlayDocument | null>;
  page: (documentId: string, page: number) => Promise<UnderlayPage | null>;
  model: (opts: { model?: string; floor?: string }) => Promise<UnderlayModel>;
  /** Write: `apply` merges the calibration into the current `_georef` (read right before the write). */
  write: (documentId: string, apply: (stored: unknown) => MergeResult) => Promise<MergeResult>;
  /** `object_ref` (space, wall, element) -> IFC GUID for `pairs[].object_ref` (D-176); without it an object_ref is rejected. */
  refGuids?: (refs: string[]) => Promise<Map<string, string>>;
  /** Calibrated floor plans (page with affine, plane null) with text and lines, for the section plane from a mark (D-179). */
  planSheets?: () => Promise<PlanSheet[]>;
  writeEnabled: boolean;
  now: () => Date;
}

export class UnderlayInputError extends Error {}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface Parsed {
  documentId: string;
  page: number;
  mode: Mode;
  floor?: string;
  section?: { axis: "x" | "y"; coordinate: number };
  /** Section from a mark on a calibrated floor plan (D-179): the letter (null = from the document name). */
  fromPlan?: { mark: string | null };
  /** Pair: the model point is `model_m`, or the `object_ref` of an element (element centroid in the plane, D-176). */
  pairs: { page_pct: P2; model_m?: P2; object_ref?: string }[];
  refine: boolean;
  maxErrorMm: number;
  force: boolean;
  model?: string;
  /** Drawing scale 1:N given by the user (fixed in the start and in ICP). */
  scale: number | null;
  /** Page region in % (x, y, w, h; top left) for a sheet with several drawings (D-180). */
  region: PageRegion | null;
}

/** `region` as [x, y, w, h] or {x, y, width, height} in % of the page (top left, like open_drawing). */
function parseRegion(v: unknown): PageRegion | null {
  if (v === undefined || v === null) return null;
  const o = v as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  const r = Array.isArray(v) ? v : [o.x, o.y, o.width, o.height];
  const bad = () => new UnderlayInputError("region je výrez strany v % (vľavo hore): [x, y, w, h] alebo {x, y, width, height}, 0 až 100, w a h aspoň 5.");
  if (r.length !== 4 || !r.every(num)) throw bad();
  const [x, y, w, h] = r as number[];
  if (x < 0 || y < 0 || w < 5 || h < 5 || x + w > 100.01 || y + h > 100.01) throw bad();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [r2(x), r2(y), r2(w), r2(h)];
}

function parse(a: Record<string, unknown>): Parsed {
  const documentId = typeof a.document_id === "string" ? a.document_id.trim() : "";
  if (!documentId) throw new UnderlayInputError("Chýba document_id (UUID alebo object_ref výkresu).");
  const page = a.page === undefined ? 1 : Number(a.page);
  if (!Number.isInteger(page) || page < 1) throw new UnderlayInputError("page je číslo strany od 1.");
  const mode = (a.mode ?? "dry_run") as Mode;
  if (!CALIBRATE_UNDERLAY_MODES.includes(mode)) throw new UnderlayInputError(`mode je ${CALIBRATE_UNDERLAY_MODES.join(" | ")}.`);
  let section: Parsed["section"];
  let fromPlan: Parsed["fromPlan"];
  if (a.section_plane !== undefined) {
    const s = a.section_plane as { axis?: unknown; coordinate_m?: unknown; from_plan?: unknown; mark?: unknown };
    const mark = typeof s?.mark === "string" && s.mark.trim() ? s.mark.trim().toUpperCase() : null;
    if (s?.axis === undefined && s?.coordinate_m === undefined && (s?.from_plan === true || mark)) {
      fromPlan = { mark };
    } else if ((s?.axis !== "x" && s?.axis !== "y") || !num(s.coordinate_m)) {
      throw new UnderlayInputError("section_plane je {axis: 'x' | 'y', coordinate_m: číslo v m} alebo {from_plan: true, mark?: 'A'} (rovina zo značky rezu na kalibrovanom pôdoryse).");
    } else {
      section = { axis: s.axis, coordinate: s.coordinate_m };
    }
  }
  const floor = typeof a.floor === "string" && a.floor.trim() ? a.floor.trim() : undefined;
  if ((section || fromPlan) && floor) throw new UnderlayInputError("Zadaj buď floor (pôdorys), alebo section_plane (rez).");
  const pairs: Parsed["pairs"] = [];
  if (a.pairs !== undefined) {
    if (!Array.isArray(a.pairs) || a.pairs.length > 20) throw new UnderlayInputError("pairs je pole najviac 20 dvojíc.");
    for (const p of a.pairs as { page_pct?: unknown; model_m?: unknown; object_ref?: unknown }[]) {
      const ok = (t: unknown): t is P2 => Array.isArray(t) && t.length === 2 && t.every(num);
      const objectRef = typeof p?.object_ref === "string" && p.object_ref.trim() ? p.object_ref.trim() : undefined;
      if (!ok(p?.page_pct) || (p.model_m === undefined) === (objectRef === undefined) || (p.model_m !== undefined && !ok(p.model_m))) {
        throw new UnderlayInputError("Dvojica je {page_pct: [x, y], model_m: [u, v]} alebo {page_pct: [x, y], object_ref: kód miestnosti, steny či prvku} (práve jedno z model_m a object_ref).");
      }
      pairs.push(objectRef ? { page_pct: p.page_pct, object_ref: objectRef } : { page_pct: p.page_pct, model_m: p.model_m as P2 });
    }
  }
  if (mode === "manual" && pairs.length < 2) throw new UnderlayInputError("mode=manual potrebuje aspoň 2 dvojice v pairs.");
  const maxErrorMm = num(a.max_error_mm) && a.max_error_mm > 0 ? a.max_error_mm : DEFAULT_MAX_ERROR_MM;
  const model = typeof a.model === "string" && a.model.trim() ? a.model.trim() : undefined;
  if (a.scale !== undefined && !(num(a.scale) && a.scale >= 2 && a.scale <= 5000)) {
    throw new UnderlayInputError("scale je číslo N z mierky výkresu 1:N (napr. 50).");
  }
  const scale = a.scale === undefined ? null : (a.scale as number);
  const region = parseRegion(a.region);
  return { documentId, page, mode, floor, section, fromPlan, pairs, refine: a.refine !== false, maxErrorMm, force: a.force === true, model, scale, region };
}

/**
 * Storey height: from the parser (`storeyElevations`, the same one the viewer takes), otherwise the median of space
 * bottoms. The minimum is not enough: a shaft reaches below the floor (1NP ASR -1.2 m) and the bottom of a space
 * is the load-bearing slab, not the floor (2NP ASR 4.85 m at a height of 5.0 m). A storey without IfcSpace (5NP)
 * goes with the height from the parser, space labels are then not available (start by scanning, D-180).
 */
function storeyFloor(model: UnderlayModel): { z: number; spaces: { name: string; centroid: P2 }[] } {
  const ids = new Set(model.storey?.spaceGuids ?? []);
  const bottoms: number[] = [];
  const spaces: { name: string; centroid: P2 }[] = [];
  for (const e of model.elements) {
    if (!ids.has(e.globalId)) continue;
    const pos = ifcPositions(e);
    let z = Infinity;
    for (let i = 2; i < pos.length; i += 3) z = Math.min(z, pos[i]);
    if (Number.isFinite(z)) bottoms.push(z);
    const c = footprintCentroid(pos, e.indices);
    if (c && e.name) spaces.push({ name: e.name, centroid: c });
  }
  const z = model.storey?.z;
  if (typeof z === "number" && Number.isFinite(z)) return { z, spaces };
  if (bottoms.length === 0) throw new UnderlayInputError(`Podlažie ${model.storey?.name ?? ""} nemá v modeli ${model.id} výšku z parsera ani priestory (IfcSpace) s geometriou, výška sa nedá určiť.`);
  bottoms.sort((a, b) => a - b);
  return { z: bottoms[Math.floor(bottoms.length / 2)], spaces };
}

/** Sum of pair deviations from a similarity (direct or mirrored). */
function residual(pairs: { pdf_pt: P2; plane_m: P2 }[], mirror: boolean): number {
  const m = fitSimilarity(
    pairs.map((x) => x.pdf_pt),
    pairs.map((x) => x.plane_m),
    mirror,
  );
  if (!m) return Infinity;
  return pairs.reduce((acc, x) => {
    const q = applyAffine(m, x.pdf_pt);
    return acc + Math.hypot(q[0] - x.plane_m[0], q[1] - x.plane_m[1]);
  }, 0);
}

/**
 * Model points for pairs with `object_ref` (D-176): centroid of the element in IFC (floor plan: area centroid of the plan, e.g. IfcSpace;
 * otherwise the mean of vertices), while the plane is known only after the storey is chosen. An element without geometry or outside the model is an error
 * with a hint (model_m or another element), not a silently dropped pair.
 */
async function pairRefPoints(pairs: Parsed["pairs"], model: UnderlayModel, deps: UnderlayDeps): Promise<Map<string, MeshElement>> {
  const refs = [...new Set(pairs.flatMap((x) => (x.object_ref ? [x.object_ref] : [])))];
  const out = new Map<string, MeshElement>();
  if (refs.length === 0) return out;
  if (!deps.refGuids) throw new UnderlayInputError("object_ref v pairs tu nie je dostupný, zadaj model_m.");
  const guids = await deps.refGuids(refs);
  const byGuid = new Map(model.elements.map((e) => [e.globalId, e]));
  for (const ref of refs) {
    const guid = guids.get(ref);
    if (!guid) throw new UnderlayInputError(`object_ref ${ref} nie je v AIM (kód miestnosti, steny či prvku); zadaj model_m alebo správny kód.`);
    const el = byGuid.get(guid);
    if (!el) throw new UnderlayInputError(`object_ref ${ref} (${guid}) nie je v modeli ${model.id} alebo nemá geometriu (napr. IfcSpace bez geometrie); zadaj model_m alebo prvok s geometriou.`);
    if (ifcPositions(el).length === 0) throw new UnderlayInputError(`object_ref ${ref} nemá geometriu; zadaj model_m.`);
    out.set(ref, el);
  }
  return out;
}

/** Centroid of an element in IFC: in plan the area centroid of the plan (like space labels), otherwise the mean of vertices. */
function elementCentroid(el: MeshElement, plan: boolean): [number, number, number] {
  const pos = ifcPositions(el);
  const n = pos.length / 3;
  let z = 0;
  for (let i = 2; i < pos.length; i += 3) z += pos[i];
  if (plan) {
    const c = footprintCentroid(pos, el.indices);
    if (c) return [c[0], c[1], z / n];
  }
  let x = 0;
  let y = 0;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    x += pos[i];
    y += pos[i + 1];
  }
  return [x / n, y / n, z / n];
}

/** Pairs with a page point in PDF points and a model point in the plane (u, v); object_ref is projected by its centroid into the plane. */
function pairsInPlane(
  pairs: Parsed["pairs"],
  refPoints: Map<string, MeshElement>,
  plane: Plane,
  pageSize: P2,
): { pdf_pt: P2; plane_m: P2 }[] {
  return pairs.map((x) => {
    let planeM = x.model_m;
    if (!planeM) {
      const c = elementCentroid(refPoints.get(x.object_ref!)!, plane.v[2] === 0);
      const d: [number, number, number] = [c[0] - plane.origin[0], c[1] - plane.origin[1], c[2] - plane.origin[2]];
      planeM = [d[0] * plane.u[0] + d[1] * plane.u[1] + d[2] * plane.u[2], d[0] * plane.v[0] + d[1] * plane.v[1] + d[2] * plane.v[2]] as P2;
    }
    return { pdf_pt: [(x.page_pct[0] / 100) * pageSize[0], (1 - x.page_pct[1] / 100) * pageSize[1]] as P2, plane_m: planeM };
  });
}

/** View from the other side: the mirror of the u axis is carried into the plane (u -> -u), the affine stays direct. */
function unmirror(res: CalibrationResult, plane: Plane): { affine: Affine; plane: Plane; calibration: CalibrationResult["calibration"] } {
  if (!res.mirrored) return { affine: res.affine, plane, calibration: res.calibration };
  const a = res.affine;
  return {
    affine: [-a[0], -a[1], -a[2], a[3], a[4], a[5]],
    // `|| 0`: no -0 in the stored JSON.
    plane: { ...plane, u: [-plane.u[0] || 0, -plane.u[1] || 0, -plane.u[2] || 0] },
    calibration: res.calibration.map((c) => ({ pdf_pt: c.pdf_pt, plane_m: [-c.plane_m[0], c.plane_m[1]] as P2 })),
  };
}

/** Series of drawings `OCB_SO01_ASR` from object_ref (construction, object, discipline): floor plans of the same series take precedence. */
function seriesOf(ref: string | null): string | null {
  const parts = ref?.split("_") ?? [];
  return parts.length >= 3 ? parts.slice(0, 3).join("_") : null;
}

/**
 * Section plane from a mark on calibrated floor plans (D-179): the letter from the argument or from the document name
 * (REZ-A), floor plans of the same series (ASR) preferably, otherwise all calibrated.
 */
async function planSection(markArg: string | null, doc: UnderlayDocument, deps: UnderlayDeps): Promise<SectionFromPlans> {
  const mark = markArg ?? sectionMarkFromName(doc.object_ref, doc.name);
  if (!mark) throw new UnderlayInputError("Písmeno rezu sa z mena dokumentu nedá zistiť; zadaj section_plane {from_plan: true, mark: 'A'} alebo {axis, coordinate_m}.");
  if (!deps.planSheets) throw new UnderlayInputError("Rovina zo značky rezu tu nie je dostupná; zadaj section_plane {axis, coordinate_m}.");
  const all = (await deps.planSheets()).filter((x) => x.ref !== (doc.object_ref ?? doc.id));
  const series = seriesOf(doc.object_ref);
  const same = series ? all.filter((x) => seriesOf(x.ref) === series) : [];
  const res = (same.length ? sectionFromPlans(mark, same) : null) ?? sectionFromPlans(mark, all);
  if (!res) {
    throw new UnderlayInputError(
      `Značku rezu ${mark} (rovnaké písmeno na oboch koncoch reznej čiary, mimo radu osí) nemá žiadny kalibrovaný pôdorys (kalibrovaných pôdorysov: ${all.length}). Kalibruj pôdorys alebo zadaj section_plane {axis, coordinate_m}.`,
    );
  }
  return res;
}

/** Floor plan grids for computation and result: where the page grids come from (pairs of labels, rows of bubbles) and the network rotation. */
interface PlanAxes {
  page: AxisLine[];
  ref: RefAxis[];
  sheets: number;
  source: "pairs" | "bubbles";
  /** Rows of bubbles (D-184 addendum): network rotation on the page and rows of labels. */
  grid?: { deg: number; rows: string[] };
  /** Network rotation for the computation, only when the network is off the page direction by more than ROTATION_TOLERANCE_DEG. */
  gridDeg?: number;
}

/**
 * Floor plan grids: rows of grids of this page (region) and their position in IFC from the other calibrated floor plans
 * (also other storeys and disciplines, the grid is shared). Without pairs of labels in the page direction, at known scale rows of bubbles
 * (D-184 addendum: rotated floor plan SF.01, details TP.01 with a grid at one end only). Without grids or references null.
 */
async function planAxes(doc: UnderlayDocument, page: number, region: PageRegion | null, pageSize: P2, blocks: PageBlock[], lines: PageLine[], scale: number | null, deps: UnderlayDeps): Promise<PlanAxes | null> {
  if (!deps.planSheets) return null;
  const pageLines = pageAxisLines(pageSize, blocks, lines);
  if (pageLines.length === 0 && !scale) return null;
  const ref = doc.object_ref ?? doc.id;
  const same = (sh: PlanSheet) => sh.ref === ref && sh.page === page && JSON.stringify(sh.region ?? null) === JSON.stringify(region);
  const others = (await deps.planSheets()).filter((sh) => !same(sh));
  const refs = refAxesFromSheets(others);
  if (!refs.length) return null;
  if (pageLines.length) return { page: pageLines, ref: refs, sheets: others.length, source: "pairs" };
  const bub = bubbleAxes(pageSize, blocks, refs, scale! * PT_M);
  if (!bub) return null;
  const skew = Math.abs((((bub.gridDeg % 90) + 135) % 90) - 45);
  return {
    page: bub.lines,
    ref: refs,
    sheets: others.length,
    source: "bubbles",
    grid: { deg: bub.gridDeg, rows: bub.rows },
    ...(skew > ROTATION_TOLERANCE_DEG ? { gridDeg: bub.gridDeg } : {}),
  };
}

/** Vertical grid plane: axis x = plane X = c (the section runs along Y), axis y = plane Y = c. */
const axisPlane = (axis: "x" | "y", c: number): Plane => (axis === "x" ? sectionPlane([c, 0], [0, 1]) : sectionPlane([0, c], [1, 0]));

export async function execCalibrateUnderlay(args: Record<string, unknown>, deps: UnderlayDeps): Promise<{ text: string; isError: boolean }> {
  try {
    return { text: JSON.stringify(await calibrate(parse(args), deps)), isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const known = err instanceof UnderlayInputError || err instanceof CalibrationError;
    return { text: known ? msg : `Chyba kalibrácie: ${msg}`, isError: true };
  }
}

async function calibrate(p: Parsed, deps: UnderlayDeps) {
  const doc = await deps.document(p.documentId);
  if (!doc) throw new UnderlayInputError(`Dokument ${p.documentId} neexistuje (UUID alebo object_ref).`);
  const pg = await deps.page(doc.id, p.page);
  if (!pg) throw new UnderlayInputError(`Dokument ${doc.object_ref ?? doc.id} nemá stranu ${p.page} s textom (document_pages; ETL etl.pdf_text --from-db).`);
  // The page size (points) is needed to convert manual points in %: from lines, otherwise from `page_size` (D-158).
  const pageSize = pg.lines?.size ?? pg.pageSize ?? null;
  const ref = doc.object_ref ?? doc.id;
  // Without lines only mode=manual without refinement is possible (refine=false): pairs of points give the similarity alone.
  const noLinesManual = !pg.lines && p.mode === "manual" && pageSize !== null;
  if (!pg.lines && !noLinesManual) {
    // `page_size` is filled by the same ETL run as the lines: if present, the ETL passed the page and there are few lines (raster, scan).
    throw new UnderlayInputError(
      pg.pageSize
        ? `Strana ${p.page} nemá čiary výkresu (document_pages.lines): ETL ju spracovalo, ale má menej než 200 úsečiek ani pri tenkých čiarach (0,25 pt), teda je to pravdepodobne raster (sken) alebo výkres bez vektorových čiar. Auto kalibrácia nejde; použi mode=manual s dvojicami pairs (refine sa vypne).`
        : `Strana ${p.page} nemá čiary výkresu (document_pages.lines): ETL ich ešte nenačítalo (python -m etl.pdf_text --from-db --only ${ref}) alebo nejde o vektorový výkres.`,
    );
  }
  if (!pageSize) {
    throw new UnderlayInputError(`Strana ${p.page} nemá rozmer (document_pages.page_size); python -m etl.pdf_text --from-db --only ${ref}.`);
  }
  const refine = p.refine && !!pg.lines;
  const warnings: string[] = [];
  if (noLinesManual && p.refine) warnings.push("Strana nemá čiary výkresu, dvojice sa nedoladili (refine=false).");
  // Region (D-180): text and lines only from it; scale preferably from the region text (sheet with drawings in different scales).
  const cropped = p.region ? cropToRegion(pg.blocks, pg.lines?.segs ?? [], p.region, pageSize) : null;
  if (cropped && pg.lines && cropped.lines.length < 20) {
    throw new UnderlayInputError(`Výrez ${p.region!.join(", ")} (%, vľavo hore) obsahuje len ${cropped.lines.length} čiar výkresu; skontroluj region (x, y, šírka, výška v % strany).`);
  }
  const blocks = cropped?.blocks ?? pg.blocks;
  const textScale = (cropped ? pageScaleFromText(cropped.blocks) : null) ?? pageScaleFromText(pg.blocks);
  const wantScale = p.scale ?? textScale;

  // Plane: section from section_plane (coordinate or a mark on a floor plan), a section document without a storey (REZ-A)
  // from a mark on a floor plan (D-179), otherwise the floor plan of the storey (from the argument or from the document link).
  let fromPlan = p.fromPlan;
  if (!p.section && !fromPlan && !p.floor && doc.floors.length === 0 && sectionMarkFromName(doc.object_ref, doc.name)) fromPlan = { mark: null };
  const marked = fromPlan ? await planSection(fromPlan.mark, doc, deps) : null;
  const section = p.section ?? (marked?.axis ? { axis: marked.axis.axis, coordinate: marked.axis.coordinate_m } : undefined);
  const isSection = !!section || !!marked;
  let floor = p.floor;
  if (!isSection && !floor) {
    if (doc.floors.length === 1) floor = doc.floors[0].guid;
    else {
      throw new UnderlayInputError(
        doc.floors.length === 0
          ? "Dokument nie je naviazaný na podlažie: zadaj floor (pôdorys) alebo section_plane (rez)."
          : `Dokument je naviazaný na viac podlaží (${doc.floors.map((f) => f.name).join(", ")}): zadaj floor.`,
      );
    }
  }
  const model = await deps.model({ model: p.model, floor });
  const segs = cropped?.lines ?? pg.lines?.segs ?? [];
  const refPoints = await pairRefPoints(p.pairs, model, deps);

  let res: CalibrationResult;
  let plane: Plane;
  let storeyZ: number | null = null;
  let spaceCount: number | null = null;
  let axes: Awaited<ReturnType<typeof planAxes>> = null;
  let axesCheck: AxesCheck | null = null;
  if (isSection) {
    plane = section ? axisPlane(section.axis, section.coordinate) : sectionPlane(marked!.at, marked!.dir);
    const what = section ? `${section.axis.toUpperCase()} = ${section.coordinate} m` : `rezu ${marked!.mark} (bod ${marked!.at.join(", ")}, smer ${marked!.dir.join(", ")})`;
    const cut = modelCut(model.elements, plane, "section");
    if (cut.length === 0) throw new UnderlayInputError(`Rovina ${what} nepretína model ${model.id}.`);
    if (p.mode === "manual") {
      const pairs = pairsInPlane(p.pairs, refPoints, plane, pageSize);
      // View direction from pairs: with 3 or more, the similarity (direct or mirrored) that fits better.
      const mirror = pairs.length >= 3 && residual(pairs, true) < residual(pairs, false);
      res = calibratePairs(pairs, refine ? { lines: segs, cut, mirror } : undefined, mirror, p.scale ?? undefined);
    } else {
      // D-179: marks paired with storey heights, grids and other sections from the floor plan as the position along the cut.
      res = calibrateSection({
        pageSize,
        blocks,
        lines: segs,
        cut,
        scale: wantScale ?? undefined,
        axes: marked && Object.keys(marked.axes).length >= 2 ? marked.axes : undefined,
        storeys: model.storeys?.map((x) => x.z),
      });
    }
  } else {
    const { z, spaces } = storeyFloor(model);
    storeyZ = z;
    spaceCount = spaces.length;
    plane = planPlane(z + PLAN_CUT_M);
    const cut = modelCut(model.elements, plane, "plan");
    const pairs = p.mode === "manual" ? pairsInPlane(p.pairs, refPoints, plane, pageSize) : [];
    axes = await planAxes(doc, p.page, p.region, pageSize, blocks, segs, wantScale, deps);
    res =
      p.mode === "manual"
        ? calibratePairs(pairs, refine ? { lines: segs, cut, mirror: false } : undefined, false, p.scale ?? undefined)
        : calibratePlan({ pageSize, blocks, lines: segs, spaces, cut, scale: wantScale ?? undefined, axes: axes ? { page: axes.page, ref: axes.ref, gridDeg: axes.gridDeg } : undefined });
    axesCheck = axes ? checkAxes(res.affine, axes.page, axes.ref) : null;
  }

  // Scale check (#284): a low median error is not enough, ICP can catch wrong lines at a wrong scale.
  // With manual the scale comes from the user's pairs of points, it is only reported.
  const scaleCheck = checkScale(res.scale_ratio, p.scale, p.mode === "manual" ? null : textScale);
  if (!scaleCheck.ok) {
    const what = { param: "zadanej mierky", text: "mierky z textu strany", standard: "najbližšej bežnej mierky", none: "" }[scaleCheck.source];
    warnings.push(`Mierka 1:${res.scale_ratio} sa líši o ${((scaleCheck.deviation ?? 0) * 100).toFixed(1)} % od ${what} 1:${scaleCheck.expected}; kalibrácia je pravdepodobne krivá.`);
  }
  // Rotation check (D-180): floor plan parallel to the model axes (also rotated by 90°), section without rotation.
  // Rotated grid network on the page (D-184 addendum): the expected rotation is from the page grids, not a multiple of 90°; the tolerance stays.
  const rotationCheck = checkRotation(res.rotation_deg, isSection ? "section" : "plan", axes?.gridDeg);
  if (!rotationCheck.ok) {
    warnings.push(`Natočenie ${res.rotation_deg}° sa líši o ${rotationCheck.deviation_deg}° od ${rotationCheck.expected_deg}°; kalibrácia je pravdepodobne krivá.`);
  }
  // Grid check: drawing grids at the same place as on the other calibrated floor plans (shift by a grid bay, bad start).
  if (axesCheck && !axesCheck.ok) {
    warnings.push(`Osi výkresu sú v mediáne ${axesCheck.median_mm} mm od polohy tých istých osí na iných kalibrovaných výkresoch (strop ${AXES_TOLERANCE_MM} mm); kalibrácia je pravdepodobne posunutá.`);
  }
  const plausible = scaleCheck.ok && rotationCheck.ok && (axesCheck?.ok ?? true);

  const fixed = isSection ? unmirror(res, plane) : { affine: res.affine, plane, calibration: res.calibration };
  const entry: GeorefCalibration = {
    page: p.page,
    page_size: [r3(pageSize[0]), r3(pageSize[1])],
    ...(isSection
      ? { plane: { origin: fixed.plane.origin, u: fixed.plane.u, v: fixed.plane.v } as GeorefPlane }
      : { plane: null, storey_guid: model.storey!.guid, storey_z: r3(storeyZ!) }),
    affine: fixed.affine,
    ...(p.region ? { region: p.region } : {}),
    calibration: fixed.calibration.map((c) => ({ pdf_pt: [r3(c.pdf_pt[0]), r3(c.pdf_pt[1])], ifc_m: [r3(c.plane_m[0]), r3(c.plane_m[1])] })),
    source: p.mode === "manual" ? "manual" : "auto",
    quality: {
      method: `${res.start.method}${res.icp_pairs > 0 ? "+icp" : ""}`,
      median_mm: Number.isFinite(res.quality.median_mm) ? res.quality.median_mm : null,
      p90_mm: Number.isFinite(res.quality.p90_mm) ? res.quality.p90_mm : null,
      cv_max_mm: Number.isFinite(res.cross_validation_max_mm) ? res.cross_validation_max_mm : null,
      start_points: res.start.points,
    },
    opacity: 0.6,
    visible: true,
    discipline: null,
    calibrated_at: deps.now().toISOString(),
  };

  const out: Record<string, unknown> = {
    document: { id: doc.id, object_ref: doc.object_ref, name: doc.name, page: p.page },
    kind: isSection ? "section" : "plan",
    ...(isSection
      ? {
          section_plane: section ? { axis: section.axis, coordinate_m: section.coordinate } : { origin: [marked!.at[0], marked!.at[1]], dir: marked!.dir },
          // View direction (floor plan X, Y): the camera looks against the normal u × v (D-133), i.e. v × u.
          view_direction: [r3(-fixed.plane.u[1]) || 0, r3(fixed.plane.u[0]) || 0],
          ...(marked
            ? {
                from_plan: {
                  mark: marked.mark,
                  plans: marked.plans,
                  spread_mm: marked.spread_mm,
                  axes: marked.axes,
                  note: "Rovina zo značky rezu na kalibrovaných pôdorysoch (koncové body cez affine strany); smer pohľadu určila zhoda s rezom modelu (šípky značky nie sú v čiarach strany).",
                },
              }
            : {}),
        }
      : { floor: model.storey?.name, storey_z_m: r3(storeyZ!), spaces: spaceCount }),
    model: model.id,
    scale: `1:${res.scale_ratio}`,
    ...(p.region ? { region: p.region } : {}),
    scale_check: { ...scaleCheck, text_scale: textScale === null ? null : `1:${textScale}`, locked: wantScale !== null && p.mode !== "manual" },
    rotation_check: rotationCheck,
    ...(res.rotation_locked_from_deg !== undefined ? { rotation_locked_from_deg: res.rotation_locked_from_deg } : {}),
    ...(axesCheck
      ? { axes_check: { ...axesCheck, tolerance_mm: AXES_TOLERANCE_MM, ref_axes: axes!.ref.length, ref_sheets: axes!.sheets, page_axes: axes!.source, ...(axes!.grid ? { grid_deg: axes!.grid.deg, rows: axes!.grid.rows } : {}) } }
      : {}),
    ...(res.icp_rejected ? { icp_rejected: res.icp_rejected } : {}),
    // The result is bad (scale or rotation off), auto does not store it; with manual only a report.
    plausible,
    ...(warnings.length ? { warnings } : {}),
    rotation_deg: res.rotation_deg,
    offset_m: [r3(fixed.affine[2]), r3(fixed.affine[5])],
    start: res.start,
    icp_pairs: res.icp_pairs,
    error_mm: { median: entry.quality!.median_mm, p90: entry.quality!.p90_mm, cross_validation_max: entry.quality!.cv_max_mm, coverage: res.quality.coverage },
    calibration: entry,
    existing: toGeorefV2(doc.georef).calibrations.map((c) => ({
      page: c.page,
      kind: c.plane ? "section" : "plan",
      ...(c.region ? { region: c.region } : {}),
      source: c.source,
      median_mm: c.quality?.median_mm ?? null,
      calibrated_at: c.calibrated_at ?? null,
    })),
  };

  if (p.mode === "dry_run") {
    out.written = false;
    out.note = "dry_run: nič sa neuložilo. Uloženie = mode=auto (na pokyn používateľa).";
    return out;
  }
  if (!deps.writeEnabled) {
    out.written = false;
    out.note = "Zápis kalibrácie je vypnutý (UNDERLAY_WRITE_ENABLED); výsledok je len náhľad.";
    return out;
  }
  const median = entry.quality!.median_mm;
  if (p.mode === "auto" && !scaleCheck.ok) {
    out.written = false;
    out.note = `Neuložené: mierka 1:${res.scale_ratio} nesedí s ${scaleCheck.source === "param" ? "zadanou" : scaleCheck.source === "text" ? "mierkou z textu strany" : "bežnými mierkami výkresu"} (1:${scaleCheck.expected}), aj keď medián chyby je ${median ?? "?"} mm. Zadaj scale (napr. scale=50), skontroluj podlažie, alebo použi mode=manual.`;
    return out;
  }
  if (p.mode === "auto" && !rotationCheck.ok) {
    out.written = false;
    out.note = `Neuložené: natočenie ${res.rotation_deg}° je o ${rotationCheck.deviation_deg}° mimo ${rotationCheck.expected_deg}° (výkres je rovnobežný s osami modelu), aj keď medián chyby je ${median ?? "?"} mm. Skontroluj podlažie, region, alebo použi mode=manual.`;
    return out;
  }
  if (p.mode === "auto" && axesCheck && !axesCheck.ok) {
    out.written = false;
    out.note = `Neuložené: osi výkresu nesedia s osami iných kalibrovaných výkresov (medián ${axesCheck.median_mm} mm), aj keď medián chyby je ${median ?? "?"} mm. Skontroluj podlažie, region, alebo použi mode=manual.`;
    return out;
  }
  if (p.mode === "auto" && res.icp_rejected) {
    out.written = false;
    out.note = `Neuložené: čiary výkresu nesedia s konštrukciami modelu v polohe z osí (doladenie by osi posunulo o ${res.icp_rejected.axes_median_mm ?? "?"} mm), výsledok je len štart z osí. Skontroluj ho vo vieweri a ulož ručne (panel Underlays alebo mode=manual s dvojicami z calibration).`;
    return out;
  }
  if (p.mode === "auto" && (median === null || median > p.maxErrorMm)) {
    out.written = false;
    out.note = `Neuložené: medián chyby ${median ?? "?"} mm je nad stropom ${p.maxErrorMm} mm. Skontroluj podlažie alebo rovinu rezu, alebo použi mode=manual.`;
    return out;
  }
  const merged = await deps.write(doc.id, (stored) => mergeCalibration(stored, entry, p.force, { by: "mcp", reason: `calibrate_underlay mode=${p.mode}`, at: deps.now().toISOString() }));
  if (!merged.ok) {
    out.written = false;
    out.note = `Neuložené: strana ${p.page} má ručnú kalibráciu z panela Underlays (${merged.existing.calibrated_at ?? "bez dátumu"}); prepíše ju len force=true na výslovný pokyn.`;
    return out;
  }
  out.written = true;
  out.replaced = merged.replaced ? { source: merged.replaced.source, calibrated_at: merged.replaced.calibrated_at ?? null } : null;
  // D-168: an overwritten calibration with a different position stays in history (calibrate_underlay mode=history | restore).
  if (merged.history_added) out.history_saved = true;
  out.calibrations_in_document = toGeorefV2(merged.georef).calibrations.length;
  out.note = "Uložené do kalibrácie dokumentu; viewer podklad načíta pri ďalšom otvorení (obnov stránku). Rez sa zobrazí, keď viewer začne čítať zvislé podklady (D-132).";
  return out;
}
