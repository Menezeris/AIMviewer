import { mergeCalibration, toGeorefV2, type GeorefCalibration, type GeorefPlane, type MergeResult } from "../data/georef";

import type { MeshElement } from "./measure";
import {
  CalibrationError,
  applyAffine,
  calibratePairs,
  calibratePlan,
  calibrateSection,
  fitSimilarity,
  footprintCentroid,
  type Affine,
  type CalibrationResult,
  type P2,
  type PageBlock,
  type PageLine,
  type Plane,
} from "./underlay-calibrate";
import { ifcPositions, modelCut, planPlane, sectionPlane } from "./underlay-model";
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
}

export interface UnderlayModel {
  id: string;
  elements: MeshElement[];
  /** Pôdorys: podlažie, jeho výška (m, z parsera, ako viewer) a IfcSpace (GUID). */
  storey?: { guid: string; name: string; z?: number | null; spaceGuids: string[] };
}

export interface UnderlayDeps {
  document: (ref: string) => Promise<UnderlayDocument | null>;
  page: (documentId: string, page: number) => Promise<UnderlayPage | null>;
  model: (opts: { model?: string; floor?: string }) => Promise<UnderlayModel>;
  /** Zápis: `apply` zlúči kalibráciu do aktuálneho `_georef` (prečítaného tesne pred zápisom). */
  write: (documentId: string, apply: (stored: unknown) => MergeResult) => Promise<MergeResult>;
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
  pairs: { page_pct: P2; model_m: P2 }[];
  refine: boolean;
  maxErrorMm: number;
  force: boolean;
  model?: string;
}

function parse(a: Record<string, unknown>): Parsed {
  const documentId = typeof a.document_id === "string" ? a.document_id.trim() : "";
  if (!documentId) throw new UnderlayInputError("Chýba document_id (UUID alebo object_ref výkresu).");
  const page = a.page === undefined ? 1 : Number(a.page);
  if (!Number.isInteger(page) || page < 1) throw new UnderlayInputError("page je číslo strany od 1.");
  const mode = (a.mode ?? "dry_run") as Mode;
  if (!CALIBRATE_UNDERLAY_MODES.includes(mode)) throw new UnderlayInputError(`mode je ${CALIBRATE_UNDERLAY_MODES.join(" | ")}.`);
  let section: Parsed["section"];
  if (a.section_plane !== undefined) {
    const s = a.section_plane as { axis?: unknown; coordinate_m?: unknown };
    if ((s?.axis !== "x" && s?.axis !== "y") || !num(s.coordinate_m)) {
      throw new UnderlayInputError("section_plane je {axis: 'x' | 'y', coordinate_m: číslo v m}.");
    }
    section = { axis: s.axis, coordinate: s.coordinate_m };
  }
  const floor = typeof a.floor === "string" && a.floor.trim() ? a.floor.trim() : undefined;
  if (section && floor) throw new UnderlayInputError("Zadaj buď floor (pôdorys), alebo section_plane (rez).");
  const pairs: Parsed["pairs"] = [];
  if (a.pairs !== undefined) {
    if (!Array.isArray(a.pairs) || a.pairs.length > 20) throw new UnderlayInputError("pairs je pole najviac 20 dvojíc.");
    for (const p of a.pairs as { page_pct?: unknown; model_m?: unknown }[]) {
      const ok = (t: unknown): t is P2 => Array.isArray(t) && t.length === 2 && t.every(num);
      if (!ok(p?.page_pct) || !ok(p?.model_m)) throw new UnderlayInputError("Dvojica je {page_pct: [x, y], model_m: [u, v]}.");
      pairs.push({ page_pct: p.page_pct, model_m: p.model_m });
    }
  }
  if (mode === "manual" && pairs.length < 2) throw new UnderlayInputError("mode=manual potrebuje aspoň 2 dvojice v pairs.");
  const maxErrorMm = num(a.max_error_mm) && a.max_error_mm > 0 ? a.max_error_mm : DEFAULT_MAX_ERROR_MM;
  const model = typeof a.model === "string" && a.model.trim() ? a.model.trim() : undefined;
  return { documentId, page, mode, floor, section, pairs, refine: a.refine !== false, maxErrorMm, force: a.force === true, model };
}

