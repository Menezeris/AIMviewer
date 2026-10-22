import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

import type { AskAction } from "./actions";
import { execLensStyle, resolveFilter, type GroupInfo } from "./style-lens";
import type { ScopeResolver } from "./style-scope";

const OPTS = { domainTypes: { hvac: ["IfcDuctSegment"] } };
const opsOf = (a: AskAction) => decodeURIComponent(new URL(a.url, "http://x").searchParams.get("ops") ?? "");

describe("style_in_3d legenda a rez (D-125)", () => {
  it("action=legend je predvolene malá karta (compact), large a normal ostávajú", async () => {
    const pushed: AskAction[] = [];
    const { result } = await execLensStyle("legend", {}, (a) => pushed.push(a), OPTS);
    expect(result.legend_size).toBe("compact");
    expect(pushed[0].label).toBe("3D: legenda AIM chat");
    await execLensStyle("legend", { legend_size: "large" }, (a) => pushed.push(a), OPTS);
    expect(pushed[1].label).toBe("3D: veľká legenda");
  });

  it("clear_section=true dá pred lens op zrušenie rezu v tom istom príkaze (#177)", async () => {
    const pushed: AskAction[] = [];
    const { result } = await execLensStyle("isolate", { ifc_type: "IfcDuctSegment", clear_section: true }, (a) => pushed.push(a), OPTS);
    expect(opsOf(pushed[0])).toMatch(/^section_clear::;lens:add/);
    expect(result.section_cleared).toBe(true);
    await execLensStyle("isolate", { ifc_type: "IfcDuctSegment" }, (a) => pushed.push(a), OPTS);
    expect(opsOf(pushed[1])).toMatch(/^lens:add/);
  });
});

describe("isolate a mode=replace (#219)", () => {
  it("mode=replace upozorní, že zrušil doterajšie pravidlá Lens; predvolené add nie", async () => {
    const { result } = await execLensStyle("isolate", { ifc_type: "IfcDuctSegment", mode: "replace" }, () => {}, OPTS);
    expect(String((result.warnings as string[])[0])).toMatch(/mode=replace zrušil/);
    const add = await execLensStyle("isolate", { ifc_type: "IfcDuctSegment" }, () => {}, OPTS);
    expect(add.result.warnings).toBeUndefined();
  });

  it("neznámy kľúč v groups sa nahlási, floor je alias storey", async () => {
    const { result } = await execLensStyle("isolate", { groups: [{ color: "ef4444", ifc_type: "IfcWall", level: "3NP" }] }, () => {}, OPTS);
    expect(String((result.warnings as string[])[0])).toMatch(/level/);
  });
});

describe("viac systémov vo filtri (#177)", () => {
  const SYSTEMS = [
    { id: "s1", object_type: "system", object_ref: "Prívod", name: "Prívod", predefined_type: "VENTILATION", user_defined_type: null },
    { id: "s2", object_type: "system", object_ref: "Odpadné hospodárstvo", name: "Odpadné hospodárstvo", predefined_type: "VENTILATION", user_defined_type: null },
  ];
  const scope = (systems: typeof SYSTEMS) =>
    ({
      pickSystems: async () => systems,
      systemMemberCounts: async (s: typeof SYSTEMS) => s.map((x) => (x.id === "s1" ? 120 : 4)),
      explicitIds: async () => null,
    }) as unknown as ScopeResolver;

  it("vypíše každý systém s typom a počtom členov a varuje", async () => {
    const info: GroupInfo = { label: "Privodne" };
    await resolveFilter(scope(SYSTEMS), { system_type: "VENTILATION" }, OPTS, info, { left: 10 });
    expect(info.system_members).toEqual([
      { system: "Prívod", type: "VENTILATION", elements: 120 },
      { system: "Odpadné hospodárstvo", type: "VENTILATION", elements: 4 },
    ]);
    expect(info.warning).toMatch(/zobral 2 systémov.*'Privodne'/);
  });

  it("jeden systém bez varovania", async () => {
    const info: GroupInfo = { label: "Prívod" };
    await resolveFilter(scope(SYSTEMS.slice(0, 1)), { system: "Prívod" }, OPTS, info, { left: 10 });
    expect(info.system_members).toBeUndefined();
    expect(info.warning).toBeUndefined();
  });
});

describe("priehľadnosť colorize (D-139, #222)", () => {
  const rulesOf = (a: AskAction) => (JSON.parse(Buffer.from(opsOf(a).split(":").pop() ?? "", "base64url").toString()) as { r: { n: string; a: string }[] }).r;

  it("colorize IfcSpace je predvolene priesvitný, opacity=1 vynúti plnú farbu", async () => {
    const pushed: AskAction[] = [];
    const { result } = await execLensStyle("colorize", { ifc_type: "IfcSpace", color: "22c55e" }, (a) => pushed.push(a), OPTS);
    expect(rulesOf(pushed[0])[0].a).toBe("transparent");
    expect((result.groups as GroupInfo[])[0].opacity).toBe(0.3);
    await execLensStyle("colorize", { ifc_type: "IfcSpace", color: "22c55e", opacity: 1 }, (a) => pushed.push(a), OPTS);
    expect(rulesOf(pushed[1])[0].a).toBe("colorize");
  });

  it("opacity < 1 spraví priesvitnou aj iný prvok, opacity mimo rozsahu je chyba", async () => {
    const pushed: AskAction[] = [];
    await execLensStyle("colorize", { ifc_type: "IfcWall", color: "ef4444", opacity: 0.3 }, (a) => pushed.push(a), OPTS);
    expect(rulesOf(pushed[0])[0].a).toBe("transparent");
    await expect(execLensStyle("colorize", { ifc_type: "IfcWall", color: "ef4444", opacity: 2 }, () => {}, OPTS)).rejects.toThrow(/opacity/);
  });

  it("plne ofarbená stena spolu s ďalšou farbou varuje, že zakryje ostatné", async () => {
    const { result } = await execLensStyle(
      "colorize",
      { groups: [{ color: "999999", ifc_type: "IfcWall" }, { color: "f97316", ifc_type: "IfcDoor" }] },
      () => {},
      OPTS,
    );
    expect((result.warnings as string[]).join(" ")).toMatch(/zakryť/);
  });
});
