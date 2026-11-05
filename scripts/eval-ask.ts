/**
 * Eval runner for /api/ask (D-057) - golden questions with deterministic scoring.
 *
 * Measures the accuracy of the LLM interface over the graph: regex assertions over `answer` +
 * a check of the trust-loop `sources` (the server collects the evidence deterministically, so
 * this part of the score does not depend on the model's wording). No LLM judge (v1).
 *
 * Running (the dev server must be running - `npm run dev`, with a real provider
 * or LLM_PROVIDER=mock for a smoke run):
 *
 *   npm run eval -- [--base-url http://localhost:3000] [--filter counts]
 *                   [--runs 3] [--label sonnet-baseline] [--include-unverified]
 *
 * - `--filter` = category or substring of the question id.
 * - `--runs N` = each question N times (variance of nondeterministic models).
 * - `--include-unverified` = also run questions with verified=false (to fill in
 *   expectations - the answers are printed, they do not count toward the headline pass-rate).
 * - mock_only questions (smoke) run only when --filter selects them explicitly.
 *
 * Output: a table per category + JSON to eval/results/<ts>_<label>.json
 * (baseline runs are committed - comparison of models/prompts over time, D-057).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { score, validateQuestions, type AskResponse, type Question } from "./eval-score";

interface Args {
  baseUrl: string;
  filter: string | null;
  runs: number;
  label: string | null;
  includeUnverified: boolean;
  timeoutMs: number;
  /** Path to the question set - per-project sets (multi-project, D-033 line). */
  questions: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: "http://localhost:3000",
    filter: null,
    runs: 1,
    label: null,
    includeUnverified: false,
    timeoutMs: 90_000,
    questions: "eval/questions.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--questions") args.questions = argv[++i];
    else if (a === "--filter") args.filter = argv[++i];
    else if (a === "--runs") args.runs = Math.max(1, Number(argv[++i]) || 1);
    else if (a === "--label") args.label = argv[++i];
    else if (a === "--include-unverified") args.includeUnverified = true;
    else if (a === "--timeout") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 90_000);
    else {
      console.error(`Neznámy argument '${a}'.`);
      process.exit(2);
    }
  }
  return args;
}

