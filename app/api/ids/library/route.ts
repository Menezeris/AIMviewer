import { NextResponse } from "next/server";

import {
  assignFromLibrary,
  libraryCatalog,
  LibraryInputError,
  LibrarySchemaMissingError,
  projectCatalog,
  type LibraryDeps,
} from "@/lib/ids/library";
import { supabaseIdsLibraryStore } from "@/lib/ids/library-store";
import { idsWriteGuard, jsonFail, NO_STORE, readJson } from "@/lib/ids/route-guard";
import { supabaseIdsStore } from "@/lib/ids/store";
import { withRequestProject } from "@/lib/project/request";
import { currentProjectId } from "@/lib/live/caller";

/**
 * Knižnica požiadaviek pre kartu "Requirements library" vo vieweri (D-182, #351; doplnok V30: katalóg z DB).
 *
 * - `GET` (len čítanie, bez brány ako `/api/ids`): `library` = IDS, ktoré do AIM zapísalo vydanie knižnice v DB
 *   (`ids_documents` `origin = library`, `status = active`, posledná verzia `source = import`, `library_repo =
 *   db:library/<kód>`, `library_commit = <vydanie>@<manifest sha256>`), stav = či má väzbu na model; `project` = IDS
 *   v AIM s históriou verzií, väzbami na modely a posledným výsledkom na model (`stale`, `ids_stale`).
 *   Repo knižnice ani GitHub token sa nečítajú.
 * - `POST {path, commit, sha256, author, model?}` = "Priradiť k projektu": väzba IDS na model federácie
 *   (`ids_document_models`, ako `POST /api/ids/models`); bez modelu odpoveď povie, kde sa väzba robí.
 *   Zápis je za `IDS_WRITE_ENABLED`, origin guardom a rate limitom (D-162).
 */

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 10_000;

const deps = (): LibraryDeps => ({ store: supabaseIdsStore(currentProjectId()), lib: supabaseIdsLibraryStore(currentProjectId()) });

async function getHandler() {
  const d = deps();
  try {
    const [library, project] = await Promise.all([
      (async () => {
        try {
          return { configured: true, ...(await libraryCatalog(d)) };
        } catch (err) {
          return { configured: true, error: err instanceof Error ? err.message : "knižnica sa nedala prečítať" };
        }
      })(),
      projectCatalog(d),
    ]);
    return NextResponse.json({ library, project }, { headers: NO_STORE });
  } catch (err) {
    return jsonFail(err instanceof Error ? err.message : "čítanie knižnice zlyhalo", 500);
  }
}

async function postHandler(req: Request) {
  const denied = idsWriteGuard(req);
  if (denied) return denied;
  const read = await readJson(req, MAX_BODY_CHARS);
  if (!read.ok) return read.res;
  const b = (read.body && typeof read.body === "object" ? read.body : {}) as Record<string, unknown>;
  if (typeof b.path !== "string" || typeof b.commit !== "string" || typeof b.sha256 !== "string") {
    return jsonFail("path, commit a sha256 z karty knižnice sú povinné", 400);
  }
  try {
    const out = await assignFromLibrary(deps(), {
      path: b.path,
      commit: b.commit,
      sha256: b.sha256,
      author: b.author as string,
      ...(typeof b.model === "string" ? { model: b.model } : {}),
    });
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof LibraryInputError) return jsonFail(err.message, 400);
    if (err instanceof LibrarySchemaMissingError) return jsonFail(err.message, 503);
    return jsonFail(err instanceof Error ? err.message : "priradenie zlyhalo", 500);
  }
}

export const GET = withRequestProject<[Request]>(getHandler);
export const POST = withRequestProject(postHandler);
