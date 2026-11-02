import { NextResponse } from "next/server";

import { IdsEngineError } from "@/lib/ids/engine";
import {
  assignFromLibrary,
  libraryCatalog,
  LibraryInputError,
  LibrarySchemaMissingError,
  projectCatalog,
  type LibraryDeps,
} from "@/lib/ids/library";
import { githubLibrarySource, libraryConfig, LibraryNotConfiguredError, LibrarySourceError, type LibrarySource } from "@/lib/ids/library-source";
import { supabaseIdsLibraryStore } from "@/lib/ids/library-store";
import { idsWriteGuard, jsonFail, NO_STORE, readJson } from "@/lib/ids/route-guard";
import { supabaseIdsStore } from "@/lib/ids/store";

/**
 * Knižnica požiadaviek pre kartu "Requirements library" vo vieweri (D-182, #351).
 *
 * - `GET` (len čítanie, bez brány ako `/api/ids`): `library` = hotové IDS z repa knižnice (priečinok `LIBRARY_IDS_DIR`
 *   na vetve `LIBRARY_REF`, token `LIBRARY_GITHUB_TOKEN` len na serveri) so stavom voči AIM; `project` = IDS v AIM s
 *   históriou verzií, väzbami na modely a posledným výsledkom na model (`stale`, `ids_stale`). Bez tokenu `library`
 *   povie, že knižnica nie je pripojená, a `project` ostane.
 * - `POST {path, commit, sha256, author, continue_code?, as_new?}` = "Priradiť k projektu": nemenná kópia IDS do
 *   `ids_documents` / `ids_document_versions` (`origin = library`, `source = import`, pôvod repo, cesta, commit, sha256,
 *   kto a kedy). Rovnaký obsah = nič; iný = nová verzia toho istého IDS. Kód súboru, ktorý v AIM nie je, kým iné
 *   knižničné IDS áno, vráti `choice_required` (nové IDS, alebo pokračovanie histórie premenovaného IDS).
 *   Zápis je za `IDS_WRITE_ENABLED`, origin guardom a rate limitom (D-162).
 */

export const dynamic = "force-dynamic";
/** Opis a audit IDS idú cez motor `@ifc-lite/mcp` (relácia bez modelov), GitHub API niekoľko volaní. */
export const maxDuration = 60;

const MAX_BODY_CHARS = 10_000;

/** Zdroj s cache blobov a stromov (podľa sha, nemenné) žije medzi požiadavkami jednej inštancie funkcie. */
let cached: { key: string; src: LibrarySource } | null = null;
function source(): LibrarySource {
  const cfg = libraryConfig();
  const key = `${cfg.repo}|${cfg.ref}|${cfg.dir}|${cfg.token ? "t" : ""}`;
  if (cached?.key !== key) cached = { key, src: githubLibrarySource(cfg) };
  return cached.src;
}

const deps = (): LibraryDeps => ({ store: supabaseIdsStore(), lib: supabaseIdsLibraryStore() });

function libraryError(err: unknown): { configured: boolean; error: string } {
  if (err instanceof LibraryNotConfiguredError) return { configured: false, error: err.message };
  return { configured: true, error: err instanceof Error ? err.message : "knižnica sa nedala prečítať" };
}

export async function GET() {
  const d = deps();
  try {
    const [library, project] = await Promise.all([
      (async () => {
        try {
          return { configured: true, ...(await libraryCatalog(source(), d)) };
        } catch (err) {
          return libraryError(err);
        }
      })(),
      projectCatalog(d),
    ]);
    return NextResponse.json({ library, project }, { headers: NO_STORE });
  } catch (err) {
    return jsonFail(err instanceof Error ? err.message : "čítanie knižnice zlyhalo", 500);
  }
}

export async function POST(req: Request) {
  const denied = idsWriteGuard(req);
  if (denied) return denied;
  const read = await readJson(req, MAX_BODY_CHARS);
  if (!read.ok) return read.res;
  const b = (read.body && typeof read.body === "object" ? read.body : {}) as Record<string, unknown>;
  if (typeof b.path !== "string" || typeof b.commit !== "string" || typeof b.sha256 !== "string") {
    return jsonFail("path, commit a sha256 z karty knižnice sú povinné", 400);
  }
  try {
    const out = await assignFromLibrary(source(), deps(), {
      path: b.path,
      commit: b.commit,
      sha256: b.sha256,
      author: b.author as string,
      ...(typeof b.continue_code === "string" ? { continue_code: b.continue_code } : {}),
      ...(b.as_new === true ? { as_new: true } : {}),
    });
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof LibraryNotConfiguredError) return jsonFail(err.message, 503);
    if (err instanceof LibraryInputError) return jsonFail(err.message, 400);
    if (err instanceof LibrarySchemaMissingError) return jsonFail(err.message, 503);
    if (err instanceof IdsEngineError) return jsonFail(err.message, 400, { ...(err.code ? { code: err.code } : {}) });
    if (err instanceof LibrarySourceError) return jsonFail(err.message, 502);
    return jsonFail(err instanceof Error ? err.message : "priradenie zlyhalo", 500);
  }
}
