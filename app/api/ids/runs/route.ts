import { NextResponse } from "next/server";

import { lookupGuids } from "@/lib/engine/aim-lookup";
import { LibraryInputError, parseRunSpecs, saveViewerRun } from "@/lib/ids/library";
import { supabaseIdsLibraryStore } from "@/lib/ids/library-store";
import { idsWriteGuard, jsonFail, NO_STORE, readJson } from "@/lib/ids/route-guard";
import { supabaseIdsStore } from "@/lib/ids/store";
import { withRequestProject } from "@/lib/project/request";
import { currentProjectId } from "@/lib/live/caller";

/**
 * Uloženie výsledku kontroly IDS z viewera (D-182, Samuel 2. 11.: kontrola beží raz, vo vieweri; server ju
 * neopakuje). `POST {code, version, ids_sha256, model, revision, engine_version, author, specs}`:
 * `specs` = výsledky po špecifikáciách v tvare reportu `@ifc-lite/ids`. Uloží sa `ids_runs` + `ids_results`
 * (`trigger = viewer`, `engine = ifc-lite`) s pečiatkou revízie modelu, ktorú viewer načítal, verzie IDS a verzie
 * nástroja; pri novej revízii alebo verzii IDS je výsledok `stale` / `ids_stale` (nikdy sa neprepisuje).
 * Uloží sa len neupravená verzia IDS z AIM (sha256 musí sedieť) a len so známou revíziou modelu.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Telo pod limitom požiadavky Vercelu (4,5 MB). */
const MAX_BODY_CHARS = 4_000_000;

async function postHandler(req: Request) {
  const denied = idsWriteGuard(req);
  if (denied) return denied;
  const read = await readJson(req, MAX_BODY_CHARS);
  if (!read.ok) {
    return read.res.status === 413
      ? jsonFail("Výsledok kontroly je priveľký na uloženie z viewera; ulož ho v chate (ifc_ids_validate save=true).", 413)
      : read.res;
  }
  const b = (read.body && typeof read.body === "object" ? read.body : {}) as Record<string, unknown>;
  const specs = parseRunSpecs(b.specs);
  if (typeof b.code !== "string" || typeof b.version !== "number" || typeof b.ids_sha256 !== "string" || typeof b.model !== "string" || !specs) {
    return jsonFail("code, version, ids_sha256, model a specs sú povinné", 400);
  }
  try {
    const out = await saveViewerRun(
      { store: supabaseIdsStore(currentProjectId()), lib: supabaseIdsLibraryStore(currentProjectId()), lookup: lookupGuids },
      {
        code: b.code,
        version: b.version,
        ids_sha256: b.ids_sha256,
        model: b.model,
        revision: typeof b.revision === "number" ? b.revision : null,
        engine_version: typeof b.engine_version === "string" ? b.engine_version : "",
        author: b.author as string,
        specs,
      },
    );
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof LibraryInputError) return jsonFail(err.message, 400);
    return jsonFail(err instanceof Error ? err.message : "uloženie výsledku zlyhalo", 500);
  }
}

export const POST = withRequestProject(postHandler);
