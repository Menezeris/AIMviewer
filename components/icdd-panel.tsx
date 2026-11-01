"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyImport,
  checkIcdd,
  downloadBytes,
  exportIcdd,
  previewImport,
  type CheckResult,
  type ExportResult,
  type ImportResponse,
} from "@/lib/icdd/client";
import { EXTRAS, type Extra } from "@/lib/icdd/model";
import type { ValidationReport } from "@/lib/icdd/validate";

/** Export ICDD do PC a kontrola kontajnera späť voči AIM (D-181, #350). */
export function IcddPanel() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [checked, setChecked] = useState<CheckResult | null>(null);
  const [imported, setImported] = useState<ImportResponse | null>(null);
  const [extras, setExtras] = useState<Record<Extra, boolean>>({ xlsx: true });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const onPreview = () =>
    run(async () => {
      if (!checked?.request) return;
      setProgress("počítam náhľad importu");
      setImported(await previewImport(checked.request));
    });

  const onApply = () =>
    run(async () => {
      if (!checked?.request || !imported?.importId) return;
      const p = imported.preview;
      if (!window.confirm(`Zapísať do AIM ${p.counts.add} nových a uzavrieť ${p.counts.close} zmenených väzieb prvok-dokument?`)) return;
      setProgress("zapisujem import");
      setImported(await applyImport(checked.request, imported.importId, p.aimStateSha256));
    });

  const onExport = () =>
    run(async () => {
      setChecked(null);
      setImported(null);
      const r = await exportIcdd(setProgress, fetch, EXTRAS.filter((x) => extras[x]));
      setExported(r);
      if (r.report.ok) {
        downloadBytes(r.bytes, r.filename);
        for (const f of r.sideFiles) downloadBytes(f.bytes, f.filename, f.mime);
      }
    });

  const onCheck = (file: File) =>
    run(async () => {
      setExported(null);
      setImported(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      setChecked(await checkIcdd(bytes, setProgress, fetch, file.name));
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Export ICDD (ISO 21597)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Kontajner s aktuálnymi revíziami modelov IFC, dokumentmi PDF a vrstvou AIM (dokument a strana k prvku z AIM,
            odvodené väzby prvok - miestnosť a zóna, podlažia naprieč modelmi, identita dokumentov IFC a PDF). Väzby, ktoré sú
            v súbore IFC, ostávajú v ňom. Zloží sa v prehliadači a uloží do PC.
          </p>
          <div className="flex flex-wrap gap-4">
            {([
              ["xlsx", "Tabuľka väzieb (xlsx, samostatný súbor vedľa .icdd)"],
            ] as [Extra, string][]).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={extras[k]} disabled={busy} onChange={(e) => setExtras({ ...extras, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onExport} disabled={busy}>
              Exportovať .icdd
            </Button>
            <label className="cursor-pointer text-sm underline">
              Skontrolovať kontajner (import)
              <input
                type="file"
                accept=".icdd,.zip"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onCheck(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {progress && <p className="text-muted-foreground">{progress}...</p>}
          {error && <p className="text-red-600">Chyba: {error}</p>}
        </CardContent>
      </Card>

      {exported && (
        <Card>
          <CardHeader>
            <CardTitle>{exported.filename}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {exported.plan.payloads.length} súborov, {exported.plan.links.length} väzieb, {(exported.bytes.length / 1e6).toFixed(1)} MB
            </p>
            {Object.keys(exported.plan.skipped).length > 0 && (
              <p className="text-muted-foreground">
                Nepribalené: {Object.entries(exported.plan.skipped).map(([k, n]) => `${k} ${n}`).join(", ")}
              </p>
            )}
            {exported.plan.warnings.map((w) => (
              <p key={w} className="text-amber-700">
                {w}
              </p>
            ))}
            <Report report={exported.report} />
            {!exported.report.ok && (
              <Button variant="outline" onClick={() => downloadBytes(exported.bytes, exported.filename)}>
                Stiahnuť aj tak
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {checked && (
        <Card>
          <CardHeader>
            <CardTitle>Kontrola {checked.versionID ?? "kontajnera"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Report report={checked.report} />
            {checked.diff && (
              <div>
                {checked.diff.same ? (
                  <p className="text-green-700">Rovnaký stav ako AIM: {checked.diff.counts.containerLinks} väzieb, {checked.diff.counts.payloads} súborov.</p>
                ) : (
                  <ul className="list-disc pl-5">
                    <li>väzby len v kontajneri: {checked.diff.linksOnlyInContainer.length}</li>
                    <li>väzby len v AIM: {checked.diff.linksOnlyInAim.length}</li>
                    <li>súbory len v kontajneri: {checked.diff.payloadsOnlyInContainer.join(", ") || "0"}</li>
                    <li>súbory len v AIM: {checked.diff.payloadsOnlyInAim.join(", ") || "0"}</li>
                    <li>zmenené súbory (sha256): {checked.diff.payloadsChanged.join(", ") || "0"}</li>
                  </ul>
                )}
              </div>
            )}
            {checked.request && (
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button variant="outline" onClick={onPreview} disabled={busy}>
                  Náhľad importu do AIM
                </Button>
                <span className="text-muted-foreground">
                  zapisujú sa len väzby prvok - dokument; ostatné vrstvy sú len na export a ich zmena je nález
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {imported && <ImportCard result={imported} busy={busy} onApply={onApply} />}
    </div>
  );
}

const FINDING_LABEL: Record<string, string> = {
  validation_failed: "kontrola ISO 21597 neprešla",
  unknown_payload: "súbor mimo indexu",
  unknown_model_revision: "IFC neznámej revízie",
  stale_revision: "IFC staršej revízie",
  unknown_document: "dokument, ktorý AIM nemá",
  ambiguous_document: "dokument nejednoznačný",
  invalid_end_type: "nepovolený koniec väzby",
  unknown_global_id: "GlobalId mimo aktuálnej revízie",
  element_not_in_aim: "prvok bez uzla AIM",
  page_without_reference: "strana bez časti dokumentu v AIM",
  based_on_other_revision: "väzba nad inou revíziou",
  relationship_closed: "väzba v AIM už ukončená",
  duplicate_relationship_id: "duplicitné id väzby",
  duplicate_in_container: "duplicitná väzba v kontajneri",
  already_in_ifc: "väzba už je v súbore IFC",
  unknown_relationship_id: "id väzby AIM nepozná",
  missing_in_container: "väzba AIM v kontajneri chýba (neuzatvára sa)",
  no_importable_linkset: "kontajner nemá importovateľný linkset",
  export_only_changed: "zmena vo vrstve len na export",
  layer_absent: "vrstva v kontajneri nie je",
  unsupported_class: "nepodporovaná trieda väzby",
  exchange_mark_mismatch: "značka aim:exchange iná ako politika AIM",
  exchange_mark_restricts: "linkset označený export-only",
};

function ImportCard({ result, busy, onApply }: { result: ImportResponse; busy: boolean; onApply: () => void }) {
  const p = result.preview;
  const applied = !!result.record;
  const byCode = Object.entries(p.counts.findings).sort(([a], [b]) => (a < b ? -1 : 1));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{applied ? "Import zapísaný" : "Náhľad importu"} {p.versionID ?? ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          {p.counts.links} väzieb v kontajneri, importovateľných {p.counts.importable}: bez zmeny {p.counts.unchanged}, pridať {p.counts.add},
          uzavrieť (zmenené) {p.counts.close}
        </p>
        {applied && (
          <p className="text-green-700">
            Zapísané {result.record!.written_ids.length} väzieb, uzavreté {result.record!.closed_ids.length} ({result.record!.applied_at}).
          </p>
        )}
        {byCode.length > 0 && (
          <ul className="list-disc pl-5">
            {byCode.map(([code, n]) => (
              <li key={code}>
                {FINDING_LABEL[code] ?? code}: {n}
              </li>
            ))}
          </ul>
        )}
        {p.findings.length > 0 && (
          <details>
            <summary className="cursor-pointer">Nálezy ({p.findings.length})</summary>
            <ul className="max-h-60 list-disc overflow-auto pl-5 font-mono text-xs">
              {p.findings.slice(0, 200).map((f, k) => (
                <li key={k}>
                  {f.code}: {f.detail} {f.key && <span className="text-muted-foreground">[{f.key}]</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {p.changes.length > 0 && (
          <details>
            <summary className="cursor-pointer">Zmeny ({p.changes.length})</summary>
            <ul className="max-h-60 list-disc overflow-auto pl-5 font-mono text-xs">
              {p.changes.map((c, k) => (
                <li key={k}>{c.op === "add" ? `pridať ${c.from_id} -> ${c.to_id}${c.replaces ? ` (nahrádza ${c.replaces})` : ""}` : `uzavrieť ${c.id}`}</li>
              ))}
            </ul>
          </details>
        )}
        {!applied && !result.writeEnabled && <p className="text-muted-foreground">Zápis importu je vypnutý (ICDD_IMPORT_ENABLED); náhľad sa neuložil.</p>}
        {!applied && result.writeEnabled && result.importId && (
          <Button onClick={onApply} disabled={busy || !p.applicable}>
            {p.applicable ? `Zapísať ${p.changes.length} zmien do AIM` : "Nie je čo zapísať"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Report({ report }: { report: ValidationReport }) {
  const errors = report.issues.filter((i) => i.level === "error");
  const warnings = report.issues.filter((i) => i.level === "warning");
  return (
    <div>
      <p className={report.ok ? "text-green-700" : "text-red-600"}>
        {report.ok ? "Kontrola ISO 21597 prešla" : `Kontrola ISO 21597 našla ${errors.length} chýb`}
        {` (${report.stats.documents} dokumentov, ${report.stats.linksets} linksetov, ${report.stats.links} linkov`}
        {warnings.length ? `, ${warnings.length} upozornení)` : ")"}
      </p>
      {errors.length > 0 && (
        <ul className="max-h-60 list-disc overflow-auto pl-5 font-mono text-xs">
          {errors.slice(0, 50).map((i, k) => (
            <li key={k}>
              {i.code} {i.where}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
