"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, FlaskConical } from "lucide-react";

import {
  PROD_VIEWER_URL,
  VIEWER_CHOICE_KEY,
  parseViewerParam,
  viewerChoiceLabel,
  viewerParamValue,
  type ViewerChoice,
  type ViewerPreview,
} from "@/lib/viewer-source";

const DEV = process.env.NODE_ENV !== "production";

/** Udalosť v tej istej karte (udalosť `storage` chodí len z iných kariet). */
const CHOICE_EVENT = "aim:viewer-choice";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHOICE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHOICE_EVENT, onChange);
  };
}

function readStoredRaw(): string {
  try {
    return window.sessionStorage.getItem(VIEWER_CHOICE_KEY) ?? "";
  } catch {
    return "";
  }
}

function store(choice: ViewerChoice) {
  try {
    if (choice.kind === "prod") window.sessionStorage.removeItem(VIEWER_CHOICE_KEY);
    else window.sessionStorage.setItem(VIEWER_CHOICE_KEY, viewerParamValue(choice));
  } catch {
    // Bez sessionStorage (súkromné okno) platí len `?viewer=` v URL.
  }
  window.dispatchEvent(new Event(CHOICE_EVENT));
}

/**
 * Ktorý viewer vložiť (D-114). `?viewer=` v URL má prednosť a uloží sa do
 * sessionStorage, takže navigácie AI docku a MCP v tej istej karte (nové `?focus=`,
 * `?ops=`) viewer nevrátia na produkciu. `viewerUrl` je null, kým sa náhľad PR
 * nezistí; `error` povie, prečo sa nedá vložiť.
 */
export function useViewerChoice() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get("viewer");
  const fromUrl = useMemo(() => parseViewerParam(param, DEV), [param]);
  // null na serveri a pri hydratácii: viewer sa vloží až po prečítaní voľby.
  const storedRaw = useSyncExternalStore(subscribe, readStoredRaw, () => null);
  const storageRead = storedRaw !== null;
  const stored = storedRaw ? parseViewerParam(storedRaw, DEV) : null;

  useEffect(() => {
    if (fromUrl) store(fromUrl);
  }, [fromUrl]);

  const choice: ViewerChoice = fromUrl ?? stored ?? { kind: "prod" };
  const choiceKey = viewerParamValue(choice);
  const [resolved, setResolved] = useState<{ key: string; url: string | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!storageRead || choice.kind !== "pr") return;
    let cancelled = false;
    fetch(`/api/viewer-previews?pr=${choice.number}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as ViewerPreview | null;
        if (cancelled) return;
        if (!res.ok || !body) setResolved({ key: choiceKey, url: null, error: `PR #${choice.number} vo forku neexistuje.` });
        else if (!body.url) setResolved({ key: choiceKey, url: null, error: `Náhľad PR #${choice.number} ešte nie je hotový (Vercel ho stavia), skús o chvíľu.` });
        else setResolved({ key: choiceKey, url: body.url, error: null });
      })
      .catch(() => {
        if (!cancelled) setResolved({ key: choiceKey, url: null, error: "Zoznam náhľadov sa nepodarilo načítať." });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceKey, storageRead]);

  let viewerUrl: string | null = null;
  let error: string | null = null;
  if (!storageRead) viewerUrl = null;
  else if (choice.kind === "prod") viewerUrl = PROD_VIEWER_URL;
  else if (choice.kind === "url") viewerUrl = choice.url;
  else if (resolved?.key === choiceKey) ({ url: viewerUrl, error } = resolved);
  if (param && !fromUrl) error = `Hodnota ?viewer=${param} nie je povolený viewer; používam ${viewerChoiceLabel(choice)}.`;

  function setChoice(next: ViewerChoice) {
    store(next);
    const sp = new URLSearchParams(searchParams.toString());
    if (next.kind === "prod") sp.delete("viewer");
    else sp.set("viewer", viewerParamValue(next));
    const qs = sp.toString();
    router.replace(qs ? `/ifc?${qs}` : "/ifc");
  }

  return { choice, viewerUrl, error, setChoice };
}

/**
 * Čip nad 3D na výber viewera (D-114): produkcia alebo náhľad otvoreného PR
 * forku. Zoznam sa načíta až pri otvorení.
 */
export function ViewerPicker({
  choice,
  error,
  onChoose,
}: {
  choice: ViewerChoice;
  error: string | null;
  onChoose: (choice: ViewerChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<ViewerPreview[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const isProd = choice.kind === "prod";

  useEffect(() => {
    if (!open || previews) return;
    let cancelled = false;
    fetch("/api/viewer-previews")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { previews: ViewerPreview[] }) => {
        if (!cancelled) setPreviews(body.previews);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, previews]);

  function choose(next: ViewerChoice) {
    setOpen(false);
    onChoose(next);
  }

  return (
    <div className="absolute bottom-3 left-3 z-20 flex max-w-[min(26rem,calc(100%-1.5rem))] flex-col items-start gap-1 text-xs">
      {open && (
        <div
          role="listbox"
          aria-label="Výber viewera"
          className="max-h-72 w-full overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-border"
        >
          <button
            type="button"
            role="option"
            aria-selected={isProd}
            className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => choose({ kind: "prod" })}
          >
            <span className="font-medium">Produkcia</span>
            <span className="text-muted-foreground">zlúčený main</span>
          </button>
          {previews === null && !loadError && <div className="px-2 py-1.5 text-muted-foreground">Načítavam náhľady PR…</div>}
          {loadError && <div className="px-2 py-1.5 text-destructive">Náhľady PR sa nepodarilo načítať.</div>}
          {previews?.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">Žiadny otvorený PR forku.</div>}
          {previews?.map((p) => (
            <button
              key={p.number}
              type="button"
              role="option"
              aria-selected={choice.kind === "pr" && choice.number === p.number}
              disabled={!p.url}
              className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
              onClick={() => choose({ kind: "pr", number: p.number })}
            >
              <span className="font-medium">
                PR #{p.number} {p.url ? "" : "(náhľad sa stavia)"}
              </span>
              <span className="line-clamp-2 text-muted-foreground">{p.title}</span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="rounded-md bg-destructive/90 px-2 py-1 text-white shadow">{error}</div>}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          "flex items-center gap-1 rounded-full px-3 py-1 shadow backdrop-blur-sm " +
          (isProd ? "bg-background/80 text-muted-foreground" : "bg-amber-500/90 font-medium text-black")
        }
      >
        {!isProd && <FlaskConical className="size-3.5" aria-hidden />}
        Viewer: {viewerChoiceLabel(choice)}
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
