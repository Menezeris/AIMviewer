"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Box,
  Cuboid,
  FileText,
  Loader2,
  Mic,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Chat panel of the LLM interface (D-056, F6). The client keeps only the text history;
 * tool-calling runs server-side in `/api/ask`. Trust loop: sources arrive
 * structured from the server and are rendered as deep links (card / 3D / drawing) -
 * every answer is traceable down to the data.
 */

interface AskSource {
  id: string;
  objectType: string;
  objectRef: string | null;
  name: string | null;
  route: "node" | "type" | "drawing";
  ifcGuid: string | null;
  drawings: { docId: string; docName: string | null; page: number | null }[];
}

interface AskToolTrace {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

/** UI action from the server (show_in_3d...) - the client navigates on it (D-056). */
interface AskUiAction {
  type: "navigate";
  url: string;
  label: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  trace?: AskToolTrace[];
  actions?: AskUiAction[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Koľko VZT jednotiek je v budove a na akých podlažiach?",
  "Zobraz VZT jednotku v 3D",
  "V ktorej miestnosti sú dvere DD01.06.03?",
  "Kto zodpovedá za budovu?",
];

/**
 * Conversations survive navigation and reload (the dock is global, D-056).
 * Several separate threads, so that a long history does not spoil the context of unrelated
 * queries - only the history of the active conversation always goes to `/api/ask`.
 */
const CHATS_STORAGE_KEY = "aim-ask-chats";
/** Original single-thread key - migrated into the first conversation. */
const LEGACY_TURNS_KEY = "aim-ask-turns";
const MAX_CHATS = 10;
const MAX_TURNS = 30;

interface ChatSession {
  id: string;
  title: string | null;
  turns: ChatTurn[];
  updatedAt: number;
}

interface ChatsState {
  chats: ChatSession[];
  activeId: string;
}

function createChat(): ChatSession {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return { id, title: null, turns: [], updatedAt: Date.now() };
}

/** Conversation name = the first question (shortened). */
function chatTitle(turns: ChatTurn[]): string | null {
  const first = turns.find((t) => t.role === "user")?.content.trim();
  if (!first) return null;
  return first.length > 48 ? `${first.slice(0, 48)}…` : first;
}

function loadStoredChats(): ChatsState {
  const fresh = () => {
    const chat = createChat();
    return { chats: [chat], activeId: chat.id };
  };
  if (typeof window === "undefined") return fresh();
  try {
    const raw = window.sessionStorage.getItem(CHATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatsState;
      if (Array.isArray(parsed?.chats) && parsed.chats.length > 0) {
        const activeId = parsed.chats.some((c) => c.id === parsed.activeId)
          ? parsed.activeId
          : parsed.chats[0].id;
        return { chats: parsed.chats, activeId };
      }
    }
    // Migration of the original single thread (aim-ask-turns).
    const legacy = window.sessionStorage.getItem(LEGACY_TURNS_KEY);
    if (legacy) {
      window.sessionStorage.removeItem(LEGACY_TURNS_KEY);
      const turns = JSON.parse(legacy) as ChatTurn[];
      if (Array.isArray(turns) && turns.length > 0) {
        const chat = { ...createChat(), turns, title: chatTitle(turns) };
        return { chats: [chat], activeId: chat.id };
      }
    }
  } catch {
    // invalid storage -> fresh conversation
  }
  return fresh();
}

/** Max dictation length - protects the STT cost and the size limit on the server. */
const MAX_RECORD_SECONDS = 60;

/** Preferred recording formats - Chrome/Firefox webm/opus, Safari mp4/AAC. */
const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/** Max sources shown without expanding. */
const SOURCE_CAP = 8;

/** Sources mentioned in the answer (object_ref/name in the text) - the others behind the expander. */
function splitSources(sources: AskSource[], answer: string) {
  const mentioned = sources.filter(
    (s) =>
      (s.objectRef && answer.includes(s.objectRef)) ||
      (s.name && s.name.length > 2 && answer.includes(s.name))
  );
  const primary = (mentioned.length > 0 ? mentioned : sources).slice(0, SOURCE_CAP);
  const rest = sources.filter((s) => !primary.includes(s));
  return { primary, rest };
}

function SourceChip({ source }: { source: AskSource }) {
  const label = source.objectRef ?? source.name ?? source.id.slice(0, 8);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs">
      <Link
        href={`/${source.route}/${source.id}`}
        prefetch={false}
        className="inline-flex items-center gap-1 font-mono hover:underline"
        title={source.name ?? undefined}
      >
        <Box className="size-3 shrink-0 text-muted-foreground" />
        {label}
      </Link>
      {source.ifcGuid && (
        <Link
          href={`/ifc?focus=${encodeURIComponent(source.ifcGuid)}`}
          prefetch={false}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
          title="Zobraziť v 3D modeli"
        >
          <Cuboid className="size-3" />
          3D
        </Link>
      )}
      {source.drawings.slice(0, 2).map((d) => (
        <Link
          key={d.docId}
          href={`/drawing/${d.docId}?focus=${source.id}${d.page ? `&page=${d.page}` : ""}`}
          prefetch={false}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:underline"
          title={d.docName ?? "Výkres"}
        >
          <FileText className="size-3" />
          výkres
        </Link>
      ))}
    </span>
  );
}

function AssistantMeta({ turn }: { turn: ChatTurn }) {
  const [showAll, setShowAll] = useState(false);
  const sources = turn.sources ?? [];
  const trace = turn.trace ?? [];
  const actions = turn.actions ?? [];
  if (sources.length === 0 && trace.length === 0 && actions.length === 0) return null;

  const { primary, rest } = splitSources(sources, turn.content);
  const visible = showAll ? [...primary, ...rest] : primary;

  return (
    <div className="mt-2 space-y-1.5">
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {actions.map((a, i) => (
            <Link
              key={i}
              href={a.url}
              prefetch={false}
              className="inline-flex items-center gap-1 rounded-md border bg-primary/10 px-2 py-0.5 text-xs font-medium hover:bg-primary/20"
            >
              <ArrowUpRight className="size-3" />
              {a.label}
            </Link>
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            Zdroje
          </span>
          {visible.map((s) => (
            <SourceChip key={s.id} source={s} />
          ))}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {showAll ? "menej" : `+${rest.length} ďalších`}
            </button>
          )}
        </div>
      )}
      {trace.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Ako som hľadal ({trace.length} {trace.length === 1 ? "dotaz" : "dotazy"})
          </summary>
          <ol className="mt-1 space-y-0.5 pl-4">
            {trace.map((t, i) => (
              <li key={i} className="font-mono">
                {t.ok ? "✓" : "✗"} {t.name}
                {" — "}
                {t.summary}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function AskPanel() {
  const router = useRouter();
  const [{ chats, activeId }, setChats] = useState<ChatsState>(loadStoredChats);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [unconfigured, setUnconfigured] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Voice input (D-069): dictation -> /api/transcribe -> the transcript is APPENDED to
  // the input as editable text - the user checks it and sends it themselves
  // (dictation pattern; with element codes the STT can make a mistake).
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);

  // Client constant (SSR has no navigator/MediaRecorder -> server snapshot false).
  const voiceSupported = useSyncExternalStore(
    () => () => {},
    () =>
      typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    () => false
  );

  // Recording timer + auto-stop at the length limit.
  useEffect(() => {
    if (voice !== "recording") return;
    const t = window.setInterval(() => {
      setVoiceSeconds((s) => {
        if (s + 1 >= MAX_RECORD_SECONDS) recorderRef.current?.stop();
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [voice]);

  // Unmount during recording -> discard and release the microphone.
  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") {
        discardRef.current = true;
        recorderRef.current.stop();
      }
    },
    []
  );

  async function transcribeRecording(blob: Blob) {
    setVoice("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "dictation");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!res.ok || typeof data.text !== "string") {
        setVoiceError(data.error ?? "Prepis zlyhal — skús to znova.");
        return;
      }
      const text = data.text.trim();
      if (!text) {
        setVoiceError("V nahrávke sa nepodarilo rozpoznať reč.");
        return;
      }
      setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    } catch {
      setVoiceError("Sieťová chyba pri prepise — skús to znova.");
    } finally {
      setVoice("idle");
    }
  }

  async function startRecording() {
    setVoiceError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch {
      setVoiceError("Mikrofón sa nepodarilo spustiť — skontroluj povolenie v prehliadači.");
      return;
    }
    const mimeType = RECORDER_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      if (discardRef.current) {
        setVoice("idle");
        return;
      }
      void transcribeRecording(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    discardRef.current = false;
    recorderRef.current = recorder;
    recorder.start();
    setVoiceSeconds(0);
    setVoice("recording");
  }

  /** Ends the recording; discard = drop without a transcript (the x button). */
  function stopRecording(discard: boolean) {
    discardRef.current = discard;
    recorderRef.current?.stop();
  }

  const active = chats.find((c) => c.id === activeId) ?? chats[0];
  const turns = active.turns;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        CHATS_STORAGE_KEY,
        JSON.stringify({
          activeId,
          chats: chats.map((c) => ({ ...c, turns: c.turns.slice(-MAX_TURNS) })),
        })
      );
    } catch {
      // full/unavailable storage does not break the thread
    }
  }, [chats, activeId]);

  // Switching conversation -> jump to the end of the thread.
  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [activeId]);

  /** Writes the thread of a specific conversation (id fixed - switching during the fetch does not matter). */
  const setChatTurns = (chatId: string, nextTurns: ChatTurn[]) => {
    setChats((s) => ({
      ...s,
      chats: s.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              turns: nextTurns,
              // A rollback to empty (503) also cancels the name from the withdrawn question.
              title: nextTurns.length === 0 ? null : (c.title ?? chatTitle(nextTurns)),
              updatedAt: Date.now(),
            }
          : c
      ),
    }));
  };

