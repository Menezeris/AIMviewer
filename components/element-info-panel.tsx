"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { nodeSummaryToAimPanel, type ElementDetail } from "@/lib/aim-panel";
import type { SelectedElement } from "@/lib/data/drawing";
import { AimPanelView } from "@/components/aim-panel-view";

/**
 * Side info panel of the drawing viewer (D-042 D): on a click on an element in the
 * drawing it loads its detail (`/api/element/[id]`) and shows it next to the drawing.
 * Since D-077 it renders the same AimPanelData schema as the AIM inspector in 3D
 * (mapping `nodeSummaryToAimPanel` + render `AimPanelView`) - one source of
 * truth for the "element detail" across 2D/3D.
 */
export function ElementInfoPanel({
  selected,
  onBack,
  backLabel = "Späť na dokument",
}: {
  selected: SelectedElement;
  /** Return to the document info (switching the panel back). */
  onBack: () => void;
  /** Text of the back button. */
  backLabel?: string;
}) {
  const [data, setData] = useState<ElementDetail | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ok">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);
    fetch(`/api/element/${selected.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ElementDetail) => {
        if (!cancelled) {
          setData(d);
          setState("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selected.id]);

  return (
    <div className="sticky top-4 rounded-md ring-1 ring-border bg-background p-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {backLabel}
      </button>

      {state === "loading" && (
        <>
          <h2 className="font-heading text-base font-semibold leading-tight">{selected.label}</h2>
          <p className="py-4 text-sm text-muted-foreground">Načítavam detail…</p>
        </>
      )}
      {state === "error" && (
        <>
          <h2 className="font-heading text-base font-semibold leading-tight">{selected.label}</h2>
          <p className="py-4 text-sm text-destructive">Detail sa nepodarilo načítať.</p>
        </>
      )}
      {state === "ok" && data && (
        <AimPanelView data={nodeSummaryToAimPanel(data, selected.label)} />
      )}
    </div>
  );
}
