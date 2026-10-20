import { describe, expect, it, vi } from "vitest";

// Moduly sú server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import type { BcfTopicRow } from "./store";
import { G1, G2, VIEW_STATE, deps, memoryStore } from "./testing";
import {
  BCF_TOOL_DEFINITIONS,
  BCF_TOOL_NAMES,
  bcfFirePayload,
  execBcfTool,
  normalizeStatus,
  topicRef,
  viewFromState,
  type BcfDeps,
} from "./tools";

const run = async (name: string, args: Record<string, unknown>, d: BcfDeps) => {
  const res = await execBcfTool(name, args, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.text) };
};

describe("definície (1:1 s @ifc-lite/mcp, D-087)", () => {
  it("čítanie a zápis sú zvlášť (D-115): bcf_topic_list read-only, bcf_topic so všetkými parametrami zápisu", () => {
    const byName = new Map(BCF_TOOL_DEFINITIONS.map((t) => [t.name, t]));
    expect([...byName.keys()]).toEqual(["bcf_topic_list", "bcf_topic"]);
    const props = Object.keys((byName.get("bcf_topic")!.inputSchema as { properties: object }).properties);
    expect(props).toEqual(
      expect.arrayContaining(["action", "guid", "title", "description", "author", "type", "status", "priority", "assigned_to"]),
    );
    expect(props).toEqual(expect.arrayContaining(["labels", "comment", "modified_by", "selection_global_ids", "capture_view"]));
    expect(byName.get("bcf_topic_list")!.annotations).toBeUndefined();
    expect(byName.get("bcf_topic")!.annotations?.readOnlyHint).toBe(false);
    expect([...BCF_TOOL_NAMES]).toEqual(["bcf_topic_list", "bcf_topic"]);
  });

  it("bcf_topic vykoná zápis podľa action, neznáma action aj staré meno sú chyba", async () => {
    const { store, rows } = memoryStore([{ title: "x" }]);
    const d = deps({ store });
    const closed = await run("bcf_topic", { action: "close", guid: "1", comment: "Nie je chyba" }, d);
    expect(closed.json.topic.status).toBe("closed");
    expect(rows[0].comments).toHaveLength(1);
    const created = await run("bcf_topic", { action: "create", title: "Zlé zábradlie", capture_view: false }, d);
    expect(created.isError).toBe(false);
    expect(rows).toHaveLength(2);
    expect((await run("bcf_topic", { action: "zmaz", guid: "1" }, d)).isError).toBe(true);
    expect((await run("bcf_topic", { title: "bez action" }, d)).isError).toBe(true);
    expect((await run("bcf_topic_close", { guid: "1" }, d)).isError).toBe(true);
  });
});

describe("pomocné funkcie", () => {
  it("stav v BCF zápise sa prevedie, neznámy odmietne", () => {
    expect(normalizeStatus("In Progress")).toBe("in_progress");
    expect(normalizeStatus("Closed")).toBe("closed");
    expect(normalizeStatus(undefined)).toBeUndefined();
    expect(() => normalizeStatus("Done")).toThrow(/Neznámy stav/);
  });

  it("téma podľa guid alebo čísla", () => {
    expect(topicRef("#12")).toEqual({ number: 12 });
    expect(topicRef(7)).toEqual({ number: 7 });
    expect(topicRef("00000000-0000-4000-8000-0000000000AB")).toEqual({ id: "00000000-0000-4000-8000-0000000000ab" });
    expect(() => topicRef("abc")).toThrow(/guid/);
  });

  it("view_state -> pohľad: orezaný výber sa označí, GUID idú do components", () => {
    const v = viewFromState(VIEW_STATE);
    expect(v.selection).toEqual([G1, G2]);
    expect(v.viewpoint).toMatchObject({ mode: "3d", selection_count: 3, selection_truncated: true, section: { axis: "y" } });
    expect(v.viewpoint).not.toHaveProperty("selection");
  });
});

