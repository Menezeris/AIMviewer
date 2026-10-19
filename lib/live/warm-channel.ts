import "server-only";

import { connect, type QueryChannel } from "./query";
import {
  LIVE_APPLIED_EVENT,
  LIVE_REPLY_EVENT,
  isLiveApplied,
  isLiveReply,
  type LiveAppliedPayload,
  type LiveReplyPayload,
} from "./protocol";

/**
 * Teplý živý kanál (D-101): jedno prihlásenie na Realtime kanál na inštanciu
 * funkcie namiesto nového websocketu pri každej otázke. Odpovede (`reply`) a
 * potvrdenia príkazov (`applied`) sa párujú podľa id. Kanál, ktorý sa zavrie
 * alebo zlyhá, sa zabudne a ďalšie volanie sa prihlási znova.
 */

export interface WarmChannel {
  send(event: string, payload: unknown): Promise<void>;
  onReply(id: string, cb: (p: LiveReplyPayload) => void): () => void;
  onApplied(cmdId: string, cb: (p: LiveAppliedPayload) => void): () => void;
}

type Open = (channel: string) => Promise<QueryChannel | null>;

const SUBSCRIBE_TIMEOUT_MS = 4000;
/**
 * Inštancia môže medzi volaniami zaspať a websocket potom ticho odumrie; kanál
 * nepoužitý dlhšie ako toto sa preto otvorí nanovo (jedno prihlásenie navyše
 * na začiatku ďalšej série volaní).
 */
const IDLE_MS = 60_000;
interface Entry {
  pending: Promise<WarmChannel | null>;
  usedAt: number;
  close: () => void;
}
const cache = new Map<string, Entry>();

export function warmChannel(name: string, open: Open = connect, now = Date.now()): Promise<WarmChannel | null> {
  let entry = cache.get(name);
  if (entry && now - entry.usedAt > IDLE_MS) {
    entry.close();
    cache.delete(name);
    entry = undefined;
  }
  if (!entry) {
    const holder: { entry?: Entry } = {};
    // Zabudnúť len vlastný záznam - zatvorenie starého kanála nesmie vyhodiť nový.
    const forget = () => {
      if (holder.entry && cache.get(name) === holder.entry) cache.delete(name);
    };
    const created = create(name, open, forget);
    entry = { pending: created.then((c) => c?.warm ?? null), usedAt: now, close: () => void created.then((c) => c?.close()) };
    holder.entry = entry;
    cache.set(name, entry);
    void entry.pending.then((w) => {
      if (!w) forget();
    });
  }
  entry.usedAt = now;
  return entry.pending;
}

/** Len pre testy. */
export function forgetWarmChannels(): void {
  cache.clear();
}

async function create(name: string, open: Open, forget: () => void): Promise<{ warm: WarmChannel; close: () => void } | null> {
  const ch = await open(name).catch(() => null);
  if (!ch) return null;
  const replies = new Map<string, (p: LiveReplyPayload) => void>();
  const applied = new Map<string, (p: LiveAppliedPayload) => void>();
  ch.on("broadcast", { event: LIVE_REPLY_EVENT }, ({ payload }) => {
    if (isLiveReply(payload)) replies.get(payload.id)?.(payload);
  });
  ch.on("broadcast", { event: LIVE_APPLIED_EVENT }, ({ payload }) => {
    if (isLiveApplied(payload)) applied.get(payload.cmdId)?.(payload);
  });
  const subscribed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), SUBSCRIBE_TIMEOUT_MS);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        resolve(false);
        forget(); // aj neskôr: zavretý kanál sa pri ďalšom volaní otvorí znova
      }
    });
  });
  if (!subscribed) {
    ch.close();
    return null;
  }
  const warm: WarmChannel = {
    send: (event, payload) => ch.send({ type: "broadcast", event, payload }).then(() => undefined),
    onReply: (id, cb) => {
      replies.set(id, cb);
      return () => replies.delete(id);
    },
    onApplied: (cmdId, cb) => {
      applied.set(cmdId, cb);
      return () => applied.delete(cmdId);
    },
  };
  return { warm, close: () => ch.close() };
}

/**
 * Prihlási čakanie na `applied` s `cmdId` ešte pred odoslaním príkazu (inak by
 * rýchle potvrdenie prišlo skôr, než ho niekto počúva). Vráti funkciu, ktorá
 * počká najviac `timeoutMs`; null = kanál nie je dostupný.
 */
export async function expectApplied(
  name: string,
  cmdId: string,
  open: Open = connect,
): Promise<((timeoutMs: number) => Promise<LiveAppliedPayload | null>) | null> {
  const w = await warmChannel(name, open);
  if (!w) return null;
  let resolve!: (p: LiveAppliedPayload) => void;
  const got = new Promise<LiveAppliedPayload>((r) => (resolve = r));
  const off = w.onApplied(cmdId, (p) => resolve(p));
  return async (timeoutMs) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), timeoutMs)));
    try {
      return await Promise.race([got, late]);
    } finally {
      clearTimeout(timer);
      off();
    }
  };
}
