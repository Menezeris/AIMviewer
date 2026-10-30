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
import { ifcPositions, modelCut, planPlane, sectionPlane } from "./underlay-model";
import { pageAxisLines, refAxesFromSheets, sectionFromPlans, sectionMarkFromName, type PlanSheet, type SectionFromPlans } from "./underlay-section-mark";
import { CALIBRATE_UNDERLAY_MODES, DEFAULT_MAX_ERROR_MM, PLAN_CUT_M, type Mode } from "./underlay-tool-def";

/**
 * `calibrate_underlay` (D-133): automatická kalibrácia podkladu výkresu (strana PDF) pod
 * IFC model - pôdorys k podlažiu, zvislý rez k rovine rezu. Výsledok ide do `_georef` v2
 * dokumentu (zoznam kalibrácií, `lib/data/georef.ts`). Logika je tu, závislosti (DB, IFC
 * motor) v `underlay-runtime.ts`, aby sa dala testovať bez nich.
 */

export { CALIBRATE_UNDERLAY_TOOL } from "./underlay-tool-def";

export interface UnderlayDocument {
  id: string;
  object_ref: string | null;
  name: string | null;
  /** Surové `properties._georef` (v1, v2 alebo nič). */
  georef: unknown;
  /** Podlažia, na ktoré je dokument naviazaný (IFC GUID a meno). */
  floors: { guid: string; name: string }[];
}

export interface UnderlayPage {
  blocks: PageBlock[];
  lines: { size: P2; segs: PageLine[] } | null;
  /** Rozmer strany v bodoch (`document_pages.page_size`, D-158); null = ETL pred D-158. */
  pageSize?: P2 | null;
}

export interface UnderlayModel {
  id: string;
  elements: MeshElement[];
  /** Pôdorys: podlažie, jeho výška (m, z parsera, ako viewer) a IfcSpace (GUID). */
  storey?: { guid: string; name: string; z?: number | null; spaceGuids: string[] };
  /** Rez: výšky všetkých podlaží (IfcBuildingStorey.Elevation z parsera, IFC Z v m) na spárovanie kót (D-179). */
  storeys?: { name: string; z: number }[];
}

export interface UnderlayDeps {
  document: (ref: string) => Promise<UnderlayDocument | null>;
  page: (documentId: string, page: number) => Promise<UnderlayPage | null>;
  model: (opts: { model?: string; floor?: string }) => Promise<UnderlayModel>;
  /** Zápis: `apply` zlúči kalibráciu do aktuálneho `_georef` (prečítaného tesne pred zápisom). */
  write: (documentId: string, apply: (stored: unknown) => MergeResult) => Promise<MergeResult>;
  /** `object_ref` (miestnosť, stena, prvok) -> IFC GUID pre `pairs[].object_ref` (D-176); bez neho sa object_ref odmietne. */
  refGuids?: (refs: string[]) => Promise<Map<string, string>>;
  /** Kalibrované pôdorysy (strana s affine, plane null) s textom a čiarami, pre rovinu rezu zo značky (D-179). */
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
  /** Rez zo značky na kalibrovanom pôdoryse (D-179): písmeno (null = z mena dokumentu). */
  fromPlan?: { mark: string | null };
  /** Dvojica: bod modelu je `model_m`, alebo `object_ref` prvku (ťažisko prvku v rovine, D-176). */
  pairs: { page_pct: P2; model_m?: P2; object_ref?: string }[];
  refine: boolean;
  maxErrorMm: number;
  force: boolean;
  model?: string;
  /** Mierka výkresu 1:N zadaná používateľom (pevná v štarte aj ICP). */
  scale: number | null;
  /** Výrez strany v % (x, y, w, h; vľavo hore) pri hárku s viac výkresmi (D-180). */
  region: PageRegion | null;
}

/** `region` ako [x, y, w, h] alebo {x, y, width, height} v % strany (vľavo hore, ako open_drawing). */
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
 * Výška podlažia: z parsera (`storeyElevations`, tú istú berie viewer), inak medián spodkov
 * priestorov. Minimum nestačí: šachta siaha pod podlahu (1NP ASR -1,2 m) a spodok priestoru
 * je nosná doska, nie podlaha (2NP ASR 4,85 m pri výške 5,0 m). Podlažie bez IfcSpace (5NP)
 * ide s výškou z parsera, popisky miestností potom nie sú (štart skenovaním, D-180).
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