async function askOnce(
  baseUrl: string,
  question: string,
  timeoutMs: number
): Promise<{ res: AskResponse; ms: number }> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
      signal: ctrl.signal,
    });
    const json = (await r.json()) as AskResponse;
    if (!r.ok && !json.error) json.error = `HTTP ${r.status}`;
    return { res: json, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

interface QuestionResult {
  id: string;
  category: string;
  verified: boolean;
  runs: {
    pass: boolean;
    failures: string[];
    answer: string;
    sourceRefs: (string | null)[];
    toolCalls: number;
    toolErrors: number;
    ms: number;
  }[];
  passRate: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const parsed = JSON.parse(readFileSync(join(root, args.questions), "utf8")) as { questions: unknown[] };
  // An invalid record (without id or question) would send an empty history and /api/ask returns 400
  // "posledná správa musí byť od používateľa"; the runner reports it and skips it.
  const invalid = validateQuestions(parsed.questions);
  if (invalid.length > 0) {
    console.warn(`Neplatné záznamy v ${args.questions} (preskočené):\n  ${invalid.join("\n  ")}`);
  }
  const questions = parsed.questions.filter((q) => validateQuestions([q]).length === 0) as Question[];

  const matchesFilter = (q: Question) =>
    !args.filter || q.category === args.filter || q.id.includes(args.filter);

  const selected = questions.filter((q) => {
    if (!matchesFilter(q)) return false;
    // smoke/mock_only only with an explicit filter - a real model would answer them with nonsense
    if (q.mock_only && !args.filter) return false;
    // /api/ask does not have the MCP connector tools (search_all, clash, calibrate_underlay...); eval/mcp-tasks.json measures them.
    if (q.mcp_only) return false;
    if (!q.verified && !args.includeUnverified) return false;
    return true;
  });
  const skippedUnverified = questions.filter(
    (q) => matchesFilter(q) && !q.mock_only && !q.mcp_only && !q.verified && !args.includeUnverified
  ).length;
  const skippedMcp = questions.filter((q) => matchesFilter(q) && q.mcp_only).length;

  if (selected.length === 0) {
    console.log(
      `Žiadne otázky na spustenie (preskočených neoverených: ${skippedUnverified}).` +
        " Doplň očakávania (verified=true) alebo použi --include-unverified."
    );
    return;
  }

  console.log(
    `Eval: ${selected.length} otázok × ${args.runs} beh(ov) proti ${args.baseUrl}` +
      (skippedUnverified ? ` (preskočených neoverených: ${skippedUnverified})` : "") +
      (skippedMcp ? ` (preskočených len pre MCP: ${skippedMcp})` : "")
  );

  let provider = "unknown";
  const results: QuestionResult[] = [];

  for (const q of selected) {
    const runs: QuestionResult["runs"] = [];
    for (let i = 0; i < args.runs; i++) {
      try {
        const { res, ms } = await askOnce(args.baseUrl, q.question, args.timeoutMs);
        if (res.provider) provider = res.provider;
        const failures = res.error ? [`chyba API: ${res.error}`] : score(q.expect, res, q.question);
        runs.push({
          pass: failures.length === 0,
          failures,
          answer: (res.answer ?? "").slice(0, 500),
          sourceRefs: (res.sources ?? []).map((s) => s.objectRef),
          toolCalls: res.trace?.length ?? 0,
          toolErrors: res.trace?.filter((t) => !t.ok).length ?? 0,
          ms,
        });
      } catch (e) {
        runs.push({
          pass: false,
          failures: [`request zlyhal: ${e instanceof Error ? e.message : String(e)}`],
          answer: "",
          sourceRefs: [],
          toolCalls: 0,
          toolErrors: 0,
          ms: 0,
        });
      }
    }
    const passRate = runs.filter((r) => r.pass).length / runs.length;
    results.push({ id: q.id, category: q.category, verified: q.verified, runs, passRate });

    const status = !q.verified ? "UNVER" : passRate === 1 ? "PASS " : passRate > 0 ? "FLAKY" : "FAIL ";
    const detail =
      passRate < 1 && q.verified
        ? ` — ${runs.find((r) => !r.pass)?.failures.join("; ")}`
        : "";
    console.log(`  [${status}] ${q.id} (${Math.round(passRate * 100)} %)${detail}`);
    if (!q.verified) {
      console.log(`          odpoveď: ${runs[0].answer.slice(0, 200).replace(/\n/g, " ")}`);
    }
  }

  // Summary per category - only verified questions make up the headline pass-rate.
  const verified = results.filter((r) => r.verified);
  const byCategory = new Map<string, { pass: number; total: number }>();
  for (const r of verified) {
    const c = byCategory.get(r.category) ?? { pass: 0, total: 0 };
    c.total += 1;
    if (r.passRate === 1) c.pass += 1;
    byCategory.set(r.category, c);
  }
  console.log("\nKategória            pass/total");
  for (const [cat, c] of [...byCategory.entries()].sort()) {
    console.log(`  ${cat.padEnd(18)} ${c.pass}/${c.total}`);
  }
  const totalPass = verified.filter((r) => r.passRate === 1).length;
  console.log(
    `\nSpolu (verified): ${totalPass}/${verified.length}` +
      ` · provider: ${provider}` +
      (results.length > verified.length
        ? ` · neoverených spustených: ${results.length - verified.length}`
        : "")
  );

  const label = args.label ?? provider.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
  const outDir = join(root, "eval", "results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${ts}_${label}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      { ranAt: ts, provider, label, args: { ...args }, results },
      null,
      2
    )
  );
  console.log(`Výsledky: ${outPath}`);
}

main().catch((e) => {
  console.error("Eval runner zlyhal:", e);
  process.exit(1);
});
