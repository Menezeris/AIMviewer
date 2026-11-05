import { NextResponse } from "next/server";

import { IdsEngineError } from "@/lib/ids/engine";
import { idsWriteGuard, jsonFail, NO_STORE, readJson } from "@/lib/ids/route-guard";
import { supabaseIdsStore } from "@/lib/ids/store";
import { conflictDiff, IdsInputError, saveFromViewer, type IdsToolDeps } from "@/lib/ids/tools";
import { IdsConflictError } from "@/lib/ids/types";
import { MAX_IDS_XML, parseIdsSave } from "@/lib/viewer-ids";
import { withRequestProject } from "@/lib/project/request";
import { currentProjectId } from "@/lib/live/caller";

/**
 * IDS z AIM pre viewer (D-162, #285).
 *
 * - `GET` without the gate (read-only, like BCF API): without parameters a list of IDS, `?code=<code>[&version=<n>]` the latest or
 *   the given version with XML (the host client builds `IDS_LOAD` from it), with `&format=ids` the XML as a downloadable file.
 * - `POST {xml, code?, base_version?, title?}` saves an IDS from the viewer panel (`IDS_SAVE`) as a new version with
 *   `source='viewer'`. Without `code` a new working IDS is created, the library snapshot is not overwritten (saved as a copy).
 *   A conflict (`base_version` is not the latest) is 409 with `latest_version` and a `diff` of changes in AIM.
 *
 * Protection as for views and underlays (D-161, D-072): the viewer is public read-only, so writing is behind the env
 * gate, OFF by default (`IDS_WRITE_ENABLED=true` turns it on), plus origin guard and per-IP rate limit
 * (D-068). Without login anyone who opens the viewer can save an IDS; an honest conscious limit until auth arrives.
 */

export const dynamic = "force-dynamic";
/** Audit and XML reading go through the `@ifc-lite/mcp` engine (session without models). */
export const maxDuration = 60;

const MAX_BODY_CHARS = MAX_IDS_XML + 10_000;

const fail = jsonFail;

async function getHandler(req: Request) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  try {
    const store = supabaseIdsStore(currentProjectId());
    if (!code) {
      const docs = await store.listDocuments();
      const latest = await store.latestVersions(docs.map((d) => d.id));
      return NextResponse.json(
        { items: docs.map((d) => ({ code: d.code, title: d.title, origin: d.origin, status: d.status, version: latest.get(d.id)?.version ?? null, updated_at: d.updated_at })) },
        { headers: NO_STORE },
      );
    }
    const doc = await store.byCode(code);
    if (!doc) return fail(`IDS '${code}' neexistuje`, 404);
    const raw = params.get("version");
    const version = raw === null ? undefined : Number(raw);
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) return fail("version: celé číslo od 1", 400);
    const row = await store.version(doc.id, version);
    if (!row) return fail(`IDS '${code}' nemá ${version === undefined ? "žiadnu verziu" : `verziu ${version}`}`, 404);
    if (params.get("format") === "ids") {
      return new NextResponse(row.xml, {
        headers: {
          ...NO_STORE,
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${doc.code}-v${row.version}.ids"`,
        },
      });
    }
    return NextResponse.json(
      {
        code: doc.code,
        title: doc.title,
        origin: doc.origin,
        version: row.version,
        sha256: row.sha256,
        ...(row.library_commit ? { library_commit: row.library_commit } : {}),
        xml: row.xml,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : "čítanie IDS zlyhalo", 500);
  }
}

async function postHandler(req: Request) {
  const denied = idsWriteGuard(req);
  if (denied) return denied;
  const read = await readJson(req, MAX_BODY_CHARS);
  if (!read.ok) return read.res;
  const save = parseIdsSave(read.body);
  if (!save) return fail("invalid IDS payload", 400);
  const deps: IdsToolDeps = { store: supabaseIdsStore(currentProjectId()) };
  try {
    const out = await saveFromViewer(deps, {
      xml: save.xml,
      ...(save.code ? { code: save.code } : {}),
      ...(save.base_version ? { base_version: save.base_version } : {}),
      ...(save.title ? { title: save.title } : {}),
    });
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof IdsConflictError) {
      const diff = save.code ? await conflictDiff(deps, save.code, err.base, err.latest).catch(() => null) : null;
      return fail(err.message, 409, { latest_version: err.latest, ...(diff ? { diff } : {}) });
    }
    if (err instanceof IdsEngineError) return fail(err.message, 400, { ...(err.code ? { code: err.code } : {}) });
    if (err instanceof IdsInputError) return fail(err.message, 400);
    return fail(err instanceof Error ? err.message : "uloženie IDS zlyhalo", 500);
  }
}

export const GET = withRequestProject(getHandler);
export const POST = withRequestProject(postHandler);
