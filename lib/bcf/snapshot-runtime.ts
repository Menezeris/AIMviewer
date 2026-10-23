import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import { isOwnStorageUrl, type SnapshotDocument, type SnapshotSource } from "./snapshot";

/**
 * Produkčné závislosti snímky výrezu (D-158 krok 3): dokument z DB, PDF z verejného
 * bucketu, keš v buckete `documents` (verejný, tam kde sú PDF, D-123) a render pdf.js.
 */

export const SNAPSHOT_BUCKET = "documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function document(id: string): Promise<SnapshotDocument | null> {
  if (!UUID_RE.test(id)) return null;
  const db = getSupabaseAdmin();
  const { data: obj, error } = await db
    .from("objects")
    .select("id")
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
 * PDF v pamäti inštancie (posledné dva súbory, 10 minút): BCF panel pýta snímky všetkých
 * pripomienok naraz a každá chýbajúca by inak stiahla celé PDF znova (egress Supabase).
 * Súbežné požiadavky na ten istý súbor zdieľajú jedno stiahnutie.
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
  // Blob, nie Buffer (vzor uploadCaptureObject); kľúč nesie sha256 súboru, obsah sa nemení.
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
    // Lenivo: pdf.js a canvas sa načítajú až pri prvom renderi (nie pri každej BCF požiadavke).
    render: async (pdf, page, region) => (await import("./snapshot-render")).renderPdfRegion(pdf, page, region),
  };
}
