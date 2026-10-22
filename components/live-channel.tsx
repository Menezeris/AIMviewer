"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Radio } from "lucide-react";

import { isSafeViewerUrl, mergeIfcActions, type AskAction } from "@/lib/llm/actions";
import { LIVE_APPLIED_EVENT, LIVE_QUERY_EVENT, LIVE_REPLY_EVENT, isCmdId, isLiveQuery, newViewerId } from "@/lib/live/protocol";
import { applyLive, deferCmdIds, parseIfcCommandUrl, setAppliedSink } from "@/lib/live/viewer-apply-bus";
import { BCF_CHANGED_WINDOW_EVENT, LIVE_BCF_EVENT } from "@/lib/live/bcf-event";
import { LIVE_REVISION_EVENT, parseRevisionNotice, revisionToast } from "@/lib/live/revision";
import { answerViewerQuery } from "@/lib/live/viewer-query-bus";

/**
 * Živý príkazový kanál (D-079): viewer otvorený s `?live=<kanál>` počúva na
 * Supabase Realtime Broadcast a príkazy od Claude (MCP konektor) vykoná tou
 * istou cestou ako AI dock — `router.push` na internú URL. Kanál si pamätá
 * v `sessionStorage`, lebo navigačné URL príkazov parameter `live` nenesú;
 * `?live=off` ho vypne. Bez kanála alebo bez verejných Supabase env premenných
 * sa nič nenačíta (supabase-js sa importuje až tu, dynamicky).
 *
 * Spätný kanál (D-085): udalosť `query` odovzdá vloženému vieweru
 * (`viewer-query-bus`) a odpoveď pošle späť udalosťou `reply`.
 *
 * D-101: na `/ifc` sa príkaz vykoná na mieste (`viewer-apply-bus`) a URL sa len
 * prepíše - bez `router.push` a serverového renderu stránky pri každom úkone.
 * Potvrdenie forku (`APPLIED`) ide späť udalosťou `applied` s `cmdId` príkazu.
 *
 * D-125: odpovede a potvrdenia nesú `viewer` (identita okna), lebo na kanál môže
 * odpovedať viac okien naraz a server ich inak nerozlíši.
 */

const STORAGE_KEY = "aim-live-channel";
/** Identita tohto okna na kanáli (D-125): server podľa nej pozná, že odpovedá viac okien. */
const VIEWER_ID = newViewerId();
const LIVE_EVENT = "command";
/** Príkazy doručené do tohto okna sa zlúčia do jednej akcie (jedno volanie toolu = jeden príkaz). */
const BATCH_MS = 50;
const TOAST_MS = 4000;
/** Miesto v spodnej stavovej lište /ifc, kam sa indikátor Live vloží (#185); inde je fixed vľavo dole. */
export const LIVE_SLOT_ID = "aim-live-slot";

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
  const pathname = usePathname();
  const [channel, setChannel] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const queue = useRef<AskAction[]>([]);
  const cmdIds = useRef<string[]>([]);
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
      const ids = cmdIds.current.splice(0);
      const nav = mergeIfcActions(batch)[0];
      if (!nav) return;
      const inPlace = parseIfcCommandUrl(nav.url);
      // Na /ifc s viewerom bez navigácie; URL sa prepíše, aby odkaz ostal zdieľateľný.
      if (inPlace && window.location.pathname === "/ifc" && applyLive({ ...inPlace, cmdIds: ids })) {
        window.history.replaceState(window.history.state, "", nav.url);
      } else {
        // Na /ifc z inej stránky: viewer príkaz z URL vykoná a potvrdí po načítaní.
        if (inPlace) deferCmdIds(ids);
        router.push(nav.url);
      }
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
          const cmdId = (payload as { cmdId?: unknown })?.cmdId;
          if (isCmdId(cmdId)) cmdIds.current.push(cmdId);
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
        // Témy BCF sa zmenili (D-099): viewer na stránke si ich načíta znova.
        .on("broadcast", { event: LIVE_BCF_EVENT }, () => {
          window.dispatchEvent(new Event(BCF_CHANGED_WINDOW_EVENT));
        })
        .on("broadcast", { event: LIVE_QUERY_EVENT }, ({ payload }) => {
          if (!isLiveQuery(payload)) return;
          void answerViewerQuery(payload).then((reply) =>
            sub.send({ type: "broadcast", event: LIVE_REPLY_EVENT, payload: { ...reply, viewer: VIEWER_ID } }),
          );
        })
        .subscribe((s) => {
          if (disposed) return;
          if (s === "SUBSCRIBED") setStatus("live");
          else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("error");
          else if (s === "CLOSED") setStatus("connecting");
        });
      // Potvrdenie príkazu z forku (D-101) späť serveru.
      const unregisterSink = setAppliedSink((applied) => {
        void sub.send({ type: "broadcast", event: LIVE_APPLIED_EVENT, payload: { ...applied, viewer: VIEWER_ID } });
      });
      cleanup = () => {
        unregisterSink();
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

  // Slot v stavovej lište sa objaví až po vykreslení stránky, preto ho hľadáme po mounte.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Hľadanie prvku v DOM po commite stránky (synchronizácia s externým stavom).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById(LIVE_SLOT_ID));
  }, [pathname, channel]);

  if (!channel) return null;

  const dot =
    status === "live" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-amber-500";
  const text =
    status === "live" ? "Live" : status === "error" ? "Live: odpojené" : "Live: pripájam…";

  const chip = (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-0.5 text-xs text-muted-foreground"
      title={`Živý kanál: ${channel}`}
    >
      <span className={`size-2 rounded-full ${dot}`} />
      <Radio className="size-3.5" />
      <span>{text}</span>
    </div>
  );

  return (
    <>
      {slot ? (
        createPortal(chip, slot)
      ) : (
        <div className="pointer-events-none fixed bottom-4 left-4 z-[9998] rounded-full border border-border bg-background/90 shadow">
          {chip}
        </div>
      )}
      {toast && (
        <div
          className="pointer-events-none fixed bottom-12 left-4 z-[9998] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-lg"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </>
  );
}
