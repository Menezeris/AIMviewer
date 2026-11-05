import { NextResponse } from "next/server";

import { GUID_RE, jsonFail, NO_STORE, verifyGuard } from "@/lib/verify/route-guard";
import { latestVerification } from "@/lib/verify/service";
import { withRequestProject } from "@/lib/project/request";

/**
 * Latest saved quantity verification of an element for the viewer (D-185 UI, `VERIFY_REQUEST latest`): `GET ?global_id=` ->
 * `{data: VerifyElementWire | null}` from `v_verification_latest` (per quantity and recipe family the highest registry, the main
 * recipe first, quantities without a value in the file omitted, `stale` and `current_revision` from the model). Read-only.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function getHandler(req: Request) {
  const denied = verifyGuard(req);
  if (denied) return denied;
  const guid = new URL(req.url).searchParams.get("global_id") ?? "";
  if (!GUID_RE.test(guid)) return jsonFail("global_id musí byť IFC GlobalId", 400);
  try {
    return NextResponse.json({ data: await latestVerification(guid) }, { headers: NO_STORE });
  } catch (err) {
    return jsonFail(err instanceof Error ? err.message : "načítanie overenia zlyhalo", 500);
  }
}

export const GET = withRequestProject(getHandler);