/**
 * Výška podlažia: z parsera (`storeyElevations`, tú istú berie viewer), inak medián spodkov
 * priestorov. Minimum nestačí: šachta siaha pod podlahu (1NP ASR -1,2 m) a spodok priestoru
 * je nosná doska, nie podlaha (2NP ASR 4,85 m pri výške 5,0 m).
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
  if (bottoms.length === 0) throw new UnderlayInputError(`Podlažie ${model.storey?.name ?? ""} nemá v modeli ${model.id} priestory (IfcSpace) s geometriou, výška sa nedá určiť.`);
  bottoms.sort((a, b) => a - b);
  const z = model.storey?.z;
  return { z: typeof z === "number" && Number.isFinite(z) ? z : bottoms[Math.floor(bottoms.length / 2)], spaces };
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
  const needLines = p.mode !== "manual" || p.refine;
  if (needLines && !pg.lines) {
    throw new UnderlayInputError(
      `Strana ${p.page} nemá čiary výkresu (document_pages.lines): nie je to vektorový výkres, alebo ich ETL ešte nenačítalo (python -m etl.pdf_text --from-db --only ${doc.object_ref ?? doc.id}). Bez nich ide len mode=manual s refine=false.`,
    );
  }
  const pageSize: P2 | null = pg.lines?.size ?? null;
  if (!pageSize) throw new UnderlayInputError("Chýba rozmer strany (document_pages.lines.size); načítaj stranu cez ETL.");

  // Rovina: rez zo section_plane, inak pôdorys podlažia (z argumentu alebo z väzby dokumentu).
  let floor = p.floor;
  if (!p.section && !floor) {
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
  const segs = pg.lines?.segs ?? [];
  const pairs = p.pairs.map((x) => ({
    pdf_pt: [(x.page_pct[0] / 100) * pageSize[0], (1 - x.page_pct[1] / 100) * pageSize[1]] as P2,
    plane_m: x.model_m,
  }));

  let res: CalibrationResult;
  let plane: Plane;
  let storeyZ: number | null = null;
  let spaceCount: number | null = null;
  if (p.section) {
    const c = p.section.coordinate;
    plane = p.section.axis === "x" ? sectionPlane([c, 0], [0, 1]) : sectionPlane([0, c], [1, 0]);
    const cut = modelCut(model.elements, plane, "section");
    if (cut.length === 0) throw new UnderlayInputError(`Rovina ${p.section.axis.toUpperCase()} = ${c} m nepretína model ${model.id}.`);
    if (p.mode === "manual") {
      // Smer pohľadu z dvojíc: pri 3 a viac tá podobnosť (priama alebo zrkadlová), ktorá sedí lepšie.
      const mirror = pairs.length >= 3 && residual(pairs, true) < residual(pairs, false);
      res = calibratePairs(pairs, p.refine ? { lines: segs, cut, mirror } : undefined, mirror);
    } else {
      res = calibrateSection({ pageSize, blocks: pg.blocks, lines: segs, cut });
    }
  } else {
    const { z, spaces } = storeyFloor(model);
    storeyZ = z;
    spaceCount = spaces.length;
    plane = planPlane(z + PLAN_CUT_M);
    const cut = modelCut(model.elements, plane, "plan");
    res =
      p.mode === "manual"
        ? calibratePairs(pairs, p.refine ? { lines: segs, cut, mirror: false } : undefined)
        : calibratePlan({ pageSize, blocks: pg.blocks, lines: segs, spaces, cut });
  }

  const fixed = p.section ? unmirror(res, plane) : { affine: res.affine, plane, calibration: res.calibration };
  const entry: GeorefCalibration = {
    page: p.page,
    page_size: [r3(pageSize[0]), r3(pageSize[1])],
    ...(p.section
      ? { plane: { origin: fixed.plane.origin, u: fixed.plane.u, v: fixed.plane.v } as GeorefPlane }
      : { plane: null, storey_guid: model.storey!.guid, storey_z: r3(storeyZ!) }),
    affine: fixed.affine,
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
    kind: p.section ? "section" : "plan",
    ...(p.section ? { section_plane: { axis: p.section.axis, coordinate_m: p.section.coordinate } } : { floor: model.storey?.name, storey_z_m: r3(storeyZ!), spaces: spaceCount }),
    model: model.id,
    scale: `1:${res.scale_ratio}`,
    rotation_deg: res.rotation_deg,
    offset_m: [r3(fixed.affine[2]), r3(fixed.affine[5])],
    start: res.start,
    icp_pairs: res.icp_pairs,
    error_mm: { median: entry.quality!.median_mm, p90: entry.quality!.p90_mm, cross_validation_max: entry.quality!.cv_max_mm },
    calibration: entry,
    existing: toGeorefV2(doc.georef).calibrations.map((c) => ({
      page: c.page,
      kind: c.plane ? "section" : "plan",
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
  if (p.mode === "auto" && (median === null || median > p.maxErrorMm)) {
    out.written = false;
    out.note = `Neuložené: medián chyby ${median ?? "?"} mm je nad stropom ${p.maxErrorMm} mm. Skontroluj podlažie alebo rovinu rezu, alebo použi mode=manual.`;
    return out;
  }
  const merged = await deps.write(doc.id, (stored) => mergeCalibration(stored, entry, p.force));
  if (!merged.ok) {
    out.written = false;
    out.note = `Neuložené: strana ${p.page} má ručnú kalibráciu z panela Underlays (${merged.existing.calibrated_at ?? "bez dátumu"}); prepíše ju len force=true na výslovný pokyn.`;
    return out;
  }
  out.written = true;
  out.replaced = merged.replaced ? { source: merged.replaced.source, calibrated_at: merged.replaced.calibrated_at ?? null } : null;
  out.calibrations_in_document = toGeorefV2(merged.georef).calibrations.length;
  out.note = "Uložené do kalibrácie dokumentu; viewer podklad načíta pri ďalšom otvorení (obnov stránku). Rez sa zobrazí, keď viewer začne čítať zvislé podklady (D-132).";
  return out;
}