/** Súčet odchýlok dvojíc od podobnosti (priamej alebo zrkadlovej). */
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
 * Body modelu pre dvojice s `object_ref` (D-176): ťažisko prvku v IFC (pôdorys: plošné ťažisko pôdorysu, napr. IfcSpace;
 * ináč priemer vrcholov), kým je rovina známa až po výbere podlažia. Prvok bez geometrie alebo mimo modelu je chyba
 * s radou (model_m alebo iný prvok), nie ticho vynechaná dvojica.
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

/** Ťažisko prvku v IFC: v pôdoryse plošné ťažisko pôdorysu (ako popisky miestností), ináč priemer vrcholov. */
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

/** Dvojice s bodom strany v bodoch PDF a bodom modelu v rovine (u, v); object_ref sa premieta ťažiskom do roviny. */
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

/** Pohľad z druhej strany: zrkadlo osi u sa prenesie do roviny (u -> -u), affine ostane priamy. */
function unmirror(res: CalibrationResult, plane: Plane): { affine: Affine; plane: Plane; calibration: CalibrationResult["calibration"] } {
  if (!res.mirrored) return { affine: res.affine, plane, calibration: res.calibration };
  const a = res.affine;
  return {
    affine: [-a[0], -a[1], -a[2], a[3], a[4], a[5]],
    // `|| 0`: bez -0 v uloženom JSON.
    plane: { ...plane, u: [-plane.u[0] || 0, -plane.u[1] || 0, -plane.u[2] || 0] },
    calibration: res.calibration.map((c) => ({ pdf_pt: c.pdf_pt, plane_m: [-c.plane_m[0], c.plane_m[1]] as P2 })),
  };
}

/** Séria výkresov `OCB_SO01_ASR` z object_ref (stavba, objekt, disciplína): pôdorysy rovnakej série majú prednosť. */
function seriesOf(ref: string | null): string | null {
  const parts = ref?.split("_") ?? [];
  return parts.length >= 3 ? parts.slice(0, 3).join("_") : null;
}

/**
 * Rovina rezu zo značky na kalibrovaných pôdorysoch (D-179): písmeno z argumentu alebo z mena dokumentu
 * (REZ-A), pôdorysy tej istej série (ASR) prednostne, inak všetky kalibrované.
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

/**
 * Osi (gridy) pôdorysu: rady osí tejto strany (výrezu) a ich poloha v IFC z ostatných kalibrovaných pôdorysov
 * (aj iných podlaží a disciplín, grid je spoločný). Bez kalibrovaných pôdorysov alebo osí null.
 */
async function planAxes(doc: UnderlayDocument, page: number, region: PageRegion | null, pageSize: P2, blocks: PageBlock[], lines: PageLine[], deps: UnderlayDeps): Promise<{ page: AxisLine[]; ref: RefAxis[]; sheets: number } | null> {
  if (!deps.planSheets) return null;
  const pageLines = pageAxisLines(pageSize, blocks, lines);
  if (pageLines.length === 0) return null;
  const ref = doc.object_ref ?? doc.id;
  const same = (sh: PlanSheet) => sh.ref === ref && sh.page === page && JSON.stringify(sh.region ?? null) === JSON.stringify(region);
  const others = (await deps.planSheets()).filter((sh) => !same(sh));
  const refs = refAxesFromSheets(others);
  return refs.length ? { page: pageLines, ref: refs, sheets: others.length } : null;
}

