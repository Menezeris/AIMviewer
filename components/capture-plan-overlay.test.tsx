import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CapturePlanOverlay } from "./capture-plan-overlay";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/drawing/6457abc6-f5fa-4d74-8d2e-4676fe85dfb1",
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

describe("CapturePlanOverlay", () => {
  // The layer spans the whole rendered page above the drawing's element links: if it caught the
  // pointer, no link of the drawing could be clicked (found in the control round, Nov 2026).
  it("lets clicks through to the drawing links outside placement mode", () => {
    nav.search = "";
    const html = renderToStaticMarkup(<CapturePlanOverlay page={1} dims={{ width: 800, height: 600 }} />);
    const root = /^<div[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(root.split(" ")).toContain("pointer-events-none");
    expect(html).not.toContain("cursor-crosshair");
  });

  it("catches clicks with its own layer in placement mode", () => {
    nav.search = "placeCapture=0b6b5b2c-1d4e-4c53-9d6a-6f1f6b7f8a11";
    const html = renderToStaticMarkup(<CapturePlanOverlay page={1} dims={{ width: 800, height: 600 }} />);
    expect(html).toMatch(/class="pointer-events-auto absolute inset-0 cursor-crosshair/);
  });
});
