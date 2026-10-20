import { describe, expect, it, vi } from "vitest";

// Modul je server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { VIEWER_QUERY_TOOL_DEFINITIONS, viewerQueryOf } from "./viewer-query-tools";

describe("get_viewer_state s obálkami (D-115)", () => {
  it("bounds alebo cieľ = obálky; inak stav", () => {
    expect(viewerQueryOf({})).toBe("view_state");
    expect(viewerQueryOf({ items_limit: 10 })).toBe("view_state");
    expect(viewerQueryOf({ bounds: true })).toBe("bounds");
    expect(viewerQueryOf({ target_ids_or_refs: ["DD01.02.0004"] })).toBe("bounds");
    expect(viewerQueryOf({ global_ids: ["0EUvFRlAzBAutkeDMKNCHH"] })).toBe("bounds");
  });

  it("v zozname je len get_viewer_state", () => {
    expect(VIEWER_QUERY_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(["get_viewer_state"]);
  });
});
