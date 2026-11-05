import "server-only";

import { fetchCurrentRevision } from "../data/model-revisions";
import { getSupabaseAdmin } from "../supabase/server";

import { REGISTRY_VERSION } from "./quantity-methods";
import type { VerificationResultWrite } from "./types";
import {
  elementWire,
  referencedGuids,
  visibleCounts,
  VERIFY_CHECK_SPACES,
  VERIFY_HELP_HREF,
  type VerifyElementWire,
  type VerifyRow,
  type VerifyRunAllWire,
} from "./wire";
import { currentProjectId } from "../project/context";

/**
 * Overenie výmer pre viewer (D-185 UI): `latest` číta `v_verification_latest`, `run` a `run_all` počítajú motorom
 * (`ifc_measure verify=true` bez toolu) a beh uložia k revízii (`verification_runs` / `verification_results`).
 * Motor sa načíta lenivo (`lib/engine/run`), `latest` ho nepotrebuje.
 */

const IN_CHUNK = 100;

/** GUID -> `object_ref` výskytu. Ten istý GUID môže mať v `objects` aj riadok s object_ref = GUID (typ); berie sa kód výskytu. */
export async function lookupObjectRefs(guids: string[]): Promise<Map<string, string>> {
  const projectId = currentProjectId();
  const out = new Map<string, string>();
  if (guids.length === 0) return out;
  const db = getSupabaseAdmin();
  const best = new Map<string, { ref: string; rank: number }>();
  for (let i = 0; i < guids.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("objects")
      .select("ifc_guid, object_ref, object_type")
      .eq("project_id", projectId)
      .in("ifc_guid", guids.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(`objects: ${error.message}`);
    for (const o of (data ?? []) as Array<{ ifc_guid: string; object_ref: string | null; object_type: string }>) {
      // Riadok, ktorý má za kód len GUID, nie je kód pre človeka; výskyt má prednosť pred typom.
      if (!o.object_ref || o.object_ref === o.ifc_guid) continue;
      const rank = o.object_type === "asset_type" ? 1 : 0;
      const cur = best.get(o.ifc_guid);
      if (!cur || rank < cur.rank) best.set(o.ifc_guid, { ref: o.object_ref, rank });
    }
  }
  for (const [g, { ref }] of best) out.set(g, ref);
  return out;
}

/** Kódy prvkov sú pre bunky len doplnok: chyba DB ich vynechá, výsledok overenia ostane. */
async function refsOf(guids: string[]): Promise<Map<string, string>> {
  try {
    return await lookupObjectRefs(guids);
  } catch {
    return new Map();
  }
}

async function currentRevisionOf(model: string): Promise<number | null> {
  try {
    return await fetchCurrentRevision(currentProjectId(), model);
  } catch {
    return null;
  }
}

/** Posledný uložený beh prvku (aj zastaraný, `stale`); null = prvok nemá uložené overenie. */
export async function latestVerification(globalId: string): Promise<VerifyElementWire | null> {
  const projectId = currentProjectId();
  const { data, error } = await getSupabaseAdmin().from("v_verification_latest").select("*").eq("project_id", projectId).eq("global_id", globalId).limit(500);
  if (error) throw new Error(`v_verification_latest: ${error.message}`);
  const rows = (data ?? []) as VerifyRow[];
  if (rows.length === 0) return null;
  const [refs, current] = await Promise.all([refsOf(referencedGuids(rows)), currentRevisionOf(rows[0].model)]);
  return elementWire(rows, { currentRevision: current, refs, helpHref: VERIFY_HELP_HREF });
}

type Saved = Record<string, unknown> & { ok?: boolean };

function rowsAsLatest(rows: VerificationResultWrite[], checkedAt: string, engine: string): VerifyRow[] {
  return rows.map((r) => ({ ...r, registry_version: REGISTRY_VERSION, checked_at: checkedAt, engine, stale: false }));
}

async function engine() {
  const [{ engineDeps }, run, tools] = await Promise.all([import("../engine/run"), import("../engine/space-verify-run"), import("../engine/tools")]);
  return { deps: engineDeps(), run, ENGINE_VERSION: tools.ENGINE_VERSION };
}

/** Overí jeden prvok teraz; s `save` beh uloží k revízii modelu (ďalší `latest` ho už len načíta). */
export async function runVerification(globalId: string, opts: { save: boolean; author?: string | null }): Promise<{ data: VerifyElementWire; saved: Saved }> {
  const { deps, run, ENGINE_VERSION } = await engine();
  const { verified, stamp, used } = await run.verifySpacesByGuid([globalId], deps);
  const rows = verified.flatMap((v) => run.resultRows(v, stamp[v.model.id] ?? null));
  const all = verified.flatMap((v) => v.results);
  const saved: Saved = opts.save
    ? await run.saveVerification(deps, rows, stamp, used, run.statusCounts(all), opts.author ?? null)
    : { ok: false, error: "ukladanie overenia z viewera je vypnuté (VERIFY_WRITE_ENABLED)" };
  const latest = rowsAsLatest(rows, new Date().toISOString(), ENGINE_VERSION);
  const [refs, current] = await Promise.all([refsOf(referencedGuids(latest)), currentRevisionOf(used[0])]);
  const wire = elementWire(latest, { currentRevision: current, refs, helpHref: VERIFY_HELP_HREF });
  if (!wire) throw new Error("overenie nevrátilo žiadny výsledok");
  return { data: wire, saved };
}

/** Overí naraz všetky IfcSpace modelov federácie jedným behom a uloží ho; vráti súhrn pre toast viewera. */
export async function runAllVerification(opts: { save: boolean; author?: string | null }): Promise<{ data: VerifyRunAllWire; saved: Saved }> {
  const { deps, run, ENGINE_VERSION } = await engine();
  const { verified, stamp, used } = await run.verifySpacesByGuid(null, deps);
  const rows = verified.flatMap((v) => run.resultRows(v, stamp[v.model.id] ?? null));
  const all = verified.flatMap((v) => v.results);
  const saved: Saved = opts.save
    ? await run.saveVerification(deps, rows, stamp, used, run.statusCounts(all), opts.author ?? null)
    : { ok: false, error: "ukladanie overenia z viewera je vypnuté (VERIFY_WRITE_ENABLED)" };
  const now = new Date().toISOString();
  const elements = verified
    .map((v) => elementWire(rowsAsLatest(run.resultRows(v, stamp[v.model.id] ?? null), now, ENGINE_VERSION), { currentRevision: null }))
    .filter((e): e is VerifyElementWire => e !== null);
  const single = used.length === 1 ? used[0] : undefined;
  return {
    data: {
      check: VERIFY_CHECK_SPACES,
      ...(single ? { model: single } : {}),
      ...(single && typeof stamp[single] === "number" ? { revision: stamp[single] } : {}),
      elements: verified.length,
      counts: visibleCounts(elements),
    },
    saved,
  };
}
