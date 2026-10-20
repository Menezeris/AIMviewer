import { describe, expect, it, vi } from "vitest";

// Modul je server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { VIEWER_QUERY_TOOL_DEFINITIONS, viewerQueryOf } from "./viewer-query-tools";

describe("get_viewer_state s obálkami (D-115)", () => {
  it("bounds, cieľ alebo staré meno get_bounds = obálky; inak stav", () => {
    expect(viewerQueryOf("get_viewer_state", {})).toBe("view_state");
    expect(viewerQueryOf("get_viewer_state", { items_limit: 10 })).toBe("view_state");
    expect(viewerQueryOf("get_viewer_state", { bounds: true })).toBe("bounds");
    expect(viewerQueryOf("get_viewer_state", { target_ids_or_refs: ["DD01.02.0004"] })).toBe("bounds");
    expect(viewerQueryOf("get_viewer_state", { global_ids: ["0EUvFRlAzBAutkeDMKNCHH"] })).toBe("bounds");
    expect(viewerQueryOf("get_bounds", {})).toBe("bounds");
  });

  it("v zozname je len get_viewer_state", () => {
    expect(VIEWER_QUERY_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(["get_viewer_state"]);
  });
});
