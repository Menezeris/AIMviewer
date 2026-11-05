import { NextRequest, NextResponse } from "next/server";

import { fetchSpaceSiblings } from "@/lib/data/filter";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ objectId: string }> }
) {
  const { objectId } = await params;

  // Validácia ako /api/element — bez nej ide nevalidný vstup až do Postgresu
  // (uuid cast error) a interná hláška by unikla do odpovede.
  if (!UUID_RE.test(objectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const result = await fetchSpaceSiblings(objectId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    // Interné DB hlášky nepatria klientovi — logni a vráť generickú chybu.
    console.error(`[api/space-siblings/${objectId}]`, err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
