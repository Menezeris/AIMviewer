import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

import { opToBridgeMessage, parseOps } from "../viewer-ops";
import type { AskAction } from "./actions";
import { execListTool, parseListEditInput, parseListViewInput } from "./list-tool";
import { StyleInputError } from "./style-plan";

const opsOf = (a: AskAction) => decodeURIComponent(new URL(a.url, "http://x").searchParams.get("ops") ?? "");
const bridge = (a: AskAction) => opToBridgeMessage(parseOps(opsOf(a))[0]) as Record<string, unknown>;
const VOL = "Qto_ColumnBaseQuantities.NetVolume";

describe("open_list úpravy zoznamu (D-149)", () => {
  it("view parametre sa preložia na stĺpce menom; nič z nich = undefined", () => {
    expect(parseListViewInput({})).toBeUndefined();
    expect(parseListViewInput({ maximize: true, sort_by: VOL, sort_dir: "desc", sum: [VOL], group_by: ["storey"], search: "3NP" })).toEqual({
      m: true,
      o: { c: { s: "quantity", p: "Qto_ColumnBaseQuantities", k: "NetVolume" }, d: "desc" },
      sum: [{ s: "quantity", p: "Qto_ColumnBaseQuantities", k: "NetVolume" }],
      gb: [{ s: "spatial", k: "Storey", l: "Podlažie" }],
      q: "3NP",
    });
    expect(parseListViewInput({ sort_by: "", sum: [] })).toEqual({ o: null, sum: [] });
    expect(() => parseListViewInput({ maximize: "áno" })).toThrow(StyleInputError);
    expect(() => parseListViewInput({ sort_by: "Name", sort_dir: "up" })).toThrow(StyleInputError);
    expect(() => parseListViewInput({ sum: VOL })).toThrow(StyleInputError);
  });

  it("action=update bez filtra pošle LIST_UPDATE len s view, bez nového zoznamu", async () => {
    const pushed: AskAction[] = [];
    const result = await execListTool("open_list", { action: "update", maximize: true, sum: [VOL] }, (a) => pushed.push(a));
    expect(result).toMatchObject({ ok: true, updated: "lists", view: { maximize: true, sum: [VOL] } });
    expect(bridge(pushed[0])).toEqual({
      type: "LIST_UPDATE",
      groups: [],
      view: { maximize: true, sum: [{ source: "quantity", propertyName: "NetVolume", psetName: "Qto_ColumnBaseQuantities" }] },
    });
  });

  it("action=update s filtrom ho pošle ako skupinu na pridanie (AND); stĺpce a prázdna úprava sú chyba", async () => {
    const pushed: AskAction[] = [];
    await execListTool("open_list", { action: "update", ifc_type: "IfcColumn", sort_by: VOL }, (a) => pushed.push(a));
    const msg = bridge(pushed[0]) as { type: string; groups: Array<{ rules: Array<{ kind: string }> }>; view: unknown };
    expect(msg.type).toBe("LIST_UPDATE");
    expect(msg.groups[0].rules[0].kind).toBe("ifcType");
    expect(msg.view).toEqual({ sort: { column: { source: "quantity", propertyName: "NetVolume", psetName: "Qto_ColumnBaseQuantities" }, dir: "asc" } });
    await expect(execListTool("open_list", { action: "update" }, () => {})).rejects.toThrow(StyleInputError);
    await expect(execListTool("open_list", { action: "update", columns: ["Name"] }, () => {})).rejects.toThrow(/add_columns/);
    await expect(execListTool("open_list", { action: "zmaž" }, () => {})).rejects.toThrow(/open alebo update/);
  });

  it("open s view nesie view v OPEN_LIST a vo výsledku toolu", async () => {
    const pushed: AskAction[] = [];
    const result = await execListTool("open_list", { ifc_type: "IfcColumn", columns: ["Name", "storey", VOL], run: true, maximize: true, sum: [VOL] },
      (a) => pushed.push(a));
    expect(result.view).toEqual({ maximize: true, sum: [VOL] });
    expect(bridge(pushed[0])).toMatchObject({ type: "OPEN_LIST", run: true, view: { maximize: true, sum: [{ propertyName: "NetVolume" }] } });
  });

  it("krok 2: stĺpce, triedy, odobratie filtrov, farby a export idú v LIST_UPDATE", async () => {
    const pushed: AskAction[] = [];
    const FIRE = "Pset_ColumnCommon.FireRating";
    const result = await execListTool(
      "open_list",
      { action: "update", add_columns: [FIRE], remove_columns: ["GlobalId"], add_types: ["IfcBeam", "Ifc Wall"], remove_types: ["IfcColumn"],
        remove_filter: ["storey", "zone", "global_ids"], color_by: FIRE, export: "xlsx" },
      (a) => pushed.push(a),
    );
    expect(result).toMatchObject({
      edit: { add_columns: [FIRE], remove_columns: ["GlobalId"], add_types: ["IfcBeam", "IfcWall"], remove_types: ["IfcColumn"], remove_filter: ["storey", "globalId"] },
      view: { color_by: FIRE, export: "xlsx" },
    });
    expect(String(result.next_step)).toContain("Stiahnuť");
    const FIRE_REF = { source: "property", propertyName: "FireRating", psetName: "Pset_ColumnCommon" };
    expect(bridge(pushed[0])).toEqual({
      type: "LIST_UPDATE",
      groups: [],
      view: { colorBy: FIRE_REF, export: "xlsx" },
      edit: {
        addColumns: [FIRE_REF],
        removeColumns: [{ source: "attribute", propertyName: "GlobalId" }],
        addTypes: ["IfcBeam", "IfcWall"],
        removeTypes: ["IfcColumn"],
        removeFilters: ["storey", "globalId"],
      },
    });
  });

  it("krok 2: podlažie pri update ide ako filter (viewer ho prepne), zlé vstupy sú chyba", async () => {
    expect(parseListEditInput({})).toBeUndefined();
    expect(parseListEditInput({ remove_filter: "all" })).toEqual({ rf: ["all"] });
    expect(() => parseListEditInput({ remove_filter: ["ifc_type"] })).toThrow(/remove_types/);
    expect(() => parseListEditInput({ add_types: ["Beam"] })).toThrow(StyleInputError);
    expect(() => parseListEditInput({ add_columns: [] })).toThrow(StyleInputError);
    expect(() => parseListViewInput({ color_by: "storey" })).toThrow(/farbiť nevie/);
    expect(() => parseListViewInput({ export: "docx" })).toThrow(/csv, xlsx alebo pdf/);
    expect(parseListViewInput({ color_by: "" })).toEqual({ cb: null });
    await expect(execListTool("open_list", { ifc_type: "IfcColumn", add_types: ["IfcBeam"] }, () => {})).rejects.toThrow(/action=update/);
  });
});
