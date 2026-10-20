import { describe, expect, it, vi } from "vitest";

// Moduly sú server-only (D-026) a DB sa v týchto testoch nesmie volať: zlý vstup sa odmietne skôr.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    throw new Error("DB sa nemá volať");
  },
}));

import { AskToolRuntime, TOOL_DEFINITIONS } from "./tools";

const OLD_NAMES = ["count_objects", "locate_objects", "get_asset_details", "get_spatial_path", "find_in_drawings", "select_in_3d"];

describe("zlúčené tooly AIM (D-115)", () => {
  it("v zozname sú zlúčené tooly, staré mená nie", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_objects", "get_object", "show_in_3d"]));
    expect(names.filter((n) => OLD_NAMES.includes(n))).toEqual([]);
    const props = (n: string) => Object.keys((TOOL_DEFINITIONS.find((t) => t.name === n)!.inputSchema as { properties: object }).properties);
    expect(props("search_objects")).toEqual(expect.arrayContaining(["mode", "ids"]));
    expect(props("get_object")).toContain("include");
    expect(props("show_in_3d")).toEqual(expect.arrayContaining(["select", "panel_tab", "panel_section", "highlight"]));
  });

  it("zlý režim a include sa odmietnu pred dotazom do DB", async () => {
    const rt = new AskToolRuntime();
    const mode = await rt.exec("search_objects", { mode: "zle" });
    expect(mode).toMatchObject({ isError: true });
    expect(mode.content).toContain("list | count | locate");
    const include = await rt.exec("get_object", { id_or_ref: "DD01.02.0004", include: ["materials"] });
    expect(include.content).toContain("details | path | documents");
  });

  it("show_in_3d select=true ide cez výber (panel sa overí pred DB), clear zruší výber", async () => {
    const rt = new AskToolRuntime();
    const bad = await rt.exec("show_in_3d", { select: true, id_or_ref: "DD01.02.0004", panel_tab: "zle" });
    expect(bad.isError).toBe(true);
    const cleared = await rt.exec("show_in_3d", { select: true, clear: true });
    expect(JSON.parse(cleared.content)).toMatchObject({ ok: true, cleared: "výber" });
    expect(rt.finalActions()[0].url).toContain("clear_selection");
  });

  it("staré mená zlúčených toolov sa už nevykonajú (aliasy D-115 zrušené)", async () => {
    const rt = new AskToolRuntime();
    for (const name of OLD_NAMES) {
      const res = await rt.exec(name, { id_or_ref: "DD01.02.0004" });
      expect(res, name).toMatchObject({ isError: true });
      expect(res.content).toContain("Neznámy tool");
    }
  });
});
