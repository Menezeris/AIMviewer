/**
 * Eval runner pre /api/ask (D-057) — zlaté otázky s deterministickým skórovaním.
 *
 * Meria presnosť LLM rozhrania nad grafom: regex asercie nad `answer` +
 * kontrola trust-loop `sources` (dôkazy zbiera server deterministicky, takže
 * táto časť skóre nezávisí od formulácie modelu). Bez LLM-judge (v1).
 *
 * Spustenie (dev server musí bežať — `npm run dev`, s reálnym providerom
 * alebo LLM_PROVIDER=mock pre smoke):
 *
 *   npm run eval -- [--base-url http://localhost:3000] [--filter counts]
 *                   [--runs 3] [--label sonnet-baseline] [--include-unverified]
 *
 * - `--filter` = kategória alebo podreťazec id otázky.
 * - `--runs N` = každú otázku N-krát (variancia nedeterministických modelov).
 * - `--include-unverified` = spusti aj otázky s verified=false (na doplnenie
 *   očakávaní — odpovede sa vypíšu, do headline pass-rate sa nerátajú).
 * - mock_only otázky (smoke) bežia len keď ich --filter explicitne vyberie.
 *
 * Výstup: tabuľka per kategória + JSON do eval/results/<ts>_<label>.json
 * (baseline runy sa commitujú — porovnanie modelov/promptov v čase, D-057).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Expect {
  answer_matches?: string[];
  answer_not_matches?: string[];
  sources_any_ref?: string[];
  source_types?: string[];
  no_facts?: boolean;
  /** Regexy, ktoré musí splniť URL niektorej UI akcie (dekódovaná), napr. ops pohľadu (D-083). */
  actions_match?: string[];
  /** Tools, ktoré musí model zavolať (podľa trace). */
  tools_called?: string[];
}

interface Question {
  id: string;
  category: string;
  question: string;
  expect: Expect;
  verified: boolean;
  mock_only?: boolean;
  notes?: string;
}

interface AskSource {
  objectRef: string | null;
  objectType: string;
}

interface AskResponse {
  answer?: string;
  sources?: AskSource[];
  trace?: { name: string; ok: boolean }[];
  actions?: { url: string }[];
  provider?: string;
  error?: string;
}

/** „Nenašiel som" vzory pre no_facts asercie (negatívne otázky). */
const NOT_FOUND_RE =
  /nenaš|nenach|neexist|nie je|niesú|nie sú|žiadn|nemá|not found|no such/i;
/** Viacciferné číslo v odpovedi na negatívnu otázku = podozrenie z konfabulácie. */
const MULTI_DIGIT_RE = /\b\d{2,}\b/;

interface Args {
  baseUrl: string;
  filter: string | null;
  runs: number;
  label: string | null;
  includeUnverified: boolean;
  timeoutMs: number;
  /** Cesta k sade otázok — per-projekt sady (multi-projekt, D-033 línia). */
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

/** Vyhodnotí asercie jednej odpovede; vráti zoznam zlyhaní (prázdny = pass). */
function score(expect: Expect, res: AskResponse): string[] {
  const failures: string[] = [];
  const answer = res.answer ?? "";
  const sources = res.sources ?? [];

  for (const pattern of expect.answer_matches ?? []) {
    if (!new RegExp(pattern, "i").test(answer)) {
      failures.push(`answer nematchuje /${pattern}/i`);
    }
  }
  for (const pattern of expect.answer_not_matches ?? []) {
    if (new RegExp(pattern, "i").test(answer)) {
      failures.push(`answer matchuje zakázané /${pattern}/i`);
    }
  }
  if (expect.sources_any_ref && expect.sources_any_ref.length > 0) {
    const refs = new Set(sources.map((s) => s.objectRef).filter(Boolean));
    if (!expect.sources_any_ref.some((r) => refs.has(r))) {
      failures.push(`sources neobsahujú žiadny z refov [${expect.sources_any_ref.join(", ")}]`);
    }
  }
  for (const t of expect.source_types ?? []) {
    if (!sources.some((s) => s.objectType === t)) {
      failures.push(`sources neobsahujú object_type '${t}'`);
    }
  }
  const urls = (res.actions ?? []).map((a) => decodeURIComponent(a.url));
  for (const pattern of expect.actions_match ?? []) {
    if (!urls.some((u) => new RegExp(pattern).test(u))) {
      failures.push(`žiadna UI akcia nematchuje /${pattern}/ (akcie: ${urls.join(" | ") || "-"})`);
    }
  }
  const called = new Set((res.trace ?? []).map((t) => t.name));
  for (const tool of expect.tools_called ?? []) {
    if (!called.has(tool)) failures.push(`model nezavolal ${tool}`);
  }
  if (expect.no_facts) {
    if (!NOT_FOUND_RE.test(answer)) failures.push("no_facts: chýba formulácia typu 'nenašiel som'");
    if (MULTI_DIGIT_RE.test(answer)) failures.push("no_facts: odpoveď obsahuje viacciferné číslo");
    // „Nenašiel som" platí len z fungujúcej DB — beh, kde zlyhali všetky tools,
    // nedokazuje nič (anti-konfabulačný fallback by inak zeleno prešiel výpadkom).
    const trace = res.trace ?? [];
    if (trace.length > 0 && trace.every((t) => !t.ok)) {
      failures.push("no_facts: všetky tool cally zlyhali — beh nevypovedá o dátach");
    }
  }
  return failures;
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
  const { questions } = JSON.parse(
    readFileSync(join(root, args.questions), "utf8")
  ) as { questions: Question[] };

  const matchesFilter = (q: Question) =>
    !args.filter || q.category === args.filter || q.id.includes(args.filter);

  const selected = questions.filter((q) => {
    if (!matchesFilter(q)) return false;
    // smoke/mock_only len pri explicitnom filtri — reálny model by na ne odpovedal nezmyslom
    if (q.mock_only && !args.filter) return false;
    if (!q.verified && !args.includeUnverified) return false;
    return true;
  });
  const skippedUnverified = questions.filter(
    (q) => matchesFilter(q) && !q.mock_only && !q.verified && !args.includeUnverified
  ).length;

  if (selected.length === 0) {
    console.log(
      `Žiadne otázky na spustenie (preskočených neoverených: ${skippedUnverified}).` +
        " Doplň očakávania (verified=true) alebo použi --include-unverified."
    );
    return;
  }

  console.log(
    `Eval: ${selected.length} otázok × ${args.runs} beh(ov) proti ${args.baseUrl}` +
      (skippedUnverified ? ` (preskočených neoverených: ${skippedUnverified})` : "")
  );

  let provider = "unknown";
  const results: QuestionResult[] = [];

  for (const q of selected) {
    const runs: QuestionResult["runs"] = [];
    for (let i = 0; i < args.runs; i++) {
      try {
        const { res, ms } = await askOnce(args.baseUrl, q.question, args.timeoutMs);
        if (res.provider) provider = res.provider;
        const failures = res.error ? [`chyba API: ${res.error}`] : score(q.expect, res);
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

  // Súhrn per kategória — len verified otázky tvoria headline pass-rate.
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
