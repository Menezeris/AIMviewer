import { NextResponse } from "next/server";

import { fetchCaptureSummaryForObject } from "@/lib/data/captures";

/**
 * Súhrn Reality Capture pre objekt vybraný v 3D (D-073) — priestor + počet snímok.
 * Poháňa „Reality Capture (N)" akciu v AIM karte (`lib/aim-panel.ts`). Read-only.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const object = new URL(req.url).searchParams.get("object");
  if (!object || !UUID_RE.test(object)) {
    return NextResponse.json({ error: "invalid object id" }, { status: 400 });
  }
  try {
    const summary = await fetchCaptureSummaryForObject(object);
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[api/captures/summary]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
