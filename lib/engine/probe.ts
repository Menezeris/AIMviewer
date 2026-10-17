import { randomUUID } from "node:crypto";

import { getIfcModels } from "@/lib/data/ifc-models";

import { cacheSnapshot, getStore } from "./cache";
import { callEngineTool, type EngineModel } from "./session";

/**
 * Diagnostický tool fázy 0 (D-084), len pri `ENGINE_SPIKE=1` (preview):
 * zmeria IFC motor priamo vo funkcii Vercelu - studené/teplé načítanie
 * modelov, dotaz, voliteľne kolízie - a vráti čísla pre brány prototypu.
 */

/** Id inštancie - rovnaké id v dvoch volaniach = tá istá teplá inštancia. */
const INSTANCE_ID = randomUUID().slice(0, 8);
const INSTANCE_STARTED = Date.now();

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - t), value };
}

const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);

export async function runProbe(input: Record<string, unknown>): Promise<string> {
  const runs = Math.min(10, Math.max(1, Math.floor(Number(input.runs ?? 3)) || 3));
  const out: Record<string, unknown> = {
    instance: INSTANCE_ID,
    instanceAgeS: Math.round((Date.now() - INSTANCE_STARTED) / 1000),
    node: process.version,
    region: process.env.VERCEL_REGION ?? null,
    rssStartMb: rssMb(),
  };

  const models: EngineModel[] = [];
  const load: Record<string, unknown> = {};
  for (const src of getIfcModels()) {
    const r = await timed(() => getStore(src));
    models.push({ id: src.id, name: `${src.id}.ifc`, store: r.value.entry.store });
    load[src.id] = { ms: r.ms, cold: r.value.cold, loadMs: r.value.entry.loadMs, sizeMb: +(r.value.entry.size / 1048576).toFixed(1) };
  }
  out.load = load;
  out.rssAfterLoadMb = rssMb();

  const asr = models.find((m) => m.id === "ASR") ?? models[0];
  const qMs: number[] = [];
  let count: unknown = null;
  for (let i = 0; i < runs; i++) {
    const r = await timed(() =>
      callEngineTool([asr], "query_entities", {
        model_id: asr.id,
        type: "IfcSpace",
        selector: "Qto_SpaceBaseQuantities.NetFloorArea>20",
        limit: 500,
        fields: ["name"],
      }),
    );
    qMs.push(r.ms);
    count = (r.value.structuredContent as { count?: number } | undefined)?.count ?? null;
  }
  out.query = { ms: qMs, count };

  const vzt = models.find((m) => m.id === "VZT");
  if (input.clash === true && vzt) {
    const r = await timed(() =>
      callEngineTool([vzt], "clash_check", { model_id: vzt.id, a: "IfcDuctSegment", b: "IfcDuctFitting" }),
    );
    out.clash = { ms: r.ms, isError: r.value.isError === true, total: (r.value.structuredContent as { summary?: { total?: number } })?.summary?.total };
  }

  out.rssEndMb = rssMb();
  out.cache = cacheSnapshot();
  return JSON.stringify(out);
}
