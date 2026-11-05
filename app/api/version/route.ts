import { NextResponse } from "next/server";

/**
 * Returns the SHA of the currently live Vercel deploy. `<VersionWatcher>` (client) remembers this
 * value on load and compares it periodically - when it changes, it knows
 * that a new build has arrived in the meantime, and offers a refresh (solves "stale UI after a deploy").
 *
 * `force-dynamic` + `no-store`: must not be cached, otherwise an open tab would keep getting
 * its own old SHA and would never catch the new version. Local/dev without
 * Vercel env returns "dev" -> the client never pops up falsely.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    "dev";

  return NextResponse.json(
    { sha },
    { headers: { "Cache-Control": "no-store" } }
  );
}