/** Zvislá rovina osi: axis x = rovina X = c (rez ide po Y), axis y = rovina Y = c. */
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
  // Rozmer strany (body) treba na prepočet ručných bodov v %: z čiar, inak z `page_size` (D-158).
  const pageSize = pg.lines?.size ?? pg.pageSize ?? null;
  const ref = doc.object_ref ?? doc.id;
  // Bez čiar sa dá len mode=manual bez doladenia (refine=false): dvojice bodov dajú podobnosť sami.
  const noLinesManual = !pg.lines && p.mode === "manual" && pageSize !== null;
  if (!pg.lines && !noLinesManual) {
    // `page_size` plní rovnaký beh ETL ako čiary: ak je, ETL strana prešla a čiar je málo (raster, sken).
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
  // Výrez (D-180): text a čiary len z neho; mierka prednostne z textu výrezu (hárok s výkresmi v rôznych mierkach).
  const cropped = p.region ? cropToRegion(pg.blocks, pg.lines?.segs ?? [], p.region, pageSize) : null;
  if (cropped && pg.lines && cropped.lines.length < 20) {
    throw new UnderlayInputError(`Výrez ${p.region!.join(", ")} (%, vľavo hore) obsahuje len ${cropped.lines.length} čiar výkresu; skontroluj region (x, y, šírka, výška v % strany).`);
  }
  const blocks = cropped?.blocks ?? pg.blocks;
  const textScale = (cropped ? pageScaleFromText(cropped.blocks) : null) ?? pageScaleFromText(pg.blocks);
  const wantScale = p.scale ?? textScale;

  // Rovina: rez zo section_plane (súradnica alebo značka na pôdoryse), dokument rezu bez podlažia (REZ-A)
  // zo značky na pôdoryse (D-179), inak pôdorys podlažia (z argumentu alebo z väzby dokumentu).
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
      // Smer pohľadu z dvojíc: pri 3 a viac tá podobnosť (priama alebo zrkadlová), ktorá sedí lepšie.
      const mirror = pairs.length >= 3 && residual(pairs, true) < residual(pairs, false);
      res = calibratePairs(pairs, refine ? { lines: segs, cut, mirror } : undefined, mirror, p.scale ?? undefined);
    } else {
      // D-179: kóty spárované s výškami podlaží, osi a iné rezy z pôdorysu ako poloha po reze.
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
    axes = await planAxes(doc, p.page, p.region, pageSize, blocks, segs, deps);
    res =
      p.mode === "manual"
        ? calibratePairs(pairs, refine ? { lines: segs, cut, mirror: false } : undefined, false, p.scale ?? undefined)
        : calibratePlan({ pageSize, blocks, lines: segs, spaces, cut, scale: wantScale ?? undefined, axes: axes ?? undefined });
    axesCheck = axes ? checkAxes(res.affine, axes.page, axes.ref) : null;
  }

  // Kontrola mierky (#284): nízky medián chyby nestačí, ICP vie zachytiť nesprávne čiary v zlej mierke.
  // Pri manual je mierka z dvojíc bodov používateľa, tá sa len ohlási.
  const scaleCheck = checkScale(res.scale_ratio, p.scale, p.mode === "manual" ? null : textScale);
  if (!scaleCheck.ok) {
    const what = { param: "zadanej mierky", text: "mierky z textu strany", standard: "najbližšej bežnej mierky", none: "" }[scaleCheck.source];
    warnings.push(`Mierka 1:${res.scale_ratio} sa líši o ${((scaleCheck.deviation ?? 0) * 100).toFixed(1)} % od ${what} 1:${scaleCheck.expected}; kalibrácia je pravdepodobne krivá.`);
  }
  // Kontrola natočenia (D-180): pôdorys rovnobežne s osami modelu (aj otočený o 90°), rez bez natočenia.
  const rotationCheck = checkRotation(res.rotation_deg, isSection ? "section" : "plan");
  if (!rotationCheck.ok) {
    warnings.push(`Natočenie ${res.rotation_deg}° sa líši o ${rotationCheck.deviation_deg}° od ${rotationCheck.expected_deg}°; kalibrácia je pravdepodobne krivá.`);
  }
  // Kontrola osí: osi výkresu na tom istom mieste ako na ostatných kalibrovaných pôdorysoch (posun o pole osí, zlý štart).
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
          // Smer pohľadu (pôdorys X, Y): kamera hľadí proti normále u × v (D-133), teda v × u.
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
    ...(axesCheck ? { axes_check: { ...axesCheck, tolerance_mm: AXES_TOLERANCE_MM, ref_axes: axes!.ref.length, ref_sheets: axes!.sheets } } : {}),
    // Výsledok je zlý (mierka alebo natočenie mimo), auto ho neuloží; pri manual len hlásenie.
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
  // D-168: prepísaná kalibrácia s inou polohou ostáva v histórii (calibrate_underlay mode=history | restore).
  if (merged.history_added) out.history_saved = true;
  out.calibrations_in_document = toGeorefV2(merged.georef).calibrations.length;
  out.note = "Uložené do kalibrácie dokumentu; viewer podklad načíta pri ďalšom otvorení (obnov stránku). Rez sa zobrazí, keď viewer začne čítať zvislé podklady (D-132).";
  return out;
}
