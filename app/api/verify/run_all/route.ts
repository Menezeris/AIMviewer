import { NextResponse } from "next/server";

import { jsonFail, NO_STORE, readBody, verifyEngineEnabled, verifyGuard, verifySaveEnabled } from "@/lib/verify/route-guard";
import { runAllVerification } from "@/lib/verify/service";
import { VERIFY_CHECK_SPACES } from "@/lib/verify/wire";

/**
 * Overenie výmer všetkých IfcSpace modelov federácie jedným behom (D-185 UI, ribbon AIM > Overovanie):
 * `POST {check: 'space_quantities'}` -> `{data: VerifyRunAllWire, saved}`; beh sa uloží k revízii (`VERIFY_WRITE_ENABLED`).
 * Súbežný druhý beh v tej istej inštancii sa odmietne (most hosta pustí z jednej karty len jeden). Limit funkcie 300 s
 * (Vercel Hobby s fluid compute; Pro až 800 s); ASR v79 (83 miestností) sa po načítaní modelu zmestí, inak dávkovanie
 * cez `run` po miestnostiach (D-185 UI, návrh v PR).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

export async function POST(req: Request) {
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
