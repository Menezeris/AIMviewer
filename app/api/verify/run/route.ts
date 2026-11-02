import { NextResponse } from "next/server";

import { GUID_RE, jsonFail, NO_STORE, readBody, verifyEngineEnabled, verifyGuard, verifySaveEnabled } from "@/lib/verify/route-guard";
import { runVerification } from "@/lib/verify/service";

/**
 * Overenie výmer jedného prvku teraz (D-185 UI, `VERIFY_REQUEST run`): `POST {global_id}` -> `{data: VerifyElementWire,
 * saved}`. To isté ako `ifc_measure verify=true` pre jednu miestnosť; beh sa uloží k aktuálnej revízii modelu
 * (`VERIFY_WRITE_ENABLED`), ďalšie zobrazenie ho už len načíta. Viewer čaká najviac 180 s.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
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
