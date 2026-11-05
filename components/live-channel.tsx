"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Radio } from "lucide-react";

import { isSafeViewerUrl, mergeIfcActions, type AskAction } from "@/lib/llm/actions";
import { LIVE_APPLIED_EVENT, LIVE_QUERY_EVENT, LIVE_REPLY_EVENT, channelFor, isCmdId, isLiveQuery, newViewerId, splitChannel, type LiveKind } from "@/lib/live/protocol";
import { NO_OWNER, decideOwner, ownerFor, takeOver, type OwnerState } from "@/lib/live/owner";
import { applyLive, deferCmdIds, parseIfcCommandUrl, sameProject, setAppliedSink } from "@/lib/live/viewer-apply-bus";
import { BCF_CHANGED_WINDOW_EVENT, LIVE_BCF_EVENT } from "@/lib/live/bcf-event";
import { LIVE_VIEWS_EVENT, VIEWS_CHANGED_WINDOW_EVENT } from "@/lib/live/views-event";
import { LIVE_REVISION_EVENT, parseRevisionNotice, revisionToast } from "@/lib/live/revision";
import { answerViewerQuery } from "@/lib/live/viewer-query-bus";

/**
 * Live command channel (D-079): a viewer opened with `?live=<channel>` listens on
 * Supabase Realtime Broadcast and executes commands from Claude (MCP connector) the
 * same way as the AI dock - `router.push` to an internal URL. The channel is remembered
 * in `sessionStorage`, because the navigation URLs of commands do not carry the `live` parameter;
 * `?live=off` turns it off. Without a channel or without public Supabase env variables
 * nothing is loaded (supabase-js is imported only here, dynamically).
 *
 * Back channel (D-085): the `query` event is handed to the embedded viewer
 * (`viewer-query-bus`) and the reply is sent back as a `reply` event.
 *
 * D-101: on `/ifc` the command is executed in place (`viewer-apply-bus`) and the URL is only
 * rewritten - without `router.push` and a server render of the page on every action.
 * The fork confirmation (`APPLIED`) goes back as an `applied` event with the `cmdId` of the command.
 *
 * D-125: replies and confirmations carry `viewer` (window identity), because several windows
 * can reply on the channel at once and the server would otherwise not tell them apart.
 *
 * D-159: a window accepts commands only from its own chat (`lib/live/owner.ts`); a foreign command is rejected
 * (`applied` with `rejected: "foreign"`) and it offers Take over ("Prevziať"). The Live chip switches between the production channel and
 * the test channel of work sessions (`<channel>-test`); the test channel shows a strip above the viewer.
 */

const STORAGE_KEY = "aim-live-channel";
/** Selected channel in this tab (D-159): production or session tests. */
const KIND_KEY = "aim-live-kind";
/** Identity of this window on the channel (D-125): the server uses it to know that several windows reply. */
const VIEWER_ID = newViewerId();
const LIVE_EVENT = "command";
/** Commands delivered to this window are merged into one action (one tool call = one command). */
const BATCH_MS = 50;
const TOAST_MS = 4000;
/** Slot in the bottom status bar of /ifc where the Live indicator is inserted (#185); elsewhere it is fixed bottom left. */
export const LIVE_SLOT_ID = "aim-live-slot";
/** Slot above the viewer on /ifc for the non-production environment strip (D-159). */
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
    // without sessionStorage the choice applies until the page is refreshed
  }
}

const PROJECT_KEY = "aim-project";

/**
 * Project of this tab (D-189): `?project=<code>` sticks in sessionStorage like `?live=` (the server
 * keeps it in the session cookie); `?project=` or `default` = the default project (null).
 */
export function readProject(): string | null {
  try {
    const param = new URLSearchParams(window.location.search).get("project");
    if (param !== null) {
      const v = param.trim();
      if (!v || v.toLowerCase() === "default") sessionStorage.removeItem(PROJECT_KEY);
      else sessionStorage.setItem(PROJECT_KEY, v);
    }
    return sessionStorage.getItem(PROJECT_KEY);
  } catch {
    return new URLSearchParams(window.location.search).get("project") || null;
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
  /** The conversation whose command the window rejected (D-159): the Take over offer. */
  const [foreign, setForeign] = useState<string | null>(null);
  const owner = useRef<OwnerState>(NO_OWNER);
  const [status, setStatus] = useState<Status>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const queue = useRef<AskAction[]>([]);
  const cmdIds = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The channel from the URL or the tab is read only in the browser (sessionStorage).
  useEffect(() => {
    readProject();
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
      // On /ifc with the viewer without navigation; the URL is rewritten so that the link stays shareable. A command of another
      // project (D-189) goes by navigation, the proxy switches the project.
      if (
        inPlace &&
        window.location.pathname === "/ifc" &&
        sameProject(inPlace.project, readProject()) &&
        applyLive({ focus: inPlace.focus, ops: inPlace.ops, nonce: inPlace.nonce, cmdIds: ids })
      ) {
        window.history.replaceState(window.history.state, "", nav.url);
      } else {
        // On /ifc from another page: the viewer executes the command from the URL and confirms it after loading.
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
          // D-159: a command from a chat other than the one the window is controlled by is not executed and the server learns about it.
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
        // New model revision (D-086): the page refreshes from the server, the model URL gets
        // a new `?rev=` and the viewer iframe loads the model again; the address (selection, ops) stays.
        .on("broadcast", { event: LIVE_REVISION_EVENT }, ({ payload }) => {
          const notice = parseRevisionNotice(payload);
          if (!notice) return;
          router.refresh();
          showToast(revisionToast(notice));
        })
        // BCF topics changed (D-099): the viewer on the page reloads them.
        .on("broadcast", { event: LIVE_BCF_EVENT }, () => {
          window.dispatchEvent(new Event(BCF_CHANGED_WINDOW_EVENT));
        })
        // Saved views changed in the chat (D-161): the viewer reloads the list.
        .on("broadcast", { event: LIVE_VIEWS_EVENT }, () => {
          window.dispatchEvent(new Event(VIEWS_CHANGED_WINDOW_EVENT));
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
      // Confirmation of a command from the fork (D-101) back to the server.
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

  // The slot in the status bar appears only after the page is rendered, so we look for it after mount.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [envSlot, setEnvSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // Looking up the element in the DOM after the page commit (synchronization with external state).
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
