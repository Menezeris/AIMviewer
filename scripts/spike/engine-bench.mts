/**
 * Phase 0 (D-084): measuring the IFC engine `@ifc-lite/mcp` over the federation models.
 *
 *   npx vite-node@6.0.0 scripts/spike/engine-bench.mts -- [--ids <path to .ids>] [--runs 5]
 *
 * Measures: cold/warm model loading (instance cache), a query with a numeric
 * filter, isolation of backends over one store (an edit in A is not visible in B),
 * optionally ids_validate and clash_check. Output = JSON on stdout (the numbers go into
 * D-084). Writes nothing, needs no DB.
 */
import { readFileSync } from "node:fs";

import {
  DEFAULT_CONFIG,
  InMemoryModelRegistry,
  NOOP_PROGRESS,
  SILENT_LOGGER,
  buildDefaultToolRegistry,
  fullScope,
} from "@ifc-lite/mcp";

import { envIfcModels } from "../../lib/data/ifc-models";
import { getStore } from "../../lib/engine/cache";
import { modelFromStore } from "../../lib/engine/loader";
import { callEngineTool, type EngineModel } from "../../lib/engine/session";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const RUNS = Number(opt("runs") ?? 5);
const IDS_PATH = opt("ids");

const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);
let peakRss = 0;
const sample = () => {
  peakRss = Math.max(peakRss, rssMb());
};
const timer = setInterval(sample, 50);

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now();
  const value = await fn();
  sample();
  return { ms: Math.round(performance.now() - t), value };
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

async function main() {
  const out: Record<string, unknown> = { node: process.version, rssStartMb: rssMb() };
  const sources = (envIfcModels() ?? []);

  // 1) Cold and warm loading.
  const models: EngineModel[] = [];
  const load: Record<string, unknown> = {};
  for (const src of sources) {
    const cold = await timed(() => getStore(src));
    const warm = await timed(() => getStore(src));
    models.push({ id: src.id, name: `${src.id}.ifc`, store: cold.value.entry.store });
    load[src.id] = {
      sizeMb: +(cold.value.entry.size / 1048576).toFixed(1),
      coldMs: cold.ms,
      parseAndDownloadMs: cold.value.entry.loadMs,
      warmMs: warm.ms,
      warmWasCold: warm.value.cold,
    };
  }
  out.load = load;
  out.rssAfterLoadMb = rssMb();

  // 2) Query with a numeric filter (ASR), repeated - a new backend on every call.
  const asr = models.find((m) => m.id === "ASR") ?? models[0];
  const qMs: number[] = [];
  let qCount: unknown = null;
  for (let i = 0; i < RUNS; i++) {
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
    qCount = (r.value.structuredContent as { count?: number } | undefined)?.count ?? r.value.content[0]?.text?.slice(0, 40);
  }
  out.query = { runs: RUNS, ms: qMs, p95Ms: p95(qMs), count: qCount };

  // 3) Isolation: a property edit on backend A must not show up in B (shared store).
  const all = buildDefaultToolRegistry();
  const first = await callEngineTool([asr], "query_entities", {
    model_id: asr.id,
    type: "IfcSpace",
    limit: 1,
  });
  const gid = (first.structuredContent as { entities?: Array<{ globalId?: string }> } | undefined)?.entities?.[0]?.globalId;
  const regA = new InMemoryModelRegistry();
  regA.add(modelFromStore(asr.store, asr.name, asr.id));
  const ctxA = {
    registry: regA,
    scope: fullScope(),
    progress: NOOP_PROGRESS,
    log: SILENT_LOGGER,
    signal: new AbortController().signal,
    config: DEFAULT_CONFIG,
  };
  const set = await all.get("entity_set_property")!.handler(
    { model_id: asr.id, global_id: gid, pset: "AIM_Spike", name: "Marker", value: "A" },
    ctxA as never,
  );
  const readA = await all.get("get_entity")!.handler(
    { model_id: asr.id, global_id: gid, include: ["properties"] },
    ctxA as never,
  );
  const readB = await callEngineTool([asr], "get_entity", {
    model_id: asr.id,
    global_id: gid,
    include: ["properties"],
  });
  const hasMarker = (r: unknown) => JSON.stringify(r).includes("AIM_Spike");
  out.isolation = {
    globalId: gid,
    setOk: !(set as { isError?: boolean }).isError,
    visibleInA: hasMarker((readA as { structuredContent?: unknown }).structuredContent),
    visibleInB: hasMarker(readB.structuredContent),
  };

  // 4) IDS (optional).
  if (IDS_PATH) {
    const xml = readFileSync(IDS_PATH, "utf8");
    const r = await timed(() => callEngineTool([asr], "ids_validate", { model_id: asr.id, ids_xml: xml }));
    const sc = r.value.structuredContent as
      | { summary?: unknown; report?: { specificationResults?: Array<{ specification?: { name?: string }; status?: string; applicableCount?: number; failedCount?: number }> } }
      | undefined;
    out.ids = {
      ms: r.ms,
      isError: r.value.isError === true,
      summary: sc?.summary ?? r.value.content[0]?.text?.slice(0, 300),
      specs: sc?.report?.specificationResults?.map((s) => ({
        name: s.specification?.name,
        status: s.status,
        applicable: s.applicableCount,
        failed: s.failedCount,
      })),
    };
  }

  // 5) Clashes (VZT, within the model).
  const vzt = models.find((m) => m.id === "VZT");
  if (vzt) {
    const r = await timed(() =>
      callEngineTool([vzt], "clash_check", { model_id: vzt.id, a: "IfcDuctSegment", b: "IfcDuctFitting" }),
    );
    out.clash = {
      ms: r.ms,
      isError: r.value.isError === true,
      summary: (r.value.structuredContent as { summary?: unknown } | undefined)?.summary ?? r.value.content[0]?.text?.slice(0, 120),
    };
  }

  clearInterval(timer);
  sample();
  out.peakRssMb = peakRss;
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  clearInterval(timer);
  console.error(err);
  process.exit(1);
});
