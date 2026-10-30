import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";
import { georefV2Wire, primaryV1, toGeorefV2, type GeorefV2 } from "@/lib/data/georef";

/**
 * Data-access vrstva pre in-app prehliadačku výkresov (D-042 fáza C). Číta zdrojové
 * PDF (`documents.location`, verejný Supabase Storage bucket) + klikateľné link
 * regióny z `objects.properties._drawing_links` (zapísané ETL fázou A, `pdf_link.py`).
 *
 * `_drawing_links` má snake_case kľúče (zapisuje ich Python); tu sa mapujú na camelCase.
 * Súradnice `bbox` sú v PDF bottom-left (y hore) — render ich preklápa na zdroji UI.
 */

/** Jeden klikateľný región vo výkrese (`_drawing_links`, D-042). */
export interface DrawingRegion {
  /** 1-based číslo strany. */
  page: number;
  /** PDF bottom-left [x0, y0, x1, y1] (body). */
  bbox: [number, number, number, number];
  /** Rozmer strany [šírka, výška] v bodoch — referenčná báza pre škálovanie. */
  pageSize: [number, number];
  /** Cieľový `objects.id` (asset / asset_type), príp. dokument pri `drawing` route. */
  targetId: string;
  /** Segment route cieľa: detail prvku (`node`/`type`) alebo iný výkres (`drawing`, D-043). */
  targetRoute: "node" | "type" | "drawing";
  /** Strana cieľového výkresu pre `drawing` route (skladby → strana vo Výpise, D-043). */
  targetPage?: number;
  /** Dôverová vrstva detekcie (D-041) / `skladba` = navigačný región skladby (D-043). */
  layer: "full" | "proximity" | "bare" | "skladba";
  /** Zobrazený SNIM kód, príp. skladbová značka (`S#`). */
  label: string;
}

/** Prvok vybraný kliknutím vo výkrese — vstup pre bočný info-panel (D-042 D). */
export interface SelectedElement {
  id: string;
  route: "node" | "type";
  label: string;
}

/** Výkres pre prehliadačku: verejné PDF URL + klikateľné regióny. */
export interface DrawingDoc {
  id: string;
  name: string | null;
  objectRef: string | null;
  /** Verejné PDF URL (`documents.location`). */
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

async function fetchDrawingImpl(id: string): Promise<DrawingDoc | null> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_ref, name, object_type, properties")
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
  if (!location) return null; // bez PDF nie je čo zobraziť

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

/** Cachované per id (ISR, D-029 perf). */
export const fetchDrawing = unstable_cache(
  fetchDrawingImpl,
  ["fetch-drawing"],
  AIM_CACHE
);

// ─── Georeferencované PDF podklady (D-072) ───────────────────────────────────

/**
 * Wire tvar jedného podkladu pre embed viewer (bridge `UNDERLAYS_LOAD`).
 * `georef` je v1 (`parsePlacement` v @ifc-lite/drawing-underlay ho validuje
 * sám): pôdorysná kalibrácia strany, ktorú dnešný fork vie zobraziť.
 * `georefV2` (D-133) nesie všetky kalibrácie dokumentu vrátane rezov
 * (`plane`); fork ho začne čítať s pohľadmi D-132.
 */
export interface UnderlayDrawingWire {
  documentId: string;
  name: string;
  pdfUrl: string;
  georef?: unknown;
  georefV2?: GeorefV2;
}

/**
 * Validácia zápisu `_georef` v1 (PATCH /api/underlay, D-072) — server nesmie
 * perzistovať ľubovoľný JSON z klienta. Zrkadlí `parsePlacement` z
 * @ifc-lite/drawing-underlay (vieweru), ale nezávisle: AIM appka balík
 * nekonzumuje a payload je untrusted vstup route handlera.
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
  // Server je hranica zápisu: 2 kalibračné body (2-bodová similarity, D-072) alebo
  // 1 bod jednobodovej kalibrácie panela (bod + mierka 1:N a natočenie sú v affine);
  // inak placement nie je re-editovateľný. Jednobodovú server predtým odmietal 400 (#317).
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

async function fetchUnderlayDrawingsImpl(): Promise<UnderlayDrawingWire[]> {
  const supabase = getSupabaseAdmin();

  // Bez stránkovania (fetchAllPages) zámerne: kardinalita je ohraničená —
  // podlaží je jednotky a ich pôdorysov ~12 (ASR v76), hlboko pod PostgREST
  // capom 1000. Pri multi-projekte (D-033) prehodnotiť.
  // 1) podlažia → dokumenty, ktoré nesú (D-104: po ASR v76 pôdorysy všetkých
  //    profesií; IFC väzba má role 'document', stará E3 mala 'drawing').
  const { data: floors, error: fErr } = await supabase
    .from("objects")
    .select("id")
    .eq("object_type", "floor")
    .is("valid_until", null);
  if (fErr) throw new Error(fErr.message);
  const floorIds = (floors ?? []).map((f) => f.id as string);

  const { data: rels, error: rErr } = floorIds.length
    ? await supabase.from("rel_associates_document").select("to_id").in("from_id", floorIds).is("valid_until", null)
    : { data: [] as { to_id: string }[], error: null };
  if (rErr) throw new Error(rErr.message);

  // 1b) dokumenty s kalibráciou bez podlažia (rezy REZ-A, REZ-B, D-179): nesú `_georef`, ale nie väzbu na podlažie.
  const { data: calibrated, error: cErr } = await supabase
    .from("objects")
    .select("id")
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

  // 2) meta + PDF URL + prípadný _georef.
  const [objsRes, docsRes] = await Promise.all([
    supabase.from("objects").select("id, name, properties").in("id", docIds),
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
    if (!location || !obj) continue; // bez verejného PDF nie je čo podložiť
    const raw = (obj.properties as Record<string, unknown> | null)?.["_georef"];
    const v2 = raw !== undefined ? toGeorefV2(raw) : null;
    const v1 = v2 ? primaryV1(v2) : null;
    const wireV2 = georefV2Wire(raw);
    // Dokument bez kalibrácie a bez väzby na podlažie (len `_georef` bez platných položiek) viewer nepotrebuje.
    if (!wireV2 && !floorDocIds.has(id)) continue;
    out.push({
      documentId: id,
      name: (obj.name as string | null) ?? id,
      pdfUrl: location,
      ...(v1 ? { georef: v1 } : {}),
      // História prepisov (D-168) zostáva na serveri, viewer ju nepotrebuje.
      ...(wireV2 ? { georefV2: wireV2 } : {}),
    });
  }
  return out;
}

/** Podklady pre 3D viewer (ISR, tag `aim` — po PATCH sa revaliduje). */
export const fetchUnderlayDrawings = unstable_cache(
  fetchUnderlayDrawingsImpl,
  ["fetch-underlay-drawings"],
  AIM_CACHE
);
