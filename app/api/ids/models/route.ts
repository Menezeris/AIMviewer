import { NextResponse } from "next/server";

import { LibraryInputError, LibrarySchemaMissingError, setModelBinding } from "@/lib/ids/library";
import { supabaseIdsLibraryStore } from "@/lib/ids/library-store";
import { idsWriteGuard, jsonFail, NO_STORE, readJson } from "@/lib/ids/route-guard";
import { supabaseIdsStore } from "@/lib/ids/store";
import { withRequestProject } from "@/lib/project/request";
import { currentProjectId } from "@/lib/live/caller";

/**
 * Manual link of an IDS to a federation model from the "Requirements library" card (D-182): `POST {code, model, bound, author,
 * library_container?}`. `bound=false` ends the link (`valid_until`, nothing is deleted). Many to many, nothing hardcoded.
 * Protection like the other IDS writes from the viewer (`IDS_WRITE_ENABLED`, origin guard, rate limit).
 */

export const dynamic = "force-dynamic";

async function postHandler(req: Request) {
  const denied = idsWriteGuard(req);
  if (denied) return denied;
  const read = await readJson(req, 5_000);
  if (!read.ok) return read.res;
  const b = (read.body && typeof read.body === "object" ? read.body : {}) as Record<string, unknown>;
  if (typeof b.code !== "string" || typeof b.model !== "string" || typeof b.bound !== "boolean") {
    return jsonFail("code, model a bound sú povinné", 400);
  }
  try {
    const out = await setModelBinding(
      { store: supabaseIdsStore(currentProjectId()), lib: supabaseIdsLibraryStore(currentProjectId()) },
      {
        code: b.code,
        model: b.model,
        bound: b.bound,
        author: b.author as string,
        ...(typeof b.library_container === "string" ? { library_container: b.library_container } : {}),
      },
    );
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof LibraryInputError) return jsonFail(err.message, 400);
    if (err instanceof LibrarySchemaMissingError) return jsonFail(err.message, 503);
    return jsonFail(err instanceof Error ? err.message : "väzba zlyhala", 500);
  }
}

export const POST = withRequestProject(postHandler);
