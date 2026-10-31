"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checkIcdd, downloadBytes, exportIcdd, type CheckResult, type ExportResult } from "@/lib/icdd/client";
import { EXTRAS, type Extra } from "@/lib/icdd/model";
import type { ValidationReport } from "@/lib/icdd/validate";

/** Export ICDD do PC a kontrola kontajnera späť voči AIM (D-181, #350). */
export function IcddPanel() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [checked, setChecked] = useState<CheckResult | null>(null);
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

  const onExport = () =>
    run(async () => {
      setChecked(null);
      const r = await exportIcdd(setProgress, fetch, EXTRAS.filter((x) => extras[x]));
      setExported(r);
      if (r.report.ok) downloadBytes(r.bytes, r.filename);
    });

  const onCheck = (file: File) =>
    run(async () => {
      setExported(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      setChecked(await checkIcdd(bytes, setProgress));
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
              ["xlsx", "Tabuľka väzieb (xlsx)"],
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
          </CardContent>
        </Card>
      )}
    </div>
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
