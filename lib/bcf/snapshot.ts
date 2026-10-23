import { createHash } from "node:crypto";

import { snapshotKey, type PctRect } from "./snapshot-plan";

/**
 * Snímka výrezu dokumentu pre BCF tému (D-158 krok 3): render na požiadanie a keš v buckete
 * `documents` pod `snapshots/<sha256>/<strana>-<oblasť>.png`. Prvá požiadavka stiahne PDF a
 * vyrenderuje len danú stranu a výrez, ďalšie čítajú keš (bez sťahovania PDF, keď je sha256
 * známe z ETL alebo z odkazu témy). Rastre všetkých strán sa vopred nerobia (egress, úložisko).
 * Závislosti (DB, storage, render) sú za rozhraním, logika sa testuje bez nich.
 */

export interface SnapshotDocument {
  id: string;
  /** Verejná adresa PDF (`documents.location`). */
  location: string | null;
  /** `documents.file_sha256` z ETL; null = ešte nepočítané. */
  sha256: string | null;
}

export interface SnapshotSource {
  document(id: string): Promise<SnapshotDocument | null>;
  fetchPdf(location: string): Promise<Uint8Array>;
  cacheGet(key: string): Promise<Buffer | null>;
  cachePut(key: string, png: Buffer): Promise<void>;
  render(pdf: Uint8Array, page: number, region: PctRect | null): Promise<{ png: Buffer }>;
}

export interface SnapshotRequest {
  document_id: string;
  page: number;
  region: PctRect | null;
  /** Revízia z odkazu témy (`document_sha256`); bez nej aktuálny súbor. */
  sha256?: string | null;
}

export interface SnapshotResult {
  png: Buffer;
  key: string;
  cached: boolean;
  sha256: string;
  /** Odkaz témy patril inej revízii a jej snímka v keši nie je: snímka je z aktuálneho súboru. */
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

/** PDF sa sťahuje len z verejného úložiska tohto projektu (žiadna iná adresa z DB). */
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
  const wanted = [req.sha256, doc.sha256].filter((s): s is string => typeof s === "string" && SHA_RE.test(s));
  for (const sha of [...new Set(wanted)]) {
    const key = snapshotKey(sha, req.page, req.region);
    const hit = await src.cacheGet(key).catch(() => null);
    if (hit) return { png: hit, key, cached: true, sha256: sha, revision_changed: Boolean(req.sha256 && sha !== req.sha256) };
  }
  const pdf = await src.fetchPdf(doc.location);
  const sha = sha256Hex(pdf);
  const key = snapshotKey(sha, req.page, req.region);
  const { png } = await src.render(pdf, req.page, req.region);
  // Keš je pohodlie: zlyhaný zápis nemá zhodiť snímku, ktorá je hotová.
  await src.cachePut(key, png).catch(() => undefined);
  return { png, key, cached: false, sha256: sha, revision_changed: Boolean(req.sha256 && req.sha256 !== sha) };
}
