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
  /** Len témy s odkazom na tento dokument (D-158), voliteľne na túto stranu. */
  document_id?: string;
  page?: number;
  model?: string;
  assigned_to?: string;
  limit: number;
  offset?: number;
  /** Podľa čísla vzostupne (BCF API stránkuje od najstaršej); predvolene najnovšie prvé. */
  ascending?: boolean;
}

/** Hodnoty, ktoré už témy používajú (slovník projektu pre BCF API extensions). */
export interface TopicVocabulary {
  topic_type: string[];
  priority: string[];
  stage: string[];
  assigned_to: string[];
}

/** Odkaz témy na dokument, stranu a oblasť strany (D-158, `model_task_documents`, BCF DocumentReference). */
export interface TopicDocumentRow {
  id: string;
  task_id: string;
  document_id: string | null;
  document_ref: string | null;
  document_name: string | null;
  document_revision: string | null;
  page: number | null;
  /** Výrez strany v % ({x, y, width, height}, vľavo hore) ako `open_drawing region`; null = celá strana. */
  region: { x: number; y: number; width: number; height: number } | null;
  markup: unknown[] | null;
  url: string | null;
  description: string | null;
  author: string | null;
  created_at: string;
}

export type TopicDocumentWrite = Omit<TopicDocumentRow, "id" | "created_at"> & { id?: string };

/** Dokument v AIM (D-104), na ktorý sa téma odkazuje. */
export interface DocumentInfo {
  id: string;
  object_ref: string | null;
  name: string | null;
  identification: string | null;
  revision: string | null;
  /** Najvyššia strana s textom (`document_pages`); null = text sa neextrahoval. */
  pages: number | null;
  /** Strana z odkazu na časť dokumentu (IfcDocumentReference, `#page=N`). */
  reference_page: number | null;
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
  vocabulary(): Promise<TopicVocabulary>;
  /** Odkazy tém na dokumenty (D-158), podľa času založenia. */
  documents(taskIds: string[]): Promise<TopicDocumentRow[]>;
  addDocument(row: TopicDocumentWrite): Promise<TopicDocumentRow>;
  /** null = odkaz pri téme nie je. */
  updateDocument(taskId: string, id: string, patch: Partial<TopicDocumentWrite>): Promise<TopicDocumentRow | null>;
  /** Zmaže odkaz (alebo všetky odkazy témy pri id = null); vráti počet. */
  removeDocuments(taskId: string, id: string | null): Promise<number>;
  /** Dokument podľa objects.id, object_ref alebo identification; odkaz na časť vedie na jeho dokument. */
  findDocument(idOrRef: string): Promise<DocumentInfo | null>;
}