  const startNewChat = () => {
    setChats((s) => {
      // An empty active conversation is recycled instead of duplicated.
      const current = s.chats.find((c) => c.id === s.activeId);
      if (current && current.turns.length === 0) return s;
      const chat = createChat();
      return { chats: [chat, ...s.chats].slice(0, MAX_CHATS), activeId: chat.id };
    });
  };

  const deleteActiveChat = () => {
    setChats((s) => {
      const rest = s.chats.filter((c) => c.id !== s.activeId);
      if (rest.length === 0) {
        const chat = createChat();
        return { chats: [chat], activeId: chat.id };
      }
      return { chats: rest, activeId: rest[0].id };
    });
  };

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    const chatId = active.id;
    const history = [...turns, { role: "user" as const, content: question }];
    setChatTurns(chatId, history);
    setInput("");
    setPending(true);
    queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        sources?: AskSource[];
        trace?: AskToolTrace[];
        actions?: AskUiAction[];
        error?: string;
        configured?: boolean;
      };

      if (res.status === 503 && data.configured === false) {
        setUnconfigured(data.error ?? "LLM rozhranie nie je nakonfigurované.");
        setChatTurns(chatId, history.slice(0, -1));
        return;
      }
      if (!res.ok || !data.answer) {
        setChatTurns(chatId, [
          ...history,
          {
            role: "assistant",
            content: data.error ?? "Spracovanie otázky zlyhalo. Skús to znova.",
            error: true,
          },
        ]);
        return;
      }
      setChatTurns(chatId, [
        ...history,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources,
          trace: data.trace,
          actions: data.actions,
        },
      ]);
      // UI action from the server (show_in_3d...) - the dock stays, navigation happens below it.
      const nav = (data.actions ?? []).find((a) => a.type === "navigate");
      if (nav) router.push(nav.url);
    } catch {
      setChatTurns(chatId, [
        ...history,
        { role: "assistant", content: "Sieťová chyba — skús to znova.", error: true },
      ]);
    } finally {
      setPending(false);
      queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
        <select
          value={active.id}
          onChange={(e) => setChats((s) => ({ ...s, activeId: e.target.value }))}
          className="h-7 min-w-0 flex-1 truncate rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Konverzácia"
        >
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? "Nová konverzácia"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={startNewChat}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Nová konverzácia"
          aria-label="Nová konverzácia"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={deleteActiveChat}
          disabled={pending}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
          title="Zmazať konverzáciu"
          aria-label="Zmazať konverzáciu"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {unconfigured && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            {unconfigured}
          </div>
        )}
        {turns.length === 0 && !unconfigured && (
          <div className="space-y-3 py-6 text-center">
            <Sparkles className="mx-auto size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Opýtaj sa na prvky, miestnosti, systémy, výkresy či zodpovednosti —
              odpoveď je vždy podložená odkazmi do dát.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn("flex", t.role === "user" && "justify-end")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                t.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : t.error
                    ? "border border-destructive/40 bg-destructive/10"
                    : "bg-muted"
              )}
            >
              <div className="whitespace-pre-wrap">{t.content}</div>
              {t.role === "assistant" && <AssistantMeta turn={t} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Hľadám v grafe…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {voiceError && (
        <p className="border-t px-3 pt-2 text-xs text-destructive">{voiceError}</p>
      )}
      <form
        className={cn("flex items-end gap-2 p-3", !voiceError && "border-t")}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Napíš otázku o budove…"
          className="max-h-32 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={pending || !!unconfigured}
        />
        {voiceSupported &&
          (voice === "recording" ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Zrušiť nahrávanie"
                aria-label="Zrušiť nahrávanie"
              >
                <X className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-2.5 text-destructive-foreground"
                title="Ukončiť diktovanie a prepísať"
                aria-label="Ukončiť diktovanie a prepísať"
              >
                <span className="size-2 animate-pulse rounded-full bg-current" />
                <span className="font-mono text-xs tabular-nums">
                  {Math.floor(voiceSeconds / 60)}:{String(voiceSeconds % 60).padStart(2, "0")}
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={pending || voice === "transcribing" || !!unconfigured}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              title="Diktovať otázku — prepis sa vloží do poľa na kontrolu"
              aria-label="Diktovať otázku"
            >
              {voice === "transcribing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>
          ))}
        <button
          type="submit"
          disabled={pending || !input.trim() || !!unconfigured}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Odoslať otázku"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
