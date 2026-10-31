/**
 * Skórovanie a validácia zlatých otázok /api/ask (D-057), oddelené od runnera `eval-ask.ts`, aby sa dalo testovať.
 */

export interface Expect {
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

export interface Question {
  id: string;
  category: string;
  question: string;
  expect: Expect;
  verified: boolean;
  mock_only?: boolean;
  /**
   * Otázka pre MCP konektor (tooly search_all, clash, calibrate_underlay, ifc_* sú len v MCP s motorom);
   * /api/ask ich nemá, runner ju preskočí. Meria sa cez eval/mcp-tasks.json (MCP-EVAL.md).
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

/** „Nenašiel som" vzory pre no_facts asercie (negatívne otázky). */
export const NOT_FOUND_RE =
  /nenaš|nenach|neexist|nie je|niesú|nie sú|žiadn|nemá|not found|no such/i;

/**
 * Kód prvku, miestnosti alebo podlažia v odpovedi (DD01.06.03, ZZZ99.99.99, 1NP, 2.05, D.1.1.01, PO.02.02):
 * systémový prompt ich káže citovať, preto nie sú konfabulované čísla. Token s písmenom a číslicou, písmená
 * s bodkovanými číslami (PO.02.02) alebo aspoň tri skupiny číslic s bodkami (desatinné číslo 11.43 ostáva číslom).
 */
const CODE_RE = /[\p{L}\d]*(?:\p{L}\d|\d\p{L})[\p{L}\d]*(?:[._/-][\p{L}\d]+)*|\p{L}+(?:\.\d+)+|\d+(?:\.\d+){2,}/gu;
/** Samostatné viacciferné číslo (počet, hodnota) = podozrenie z konfabulácie pri negatívnej otázke. */
const MULTI_DIGIT_RE = /(?<![\p{L}\d])\d{2,}(?![\p{L}\d])/u;

/**
 * Viacciferné číslo v odpovedi na negatívnu otázku, okrem kódov prvkov a čísel z otázky
 * (rel-actor, neg-nonexistent-ref padali na DD01.06.03 a ZZZ99.99.99, ktoré model správne citoval).
 */
export function suspiciousNumber(answer: string, question = ""): string | null {
  const own = new Set(question.match(/\d+/g) ?? []);
  const stripped = answer.replace(CODE_RE, " ").replace(/\d+/g, (n) => (own.has(n) ? " " : n));
  return stripped.match(MULTI_DIGIT_RE)?.[0] ?? null;
}

/** Vyhodnotí asercie jednej odpovede; vráti zoznam zlyhaní (prázdny = pass). */
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
    // „Nenašiel som" platí len z fungujúcej DB — beh, kde zlyhali všetky tools,
    // nedokazuje nič (anti-konfabulačný fallback by inak zeleno prešiel výpadkom).
    const trace = res.trace ?? [];
    if (trace.length > 0 && trace.every((t) => !t.ok)) {
      failures.push("no_facts: všetky tool cally zlyhali — beh nevypovedá o dátach");
    }
  }
  return failures;
}

/**
 * Chyby sady otázok (runner ich vypíše a skončí): záznam bez id alebo otázky poslal /api/ask prázdnu históriu
 * ("posledná správa musí byť od používateľa"), duplicitné id, tools_called s toolom, ktorý /api/ask nemá.
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
