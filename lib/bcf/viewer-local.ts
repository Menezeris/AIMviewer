import { MAX_TOPIC_DOCUMENTS } from "./documents";
import { parseMarkup, type Markup } from "./markup";

/**
 * Lokálne BCF témy viewera v `view_state.bcf_local` (D-158): overenie
 * nedôveryhodných dát z prehliadača a krátky súhrn pre `get_viewer_state`.
 * Bez závislosti na tools (číta ho aj `viewer-query-tools`).
 */

const MAX_TOPICS = 50;
const MAX_COMMENTS = 50;
const MAX_TEXT = 8000;

export interface LocalTopic {
  guid: string;
  title: string;
  description: string | null;
  topic_type: string | null;
  topic_status: string | null;
  priority: string | null;
  assigned_to: string | null;
  due_date: string | null;
  labels: string[];
  creation_author: string | null;
  comments: { author: string | null; comment: string }[];
  viewpoint: Record<string, unknown> | null;
  document_references: { url: string; description: string | null; markup: Markup[] }[];
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/** `view_state.bcf_local` -> overené lokálne témy (neplatné vynechá). */
export function localTopicsFromState(state: unknown): { count: number; topics: LocalTopic[] } {
  const raw = (state && typeof state === "object" ? (state as Record<string, unknown>).bcf_local : null) as
    | { count?: unknown; topics?: unknown }
    | null
    | undefined;
  const list = Array.isArray(raw?.topics) ? raw.topics : [];
  const topics: LocalTopic[] = [];
  for (const item of list.slice(0, MAX_TOPICS)) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const guid = str(t.guid, 64);
    const title = str(t.title, 200);
    if (!guid || !title) continue;
    const comments = Array.isArray(t.comments) ? t.comments : [];
    const refs = Array.isArray(t.document_references) ? t.document_references : [];
    topics.push({
      guid,
      title,
      description: str(t.description, MAX_TEXT),
      topic_type: str(t.topic_type, 60),
      topic_status: str(t.topic_status, 40),
      priority: str(t.priority, 60),
      assigned_to: str(t.assigned_to, 200),
      due_date: str(t.due_date, 40),
      labels: Array.isArray(t.labels) ? [...new Set(t.labels.map((l) => str(l, 60)).filter((l): l is string => !!l))].slice(0, 20) : [],
      creation_author: str(t.creation_author, 200),
      comments: comments
        .slice(0, MAX_COMMENTS)
        .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
        .map((c) => ({ author: str(c.author, 200), comment: str(c.comment, MAX_TEXT) ?? "" }))
        .filter((c) => c.comment),
      viewpoint: t.viewpoint && typeof t.viewpoint === "object" && !Array.isArray(t.viewpoint) ? (t.viewpoint as Record<string, unknown>) : null,
      document_references: refs
        .slice(0, MAX_TOPIC_DOCUMENTS)
        .map((d) => (d && typeof d === "object" ? (d as Record<string, unknown>) : {}))
        .map((d) => ({ url: str(d.url, 2000) ?? "", description: str(d.description, 2000), markup: parseMarkup(d.markup) }))
        .filter((d) => d.url),
    });
  }
  const count = typeof raw?.count === "number" && Number.isFinite(raw.count) ? raw.count : topics.length;
  return { count, topics };
}

/** Krátky súhrn pre `get_viewer_state` (celé pohľady a výbery by zahltili odpoveď). */
export function compactLocalTopics(state: unknown) {
  const { count, topics } = localTopicsFromState(state);
  if (count === 0) return undefined;
  return {
    count,
    topics: topics.map((t) => ({
      guid: t.guid,
      title: t.title,
      status: t.topic_status,
      documents: t.document_references.map((d) => d.description ?? d.url),
      components: ((t.viewpoint?.components as { selection?: unknown[] } | undefined)?.selection ?? []).length,
    })),
    note: "Témy z BCF panela viewera, ešte nie sú v AIM. Uloží ich bcf_topic(action=from_viewer) na pokyn používateľa.",
  };
}
