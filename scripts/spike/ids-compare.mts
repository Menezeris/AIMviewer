/**
 * Phase 0 (D-084): agreement of the IDS engine `@ifc-lite/ids` (via `@ifc-lite/mcp`
 * ids_validate) with ifctester (`etl.ids_check`, D-081) on the same IDS and model.
 *
 *   python -m etl.ids_check --ids <ids> --model <ASR.ifc> --label ASR --dry-run --report ifctester.csv
 *   npx vite-node@6.0.0 scripts/spike/ids-compare.mts -- --ids <ids> --csv ifctester.csv [--model ASR]
 *
 * Compares the verdict of each specification and each pair (specification x GUID).
 * Specifications are matched by name (ifctester carries it in the CSV). Writes nothing.
 */
import { readFileSync } from "node:fs";

import { envIfcModels } from "../../lib/data/ifc-models";
import { getStore } from "../../lib/engine/cache";
import { callEngineTool } from "../../lib/engine/session";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const IDS = opt("ids");
const CSV = opt("csv");
const MODEL = opt("model") ?? "ASR";
if (!IDS || !CSV) {
  console.error("Použitie: --ids <ids> --csv <report z etl.ids_check> [--model ASR]");
  process.exit(2);
}

/** Minimal CSV parser (quotes + commas in a field), enough for the ids_check report. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ""));
}

interface Verdict {
  status: "pass" | "fail";
  reasons: string;
}

async function main() {
  // ifctester: spec_identifier, spec_name, ifc_guid, ifc_type, status, reasons
  const [header, ...rows] = parseCsv(readFileSync(CSV!, "utf8"));
  const col = (n: string) => header.indexOf(n);
  const ref = new Map<string, Verdict>(); // `${spec}|${guid}`
  const refSpec = new Map<string, "pass" | "fail">();
  for (const r of rows) {
    const spec = r[col("spec_name")];
    const guid = r[col("ifc_guid")] || "-";
    const status = r[col("status")] as "pass" | "fail";
    ref.set(`${spec}|${guid}`, { status, reasons: r[col("reasons")] });
    refSpec.set(spec, refSpec.get(spec) === "fail" || status === "fail" ? "fail" : "pass");
  }

  const src = (envIfcModels() ?? []).find((m) => m.id === MODEL);
  if (!src) throw new Error(`Model ${MODEL} nie je v zozname federácie`);
  const { entry } = await getStore(src);
  const t = performance.now();
  const res = await callEngineTool([{ id: src.id, name: `${src.id}.ifc`, store: entry.store }], "ids_validate", {
    model_id: src.id,
    ids_xml: readFileSync(IDS!, "utf8"),
  });
  const ms = Math.round(performance.now() - t);
  type Spec = {
    specification?: { name?: string };
    status?: string;
    applicableCount?: number;
    entityResults?: Array<{ globalId?: string; passed?: boolean; requirementResults?: Array<{ status?: string; failureReason?: string }> }>;
  };
  const specs = ((res.structuredContent as { report?: { specificationResults?: Spec[] } })?.report?.specificationResults ?? []) as Spec[];

  const got = new Map<string, Verdict>();
  const specVerdicts: Array<{ spec: string; ifctester?: string; ifclite?: string; match: boolean }> = [];
  for (const s of specs) {
    const name = s.specification?.name ?? "?";
    const verdict = s.status === "fail" ? "fail" : "pass";
    // A specification without a passing element has no row in the ifctester CSV, but
    // ifctester counts it as passed in the summary (etl.ids_check: specs_passed).
    const refVerdict = refSpec.get(name) ?? "pass";
    specVerdicts.push({ spec: name, ifctester: refSpec.get(name) ?? "pass (bez prvkov)", ifclite: s.status, match: refVerdict === verdict });
    const ents = s.entityResults ?? [];
    if (ents.length === 0 && s.status === "fail") got.set(`${name}|-`, { status: "fail", reasons: "(bez prvku)" });
    for (const e of ents) {
      const reasons = (e.requirementResults ?? [])
        .filter((q) => q.status === "fail")
        .map((q) => q.failureReason ?? "")
        .join(" | ");
      got.set(`${name}|${e.globalId ?? "?"}`, { status: e.passed ? "pass" : "fail", reasons });
    }
  }

  const keys = new Set([...ref.keys(), ...got.keys()]);
  let agree = 0;
  const diffs: Array<Record<string, string | undefined>> = [];
  for (const k of keys) {
    const a = ref.get(k);
    const b = got.get(k);
    if (a && b && a.status === b.status) agree++;
    else diffs.push({ key: k, ifctester: a?.status, ifclite: b?.status, reasonsIfctester: a?.reasons?.slice(0, 160), reasonsIfclite: b?.reasons?.slice(0, 160) });
  }
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        validateMs: ms,
        specsCompared: specVerdicts.length,
        specVerdictsMatch: specVerdicts.filter((s) => s.match).length,
        specVerdicts,
        pairs: { ifctester: ref.size, ifclite: got.size, union: keys.size, agree, agreementPct: +((100 * agree) / keys.size).toFixed(2) },
        diffs: diffs.slice(0, 30),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
