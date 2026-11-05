"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Upload of a capture image/panorama (D-073, F1/F3). Two steps:
 *   1. POST /api/captures  -> create a capture point (semantic anchoring to a space)
 *   2. POST /api/captures/{id}/media  -> upload the file (multipart; server-side sharp)
 *
 * The plan/3D pin is not entered here (F1) - it is added in the viewer (F2). Kind is auto-detected
 * from the aspect ratio (equirect 2:1 -> pano360), the user can switch it.
 */

type Kind = "photo" | "pano360";

function isPanoAspect(w: number, h: number): boolean {
  return h > 0 && Math.abs(w / h - 2) <= 0.1;
}

export function CaptureUploadDialog({
  spaceId,
  spaceName,
  open,
  onClose,
  onUploaded,
}: {
  spaceId: string;
  spaceName: string | null;
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("photo");
  const [name, setName] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setKind("photo");
    setName("");
    setCapturedAt("");
    setError(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const pickFile = useCallback(async (f: File | null) => {
    setError(null);
    setFile(f);
    if (!f) return;
    // Auto-detection of a panorama from the dimensions (equirect 2:1).
    try {
      const bmp = await createImageBitmap(f);
      setKind(isPanoAspect(bmp.width, bmp.height) ? "pano360" : "photo");
      bmp.close?.();
    } catch {
      /* leave default */
    }
  }, []);

  const submit = useCallback(async () => {
    if (!file) {
      setError("Vyber súbor.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1) capture point
      const createRes = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          spaceId,
          name: name.trim() || undefined,
          placement: { version: 1 },
        }),
      });
      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}));
        throw new Error(
          createRes.status === 403
            ? "Zápis je vypnutý (CAPTURE_WRITE_ENABLED)."
            : (j.error ?? "Vytvorenie capture pointu zlyhalo.")
        );
      }
      const { id } = (await createRes.json()) as { id: string };

      // 2) media
      const form = new FormData();
      form.append("file", file);
      if (capturedAt) form.append("capturedAt", new Date(capturedAt).toISOString());
      const mediaRes = await fetch(`/api/captures/${id}/media`, {
        method: "POST",
        body: form,
      });
      if (!mediaRes.ok) {
        const j = await mediaRes.json().catch(() => ({}));
        throw new Error(j.error ?? "Nahranie snímky zlyhalo.");
      }

      reset();
      onUploaded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznáma chyba.");
      setBusy(false);
    }
  }, [file, kind, spaceId, name, capturedAt, reset, onUploaded, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Nahrať snímku"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-card p-5 text-card-foreground shadow-lg ring-1 ring-foreground/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Nahrať snímku</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy} aria-label="Zavrieť">
            <X />
          </Button>
        </div>
        {spaceName && (
          <p className="mb-3 text-sm text-muted-foreground">
            Priestor: <span className="font-medium text-foreground">{spaceName}</span>
          </p>
        )}

        <div className="space-y-4">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50",
              file && "border-primary/40 text-foreground"
            )}
          >
            <Upload className="size-6" />
            {file ? (
              <span className="font-medium">{file.name}</span>
            ) : (
              <span>Klikni a vyber fotku alebo 360° panorámu (jpg/png/webp)</span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="flex gap-2">
            {(["photo", "pano360"] as Kind[]).map((k) => (
              <Button
                key={k}
                type="button"
                variant={kind === k ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setKind(k)}
              >
                {k === "photo" ? "Fotka" : "360° panoráma"}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Názov (voliteľný)
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="napr. Pohľad ku dverám"
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Dátum snímania
              <input
                type="date"
                value={capturedAt}
                onChange={(e) => setCapturedAt(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Zrušiť
            </Button>
            <Button onClick={submit} disabled={busy || !file}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}
              Nahrať
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
