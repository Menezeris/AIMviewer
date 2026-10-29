import { describe, expect, it } from "vitest";

import { shouldClearFocusOnEscape } from "./viewer-escape";

const target = (editable: boolean) => ({ closest: () => (editable ? {} : null) }) as unknown as EventTarget;
const esc = (over: Partial<Parameters<typeof shouldClearFocusOnEscape>[0]> = {}) => ({ key: "Escape", target: target(false), ...over });

describe("shouldClearFocusOnEscape (#94)", () => {
  it("Esc mimo polí a bez otvoreného dialógu zruší zvýraznenie", () => {
    expect(shouldClearFocusOnEscape(esc(), false)).toBe(true);
    expect(shouldClearFocusOnEscape(esc({ target: null }), false)).toBe(true);
  });

  it("iná klávesa nie", () => {
    expect(shouldClearFocusOnEscape(esc({ key: "Enter" }), false)).toBe(false);
  });

  it("Esc v input/textarea/select/contenteditable patrí poľu", () => {
    expect(shouldClearFocusOnEscape(esc({ target: target(true) }), false)).toBe(false);
  });

  it("Esc, ktorý zatvára dialóg alebo popover, zvýraznenie nezruší", () => {
    expect(shouldClearFocusOnEscape(esc(), true)).toBe(false);
  });

  it("už spracovaný Esc a IME kompozícia nie", () => {
    expect(shouldClearFocusOnEscape(esc({ defaultPrevented: true }), false)).toBe(false);
    expect(shouldClearFocusOnEscape(esc({ isComposing: true }), false)).toBe(false);
  });
});
