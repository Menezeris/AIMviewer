import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

import { appliedWarnings } from "../live/applied-text";
import { lensCountsText } from "../live/lens-counts";
import type { AskAction } from "./actions";
import { execLensStyle } from "./style-lens";
import { inactiveRuleWarnings, lensPriorityOrder } from "./style-overlap";

const OPTS = { domainTypes: { hvac: ["IfcDuctSegment"] } };
const wireOf = (a: AskAction) => {
  const op = decodeURIComponent(new URL(a.url, "http://x").searchParams.get("ops") ?? "");
  return JSON.parse(Buffer.from(op.split(":")[2], "base64url").toString("utf8")) as { r: { n: string }[] };
};

describe("priorita prekrytých pravidiel (#221)", () => {
  it("lensPriorityOrder otočí poradie bez zmeny vstupu", () => {
    const src = [1, 2, 3];
    expect(lensPriorityOrder(src)).toEqual([3, 2, 1]);
    expect(src).toEqual([1, 2, 3]);
  });

  it("posledná skupina volania ide do wire prvá (Lens farbí prvou zhodou) a odpoveď to povie", async () => {
    const pushed: AskAction[] = [];
    const { result } = await execLensStyle(
      "colorize",
      { groups: [{ label: "Prívod", color: "ef4444", ifc_type: "IfcDuctSegment" }, { label: "Trasa", color: "ec4899", ifc_type: "IfcAirTerminal" }] },
      (a) => pushed.push(a),
      OPTS,
    );
    expect(wireOf(pushed[0]).r.map((r) => r.n)).toEqual(["Trasa", "Prívod"]);
    expect((result.warnings as string[]).join(" ")).toMatch(/neskoršia skupina/);
  });

  it("pravidlo s 0 prvkami: pod pravidlom so zásahom = prekryté alebo filter, inak filter nič nenašiel", () => {
    const rules = [
      { name: "Trasa", count: 19 },
      { name: "Prívod", count: 1259 },
      { name: "Odvod", count: 0, inactive: true },
    ];
    const w = inactiveRuleWarnings(rules);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/'Odvod'.*prekryli.*Trasa, Prívod/);
    expect(inactiveRuleWarnings([{ name: "Prázdne", count: 0, inactive: true }])[0]).toMatch(/filter nič nenašiel/);
    expect(inactiveRuleWarnings([{ name: "A", count: 3 }])).toEqual([]);
    expect(inactiveRuleWarnings(undefined)).toEqual([]);
  });

  it("varovanie ide do potvrdenia aj do textu s počtami", async () => {
    const lens = { rules: [{ name: "A", count: 5 }, { name: "B", count: 0, inactive: true }] };
    const w = appliedWarnings("style_in_3d", { cmdId: "c", ok: true, issues: [], state: { lens } });
    expect(w.join(" ")).toMatch(/'B'/);
    expect(appliedWarnings("show_in_3d", { cmdId: "c", ok: true, issues: [], state: { lens } })).toEqual([]);
    const text = await lensCountsText("ch", "r", (async () => ({ ok: true, reply: { ok: true, result: lens } })) as never);
    expect(text).toMatch(/^POZOR: Pravidlo 'B'/);
  });
});