describe("bcf_topic action=create", () => {
  it("bez prvkov vezme výber a pohľad z viewera; téma pre človeka session nespúšťa", async () => {
    const d = deps();
    const r = await run("bcf_topic", { action: "create", title: "Potrubie koliduje s nosníkom", assigned_to: "Projektant VZT", priority: "High" }, d);
    expect(r.isError).toBe(false);
    expect(r.json.topic).toMatchObject({ number: 1, status: "open", components: 2, assigned_to: "Projektant VZT" });
    expect(r.json.viewpoint_saved).toBe(true);
    expect(r.json.session).toBeNull();
    expect(d.fired).toEqual([]);
  });

  it("zadané prvky majú prednosť pred výberom, pohľad sa uloží aj tak", async () => {
    const { store, rows } = memoryStore();
    const r = await run("bcf_topic", { action: "create", title: "t", target_ids_or_refs: ["DD01.06.03"] }, deps({ store }));
    expect(r.json.topic.components).toBe(1);
    expect(rows[0].components).toEqual([G2]);
    expect(rows[0].viewpoint).toMatchObject({ source: "viewer" });
  });

  it("bez viewera vznikne téma bez pohľadu a povie prečo", async () => {
    const r = await run("bcf_topic", { action: "create", title: "t", global_ids: [G1] }, deps({ captureView: async () => "viewer neodpovedal" }));
    expect(r.json.viewpoint_saved).toBe(false);
    expect(r.json.view_note).toMatch(/viewer neodpovedal/);
    expect(r.json.topic.components).toBe(1);
  });

  it("téma pre Claude spustí session, zapíše odkaz, stav a komentár", async () => {
    const { store, rows } = memoryStore();
    const d = deps({ store });
    const r = await run("bcf_topic", { action: "create", title: "Doplň Pset_SpaceCommon.Reference", assigned_to: "Claude", model: "ASR" }, d);
    expect(r.json.session).toEqual({ url: "https://claude.ai/code/session_1" });
    expect(r.json.topic.status).toBe("in_progress");
    expect(rows[0].session_url).toBe("https://claude.ai/code/session_1");
    expect(rows[0].comments[0].comment).toMatch(/session_1/);
    expect(d.fired[0]).toContain("tema: #1");
    expect(d.fired[0]).toContain("model: ASR");
  });

  it("nad stropom a bez routine téma čaká", async () => {
    const busy = memoryStore([
      { status: "in_progress", session_url: "u1" },
      { status: "in_progress", session_url: "u2" },
    ]);
    const full = await run("bcf_topic", { action: "create", title: "t", assigned_to: "claude" }, deps({ store: busy.store, maxSessions: 2 }));
    expect(full.json).toMatchObject({ session: null, queued: true });
    expect(full.json.session_note).toMatch(/#1, #2/);

    const none = await run("bcf_topic", { action: "create", title: "t", assigned_to: "claude" }, deps({ fire: null }));
    expect(none.json).toMatchObject({ session: null, queued: true });
    expect(none.json.session_note).toMatch(/CLAUDE_BCF_ROUTINE_FIRE_URL/);
  });

  it("chybný vstup vráti chybu bez zápisu", async () => {
    const { store, rows } = memoryStore();
    expect((await run("bcf_topic", { action: "create", title: " " }, deps({ store }))).isError).toBe(true);
    expect((await run("bcf_topic", { action: "create", title: "t", due_date: "zajtra" }, deps({ store }))).text).toMatch(/YYYY-MM-DD/);
    expect(rows).toHaveLength(0);
  });
});

describe("bcf_topic action=update / close / viewpoint, bcf_topic_list", () => {
  it("priradenie Claudovi spustí session raz; komentár sa pripojí", async () => {
    const { store, rows } = memoryStore([{ title: "Okno bez FireRating" }]);
    const d = deps({ store });
    const r = await run("bcf_topic", { action: "update", guid: "#1", assigned_to: "claude", comment: "Oprav podľa IDS" }, d);
    expect(r.json.session).toEqual({ url: "https://claude.ai/code/session_1" });
    expect(r.json.comment_added).toBe(true);
    expect(rows[0].comments.map((c) => c.comment)).toEqual(["Oprav podľa IDS", expect.stringMatching(/session_1/)]);
    const again = await run("bcf_topic", { action: "update", guid: "#1", start_session: true }, d);
    expect(again.json.session).toBeNull();
    expect(again.json.session_note).toMatch(/už bola spustená/);
    expect(d.fired).toHaveLength(1);
  });

  it("session píše stav a výsledok; BCF stav sa prevedie", async () => {
    const { store, rows } = memoryStore([{ assigned_to: "claude", status: "in_progress", session_url: "u" }]);
    const r = await run("bcf_topic", { action: "update", guid: rows[0].id, status: "Resolved", comment: "Revízia v74", modified_by: "Claude (OCB)" }, deps({ store }));
    expect(r.json.topic).toMatchObject({ status: "resolved", comments: 1 });
    expect(rows[0].modified_by).toBe("Claude (OCB)");
  });

  it("close uzavrie s komentárom; neznáma téma je chyba", async () => {
    const { store, rows } = memoryStore([{ title: "x" }]);
    const r = await run("bcf_topic", { action: "close", guid: "1", comment: "Nie je chyba" }, deps({ store }));
    expect(r.json.topic.status).toBe("closed");
    expect(rows[0].comments).toHaveLength(1);
    const miss = await run("bcf_topic", { action: "close", guid: "#9" }, deps({ store }));
    expect(miss.isError).toBe(true);
    expect(miss.text).toMatch(/#9 neexistuje/);
  });

  it("list filtruje a s guid vráti detail s pohľadom a GlobalId", async () => {
    const { store } = memoryStore([
      { title: "a", model: "ASR", components: [G1] },
      { title: "b", model: "VZT", assigned_to: "Claude", viewpoint: { source: "viewer" } },
    ]);
    const all = await run("bcf_topic_list", { model: "VZT" }, deps({ store }));
    expect(all.json).toMatchObject({ count: 1, topics: [{ number: 2, title: "b" }] });
    const mine = await run("bcf_topic_list", { assigned_to: "claude", status: "open" }, deps({ store }));
    expect(mine.json.count).toBe(1);
    expect(mine.json).not.toHaveProperty("count_without_filter");
    const none = await run("bcf_topic_list", { status: "closed" }, deps({ store }));
    expect(none.json).toMatchObject({ count: 0, count_without_filter: 2, topics: [] });
    const one = await run("bcf_topic_list", { guid: "#1" }, deps({ store }));
    expect(one.json.topic).toMatchObject({ number: 1, global_ids: [G1], global_ids_truncated: false, comment_list: [] });
  });

  it("viewpoint nahradí prvky a pohľad; bez prvkov aj pohľadu je to chyba", async () => {
    const { store, rows } = memoryStore([{ title: "x", components: [G1] }]);
    const r = await run("bcf_topic", { action: "viewpoint", guid: "#1", selection_global_ids: [G2] }, deps({ store }));
    expect(r.json).toMatchObject({ selection: 1, viewpoint_from_viewer: true });
    expect(rows[0].components).toEqual([G2]);
    const empty = await run("bcf_topic", { action: "viewpoint", guid: "#1", capture_view: false }, deps({ store }));
    expect(empty.isError).toBe(true);
  });
});

describe("payload routine", () => {
  it("nesie len číslo, guid a krátky opis; podrobnosti si session prečíta z témy", () => {
    const text = bcfFirePayload({
      id: "g",
      number: 4,
      model: null,
      topic_type: "Request",
      title: "Premenuj dvere",
      components: [G1, G2],
    } as BcfTopicRow);
    expect(text.split("\n")).toEqual([
      "BCF téma z MCP konektora AIM (D-099).",
      "tema: #4",
      "guid: g",
      "model: federacia",
      "typ: Request",
      "nazov: Premenuj dvere",
      "prvkov: 2",
    ]);
  });
});

describe("oznámenie viewerom (D-099 dodatok)", () => {
  it("zápis cez tool oznámi zmenu, zoznam ani chybný vstup nie", async () => {
    const notify = vi.fn(async () => undefined);
    const d = deps({ notify });
    await run("bcf_topic_list", {}, d);
    await run("bcf_topic", { action: "create", title: " " }, d);
    expect(notify).not.toHaveBeenCalled();
    await run("bcf_topic", { action: "create", title: "t" }, d);
    await run("bcf_topic", { action: "update", guid: "#1", comment: "c" }, d);
    await run("bcf_topic", { action: "close", guid: "#1" }, d);
    expect(notify).toHaveBeenCalledTimes(3);
    const broken = await run("bcf_topic", { action: "create", title: "u" }, deps({ notify: async () => Promise.reject(new Error("x")) }));
    expect(broken.isError).toBe(false);
  });
});
