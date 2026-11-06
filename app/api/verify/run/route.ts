import { NextResponse } from "next/server";

import { GUID_RE, jsonFail, NO_STORE, readBody, verifyEngineEnabled, verifyGuard, verifySaveEnabled } from "@/lib/verify/route-guard";
import { runVerification } from "@/lib/verify/service";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * Quantity verification of a single element now (D-185 UI, `VERIFY_REQUEST run`): `POST {global_id}` -> `{data: VerifyElementWire,
 * saved}`. The same as `ifc_measure verify=true` for one room; the run is saved with the current model revision
 * (`VERIFY_WRITE_ENABLED`), the next display only loads it. The viewer waits at most 180 s.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function postHandler(req: Request) {
  const denied = verifyGuard(req);
  if (denied) return denied;
  if (!verifyEngineEnabled()) return jsonFail("motor IFC je na tomto nasadení vypnutý (ENGINE_ENABLED), overiť sa nedá", 503);
  const b = await readBody(req);
  const guid = typeof b?.global_id === "string" ? b.global_id : "";
  if (!GUID_RE.test(guid)) return jsonFail("global_id musí byť IFC GlobalId", 400);
  try {
    const { data, saved } = await runVerification(guid, { save: verifySaveEnabled(), author: typeof b?.author === "string" ? b.author.slice(0, 200) : null });
    return NextResponse.json({ data, saved }, { headers: NO_STORE });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "overenie zlyhalo";
    return jsonFail(msg, err instanceof Error && err.name === "InputError" ? 400 : 500);
  }
}

export const POST = withRequestAuth(withRequestProject(postHandler), { source: "app:/api/verify/run", write: true });
