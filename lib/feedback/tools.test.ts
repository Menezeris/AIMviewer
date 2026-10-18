import { afterEach, describe, expect, it, vi } from "vitest";

// Moduly sú server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { GithubClient } from "../github/client";

import { fireRoutine, ROUTINE_BETA } from "./routine";
import {
  draftFeedback,
  draftToolRequest,
  execFeedbackTool,
  FEEDBACK_TOOL_DEFINITIONS,
  marker,
  parseMarker,
  slug,
  type FeedbackDeps,
} from "./tools";

const NOW = new Date("2026-10-18T22:00:00Z");
const REPO = { owner: "Menezeris", repo: "AIMviewer" };

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Falošný GitHub: odpovede podľa metódy a cesty, zaznamená volania. */
function fakeGithub(routes: Record<string, (body: unknown) => { status?: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const r = handler(body);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200 });
  });
  return { client: new GithubClient("pat", REPO, fetchImpl as unknown as typeof fetch), calls };
}

const issue = (over: Record<string, unknown> = {}) => ({
  number: 12,
  html_url: "https://github.com/Menezeris/AIMviewer/issues/12",
  title: "Nový tool: Miestnosti bez osvetlenia",
  state: "open",
  labels: [{ name: "mcp" }, { name: "novy-tool" }],
  comments: 0,
  created_at: "t",
  updated_at: "t",
  body: "",
  ...over,
});

const toolArgs = {
  title: "Miestnosti bez osvetlenia",
  user_request: "Ktoré miestnosti na 2NP nemajú svietidlo?",
  why_existing_fail: "Model nemá IfcLightFixture, nedá sa odvodiť.",
  tried_tools: ["count_objects IfcLightFixture: 0"],
  proposal: { name: "Rooms Without Lighting" },
};

function deps(over: Partial<FeedbackDeps> = {}): FeedbackDeps {
  return { client: null, fire: null, now: () => NOW, secrets: [], ...over };
}

