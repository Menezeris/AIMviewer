import { NextResponse } from "next/server";

import { LibraryInputError, LibrarySchemaMissingError, setModelBinding } from "@/lib/ids/library";
import { supabaseIdsLibraryStore } from "@/lib/ids/library-store";
import { idsWriteGuard, jsonFail, NO_STORE, readJson } from "@/lib/ids/route-guard";
import { supabaseIdsStore } from "@/lib/ids/store";

/**
 * Ručná väzba IDS na model federácie z karty "Requirements library" (D-182): `POST {code, model, bound, author,
 * library_container?}`. `bound=false` väzbu ukončí (`valid_until`, nič sa nemaže). Mnoho na mnoho, nič natvrdo.
 * Ochrana ako ostatné zápisy IDS z viewera (`IDS_WRITE_ENABLED`, origin guard, rate limit).
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
      { store: supabaseIdsStore(), lib: supabaseIdsLibraryStore() },
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
