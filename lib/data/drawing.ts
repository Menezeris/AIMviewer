import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cachedProjectRead } from "@/lib/data/revalidate";
import { georefV2Wire, primaryV1, toGeorefV2, type GeorefV2 } from "@/lib/data/georef";

/**
 * Data-access layer for the in-app drawing viewer (D-042 phase C). Reads the source
 * PDF (`documents.location`, public Supabase Storage bucket) + clickable link
 * regions from `objects.properties._drawing_links` (written by ETL phase A, `pdf_link.py`).
 *
 * `_drawing_links` has snake_case keys (written by Python); here they are mapped to camelCase.
 * The `bbox` coordinates are in PDF bottom-left (y up) - the render flips them at the UI source.
 */

/** One clickable region in a drawing (`_drawing_links`, D-042). */
export interface DrawingRegion {
  /** 1-based page number. */
  page: number;
  /** PDF bottom-left [x0, y0, x1, y1] (points). */
  bbox: [number, number, number, number];
  /** Page size [width, height] in points - the reference base for scaling. */
  pageSize: [number, number];
  /** Target `objects.id` (asset / asset_type), or a document for the `drawing` route. */
  targetId: string;
  /** Target route segment: element detail (`node`/`type`) or another drawing (`drawing`, D-043). */
  targetRoute: "node" | "type" | "drawing";
  /** Page of the target drawing for the `drawing` route (assemblies -> page in the Schedule, D-043). */
  targetPage?: number;
  /** Confidence layer of detection (D-041) / `skladba` = navigation region of an assembly (D-043). */
  layer: "full" | "proximity" | "bare" | "skladba";
  /** Displayed SNIM code, or an assembly mark (`S#`). */
  label: string;
}

/** Element selected by a click in a drawing - input for the side info panel (D-042 D). */
export interface SelectedElement {
  id: string;
  route: "node" | "type";
  label: string;
}

/** Drawing for the viewer: public PDF URL + clickable regions. */
export interface DrawingDoc {
  id: string;
  name: string | null;
  objectRef: string | null;
  /** Public PDF URL (`documents.location`). */
  location: string;
  links: DrawingRegion[];
}

type RawRegion = {
  page?: unknown;
  bbox?: unknown;
  page_size?: unknown;
  target_id?: unknown;
  target_route?: unknown;
  target_page?: unknown;
  layer?: unknown;
  label?: unknown;
};

function normalizeRegion(r: RawRegion): DrawingRegion | null {
  if (
    typeof r.page !== "number" ||
    !Array.isArray(r.bbox) ||
    r.bbox.length !== 4 ||
    !Array.isArray(r.page_size) ||
    r.page_size.length !== 2 ||
    typeof r.target_id !== "string"
  ) {
    return null;
  }
  const targetRoute: DrawingRegion["targetRoute"] =
    r.target_route === "type"
      ? "type"
      : r.target_route === "drawing"
        ? "drawing"
        : "node";
  return {
    page: r.page,
    bbox: r.bbox as [number, number, number, number],
    pageSize: r.page_size as [number, number],
    targetId: r.target_id,
    targetRoute,
    targetPage: typeof r.target_page === "number" ? r.target_page : undefined,
    layer: (r.layer as DrawingRegion["layer"]) ?? "full",
    label: typeof r.label === "string" ? r.label : "",
  };
}

async function fetchDrawingImpl(projectId: string, id: string): Promise<DrawingDoc | null> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_ref, name, object_type, properties")
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj || obj.object_type !== "document") return null;

  const { data: doc, error: dErr } = await supabase
    .from("documents")
    .select("location")
    .eq("id", id)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);

  const location = (doc?.location as string | null) ?? null;
  if (!location) return null; // without a PDF there is nothing to show

  const raw = ((obj.properties as Record<string, unknown> | null)?.[
    "_drawing_links"
  ] ?? []) as RawRegion[];
  const links = raw
    .map(normalizeRegion)
    .filter((r): r is DrawingRegion => r !== null);

  return {
    id: obj.id as string,
    name: (obj.name as string | null) ?? null,
    objectRef: (obj.object_ref as string | null) ?? null,
    location,
    links,
  };
}

/** Cached per id (ISR, D-029 perf). */
export const fetchDrawing = cachedProjectRead("fetch-drawing", fetchDrawingImpl);

// --- Georeferenced PDF underlays (D-072) -----------------------------------------

/**
 * Wire shape of one underlay for the embed viewer (bridge `UNDERLAYS_LOAD`).
 * `georef` is v1 (`parsePlacement` in @ifc-lite/drawing-underlay validates it
 * itself): the floor-plan calibration of the page that today's fork can display.
 * `georefV2` (D-133) carries all calibrations of the document including sections
 * (`plane`); the fork will start reading it with the views of D-132.
 */
export interface UnderlayDrawingWire {
  documentId: string;
  name: string;
  pdfUrl: string;
  georef?: unknown;
  georefV2?: GeorefV2;
}

/**
 * Validation of writing `_georef` v1 (PATCH /api/underlay, D-072) - the server must not
 * persist arbitrary JSON from the client. Mirrors `parsePlacement` from
 * @ifc-lite/drawing-underlay (of the viewer), but independently: the AIM app does not
 * consume the package and the payload is untrusted input of the route handler.
 */
