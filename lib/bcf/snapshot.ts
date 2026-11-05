import { createHash } from "node:crypto";

import { markupHash, type Markup } from "./markup";
import { snapshotKey, type PctRect } from "./snapshot-plan";

/**
 * Snapshot of a document region for a BCF topic (D-158 step 3): on-demand rendering and a cache in the
 * `documents` bucket under `snapshots/<sha256>/<page>-<region>.png`. The first request downloads the PDF and
 * renders only the given page and crop, later ones read the cache (without downloading the PDF when sha256 is
 * known from the ETL or from the topic reference). Rasters of all pages are not made in advance (egress, storage).
 * Dependencies (DB, storage, render) are behind an interface, the logic is tested without them.
 */

export interface SnapshotDocument {
  id: string;
  /** Public address of the PDF (`documents.location`). */
  location: string | null;
  /** `documents.file_sha256` from the ETL; null = not computed yet. */
  sha256: string | null;
}

export interface SnapshotSource {
  document(id: string): Promise<SnapshotDocument | null>;
  fetchPdf(location: string): Promise<Uint8Array>;
  cacheGet(key: string): Promise<Buffer | null>;
  cachePut(key: string, png: Buffer): Promise<void>;
  render(pdf: Uint8Array, page: number, region: PctRect | null, markup?: Markup[]): Promise<{ png: Buffer }>;
}

export interface SnapshotRequest {
  document_id: string;
  page: number;
  region: PctRect | null;
  /** Revision from the topic reference (`document_sha256`); without it the current file. */
  sha256?: string | null;
  /** Markups over the page (D-158 step 7): stored from the column or unstored from the parameter; without them the snapshot as before. */
  markup?: Markup[] | null;
}

export interface SnapshotResult {
  png: Buffer;
  key: string;
  cached: boolean;
  sha256: string;
  /** The topic reference belonged to another revision and its snapshot is not in the cache: the snapshot is from the current file. */
  revision_changed: boolean;
}

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const SHA_RE = /^[0-9a-f]{64}$/;

/** The PDF is downloaded only from the public storage of this project (no other address from the DB). */
export function isOwnStorageUrl(location: string, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const u = new URL(location);
    const base = new URL(supabaseUrl);
    return u.protocol === "https:" && u.origin === base.origin && u.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}

export async function documentSnapshot(src: SnapshotSource, req: SnapshotRequest): Promise<SnapshotResult> {
  const doc = await src.document(req.document_id);
  if (!doc) throw new SnapshotError(`Dokument ${req.document_id} v AIM nie je.`, 404);
  if (!doc.location) throw new SnapshotError("Dokument nemá PDF súbor.", 404);
  const mh = markupHash(req.markup);
  const marks = mh && req.markup ? req.markup : undefined;
  const wanted = [req.sha256, doc.sha256].filter((s): s is string => typeof s === "string" && SHA_RE.test(s));
  for (const sha of [...new Set(wanted)]) {
    const key = snapshotKey(sha, req.page, req.region, mh);
    const hit = await src.cacheGet(key).catch(() => null);
    if (hit) return { png: hit, key, cached: true, sha256: sha, revision_changed: Boolean(req.sha256 && sha !== req.sha256) };
  }
  const pdf = await src.fetchPdf(doc.location);
  const sha = sha256Hex(pdf);
  const key = snapshotKey(sha, req.page, req.region, mh);
  const { png } = await src.render(pdf, req.page, req.region, marks);
  // The cache is a convenience: a failed write must not fail a snapshot that is done.
  await src.cachePut(key, png).catch(() => undefined);
  return { png, key, cached: false, sha256: sha, revision_changed: Boolean(req.sha256 && req.sha256 !== sha) };
}
