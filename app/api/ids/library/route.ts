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
 * Requirements library for the "Requirements library" card in the viewer (D-182, #351; V30 addendum: catalog from the DB).
 *
 * - `GET` (read-only, without a gate like `/api/ids`): `library` = IDS that a library release in the DB wrote into AIM
 *   (`ids_documents` `origin = library`, `status = active`, latest version `source = import`, `library_repo =
 *   db:library/<code>`, `library_commit = <release>@<manifest sha256>`), status = whether it has a link to a model; `project` = IDS
 *   in AIM with version history, links to models and the latest result per model (`stale`, `ids_stale`).
 *   The library repo and the GitHub token are not read.
 * - `POST {path, commit, sha256, author, model?}` = "Assign to project": a link of the IDS to a federation model
 *   (`ids_document_models`, like `POST /api/ids/models`); without a model the response says where the link is made.
 *   Writing is behind `IDS_WRITE_ENABLED`, the origin guard and the rate limit (D-162).
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