export function isValidGeorefV1(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const g = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const tuple = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(num);
  if (g.version !== 1) return false;
  if (typeof g.storey_guid !== "string" || g.storey_guid.length === 0) return false;
  if (!num(g.storey_z)) return false;
  if (!num(g.page) || !Number.isInteger(g.page) || (g.page as number) < 1) return false;
  if (!tuple(g.page_size, 2)) return false;
  const pageSize = g.page_size as number[];
  if (pageSize[0] <= 0 || pageSize[1] <= 0) return false;
  if (!tuple(g.affine, 6)) return false;
  const a = g.affine as number[];
  if (!(Math.abs(a[0] * a[4] - a[1] * a[3]) > 0)) return false;
  // The server is the write boundary: 2 calibration points (2-point similarity, D-072) or
  // 1 point of the panel's single-point calibration (point + scale 1:N and rotation are in the affine);
  // otherwise the placement is not re-editable. The server used to reject single-point with 400 (#317).
  if (!Array.isArray(g.calibration) || g.calibration.length < 1 || g.calibration.length > 2) return false;
  for (const c of g.calibration as { pdf_pt?: unknown; ifc_m?: unknown }[]) {
    if (!c || typeof c !== "object" || !tuple(c.pdf_pt, 2) || !tuple(c.ifc_m, 2)) return false;
  }
  if (g.opacity !== undefined && !num(g.opacity)) return false;
  if (g.visible !== undefined && typeof g.visible !== "boolean") return false;
  if (g.discipline !== undefined && g.discipline !== null && typeof g.discipline !== "string") return false;
  if (g.calibrated_at !== undefined && g.calibrated_at !== null && typeof g.calibrated_at !== "string") return false;
  return true;
}

async function fetchUnderlayDrawingsImpl(projectId: string): Promise<UnderlayDrawingWire[]> {
  const supabase = getSupabaseAdmin();

  // Without pagination (fetchAllPages) intentionally: the cardinality is bounded -
  // there are a handful of storeys and ~12 floor plans of them (ASR v76), far below the PostgREST
  // cap of 1000. Reconsider for multi-project (D-033).
  // 1) storeys -> documents that carry them (D-104: after ASR v76 floor plans of all
  //    professions; the IFC link has role 'document', the old E3 had 'drawing').
  const { data: floors, error: fErr } = await supabase
    .from("objects")
    .select("id")
    .eq("project_id", projectId)
    .eq("object_type", "floor")
    .is("valid_until", null);
  if (fErr) throw new Error(fErr.message);
  const floorIds = (floors ?? []).map((f) => f.id as string);

  const { data: rels, error: rErr } = floorIds.length
    ? await supabase
        .from("rel_associates_document")
        .select("to_id")
        .eq("project_id", projectId)
        .in("from_id", floorIds)
        .is("valid_until", null)
        .not("to_id", "is", null)
    : { data: [] as { to_id: string }[], error: null };
  if (rErr) throw new Error(rErr.message);

  // 1b) documents with calibration without a storey (sections REZ-A, REZ-B, D-179): they carry `_georef`, but no link to a storey.
  const { data: calibrated, error: cErr } = await supabase
    .from("objects")
    .select("id")
    .eq("project_id", projectId)
    .eq("object_type", "document")
    .is("valid_until", null)
    .not("properties->_georef", "is", null);
  if (cErr) throw new Error(cErr.message);

  const docIds = [
    ...new Set([
      ...((rels ?? []) as { to_id: string }[]).map((r) => r.to_id),
      ...((calibrated ?? []) as { id: string }[]).map((r) => r.id),
    ]),
  ];
  if (docIds.length === 0) return [];

  // 2) meta + PDF URL + a possible _georef.
  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, name, properties").eq("project_id", projectId).in("id", docIds),
    supabase
      .from("documents")
      .select("id, location, storage_type")
      .in("id", docIds)
      .eq("storage_type", "supabase"),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);

  const floorDocIds = new Set(((rels ?? []) as { to_id: string }[]).map((r) => r.to_id));
  const objById = new Map((objsRes.data ?? []).map((o) => [o.id as string, o]));
  const out: UnderlayDrawingWire[] = [];
  for (const doc of docsRes.data ?? []) {
    const id = doc.id as string;
    const location = (doc.location as string | null) ?? null;
    const obj = objById.get(id);
    if (!location || !obj) continue; // without a public PDF there is nothing to underlay
    const raw = (obj.properties as Record<string, unknown> | null)?.["_georef"];
    const v2 = raw !== undefined ? toGeorefV2(raw) : null;
    const v1 = v2 ? primaryV1(v2) : null;
    const wireV2 = georefV2Wire(raw);
    // A document without calibration and without a link to a storey (only `_georef` without valid items) is not needed by the viewer.
    if (!wireV2 && !floorDocIds.has(id)) continue;
    out.push({
      documentId: id,
      name: (obj.name as string | null) ?? id,
      pdfUrl: location,
      ...(v1 ? { georef: v1 } : {}),
      // The history of overwrites (D-168) stays on the server, the viewer does not need it.
      ...(wireV2 ? { georefV2: wireV2 } : {}),
    });
  }
  return out;
}

/** Underlays for the 3D viewer (ISR, tag `aim` - revalidated after PATCH). */
export const fetchUnderlayDrawings = cachedProjectRead("fetch-underlay-drawings", fetchUnderlayDrawingsImpl);
