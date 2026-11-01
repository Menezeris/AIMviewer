import { describe, expect, it } from "vitest";

import { bcfImportedMessage, parseBcfImport, summaryToWire } from "./viewer-bcf-import";

describe("BCF_IMPORT z viewera", () => {
  it("prijme platnú správu a predvolene nie je dry_run", () => {
    const bytes = new ArrayBuffer(4);
    expect(parseBcfImport({ type: "BCF_IMPORT", id: "a1", name: " t.bcfzip ", bytes })).toEqual({ id: "a1", name: "t.bcfzip", bytes, dry_run: false });
    expect(parseBcfImport({ type: "BCF_IMPORT", id: "a1", bytes, dry_run: true })?.dry_run).toBe(true);
    expect(parseBcfImport({ type: "BCF_IMPORT", id: "a1", bytes })?.name).toBe("import.bcfzip");
  });

  it("odmietne neplatný tvar", () => {
    expect(parseBcfImport(null)).toBeNull();
    expect(parseBcfImport({ type: "BCF_IMPORT", id: "", bytes: new ArrayBuffer(1) })).toBeNull();
    expect(parseBcfImport({ type: "BCF_IMPORT", id: "x", bytes: "abc" })).toBeNull();
    expect(parseBcfImport({ type: "ICDD_CHECK", id: "x", bytes: new ArrayBuffer(1) })).toBeNull();
  });

  it("súhrn zúži na čísla a varovania, témy neposiela", () => {
    const wire = summaryToWire({ dry_run: true, bcf_version: "2.1", topics_in_file: 3, created: 1, updated: 1, unchanged: 1, conflicts: 0, skipped: 0, failed: 0, topics: [{ guid: "g" }], warnings: ["w", 5] });
    expect(wire).toEqual({ dry_run: true, bcf_version: "2.1", topics_in_file: 3, created: 1, updated: 1, unchanged: 1, conflicts: 0, skipped: 0, failed: 0, warnings: ["w"] });
    expect("topics" in wire).toBe(false);
  });

  it("odpoveď BCF_IMPORTED nesie id a skráti chybu", () => {
    expect(bcfImportedMessage("a1", { ok: false, error: "x".repeat(3000) })).toMatchObject({ type: "BCF_IMPORTED", id: "a1", ok: false });
    expect((bcfImportedMessage("a1", { ok: false, error: "x".repeat(3000) }).error as string).length).toBe(2000);
  });
});
