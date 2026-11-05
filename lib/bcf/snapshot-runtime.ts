import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import { isOwnStorageUrl, type SnapshotDocument, type SnapshotSource } from "./snapshot";
import { currentProjectId } from "../project/context";

/**
 * Production dependencies of the region snapshot (D-158 step 3): the document from the DB, the PDF from the public
 * bucket, the cache in the `documents` bucket (public, where the PDFs are, D-123) and the pdf.js render.
 */

export const SNAPSHOT_BUCKET = "documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function document(id: string): Promise<SnapshotDocument | null> {
  const projectId = currentProjectId();
  if (!UUID_RE.test(id)) return null;
  const db = getSupabaseAdmin();
  const { data: obj, error } = await db
    .from("objects")
    .select("id")
    .eq("project_id", projectId)
    .eq("id", id.toLowerCase())
    .eq("object_type", "document")
    .is("valid_until", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj) return null;
  const { data, error: e } = await db.from("documents").select("location, file_sha256").eq("id", obj.id).maybeSingle();
  if (e) throw new Error(e.message);
  return {
    id: obj.id as string,
    location: (data?.location as string | null) ?? null,
    sha256: (data?.file_sha256 as string | null) ?? null,
  };
}

/**
 * PDF in instance memory (the last two files, 10 minutes): the BCF panel asks for snapshots of all
 * comments at once and each missing one would otherwise download the whole PDF again (Supabase egress).
 * Concurrent requests for the same file share one download.
 */
const PDF_TTL_MS = 10 * 60_000;
const PDF_KEEP = 2;
const pdfMemo = new Map<string, { at: number; bytes: Promise<Uint8Array> }>();

async function download(location: string): Promise<Uint8Array> {
  if (!isOwnStorageUrl(location, process.env.SUPABASE_URL)) throw new Error("PDF dokumentu nie je v úložisku AIM.");
  const { MAX_PDF_BYTES } = await import("./snapshot-render");
  const res = await fetch(location, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`PDF sa nedalo stiahnuť (HTTP ${res.status}).`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_PDF_BYTES) throw new Error("PDF je príliš veľké na snímku.");
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchPdf(location: string): Promise<Uint8Array> {
  const now = Date.now();
  for (const [k, v] of pdfMemo) if (now - v.at > PDF_TTL_MS) pdfMemo.delete(k);
  let hit = pdfMemo.get(location);
  if (!hit) {
    hit = { at: now, bytes: download(location) };
    pdfMemo.set(location, hit);
    hit.bytes.catch(() => pdfMemo.delete(location));
    while (pdfMemo.size > PDF_KEEP) pdfMemo.delete(pdfMemo.keys().next().value as string);
  }
  return hit.bytes;
}

async function cacheGet(key: string): Promise<Buffer | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(SNAPSHOT_BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function cachePut(key: string, png: Buffer): Promise<void> {
  // A Blob, not a Buffer (pattern of uploadCaptureObject); the key carries the file sha256, the content does not change.
  const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
  const { error } = await getSupabaseAdmin()
    .storage.from(SNAPSHOT_BUCKET)
    .upload(key, blob, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
}

export function defaultSnapshotSource(): SnapshotSource {
  return {
    document,
    fetchPdf,
    cacheGet,
    cachePut,
    // Lazily: pdf.js and canvas load only on the first render (not on every BCF request).
    render: async (pdf, page, region, markup) => (await import("./snapshot-render")).renderPdfRegion(pdf, page, region, markup),
  };
}
