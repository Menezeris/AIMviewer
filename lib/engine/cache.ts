import { gunzipSync } from "node:zlib";

import type { IfcDataStore } from "@ifc-lite/parser";

import { parseIfcBytes } from "./loader";

/**
 * Cache of parsed models in the memory of a function instance (D-084).
 *
 * Key = model identity, the container (`information_containers.id`, D-189); the model code (ASR) is only a
 * label unique within a project. An entry is valid for a specific URL and ETag. The file is re-checked by a HEAD request at most once per `REVALIDATE_MS`
 * (the same window as ISR, D-030) and on an ETag change it is loaded anew. Concurrent
 * requests for the same model wait for a single load (single-flight).
 * `unstable_cache` cannot be used - the parsed store has hundreds of MB and is not
 * serializable.
 *
 * D-135: bytes are downloaded from the immutable archive of the current revision (`archive/<MODEL>/
 * vNNN.ifc.gz`, about 5 times smaller) if the resolver knows it; the ETag for change checking is
 * still from HEAD of the original URL. Without a resolver or on an archive error the
 * original URL is downloaded as before.
 */

export interface EngineModelSource {
  /** Model code within the project (ASR); the tools speak codes. */
  id: string;
  label: string;
  url: string;
  /** Container id = the model's identity (D-189); the cache key. Missing only for env overrides. */
  containerId?: string;
  /** Current revision from the DB (D-086), when known. */
  revision?: number;
}

/** Cache key of a model: its container, else (env override, tests) its code. */
export function engineKey(src: EngineModelSource): string {
  return src.containerId ?? src.id;
}

export interface CachedStore {
  /** Cache key (`engineKey`: container id, D-189). */
  key: string;
  id: string;
  url: string;
  etag: string | null;
  size: number;
  /** Revision of the archive the model was loaded from (D-183, input signature); null = original URL. */
  revision: number | null;
  store: IfcDataStore;
  loadedAt: number;
  loadMs: number;
  checkedAt: number;
}

export interface GetStoreResult {
  entry: CachedStore;
  /** true = the model was downloaded and parsed in this call. */
  cold: boolean;
}

const REVALIDATE_MS = 60_000;

const entries = new Map<string, CachedStore>();
const inflight = new Map<string, Promise<CachedStore>>();

/** URL of the archive of the current model revision (D-135) or null when the revision is not known. */
export type ArchiveResolver = (src: EngineModelSource) => Promise<string | null>;

let defaultArchive: ArchiveResolver | null = null;

/** The server (`run.ts`) registers a resolver over `model_revisions`; tests and scripts without it. */
export function setArchiveResolver(resolver: ArchiveResolver | null): void {
  defaultArchive = resolver;
}

interface Deps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  archive?: ArchiveResolver | null;
}

async function head(url: string, fetchImpl: typeof fetch): Promise<{ etag: string | null; size: number | null }> {
  const res = await fetchImpl(url, { method: "HEAD", cache: "no-store" });
  if (!res.ok) throw new Error(`HEAD ${url} → ${res.status}`);
  const len = res.headers.get("content-length");
  return { etag: res.headers.get("etag"), size: len ? Number(len) : null };
}

/** Ceiling of the unpacked model: a damaged or forged archive does not flood the function memory. */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

/** Revision number from the archive URL (`archive/<MODEL>/vNNN.ifc.gz`); null = another shape. */
export function archiveRevision(url: string): number | null {
  const m = /\/v(\d+)\.ifc\.gz$/i.exec(url.split(/[?#]/)[0]);
  return m ? Number(m[1]) : null;
}

/** Bytes from the revision archive (gzip) with the ETag of the original URL; null = do not use the archive. */
async function fromArchive(
  src: EngineModelSource,
  fetchImpl: typeof fetch,
  archive: ArchiveResolver,
): Promise<{ bytes: Uint8Array; etag: string | null; revision: number | null } | null> {
  try {
    // HEAD before the revision from the DB: publishing writes the DB before the current key, so an old ETag
    // with a new revision means at most one extra load, never a new ETag with an old revision.
    const h = await head(src.url, fetchImpl);
    const url = await archive(src);
    if (!url) return null;
    const res = await fetchImpl(url, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = gunzipSync(new Uint8Array(await res.arrayBuffer()), { maxOutputLength: MAX_UNPACKED_BYTES });
    return { bytes, etag: h.etag, revision: archiveRevision(url) };
  } catch {
    return null;
  }
}

async function load(src: EngineModelSource, fetchImpl: typeof fetch, now: () => number, archive: ArchiveResolver | null): Promise<CachedStore> {
  const started = now();
  // The source already points at a revision archive (D-135 viewer URL from the DB, D-189).
  let got = archiveRevision(src.url) !== null ? await fromArchive(src, fetchImpl, async () => src.url) : null;
  if (!got && archive && archiveRevision(src.url) === null) got = await fromArchive(src, fetchImpl, archive);
  if (!got) {
    const res = await fetchImpl(src.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Model ${src.id} sa nepodarilo stiahnuť (${res.status})`);
    got = { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get("etag"), revision: null };
  }
  const { bytes, etag, revision } = got;
  const store = await parseIfcBytes(bytes, `${src.id}.ifc`);
  const t = now();
  return {
    key: engineKey(src),
    id: src.id,
    url: src.url,
    etag,
    size: bytes.byteLength,
    revision,
    store,
    loadedAt: t,
    loadMs: t - started,
    checkedAt: t,
  };
}

/** Returns the parsed store of a model - from the cache, or downloads and parses it. */
export async function getStore(src: EngineModelSource, deps: Deps = {}): Promise<GetStoreResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  const key = engineKey(src);
  const cached = entries.get(key);
  if (cached && cached.url === src.url) {
    if (now() - cached.checkedAt < REVALIDATE_MS) return { entry: cached, cold: false };
    const h = await head(src.url, fetchImpl).catch(() => null);
    // Unavailable HEAD = rather the old model than an error; an unchanged ETag = valid.
    if (!h || (h.etag !== null && h.etag === cached.etag)) {
      cached.checkedAt = now();
      return { entry: cached, cold: false };
    }
  }

  const pending = inflight.get(key);
  if (pending) return { entry: await pending, cold: true };

  const archive = deps.archive === undefined ? defaultArchive : deps.archive;
  const p = load(src, fetchImpl, now, archive)
    .then((entry) => {
      entries.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return { entry: await p, cold: true };
}

/** Info about the loaded model in engine results: ETag, size, time and archive revision when known (D-183). */
export function engineRevision(entry: CachedStore): { etag: string | null; size: number; loaded_at: string; revision?: number } {
  return {
    etag: entry.etag,
    size: entry.size,
    loaded_at: new Date(entry.loadedAt).toISOString(),
    ...(entry.revision !== null ? { revision: entry.revision } : {}),
  };
}

/** Cache state for diagnostics (ifc_models / ifc_engine_probe). */
export function cacheSnapshot(): Array<Omit<CachedStore, "store">> {
  return [...entries.values()].map((e) => ({
    key: e.key,
    id: e.id,
    url: e.url,
    etag: e.etag,
    size: e.size,
    revision: e.revision,
    loadedAt: e.loadedAt,
    loadMs: e.loadMs,
    checkedAt: e.checkedAt,
  }));
}

/** Tests only. */
export function clearEngineCache(): void {
  entries.clear();
  inflight.clear();
}
