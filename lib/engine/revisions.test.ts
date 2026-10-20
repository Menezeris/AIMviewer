import { describe, expect, it } from "vitest";

import { revisionsFor, shapeRevision, type ModelRevisionRow } from "./revisions";
import { execEngineTool, type EngineDeps } from "./tools";

const row = (revision: number, extra: Partial<ModelRevisionRow> = {}): ModelRevisionRow => ({
  model: "ASR",
  revision,
  parent_revision: revision - 1,
  is_current: false,
  sha256: `sha-${revision}`,
  size_bytes: 1000 + revision,
  recipe_ref: null,
  summary: null,
  author: null,
  guard: null,
  created_at: `2026-10-19T1${revision % 10}:00:00Z`,
  ...extra,
});

describe("revízie modelu (D-109)", () => {
  it("shapeRevision: vNNN, poistka s počtami a skrátenými GUIDmi, cesta k zoznamu zmien", () => {
    const added = Array.from({ length: 25 }, (_, i) => `G${i}`);
    const shaped = shapeRevision(
      row(75, {
        is_current: true,
        author: "bcf-tema-3",
        summary: "schodisko SC01",
        recipe_ref: "recepty/ASR/v075-schodisko-sc01.py@8514838",
        guard: { ok: true, schema: "IFC4X3_ADD2", objects: 5000, added, removed: [], class_delta: { IfcStair: 1 } },
      }),
    );
    expect(shaped).toMatchObject({
      revision: 75,
      label: "v075",
      parent: 74,
      current: true,
      author: "bcf-tema-3",
      summary: "schodisko SC01",
      recipe: "recepty/ASR/v075-schodisko-sc01.py@8514838",
      changes_file: "Menezeris/OCB: zmeny/ASR/v075.json",
      guard: { ok: true, schema: "IFC4X3_ADD2", objects: 5000, added: 25, removed: 0, class_delta: { IfcStair: 1 } },
    });
    expect((shaped.guard as { added_guids: string[] }).added_guids).toHaveLength(20);
    expect(shaped.guard).not.toHaveProperty("removed_guids");
  });

  it("revisionsFor: aktuálna aj po návrate (nie najnovšia), história najnovšie prvé", () => {
    const rows = [row(73), row(75), row(74, { is_current: true }), row(2, { model: "VZT", is_current: true })];
    const asr = revisionsFor("ASR", rows, 2);
    expect(asr.current).toMatchObject({ revision: 74, current: true });
    expect(asr.history?.map((h) => h.revision)).toEqual([75, 74]);
    expect(revisionsFor("VZT", rows, 0)).toEqual({ current: expect.objectContaining({ revision: 2 }) });
    expect(revisionsFor("XYZ", rows, 0).current).toBeNull();
  });
});

describe("ifc_models s revíziou (D-109)", () => {
  const base: EngineDeps = {
    sources: () => [{ id: "ASR", label: "Architektúra", url: "https://example.test/ifc/ASR.ifc" }],
    lookup: async () => new Map(),
    resolveTargets: async () => new Map(),
  };

  it("pridá aktuálnu revíziu a na history aj predchádzajúce; kľúč z mena súboru", async () => {
    const asked: Array<[string[], number]> = [];
    const deps: EngineDeps = {
      ...base,
      revisions: async (models, perModel) => {
        asked.push([models, perModel]);
        return [row(75, { is_current: true }), row(74)];
      },
    };
    const plain = JSON.parse((await execEngineTool("ifc_models", {}, deps)).content);
    expect(plain.models[0].revision).toMatchObject({ label: "v075", current: true });
    expect(plain.models[0]).not.toHaveProperty("history");
    expect(plain.loaded_means).toMatch(/viewer/);
    const hist = JSON.parse((await execEngineTool("ifc_models", { history: 2 }, deps)).content);
    expect(hist.models[0].history.map((h: { label: string }) => h.label)).toEqual(["v075", "v074"]);
    expect(asked).toEqual([[["ASR"], 1], [["ASR"], 2]]);
  });

  it("chyba DB nezhodí zoznam modelov; bez zdroja revízií pole revision chýba", async () => {
    const broken = JSON.parse(
      (await execEngineTool("ifc_models", {}, { ...base, revisions: async () => { throw new Error("db down"); } })).content,
    );
    expect(broken.models[0].model).toBe("ASR");
    expect(broken.revision_error).toBe("db down");
    expect(broken.models[0]).not.toHaveProperty("revision");
    const none = JSON.parse((await execEngineTool("ifc_models", {}, base)).content);
    expect(none.models[0]).not.toHaveProperty("revision");
  });
});
