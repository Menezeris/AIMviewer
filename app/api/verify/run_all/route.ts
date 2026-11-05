import { NextResponse } from "next/server";

import { jsonFail, NO_STORE, readBody, verifyEngineEnabled, verifyGuard, verifySaveEnabled } from "@/lib/verify/route-guard";
import { runAllVerification } from "@/lib/verify/service";
import { VERIFY_CHECK_SPACES } from "@/lib/verify/wire";
import { withRequestProject } from "@/lib/project/request";

/**
 * Quantity verification of all IfcSpace of the federation models in one run (D-185 UI, ribbon AIM > Verification):
 * `POST {check: 'space_quantities'}` -> `{data: VerifyRunAllWire, saved}`; the run is saved with the revision (`VERIFY_WRITE_ENABLED`).
 * A concurrent second run in the same instance is rejected (the host bridge lets only one through from one tab). Function limit 300 s
 * (Vercel Hobby with fluid compute; Pro up to 800 s); ASR v79 (83 rooms) fits after loading the model, otherwise batching
 * via `run` per room (D-185 UI, proposal in the PR).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

async function postHandler(req: Request) {
  const denied = verifyGuard(req);
  if (denied) return denied;
  if (!verifyEngineEnabled()) return jsonFail("motor IFC je na tomto nasadení vypnutý (ENGINE_ENABLED), overiť sa nedá", 503);
  const b = await readBody(req);
  if (b?.check !== VERIFY_CHECK_SPACES) return jsonFail(`neznáma kontrola; podporovaná je '${VERIFY_CHECK_SPACES}'`, 400);
  if (running) return jsonFail("overenie už beží", 409);
  running = true;
  try {
    const { data, saved } = await runAllVerification({ save: verifySaveEnabled(), author: typeof b.author === "string" ? b.author.slice(0, 200) : null });
    return NextResponse.json({ data, saved }, { headers: NO_STORE });
  } catch (err) {
    return jsonFail(err instanceof Error ? err.message : "overenie zlyhalo", 500);
  } finally {
    running = false;
  }
}

export const POST = withRequestProject(postHandler);
