import { describe, expect, it } from "vitest";

import { disciplineOf, documentMeta, floorDrawing, META_VALUES_SEPARATOR, pickFloorDrawing, type FloorDrawingCandidate } from "./document-meta";

describe("documentMeta (D-104 krok 3)", () => {
  it("skladá slovenské kľúče na zoskupenie; projekt ako nositeľ len keď nie je iný", () => {
    const meta = documentMeta({
      identification: "OCB_SO01_ASR_D-1-1-04_PODORYS-STRECHY",
      folder: ["D.1.1 Architektonicko-stavebné riešenie"],
      type: "DR Výkres",
      holders: [
        { objectType: "project", name: "OCB" },
        { objectType: "floor", name: "5NP", ifcGuid: "g5" },
        { objectType: "floor", name: "4NP", ifcGuid: "g4" },
      ],
      lastRevisionTime: "2025-01-15 19:56:14+00",
      electronicFormat: "application/pdf",
      owner: "Samuel Augustín (Assetin s.r.o.)",
    });
    expect(meta).toEqual({
      "Identifikácia": "OCB_SO01_ASR_D-1-1-04_PODORYS-STRECHY",
      "Časť": "D.1.1 Architektonicko-stavebné riešenie",
      "Druh": "DR Výkres",
      "Nositeľ": "podlažie",
      "Podlažie": ["4NP", "5NP"].join(META_VALUES_SEPARATOR),
      "Revízia": "2025-01-15",
      "Formát": "PDF",
      "Vlastník": "Samuel Augustín (Assetin s.r.o.)",
    });
    const projectOnly = documentMeta({
      identification: null, holders: [{ objectType: "project", name: "OCB" }],
      lastRevisionTime: null, electronicFormat: null, owner: null,
    });
    expect(projectOnly).toEqual({ "Nositeľ": "projekt" });
  });

  it("druh média je druhá os vedľa typu informácie (D-131)", () => {
    const meta = documentMeta({
      identification: null, type: "RP Správa", mediaKind: "Fotografia",
      holders: [{ objectType: "space", name: "3.12" }],
      lastRevisionTime: null, electronicFormat: "image/jpeg", owner: null,
    });
    expect(meta).toEqual({ "Druh": "RP Správa", "Druh média": "Fotografia", "Nositeľ": "miestnosť", "Formát": "JPEG" });
  });

  it("pôdorys podlažia: výkres na podlaží, storeyGuid len pri jednom podlaží", () => {
    const floor = (name: string, ifcGuid: string) => ({ objectType: "floor", name, ifcGuid });
    expect(floorDrawing([floor("1NP", "g1"), { objectType: "project", name: "OCB" }], "DR")).toEqual({
      drawing: true, storeyGuid: "g1",
    });
    expect(floorDrawing([floor("4NP", "g4"), floor("5NP", "g5")], undefined)).toEqual({ drawing: true });
    expect(floorDrawing([floor("1NP", "g1")], "RP")).toEqual({ drawing: false });
    expect(floorDrawing([{ objectType: "zone", name: "Z3" }], "DR")).toEqual({ drawing: false });
  });
});

describe("výkres podlažia pre split (D-176, #316)", () => {
  const c = (documentId: string, ref: string, floorGuids: string[]): FloorDrawingCandidate => ({ documentId, ref, discipline: disciplineOf(ref), floorGuids });
  const ASR4 = c("a4", "OCB_SO01_ASR_D-1-1-04_PODORYS-STRECHY", ["g4", "g5"]);
  const PBR4 = c("p4", "OCB_SO01_PBR_D-1-3-05_PODORYS-4NP", ["g4"]);
  const ASR1 = c("a1", "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP", ["g1"]);
  const PBR1 = c("p1", "OCB_SO01_PBR_D-1-3-02_PODORYS-1NP", ["g1"]);
  const STA1 = c("s1", "OCB_SO01_STA_D-1-2-01_PODORYS-ZAKLADOV", ["g1"]);

  it("disciplína z kódu dokumentu", () => {
    expect(disciplineOf("OCB_SO01_ASR_D-1-1-01_PODORYS-1NP")).toBe("ASR");
    expect(disciplineOf("ocb_so01_pbr_x")).toBe("PBR");
    expect(disciplineOf("Pôdorys 1NP")).toBeNull();
    expect(disciplineOf(null)).toBeNull();
  });

  it("predvolene ASR pôdorys podlažia, nie požiarny plán", () => {
    const p = pickFloorDrawing([PBR1, STA1, ASR1, PBR4], "g1");
    expect(p).toMatchObject({ ok: true, chosen_by: "preference", drawing: { documentId: "a1" } });
    expect(p.ok && p.alternatives.map((a) => a.documentId)).toEqual(["s1", "p1"]);
  });

  it("PBR len keď iný výkres podlažia nie je; ASR spoločný pre viac podlaží (strecha) je pred PBR", () => {
    expect(pickFloorDrawing([PBR1], "g1")).toMatchObject({ ok: true, drawing: { documentId: "p1" } });
    expect(pickFloorDrawing([PBR4, ASR4], "g4")).toMatchObject({ ok: true, drawing: { documentId: "a4" } });
    // ASR jedného podlažia je pred ASR spoločným
    expect(pickFloorDrawing([ASR4, c("a4b", "OCB_SO01_ASR_D-1-1-09_PODORYS-4NP", ["g4"])], "g4")).toMatchObject({ drawing: { documentId: "a4b" } });
  });

  it("výslovná disciplína vyberie PBR; neznáma vráti dostupné; podlažie bez výkresu", () => {
    expect(pickFloorDrawing([ASR1, PBR1], "g1", "pbr")).toMatchObject({ ok: true, chosen_by: "discipline", drawing: { documentId: "p1" } });
    expect(pickFloorDrawing([ASR1, PBR1], "g1", "VZT")).toEqual({ ok: false, reason: "no_discipline", available: ["ASR", "PBR"] });
    expect(pickFloorDrawing([ASR1], "g9")).toEqual({ ok: false, reason: "no_drawing", available: [] });
  });
});

