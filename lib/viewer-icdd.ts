/**
 * Export a kontrola ICDD z AIM ribbonu viewera (D-181, Samuel 31. 10.: "tlačidlo na ribbon AIM").
 * Wire formát: viewer -> host `ICDD_EXPORT {id}` a `ICDD_CHECK {id, name, bytes: ArrayBuffer}`,
 * host -> viewer `ICDD_STATUS {id, op, phase, message, result?}`. Prácu robí host (D-091): stiahne payloady,
 * zloží kontajner a uloží ho cez download v okne hosta; viewer len ukáže stav.
 */

import type { CheckResult, ExportResult } from "@/lib/icdd/client";
import { EXTRAS, type Extra } from "@/lib/icdd/model";

export type IcddOp = "export" | "check";

export type IcddRequest = { op: "export"; id: string; extras?: Extra[] } | { op: "check"; id: string; name: string; bytes: Uint8Array };

export interface IcddStatus {
  type: "ICDD_STATUS";
  id: string;
  op: IcddOp;
  phase: "running" | "done" | "error";
  message: string;
  result?: Record<string, unknown>;
}

const MAX_CHECK_BYTES = 512 * 1024 * 1024;

/** Overí tvar správy z viewera; null = neplatná. */
export function parseIcddRequest(data: unknown): IcddRequest | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const id = typeof d.id === "string" && d.id.length > 0 && d.id.length <= 100 ? d.id : null;
  if (!id) return null;
  if (d.type === "ICDD_EXPORT") {
    if (!Array.isArray(d.extras)) return { op: "export", id };
    return { op: "export", id, extras: d.extras.filter((x): x is Extra => (EXTRAS as readonly unknown[]).includes(x)) };
  }
  if (d.type === "ICDD_CHECK") {
    const raw = d.bytes;
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : null;
    if (!bytes || bytes.length === 0 || bytes.length > MAX_CHECK_BYTES) return null;
    return { op: "check", id, name: typeof d.name === "string" ? d.name.slice(0, 200) : "kontajner.icdd", bytes };
  }
  return null;
}

const errorsOf = (r: { issues: { level: string; code: string; where: string; message: string }[] }) =>
  r.issues
    .filter((i) => i.level === "error")
    .slice(0, 20)
    .map((i) => `${i.code} ${i.where}: ${i.message}`);

export function exportSummary(r: ExportResult): Record<string, unknown> {
  return {
    filename: r.filename,
    payloads: r.plan.payloads.length,
    links: r.plan.links.length,
    size_bytes: r.bytes.length,
    side_files: (r.sideFiles ?? []).map((f) => f.filename),
    ok: r.report.ok,
    errors: errorsOf(r.report),
    warnings: r.plan.warnings,
    skipped: r.plan.skipped,
  };
}

export function checkSummary(r: CheckResult): Record<string, unknown> {
  return {
    ok: r.report.ok,
    errors: errorsOf(r.report),
    version_id: r.versionID,
    same: r.diff?.same ?? false,
    links_only_in_container: r.diff?.linksOnlyInContainer.length ?? 0,
    links_only_in_aim: r.diff?.linksOnlyInAim.length ?? 0,
    payloads_changed: r.diff?.payloadsChanged ?? [],
    payloads_only_in_container: r.diff?.payloadsOnlyInContainer ?? [],
    payloads_only_in_aim: r.diff?.payloadsOnlyInAim ?? [],
  };
}

export interface IcddDeps {
  exportIcdd: (progress: (m: string) => void, extras?: Extra[]) => Promise<ExportResult>;
  checkIcdd: (bytes: Uint8Array, progress: (m: string) => void) => Promise<CheckResult>;
  download: (bytes: Uint8Array, filename: string, mime?: string) => void;
}

/** Vykoná požiadavku a priebežne posiela `ICDD_STATUS`. Kontajner s chybou kontroly sa nestiahne. */
export async function runIcddRequest(req: IcddRequest, post: (s: IcddStatus) => void, deps: IcddDeps): Promise<void> {
  const send = (phase: IcddStatus["phase"], message: string, result?: Record<string, unknown>) =>
    post({ type: "ICDD_STATUS", id: req.id, op: req.op, phase, message, ...(result ? { result } : {}) });
  const progress = (m: string) => send("running", m);
  try {
    if (req.op === "export") {
      const r = await deps.exportIcdd(progress, req.extras);
      if (r.report.ok) {
        deps.download(r.bytes, r.filename);
        // xlsx výpis je mimo kontajnera (audit ICDD 1. 11.), stiahne sa vedľa neho
        for (const f of r.sideFiles ?? []) deps.download(f.bytes, f.filename, f.mime);
      }
      send("done", r.report.ok ? `stiahnuté ${r.filename}` : "kontajner neprešiel kontrolou ISO 21597, nestiahol sa", exportSummary(r));
    } else {
      const r = await deps.checkIcdd(req.bytes, progress);
      const msg = !r.report.ok ? "kontrola ISO 21597 našla chyby" : r.diff?.same ? "rovnaký stav ako AIM" : "kontajner sa líši od AIM";
      send("done", msg, checkSummary(r));
    }
  } catch (e) {
    send("error", e instanceof Error ? e.message : String(e));
  }
}
