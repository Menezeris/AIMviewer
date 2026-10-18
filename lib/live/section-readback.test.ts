import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readBackSection } from "./section-readback";

describe("potvrdenie rezu zo živého viewera (D-092)", () => {
  it("vráti rez, ktorý hlási viewer", async () => {
    const section = { axis: "y", coordinate_m: 10.2, percent: 48 };
    const line = await readBackSection("k", async () => ({ ok: true, reply: { id: "a", ok: true, result: { mode: "3d", section } } }));
    expect(line).toContain(JSON.stringify({ viewer_section: section }));
  });

  it("bez rezu v stave vráti null, nie celý stav viewera", async () => {
    const line = await readBackSection("k", async () => ({ ok: true, reply: { id: "a", ok: true, result: { mode: "3d" } } }));
    expect(line).toContain('{"viewer_section":null}');
  });

  it("timeout, chyba viewera aj výnimka kanála povedia, že poloha nie je potvrdená", async () => {
    expect(await readBackSection("k", async () => ({ ok: false, reason: "timeout" }))).toMatch(/nepotvrdil/);
    expect(await readBackSection("k", async () => ({ ok: true, reply: { id: "a", ok: false, error: "no model" } }))).toMatch(
      /no model/,
    );
    expect(
      await readBackSection("k", async () => {
        throw new Error("ws");
      }),
    ).toMatch(/get_viewer_state/);
  });
});
