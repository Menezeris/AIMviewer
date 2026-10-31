import { describe, expect, it } from "vitest";

import type { CheckResult, ExportResult } from "@/lib/icdd/client";

import { parseIcddRequest, runIcddRequest, type IcddStatus } from "./viewer-icdd";

const report = (ok: boolean) => ({
  ok,
  issues: ok ? [] : [{ level: "error" as const, code: "checksum", where: "Payload documents/a.pdf", message: "nesedí" }],
  stats: { documents: 1, linksets: 1, links: 1, triples: 1 },
  contents: null,
});

const exportResult = (ok: boolean): ExportResult =>
  ({
    plan: { payloads: [{}], links: [{}, {}], warnings: ["w"], skipped: { document_without_file: 10 } },
    filename: "AIM_x.icdd",
    bytes: new Uint8Array(5),
    report: report(ok),
  }) as unknown as ExportResult;

describe("ICDD most (D-181)", () => {
  it("overí tvar správ z viewera", () => {
    expect(parseIcddRequest({ type: "ICDD_EXPORT", id: "a" })).toEqual({ op: "export", id: "a" });
    const buf = new Uint8Array([1, 2]).buffer;
    expect(parseIcddRequest({ type: "ICDD_CHECK", id: "b", name: "x.icdd", bytes: buf })).toMatchObject({ op: "check", id: "b", name: "x.icdd" });
    expect(parseIcddRequest({ type: "ICDD_CHECK", id: "b", bytes: new ArrayBuffer(0) })).toBeNull();
    expect(parseIcddRequest({ type: "ICDD_EXPORT" })).toBeNull();
    expect(parseIcddRequest({ type: "OTHER", id: "a" })).toBeNull();
  });

  it("export: priebeh, stiahnutie a súhrn", async () => {
    const sent: IcddStatus[] = [];
    const downloads: string[] = [];
    await runIcddRequest({ op: "export", id: "e1" }, (s) => sent.push(s), {
      exportIcdd: async (p) => {
        p("sťahujem 1/1");
        return exportResult(true);
      },
      checkIcdd: async () => {
        throw new Error("nie");
      },
      download: (_b, f) => downloads.push(f),
    });
    expect(downloads).toEqual(["AIM_x.icdd"]);
    expect(sent.map((s) => s.phase)).toEqual(["running", "done"]);
    expect(sent[1]).toMatchObject({ id: "e1", op: "export", result: { filename: "AIM_x.icdd", payloads: 1, links: 2, ok: true, size_bytes: 5 } });
  });

  it("export s chybou kontroly sa nestiahne", async () => {
    const sent: IcddStatus[] = [];
    const downloads: string[] = [];
    await runIcddRequest({ op: "export", id: "e2" }, (s) => sent.push(s), {
      exportIcdd: async () => exportResult(false),
      checkIcdd: async () => ({}) as CheckResult,
      download: (_b, f) => downloads.push(f),
    });
    expect(downloads).toEqual([]);
    expect(sent[0].result).toMatchObject({ ok: false, errors: ["checksum Payload documents/a.pdf: nesedí"] });
  });

  it("kontrola: rozdiel voči AIM a chyba ako phase error", async () => {
    const sent: IcddStatus[] = [];
    const deps = {
      exportIcdd: async () => exportResult(true),
      checkIcdd: async () =>
        ({
          report: report(true),
          versionID: "v1",
          diff: { same: false, linksOnlyInContainer: ["a"], linksOnlyInAim: [], payloadsChanged: ["D.pdf"], payloadsOnlyInContainer: [], payloadsOnlyInAim: [] },
        }) as unknown as CheckResult,
      download: () => {},
    };
    await runIcddRequest({ op: "check", id: "c1", name: "x", bytes: new Uint8Array(1) }, (s) => sent.push(s), deps);
    expect(sent[0]).toMatchObject({ phase: "done", message: "kontajner sa líši od AIM", result: { same: false, links_only_in_container: 1, payloads_changed: ["D.pdf"], version_id: "v1" } });
    await runIcddRequest({ op: "check", id: "c2", name: "x", bytes: new Uint8Array(1) }, (s) => sent.push(s), {
      ...deps,
      checkIcdd: async () => {
        throw new Error("plán ICDD: HTTP 500");
      },
    });
    expect(sent[1]).toEqual({ type: "ICDD_STATUS", id: "c2", op: "check", phase: "error", message: "plán ICDD: HTTP 500" });
  });
});
