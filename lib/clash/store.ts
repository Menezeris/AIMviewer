import "server-only";

import { fetchAllPages } from "../data/pagination";
import { getSupabaseAdmin } from "../supabase/server";

import type {
  ClashResultRow,
  ClashReviewRow,
  ClashRunRow,
  ClashRunWrite,
  ClashStore,
  ClashTestRow,
  ClashTestWrite,
} from "./types";

/** Úložisko testov, behov a stavov kolízií v DB (D-164, `service_role`); logika je v `lib/engine/clash-saved.ts`. */

const TESTS = "clash_tests";
const RUNS = "clash_runs";
const RESULTS = "clash_results";
const REVIEWS = "clash_reviews";
const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const RESULT_COLUMNS =
  "clash_key, rule, status, severity, distance, a_guid, a_model, a_ifc_type, a_name, b_guid, b_model, b_ifc_type, b_name, storey, center, point, bounds";

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export function supabaseClashStore(): ClashStore {
  const db = () => getSupabaseAdmin();

  return {
    async listTests() {
      const { data, error } = await db().from(TESTS).select("*").order("code");
      if (error) fail("Čítanie testov kolízií zlyhalo", error);
      return (data ?? []) as ClashTestRow[];
    },
    async testByCode(code) {
      const { data, error } = await db().from(TESTS).select("*").eq("code", code).maybeSingle();
      if (error) fail("Čítanie testu kolízií zlyhalo", error);
      return (data as ClashTestRow | null) ?? null;
    },
    async upsertTest(row: ClashTestWrite) {
      const { data, error } = await db()
        .from(TESTS)
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "code" })
        .select("*")
        .single();
      if (error || !data) fail("Uloženie testu kolízií zlyhalo", error);
      return data as ClashTestRow;
    },
    async deleteTest(id) {
      const { error } = await db().from(TESTS).delete().eq("id", id);
      if (error) fail("Zrušenie testu kolízií zlyhalo", error);
    },
    async testStats(id) {
      const count = async (table: string, column: string) => {
        const { count: n, error } = await db().from(table).select("*", { count: "exact", head: true }).eq(column, id);
        if (error) fail("Čítanie počtov testu kolízií zlyhalo", error);
        return n ?? 0;
      };
      const { count: topics, error } = await db().from(REVIEWS).select("*", { count: "exact", head: true }).eq("test_id", id).not("bcf_topic_id", "is", null);
      if (error) fail("Čítanie počtov testu kolízií zlyhalo", error);
      return { runs: await count(RUNS, "test_id"), reviews: await count(REVIEWS, "test_id"), topics: topics ?? 0 };
    },
    async lastRuns(testIds) {
      const out = new Map<string, ClashRunRow>();
      for (const ids of chunks(testIds, IN_CHUNK)) {
        const { data, error } = await db().from(RUNS).select("*").in("test_id", ids).order("created_at", { ascending: false }).limit(500);
        if (error) fail("Čítanie behov kolízií zlyhalo", error);
        for (const r of (data ?? []) as ClashRunRow[]) if (r.test_id && !out.has(r.test_id)) out.set(r.test_id, r);
      }
      return out;
    },
    async runs(testId, limit) {
      const { data, error } = await db().from(RUNS).select("*").eq("test_id", testId).order("created_at", { ascending: false }).limit(limit);
      if (error) fail("Čítanie behov kolízií zlyhalo", error);
      return (data ?? []) as ClashRunRow[];
    },
    async run(id) {
      const { data, error } = await db().from(RUNS).select("*").eq("id", id).maybeSingle();
      if (error) fail("Čítanie behu kolízií zlyhalo", error);
      return (data as ClashRunRow | null) ?? null;
    },
    async results(runId) {
      return fetchAllPages<ClashResultRow>((from, to) =>
        db().from(RESULTS).select(RESULT_COLUMNS).eq("run_id", runId).order("id").range(from, to),
      );
    },
    async saveRun(run: ClashRunWrite, results: ClashResultRow[]) {
      const { data, error } = await db().from(RUNS).insert(run).select("id").single();
      if (error || !data) fail("Uloženie behu kolízií zlyhalo", error);
      const runId = (data as { id: string }).id;
      for (const part of chunks(results, WRITE_CHUNK)) {
        const { error: err } = await db().from(RESULTS).insert(part.map((r) => ({ ...r, run_id: runId })));
        if (err) {
          await db().from(RUNS).delete().eq("id", runId);
          fail("Uloženie kolízií behu zlyhalo", err);
        }
      }
      return runId;
    },
    async reviews(testId) {
      return fetchAllPages<ClashReviewRow>((from, to) =>
        db().from(REVIEWS).select("*").eq("test_id", testId).order("clash_key").range(from, to),
      );
    },
    async setReviews(testId, keys, patch, by) {
      const now = new Date().toISOString();
      for (const part of chunks(keys, WRITE_CHUNK)) {
        // Bez `comment` v obsahu upsert poznámku nezmení (PostgREST aktualizuje len zadané stĺpce).
        const rows = part.map((clash_key) => ({
          test_id: testId,
          clash_key,
          status: patch.status,
          ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
          updated_by: by,
          updated_at: now,
        }));
        const { error } = await db().from(REVIEWS).upsert(rows, { onConflict: "test_id,clash_key" });
        if (error) fail("Uloženie stavu kolízií zlyhalo", error);
      }
      return keys.length;
    },
    async linkTopic(testId, keys, topicId) {
      for (const part of chunks(keys, WRITE_CHUNK)) {
        const rows = part.map((clash_key) => ({ test_id: testId, clash_key, bcf_topic_id: topicId }));
        const { error } = await db().from(REVIEWS).upsert(rows, { onConflict: "test_id,clash_key" });
        if (error) fail("Odkaz kolízií na BCF tému zlyhal", error);
      }
    },
    async topicNumbers(topicIds) {
      const out = new Map<string, number>();
      for (const ids of chunks(topicIds, IN_CHUNK)) {
        const { data, error } = await db().from("model_tasks").select("id, number").in("id", ids);
        if (error) fail("Čítanie BCF tém zlyhalo", error);
        for (const t of (data ?? []) as { id: string; number: number }[]) out.set(t.id, t.number);
      }
      return out;
    },
  };
}
