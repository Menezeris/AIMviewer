import { describe, expect, it } from "vitest";

import { documentMeta, floorDrawing, META_VALUES_SEPARATOR } from "./document-meta";

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
