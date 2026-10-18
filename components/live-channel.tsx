"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";

import { isSafeViewerUrl, mergeIfcActions, type AskAction } from "@/lib/llm/actions";
import { LIVE_REVISION_EVENT, parseRevisionNotice, revisionToast } from "@/lib/live/revision";

/**
 * Živý príkazový kanál (D-079): viewer otvorený s `?live=<kanál>` počúva na
 * Supabase Realtime Broadcast a príkazy od Claude (MCP konektor) vykoná tou
 * istou cestou ako AI dock — `router.push` na internú URL. Kanál si pamätá
 * v `sessionStorage`, lebo navigačné URL príkazov parameter `live` nenesú;
 * `?live=off` ho vypne. Bez kanála alebo bez verejných Supabase env premenných
 * sa nič nenačíta (supabase-js sa importuje až tu, dynamicky).
 */

const STORAGE_KEY = "aim-live-channel";
const LIVE_EVENT = "command";
/** Príkazy doručené do tohto okna sa zlúčia do jednej navigácie. */
const BATCH_MS = 350;
const TOAST_MS = 4000;

type Status = "connecting" | "live" | "error";

function readChannel(): string | null {
  try {
    const param = new URLSearchParams(window.location.search).get("live");
    if (param === "off") {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (param) sessionStorage.setItem(STORAGE_KEY, param);
    return param || sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return new URLSearchParams(window.location.search).get("live");
  }
}

export function LiveChannel() {
  const router = useRouter();
  const [channel, setChannel] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const queue = useRef<AskAction[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const name = readChannel();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!name || !url || !anonKey) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const showToast = (msg: string) => {
      setToast(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    };

    const flush = () => {
      timer.current = null;
      const batch = queue.current.splice(0);
      const nav = mergeIfcActions(batch)[0];
      if (!nav) return;
      router.push(nav.url);
      showToast(`Claude: ${nav.label}`);
    };

    import("@supabase/supabase-js").then(({ createClient }) => {
      if (disposed) return;
      setChannel(name);
      const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const sub = client
        .channel(name)
        .on("broadcast", { event: LIVE_EVENT }, ({ payload }) => {
          const actions = (payload as { actions?: unknown })?.actions;
          if (!Array.isArray(actions)) return;
          for (const a of actions) {
            if (a && (a as AskAction).type === "navigate" && isSafeViewerUrl((a as AskAction).url)) {
              queue.current.push({
                type: "navigate",
                url: (a as AskAction).url,
                label: String((a as AskAction).label ?? "").slice(0, 120),
              });
            }
          }
          if (queue.current.length > 0 && !timer.current) {
            timer.current = setTimeout(flush, BATCH_MS);
          }
        })
        // Nová revízia modelu (D-086): stránka sa obnoví zo servera, URL modelu dostane
        // nový `?rev=` a iframe viewera model načíta znova; adresa (výber, ops) ostáva.
        .on("broadcast", { event: LIVE_REVISION_EVENT }, ({ payload }) => {
          const notice = parseRevisionNotice(payload);
          if (!notice) return;
          router.refresh();
          showToast(revisionToast(notice));
        })
        .subscribe((s) => {
          if (disposed) return;
          if (s === "SUBSCRIBED") setStatus("live");
          else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("error");
          else if (s === "CLOSED") setStatus("connecting");
        });
      cleanup = () => {
        client.removeChannel(sub);
      };
    }).catch(() => {
      if (!disposed) setStatus("error");
    });

    return () => {
      disposed = true;
      if (timer.current) clearTimeout(timer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      cleanup?.();
    };
  }, [router]);

  if (!channel) return null;

  const dot =
    status === "live" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-amber-500";
  const text =
    status === "live" ? "Live" : status === "error" ? "Live: odpojené" : "Live: pripájam…";

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[9998] flex flex-col items-start gap-2"
      aria-live="polite"
    >
      {toast && (
        <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-lg">
          {toast}
        </div>
      )}
      <div
        className="flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow"
        title={`Živý kanál: ${channel}`}
      >
        <span className={`size-2 rounded-full ${dot}`} />
        <Radio className="size-3.5" />
        <span>{text}</span>
      </div>
    </div>
  );
}
