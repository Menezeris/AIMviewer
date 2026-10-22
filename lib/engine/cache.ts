import { gunzipSync } from "node:zlib";

import type { IfcDataStore } from "@ifc-lite/parser";

import { parseIfcBytes } from "./loader";

/**
 * Cache parsovaných modelov v pamäti inštancie funkcie (D-084).
 *
 * Kľúč = id modelu federácie (ASR, VZT...); položka platí pre konkrétnu URL a
 * ETag. Súbor sa znova overí HEAD requestom najviac raz za `REVALIDATE_MS`
 * (rovnaké okno ako ISR, D-030) a pri zmene ETagu sa načíta nanovo. Súbežné
 * požiadavky na ten istý model čakajú na jedno načítanie (single-flight).
 * `unstable_cache` sa nedá použiť - parsovaný store má stovky MB a nie je
 * serializovateľný.
 *
 * D-135: bajty sa sťahujú z nemenného archívu aktuálnej revízie (`archive/<MODEL>/
 * vNNN.ifc.gz`, cca 5-krát menší), ak ho resolver pozná; ETag na kontrolu zmeny je
 * stále z HEAD pôvodnej URL. Bez resolvera alebo pri chybe archívu sa stiahne
 * pôvodná URL ako doteraz.
 */

export interface EngineModelSource {
  id: string;
  label: string;
  url: string;
}

export interface CachedStore {
  id: string;
  url: string;
  etag: string | null;
  size: number;
  store: IfcDataStore;
  loadedAt: number;
  loadMs: number;
  checkedAt: number;
}

export interface GetStoreResult {
  entry: CachedStore;
  /** true = model sa v tomto volaní sťahoval a parsoval. */
  cold: boolean;
}

const REVALIDATE_MS = 60_000;

const entries = new Map<string, CachedStore>();
const inflight = new Map<string, Promise<CachedStore>>();

/** URL archívu aktuálnej revízie modelu (D-135) alebo null, keď revíziu nepoznáme. */
export type ArchiveResolver = (src: EngineModelSource) => Promise<string | null>;

let defaultArchive: ArchiveResolver | null = null;

/** Server (`run.ts`) zaregistruje resolver nad `model_revisions`; testy a skripty bez neho. */
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

/** Strop rozbaleného modelu: poškodený alebo podvrhnutý archív nezahltí pamäť funkcie. */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

/** Bajty z archívu revízie (gzip) s ETagom pôvodnej URL; null = archív nepoužiť. */
async function fromArchive(
  src: EngineModelSource,
  fetchImpl: typeof fetch,
  archive: ArchiveResolver,
): Promise<{ bytes: Uint8Array; etag: string | null } | null> {
  try {
    // HEAD pred revíziou z DB: publikácia zapíše DB skôr než aktuálny kľúč, takže starý ETag
    // s novou revíziou znamená najviac jedno načítanie navyše, nikdy nový ETag so starou revíziou.
    const h = await head(src.url, fetchImpl);
    const url = await archive(src);
    if (!url) return null;
    const res = await fetchImpl(url, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = gunzipSync(new Uint8Array(await res.arrayBuffer()), { maxOutputLength: MAX_UNPACKED_BYTES });
    return { bytes, etag: h.etag };
  } catch {
    return null;
  }
}

async function load(src: EngineModelSource, fetchImpl: typeof fetch, now: () => number, archive: ArchiveResolver | null): Promise<CachedStore> {
  const started = now();
  let got = archive ? await fromArchive(src, fetchImpl, archive) : null;
  if (!got) {
    const res = await fetchImpl(src.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Model ${src.id} sa nepodarilo stiahnuť (${res.status})`);
    got = { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get("etag") };
  }
  const { bytes, etag } = got;
  const store = await parseIfcBytes(bytes, `${src.id}.ifc`);
  const t = now();
  return {
    id: src.id,
    url: src.url,
    etag,
    size: bytes.byteLength,
    store,
    loadedAt: t,
    loadMs: t - started,
    checkedAt: t,
  };
}

/** Vráti parsovaný store modelu - z cache, alebo ho stiahne a naparsuje. */
export async function getStore(src: EngineModelSource, deps: Deps = {}): Promise<GetStoreResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  const cached = entries.get(src.id);
  if (cached && cached.url === src.url) {
    if (now() - cached.checkedAt < REVALIDATE_MS) return { entry: cached, cold: false };
    const h = await head(src.url, fetchImpl).catch(() => null);
    // Nedostupný HEAD = radšej starý model než chyba; ETag bez zmeny = platí.
    if (!h || (h.etag !== null && h.etag === cached.etag)) {
      cached.checkedAt = now();
      return { entry: cached, cold: false };
    }
  }

  const pending = inflight.get(src.id);
  if (pending) return { entry: await pending, cold: true };

  const archive = deps.archive === undefined ? defaultArchive : deps.archive;
  const p = load(src, fetchImpl, now, archive)
    .then((entry) => {
      entries.set(src.id, entry);
      return entry;
    })
    .finally(() => inflight.delete(src.id));
  inflight.set(src.id, p);
  return { entry: await p, cold: true };
}

/** Stav cache pre diagnostiku (ifc_models / ifc_engine_probe). */
export function cacheSnapshot(): Array<Omit<CachedStore, "store">> {
  return [...entries.values()].map((e) => ({
    id: e.id,
    url: e.url,
    etag: e.etag,
    size: e.size,
    loadedAt: e.loadedAt,
    loadMs: e.loadMs,
    checkedAt: e.checkedAt,
  }));
}

/** Len pre testy. */
export function clearEngineCache(): void {
  entries.clear();
  inflight.clear();
}
