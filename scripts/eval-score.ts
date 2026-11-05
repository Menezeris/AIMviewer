/**
 * Scoring and validation of the /api/ask golden questions (D-057), separate from the `eval-ask.ts` runner so it can be tested.
 */

export interface Expect {
  answer_matches?: string[];
  answer_not_matches?: string[];
  sources_any_ref?: string[];
  source_types?: string[];
  no_facts?: boolean;
  /** Regexes that the URL of some UI action (decoded) must satisfy, e.g. the ops of a view (D-083). */
  actions_match?: string[];
  /** Tools that the model must call (per the trace). */
  tools_called?: string[];
}

export interface Question {
  id: string;
  category: string;
  question: string;
  expect: Expect;
  verified: boolean;
  mock_only?: boolean;
  /**
   * Question for the MCP connector (the tools search_all, clash, calibrate_underlay, ifc_* exist only in MCP with the engine);
   * /api/ask does not have them, the runner skips it. It is measured via eval/mcp-tasks.json (MCP-EVAL.md).
   */
  mcp_only?: boolean;
  notes?: string;
}

export interface AskSource {
  objectRef: string | null;
  objectType: string;
}

export interface AskResponse {
  answer?: string;
  sources?: AskSource[];
  trace?: { name: string; ok: boolean }[];
  actions?: { url: string }[];
  provider?: string;
  error?: string;
}

/** "Not found" patterns for no_facts assertions (negative questions). */
export const NOT_FOUND_RE =
  /nenaš|nenach|neexist|nie je|niesú|nie sú|žiadn|nemá|not found|no such/i;

/**
 * Code of an element, room or storey in the answer (DD01.06.03, ZZZ99.99.99, 1NP, 2.05, D.1.1.01, PO.02.02):
 * the system prompt tells the model to cite them, so they are not confabulated numbers. A token with a letter and a digit, letters
 * with dotted numbers (PO.02.02) or at least three groups of digits with dots (the decimal number 11.43 stays a number).
 */
const CODE_RE = /[\p{L}\d]*(?:\p{L}\d|\d\p{L})[\p{L}\d]*(?:[._/-][\p{L}\d]+)*|\p{L}+(?:\.\d+)+|\d+(?:\.\d+){2,}/gu;
/** A standalone multi-digit number (count, value) = suspected confabulation in a negative question. */
const MULTI_DIGIT_RE = /(?<![\p{L}\d])\d{2,}(?![\p{L}\d])/u;

/**
 * Multi-digit number in the answer to a negative question, except element codes and numbers from the question
 * (rel-actor, neg-nonexistent-ref failed on DD01.06.03 and ZZZ99.99.99, which the model cited correctly).
 */
export function suspiciousNumber(answer: string, question = ""): string | null {
  const own = new Set(question.match(/\d+/g) ?? []);
  const stripped = answer.replace(CODE_RE, " ").replace(/\d+/g, (n) => (own.has(n) ? " " : n));
  return stripped.match(MULTI_DIGIT_RE)?.[0] ?? null;
}

/** Evaluates the assertions of one answer; returns the list of failures (empty = pass). */
export function score(expect: Expect, res: AskResponse, question = ""): string[] {
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
    const n = suspiciousNumber(answer, question);
    if (n) failures.push(`no_facts: odpoveď obsahuje viacciferné číslo (${n})`);
    // "Not found" counts only from a working DB - a run where all tools failed
    // proves nothing (the anti-confabulation fallback would otherwise pass green through an outage).
    const trace = res.trace ?? [];
    if (trace.length > 0 && trace.every((t) => !t.ok)) {
      failures.push("no_facts: všetky tool cally zlyhali — beh nevypovedá o dátach");
    }
  }
  return failures;
}

/**
 * Errors of the question set (the runner prints them and exits): a record without id or question sent /api/ask an empty history
 * ("posledná správa musí byť od používateľa"), duplicate id, tools_called with a tool that /api/ask does not have.
 */
export function validateQuestions(questions: unknown[], askTools?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  questions.forEach((raw, i) => {
    const q = (raw ?? {}) as Partial<Question>;
    const at = `#${i}${q.id ? ` (${q.id})` : ""}`;
    if (typeof q.id !== "string" || !q.id.trim()) errors.push(`${at}: chýba id`);
    else if (seen.has(q.id)) errors.push(`${at}: duplicitné id`);
    else seen.add(q.id);
    if (typeof q.question !== "string" || !q.question.trim()) errors.push(`${at}: chýba question`);
    if (typeof q.category !== "string" || !q.category) errors.push(`${at}: chýba category`);
    if (typeof q.expect !== "object" || q.expect === null) errors.push(`${at}: chýba expect`);
    if (typeof q.verified !== "boolean") errors.push(`${at}: chýba verified`);
    if (askTools && !q.mcp_only) {
      for (const t of q.expect?.tools_called ?? []) {
        if (!askTools.has(t)) errors.push(`${at}: tool '${t}' /api/ask nemá (otázka pre MCP = mcp_only: true)`);
      }
    }
  });
  return errors;
}
