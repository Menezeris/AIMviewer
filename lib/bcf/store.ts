import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

/**
 * Uloženie BCF tém (D-099): riadky `model_tasks` (D-086), polia podľa BCF API
 * 2.1 topic. Tools pracujú cez rozhranie `BcfStore`, takže sú testovateľné bez DB.
 */

export const TOPIC_STATUSES = ["open", "in_progress", "resolved", "closed", "conflict", "failed"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export interface BcfComment {
  guid: string;
  author: string | null;
  date: string;
  comment: string;
}

export interface BcfTopicRow {
  id: string;
  number: number;
  model: string | null;
  title: string;
  description: string | null;
  topic_type: string;
  status: TopicStatus;
  priority: string | null;
  assigned_to: string | null;
  due_date: string | null;
  labels: string[];
  stage: string | null;
  components: string[];
  viewpoint: Record<string, unknown> | null;
  comments: BcfComment[];
  author: string | null;
  modified_by: string | null;
  session_url: string | null;
  run_url: string | null;
  base_revision: number | null;
  result_revision: number | null;
  created_at: string;
  updated_at: string;
}

/** Polia, ktoré tools zapisujú (ostatné patria `model_publish`). */
export type BcfTopicWrite = Partial<
  Pick<
    BcfTopicRow,
    | "model"
    | "title"
    | "description"
    | "topic_type"
    | "status"
    | "priority"
    | "assigned_to"
    | "due_date"
    | "labels"
    | "components"
    | "viewpoint"
    | "author"
    | "modified_by"
    | "session_url"
  >
>;

export interface TopicFilter {
  status?: TopicStatus;
  model?: string;
  assigned_to?: string;
  limit: number;
}

export interface BcfStore {
  create(row: BcfTopicWrite & { title: string }): Promise<BcfTopicRow>;
  /** Téma podľa guid (uuid) alebo čísla; null = neexistuje. */
  get(ref: { id?: string; number?: number }): Promise<BcfTopicRow | null>;
  list(filter: TopicFilter): Promise<{ rows: BcfTopicRow[]; total: number }>;
  update(id: string, patch: BcfTopicWrite): Promise<BcfTopicRow>;
  /** Atomické pripojenie komentára (`model_task_add_comment`); null = téma neexistuje. */
  addComment(id: string, author: string, comment: string): Promise<BcfComment | null>;
  /** Témy so session, ktoré ešte bežia (stav `in_progress`, pohyb po `since`). */
  runningSessions(since: Date): Promise<BcfTopicRow[]>;
}

const TABLE = "model_tasks";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

export function supabaseBcfStore(): BcfStore {
  const db = () => getSupabaseAdmin();
  return {
    async create(row) {
      const { data, error } = await db().from(TABLE).insert(row).select("*").single();
      if (error || !data) fail("Zápis témy zlyhal", error);
      return data as BcfTopicRow;
    },
    async get(ref) {
      let q = db().from(TABLE).select("*");
      if (ref.id) q = q.eq("id", ref.id);
      else if (ref.number !== undefined) q = q.eq("number", ref.number);
      else return null;
      const { data, error } = await q.maybeSingle();
      if (error) fail("Čítanie témy zlyhalo", error);
      return (data as BcfTopicRow | null) ?? null;
    },
    async list(filter) {
      let q = db().from(TABLE).select("*", { count: "exact" });
      if (filter.status) q = q.eq("status", filter.status);
      if (filter.model) q = q.eq("model", filter.model);
      // Presná zhoda bez ohľadu na veľkosť písmen: zástupné znaky LIKE sa escapujú.
      if (filter.assigned_to) q = q.ilike("assigned_to", filter.assigned_to.replace(/[\\%_]/g, "\\$&"));
      const { data, error, count } = await q.order("number", { ascending: false }).limit(filter.limit);
      if (error) fail("Čítanie tém zlyhalo", error);
      return { rows: (data ?? []) as BcfTopicRow[], total: count ?? (data ?? []).length };
    },
    async update(id, patch) {
      const { data, error } = await db()
        .from(TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) fail("Úprava témy zlyhala", error);
      return data as BcfTopicRow;
    },
    async addComment(id, author, comment) {
      const { data, error } = await db().rpc("model_task_add_comment", {
        p_task: id,
        p_author: author,
        p_comment: comment,
      });
      if (error) fail("Zápis komentára zlyhal", error);
      return (data as BcfComment | null) ?? null;
    },
    async runningSessions(since) {
      const { data, error } = await db()
        .from(TABLE)
        .select("*")
        .eq("status", "in_progress")
        .not("session_url", "is", null)
        .gte("updated_at", since.toISOString());
      if (error) fail("Čítanie bežiacich sessions zlyhalo", error);
      return (data ?? []) as BcfTopicRow[];
    },
  };
}