describe("pripomienky a požiadavky na tools (D-090)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("tools zápisu nie sú read-only, stav áno", () => {
    const by = Object.fromEntries(FEEDBACK_TOOL_DEFINITIONS.map((t) => [t.name, t.annotations]));
    expect(by.request_tool).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(by.report_feedback).toMatchObject({ readOnlyHint: false });
    expect(by.feedback_status).toMatchObject({ readOnlyHint: true });
  });

  it("slug odstráni diakritiku a odtlačok berie meno návrhu", () => {
    expect(slug("Miestnosti bez osvetlenia, 2. NP!")).toBe("miestnosti-bez-osvetlenia-2-np");
    const d = draftToolRequest(toolArgs, NOW);
    expect(d.fp).toBe("tool:rooms-without-lighting");
    expect(d.title).toBe("Nový tool: Miestnosti bez osvetlenia");
    expect(d.labels).toEqual(["mcp", "novy-tool", "oblast:other"]);
    expect(d.body).toContain("`rooms_without_lighting`");
    expect(parseMarker(d.body)).toEqual({ v: 1, kind: "tool", fp: "tool:rooms-without-lighting" });
    expect(d.start).toBe(true);
  });

  it("pripomienka spúšťa session len na požiadanie a má štítok druhu", () => {
    const d = draftFeedback({ kind: "wrong_data", title: "Plocha 0 m2", description: "x" }, NOW);
    expect(d.labels).toEqual(["mcp", "pripomienka", "data"]);
    expect(d.start).toBe(false);
    expect(draftFeedback({ kind: "bug", title: "a", description: "b", start_session: true }, NOW).start).toBe(true);
  });

  it("chýbajúce povinné pole je chyba vstupu, nič sa nevolá", async () => {
    const res = await execFeedbackTool("request_tool", { title: "x" }, deps());
    expect(res).toEqual({ text: "Chýba user_request.", isError: true });
    const bad = await execFeedbackTool("report_feedback", { kind: "spam", title: "a", description: "b" }, deps());
    expect(bad.isError).toBe(true);
  });

  it("bez tokenu vráti koncept issue, aby sa požiadavka nestratila", async () => {
    const res = await execFeedbackTool("request_tool", toolArgs, deps());
    expect(res.isError).toBe(true);
    const out = JSON.parse(res.text);
    expect(out.error).toContain("FEEDBACK_GITHUB_TOKEN");
    expect(out.draft.title).toBe("Nový tool: Miestnosti bez osvetlenia");
  });

  it("nová požiadavka založí issue, spustí session a zapíše odkaz k issue", async () => {
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [] }),
      "POST /repos/Menezeris/AIMviewer/issues": () => ({ status: 201, json: issue() }),
      "POST /repos/Menezeris/AIMviewer/issues/12/comments": () => ({ status: 201, json: { id: 1 } }),
      "POST /repos/Menezeris/AIMviewer/issues/12/labels": () => ({ json: [] }),
    });
    const fire = vi.fn(async () => ({ sessionId: "session_1", sessionUrl: "https://claude.ai/code/session_1" }));
    const res = await execFeedbackTool("request_tool", toolArgs, deps({ client: gh.client, fire }));
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toMatchObject({
      issue: { number: 12 },
      duplicate: false,
      session: { url: "https://claude.ai/code/session_1" },
    });
    const created = gh.calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"))!;
    expect(created.body).toMatchObject({ labels: ["mcp", "novy-tool", "oblast:other"] });
    const payload = (fire.mock.calls[0] as unknown as [string])[0];
    expect(payload).toContain("issue: 12");
    expect(payload).toContain("druh: novy-tool");
    const comment = gh.calls.find((c) => c.url.endsWith("/issues/12/comments"))!;
    expect((comment.body as { body: string }).body).toContain("aim-mcp-session");
    expect(gh.calls.some((c) => c.url.endsWith("/issues/12/labels"))).toBe(true);
  });

  it("nové issue nesie zoznam súbežných otvorených požiadaviek (koordinácia)", async () => {
    const other = issue({
      number: 7,
      title: "Nový tool: Zóny podľa požiarneho úseku",
      body: marker({ v: 1, kind: "tool", fp: "tool:fire-zones" }),
      labels: [{ name: "mcp" }, { name: "session" }],
    });
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [other] }),
      "POST /repos/Menezeris/AIMviewer/issues": () => ({ status: 201, json: issue() }),
    });
    const res = await execFeedbackTool("request_tool", toolArgs, deps({ client: gh.client }));
    expect(JSON.parse(res.text).other_open).toEqual([
      { number: 7, title: "Nový tool: Zóny podľa požiarneho úseku", session: true },
    ]);
    const body = (gh.calls[1].body as { body: string }).body;
    expect(body).toContain("- #7 Nový tool: Zóny podľa požiarneho úseku (session beží)");
    // Značka ostáva na konci, aby ju zhoda opakovania našla.
    expect(body.indexOf("Otvorené požiadavky")).toBeLessThan(body.indexOf("<!-- aim-mcp "));
  });

  it("rovnaká požiadavka sa pripíše k otvorenému issue a session nespúšťa znova", async () => {
    const existing = issue({
      body: marker({ v: 1, kind: "tool", fp: "tool:rooms-without-lighting" }),
      labels: [{ name: "mcp" }, { name: "session" }],
    });
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [existing] }),
      "POST /repos/Menezeris/AIMviewer/issues/12/comments": () => ({ status: 201, json: { id: 2 } }),
    });
    const fire = vi.fn();
    const res = await execFeedbackTool("request_tool", toolArgs, deps({ client: gh.client, fire }));
    expect(JSON.parse(res.text)).toMatchObject({ duplicate: true, session: null });
    expect(fire).not.toHaveBeenCalled();
    expect(gh.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("opakovanie bez bežiacej session ju spustí (náprava po doplnení routine)", async () => {
    const existing = issue({ body: marker({ v: 1, kind: "tool", fp: "tool:rooms-without-lighting" }) });
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [existing] }),
      "POST /repos/Menezeris/AIMviewer/issues/12/comments": () => ({ status: 201, json: { id: 3 } }),
      "POST /repos/Menezeris/AIMviewer/issues/12/labels": () => ({ json: [] }),
    });
    const fire = vi.fn(async () => ({ sessionId: "s", sessionUrl: "https://claude.ai/code/s" }));
    await execFeedbackTool("request_tool", toolArgs, deps({ client: gh.client, fire }));
    expect((fire.mock.calls[0] as unknown as [string])[0]).toContain("opakovanie: ano");
  });

  it("bez routine issue vznikne a výsledok povie, že session čaká", async () => {
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [] }),
      "POST /repos/Menezeris/AIMviewer/issues": () => ({ status: 201, json: issue() }),
    });
    const res = await execFeedbackTool("request_tool", toolArgs, deps({ client: gh.client }));
    const out = JSON.parse(res.text);
    expect(res.isError).toBe(false);
    expect(out.session).toBeNull();
    expect(out.session_note).toContain("CLAUDE_ROUTINE_FIRE_URL");
  });

  it("štítok, ktorý token nesmie použiť, issue nezhodí", async () => {
    let first = true;
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [] }),
      "POST /repos/Menezeris/AIMviewer/issues": () => {
        if (first) {
          first = false;
          return { status: 422, json: { message: "Validation Failed" } };
        }
        return { status: 201, json: issue() };
      },
    });
    const res = await execFeedbackTool(
      "report_feedback",
      { kind: "bug", title: "a", description: "b" },
      deps({ client: gh.client }),
    );
    expect(res.isError).toBe(false);
    const posts = gh.calls.filter((c) => c.method === "POST");
    expect(posts[1].body).toMatchObject({ labels: [] });
  });

  it("tajomstvá servera sa do verejného issue nedostanú", async () => {
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({ json: [] }),
      "POST /repos/Menezeris/AIMviewer/issues": () => ({ status: 201, json: issue() }),
    });
    await execFeedbackTool(
      "report_feedback",
      { kind: "bug", title: "a", description: "konektor /api/mcp/tajny-token-123 padá" },
      deps({ client: gh.client, secrets: ["tajny-token-123"] }),
    );
    const body = (gh.calls[1].body as { body: string }).body;
    expect(body).not.toContain("tajny-token-123");
    expect(body).toContain("[skryté]");
  });

  it("stav issue vráti session, PR a posledné komentáre bez skrytých značiek", async () => {
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues/12": () => ({ json: issue() }),
      "GET /repos/Menezeris/AIMviewer/issues/12/comments": () => ({
        json: [
          {
            id: 1,
            html_url: "c1",
            user: { login: "claude" },
            created_at: "t1",
            body: 'Claude session: https://claude.ai/code/s1\n\n<!-- aim-mcp-session {"url":"https://claude.ai/code/s1"} -->',
          },
          { id: 2, html_url: "c2", user: { login: "claude" }, created_at: "t2", body: "Otázka: ktoré podlažia?" },
        ],
      }),
      "GET /repos/Menezeris/AIMviewer/issues/12/timeline": () => ({
        json: [
          {
            event: "cross-referenced",
            source: {
              issue: {
                number: 60,
                html_url: "pr60",
                title: "feat: rooms_without_lighting",
                state: "open",
                pull_request: { merged_at: null },
              },
            },
          },
          { event: "labeled" },
        ],
      }),
    });
    const res = await execFeedbackTool("feedback_status", { issue_number: 12 }, deps({ client: gh.client }));
    const out = JSON.parse(res.text);
    expect(out.session_url).toBe("https://claude.ai/code/s1");
    expect(out.pull_requests).toEqual([
      { number: 60, html_url: "pr60", title: "feat: rooms_without_lighting", state: "open", merged: false },
    ]);
    expect(out.last_comments[0].text).not.toContain("aim-mcp-session");
    expect(out.last_comments[1].text).toBe("Otázka: ktoré podlažia?");
  });

  it("zoznam otvorených vynechá PR a ukáže druh a session", async () => {
    const gh = fakeGithub({
      "GET /repos/Menezeris/AIMviewer/issues": () => ({
        json: [
          issue({ body: marker({ v: 1, kind: "tool", fp: "tool:x" }), labels: [{ name: "mcp" }, { name: "session" }] }),
          issue({ number: 13, pull_request: {} }),
        ],
      }),
    });
    const out = JSON.parse((await execFeedbackTool("feedback_status", {}, deps({ client: gh.client }))).text);
    expect(out.open).toHaveLength(1);
    expect(out.open[0]).toMatchObject({ number: 12, kind: "tool", session: true });
  });
});