const DOCS = "model_task_documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strana z `Location` odkazu na časť dokumentu (`...#page=3`, `?page=3`). */
export function pageFromLocation(location: string | null | undefined): number | null {
  const m = location ? /[#?&]page=(\d{1,5})\b/i.exec(location) : null;
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

const TABLE = "model_tasks";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

export function supabaseBcfStore(): BcfStore {
  const db = () => getSupabaseAdmin();
  const store: BcfStore = {
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
      if (filter.document_id) {
        let d = db().from(DOCS).select("task_id").eq("document_id", filter.document_id);
        if (filter.page !== undefined) d = d.eq("page", filter.page);
        const { data: hits, error: e } = await d;
        if (e) fail("Čítanie odkazov na dokument zlyhalo", e);
        const ids = [...new Set((hits ?? []).map((h) => (h as { task_id: string }).task_id))];
        if (ids.length === 0) return { rows: [], total: 0 };
        q = q.in("id", ids);
      }
      if (filter.status) q = q.eq("status", filter.status);
      if (filter.model) q = q.eq("model", filter.model);
      // Presná zhoda bez ohľadu na veľkosť písmen: zástupné znaky LIKE sa escapujú.
      if (filter.assigned_to) q = q.ilike("assigned_to", filter.assigned_to.replace(/[\\%_]/g, "\\$&"));
      const from = filter.offset ?? 0;
      const { data, error, count } = await q
        .order("number", { ascending: filter.ascending === true })
        .range(from, from + filter.limit - 1);
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
    async vocabulary() {
      const { data, error } = await db().from(TABLE).select("topic_type, priority, stage, assigned_to");
      if (error) fail("Čítanie slovníka tém zlyhalo", error);
      const rows = (data ?? []) as Pick<BcfTopicRow, "topic_type" | "priority" | "stage" | "assigned_to">[];
      const distinct = (k: keyof (typeof rows)[number]) =>
        [...new Set(rows.map((r) => r[k]).filter((v): v is string => typeof v === "string" && v !== ""))].sort();
      return {
        topic_type: distinct("topic_type"),
        priority: distinct("priority"),
        stage: distinct("stage"),
        assigned_to: distinct("assigned_to"),
      };
    },
    async documents(taskIds) {
      if (taskIds.length === 0) return [];
      const { data, error } = await db().from(DOCS).select("*").in("task_id", taskIds).order("created_at");
      if (error) fail("Čítanie odkazov na dokumenty zlyhalo", error);
      return (data ?? []) as TopicDocumentRow[];
    },
    async addDocument(row) {
      const { data, error } = await db().from(DOCS).insert(row).select("*").single();
      if (error || !data) fail("Zápis odkazu na dokument zlyhal", error);
      return data as TopicDocumentRow;
    },
    async updateDocument(taskId, id, patch) {
      const { data, error } = await db().from(DOCS).update(patch).eq("task_id", taskId).eq("id", id).select("*").maybeSingle();
      if (error) fail("Úprava odkazu na dokument zlyhala", error);
      return (data as TopicDocumentRow | null) ?? null;
    },
    async removeDocuments(taskId, id) {
      let q = db().from(DOCS).delete({ count: "exact" }).eq("task_id", taskId);
      if (id) q = q.eq("id", id);
      const { error, count } = await q;
      if (error) fail("Mazanie odkazu na dokument zlyhalo", error);
      return count ?? 0;
    },
    async findDocument(idOrRef) {
      const s = idOrRef.trim();
      const cols = "id, object_type, object_ref, name";
      const live = () => db().from("objects").select(cols).in("object_type", ["document", "document_reference"]).is("valid_until", null);
      let obj: { id: string; object_type: string; object_ref: string | null; name: string | null } | null = null;
      if (UUID_RE.test(s)) {
        const { data, error } = await live().eq("id", s.toLowerCase()).maybeSingle();
        if (error) fail("Čítanie dokumentu zlyhalo", error);
        obj = data;
      }
      if (!obj) {
        const { data, error } = await live().eq("object_ref", s).maybeSingle();
        if (error) fail("Čítanie dokumentu zlyhalo", error);
        obj = data;
      }
      let ext: { id: string; identification: string | null; revision: string | null; location: string | null; referenced_document_id: string | null } | null = null;
      const extCols = "id, identification, revision, location, referenced_document_id";
      if (obj) {
        const { data, error } = await db().from("documents").select(extCols).eq("id", obj.id).maybeSingle();
        if (error) fail("Čítanie dokumentu zlyhalo", error);
        ext = data;
      } else {
        const { data, error } = await db().from("documents").select(extCols).eq("identification", s).limit(2);
        if (error) fail("Čítanie dokumentu zlyhalo", error);
        // Kód dokumentu musí byť jednoznačný, inak by téma visela na náhodnom z nich.
        if (!data || data.length !== 1) return null;
        ext = data[0];
        const { data: o, error: e } = await live().eq("id", ext.id).maybeSingle();
        if (e) fail("Čítanie dokumentu zlyhalo", e);
        obj = o;
        if (!obj) return null;
      }
      let referencePage: number | null = null;
      // Odkaz na časť (D-104): téma visí na celom dokumente a strane z odkazu.
      if (obj.object_type === "document_reference" && ext?.referenced_document_id) {
        referencePage = pageFromLocation(ext.location);
        const parent = await store.findDocument(ext.referenced_document_id);
        return parent ? { ...parent, reference_page: referencePage } : null;
      }
      const { data: last, error: pe } = await db()
        .from("document_pages")
        .select("page")
        .eq("document_id", obj.id)
        .order("page", { ascending: false })
        .limit(1);
      if (pe) fail("Čítanie strán dokumentu zlyhalo", pe);
      return {
        id: obj.id,
        object_ref: obj.object_ref,
        name: obj.name,
        identification: ext?.identification ?? null,
        revision: ext?.revision ?? null,
        pages: last && last.length ? (last[0] as { page: number }).page : null,
        reference_page: referencePage,
      };
    },
  };
  return store;
}
