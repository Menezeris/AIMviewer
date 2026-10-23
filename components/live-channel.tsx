"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Radio } from "lucide-react";

import { isSafeViewerUrl, mergeIfcActions, type AskAction } from "@/lib/llm/actions";
import { LIVE_APPLIED_EVENT, LIVE_QUERY_EVENT, LIVE_REPLY_EVENT, channelFor, isCmdId, isLiveQuery, newViewerId, splitChannel, type LiveKind } from "@/lib/live/protocol";
import { NO_OWNER, decideOwner, ownerFor, takeOver, type OwnerState } from "@/lib/live/owner";
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
 *
 * D-159: okno prijíma príkazy len od svojho chatu (`lib/live/owner.ts`); cudzí príkaz odmietne
 * (`applied` s `rejected: "foreign"`) a ponúkne Prevziať. Čip Live prepína produkčný kanál a
 * testovací kanál pracovných sessions (`<kanál>-test`); testovací kanál ukáže pruh nad viewerom.
 */

const STORAGE_KEY = "aim-live-channel";
/** Vybraný kanál v tejto karte (D-159): produkcia alebo testy sessions. */
const KIND_KEY = "aim-live-kind";
/** Identita tohto okna na kanáli (D-125): server podľa nej pozná, že odpovedá viac okien. */
const VIEWER_ID = newViewerId();
const LIVE_EVENT = "command";
/** Príkazy doručené do tohto okna sa zlúčia do jednej akcie (jedno volanie toolu = jeden príkaz). */
const BATCH_MS = 50;
const TOAST_MS = 4000;
/** Miesto v spodnej stavovej lište /ifc, kam sa indikátor Live vloží (#185); inde je fixed vľavo dole. */
export const LIVE_SLOT_ID = "aim-live-slot";
/** Miesto nad viewerom na /ifc pre pruh prostredia mimo produkcie (D-159). */
export const LIVE_ENV_SLOT_ID = "aim-env-slot";

type Status = "connecting" | "live" | "error";

function readKind(): string | null {
  try {
    return sessionStorage.getItem(KIND_KEY);
  } catch {
    return null;
  }
}

function storeKind(kind: LiveKind) {
  try {
    sessionStorage.setItem(KIND_KEY, kind);
  } catch {
    // bez sessionStorage výber platí do obnovenia stránky
  }
}

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
  const [live, setLive] = useState<{ base: string; kind: LiveKind } | null>(null);
  const [menu, setMenu] = useState(false);
  /** Rozhovor, ktorého príkaz okno odmietlo (D-159): ponuka Prevziať. */
  const [foreign, setForeign] = useState<string | null>(null);
  const owner = useRef<OwnerState>(NO_OWNER);
  const [status, setStatus] = useState<Status>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const queue = useRef<AskAction[]>([]);
  const cmdIds = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kanál z URL alebo karty sa číta až v prehliadači (sessionStorage).
  useEffect(() => {
    const name = readChannel();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (name) setLive(splitChannel(name, readKind()));
  }, []);

  const liveName = live ? channelFor(live.base, live.kind) : null;

  useEffect(() => {
    const name = liveName;
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
          const rawSid = (payload as { sid?: unknown })?.sid;
          const sid = typeof rawSid === "string" && rawSid.length <= 64 ? rawSid : undefined;
          // D-159: príkaz z iného chatu, než ktorý okno ovláda, sa nevykoná a server sa to dozvie.
          const decision = decideOwner(owner.current, sid, Date.now());
          owner.current = decision.state;
          if (!decision.accept) {
            if (isCmdId(cmdId)) {
              void sub.send({
                type: "broadcast",
                event: LIVE_APPLIED_EVENT,
                payload: { cmdId, viewer: VIEWER_ID, ok: false, issues: ["viewer ovláda iný chat"], rejected: "foreign" },
              });
            }
            if (sid) setForeign(sid);
            return;
          }
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
            sub.send({
              type: "broadcast",
              event: LIVE_REPLY_EVENT,
              payload: { ...reply, viewer: VIEWER_ID, owner: ownerFor(owner.current, payload.sid, Date.now()) },
            }),
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
  }, [router, liveName]);

  const choose = (kind: LiveKind) => {
    setMenu(false);
    if (!live || live.kind === kind) return;
    storeKind(kind);
    setStatus("connecting");
    setForeign(null);
    setLive({ ...live, kind });
  };

  const acceptForeign = () => {
    if (foreign) owner.current = takeOver(foreign, Date.now());
    setForeign(null);
    setToast("Viewer odteraz ovláda ten chat; príkaz nech Claude zopakuje.");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  // Slot v stavovej lište sa objaví až po vykreslení stránky, preto ho hľadáme po mounte.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [envSlot, setEnvSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Hľadanie prvku v DOM po commite stránky (synchronizácia s externým stavom).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById(LIVE_SLOT_ID));
    setEnvSlot(document.getElementById(LIVE_ENV_SLOT_ID));
  }, [pathname, channel]);

  if (!channel || !live) return null;

  const test = live.kind === "test";
  const dot =
    status === "live" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-amber-500";
  const name = test ? "Live: testy sessions" : "Live";
  const text =
    status === "live" ? name : status === "error" ? `${name}: odpojené` : `${name}: pripájam…`;

  const chip = (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-full px-3 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        title={test ? "Testovací kanál pracovných sessions (D-159)" : "Živý kanál tvojho chatu"}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        <span className={`size-2 rounded-full ${dot}`} />
        <Radio className="size-3.5" />
        <span>{text}</span>
      </button>
      {menu && (
        <div role="menu" className="absolute bottom-full left-0 z-[9999] mb-1 w-64 rounded-md border border-border bg-background p-1 text-xs shadow-lg">
          {(["prod", "test"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={live.kind === k}
              className={`block w-full rounded px-2 py-1.5 text-left hover:bg-muted ${live.kind === k ? "font-semibold" : ""}`}
              onClick={() => choose(k)}
            >
              {k === "prod" ? "Produkcia (príkazy z tvojho chatu)" : "Testy sessions (príkazy pracovných sessions)"}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {slot ? (
        createPortal(chip, slot)
      ) : (
        <div className="fixed bottom-4 left-4 z-[9998] rounded-full border border-border bg-background/90 shadow">
          {chip}
        </div>
      )}
      {test && envSlot &&
        createPortal(
          <div className="bg-amber-100 px-3 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Testovací kanál sessions: príkazy pracovných sessions, nie tvojho chatu
          </div>,
          envSlot,
        )}
      {foreign && (
        <div
          className="fixed bottom-12 left-4 z-[9998] flex items-center gap-3 rounded-lg border border-amber-500 bg-background px-3 py-2 text-sm text-foreground shadow-lg"
          role="alert"
        >
          <span>Príkaz z iného chatu neprijatý.</span>
          <button type="button" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted" onClick={acceptForeign}>
            Prevziať
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setForeign(null)}>
            Zavrieť
          </button>
        </div>
      )}
      {toast && !foreign && (
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