describe("routine /fire (D-090)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_01abc/fire";

  it("posiela text s beta hlavičkou a vráti odkaz na session", async () => {
    vi.stubEnv("CLAUDE_ROUTINE_FIRE_URL", URL_OK);
    vi.stubEnv("CLAUDE_ROUTINE_TOKEN", "tok");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: "routine_fire",
            claude_code_session_id: "session_9",
            claude_code_session_url: "https://claude.ai/code/session_9",
          }),
        ),
    );
    const res = await fireRoutine("issue: 12", fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ sessionId: "session_9", sessionUrl: "https://claude.ai/code/session_9" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["anthropic-beta"]).toBe(ROUTINE_BETA);
    expect(JSON.parse(init.body as string)).toEqual({ text: "issue: 12" });
  });

  it("odmietne URL mimo api.anthropic.com (token nepošle inam)", async () => {
    vi.stubEnv("CLAUDE_ROUTINE_FIRE_URL", "https://evil.example/fire");
    vi.stubEnv("CLAUDE_ROUTINE_TOKEN", "tok");
    const fetchImpl = vi.fn();
    await expect(fireRoutine("x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("nemá tvar");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("chyba API je výnimka s kódom", async () => {
    vi.stubEnv("CLAUDE_ROUTINE_FIRE_URL", URL_OK);
    vi.stubEnv("CLAUDE_ROUTINE_TOKEN", "tok");
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    await expect(fireRoutine("x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("HTTP 429");
  });
});
