/** Pomôcky testov kolízií (D-164): úložisko a BCF vrstva v pamäti so správaním DB (jedinečný kód, cascade, upsert stavu). */

import type {
  ClashBcfPort,
  ClashResultRow,
  ClashReviewRow,
  ClashRunRow,
  ClashRunWrite,
  ClashStore,
  ClashTestRow,
  ClashTestWrite,
} from "./types";

export interface MemoryClashStore extends ClashStore {
  tests: ClashTestRow[];
  runRows: ClashRunRow[];
  resultRows: Array<ClashResultRow & { run_id: string }>;
  reviewRows: ClashReviewRow[];
  /** Čísla tém, ktoré store pozná (BCF `model_tasks.number`). */
  topics: Map<string, number>;
}

export function memoryClashStore(): MemoryClashStore {
  const tests: ClashTestRow[] = [];
  const runRows: ClashRunRow[] = [];
  const resultRows: Array<ClashResultRow & { run_id: string }> = [];
  const reviewRows: ClashReviewRow[] = [];
  const topics = new Map<string, number>();
  let n = 0;
  const id = (prefix: string) => `${prefix}${String(++n).padStart(7, "0")}-0000-4000-8000-000000000000`;
  const stamp = () => new Date(Date.UTC(2026, 9, 23, 12, 0, n)).toISOString();
  return {
    tests,
    runRows,
    resultRows,
    reviewRows,
    topics,
    async listTests() {
      return [...tests].sort((a, b) => a.code.localeCompare(b.code));
    },
    async testByCode(code) {
      return tests.find((t) => t.code === code) ?? null;
    },
    async upsertTest(row: ClashTestWrite) {
      const at = tests.findIndex((t) => t.code === row.code);
      const next: ClashTestRow = {
        ...row,
        id: at >= 0 ? tests[at].id : id("a"),
        created_at: at >= 0 ? tests[at].created_at : stamp(),
        updated_at: stamp(),
      };
      if (at >= 0) tests[at] = next;
      else tests.push(next);
      return next;
    },
    async deleteTest(testId) {
      const at = tests.findIndex((t) => t.id === testId);
      if (at >= 0) tests.splice(at, 1);
      for (const r of runRows.filter((x) => x.test_id === testId)) await this.deleteRun(r.id);
      for (let i = reviewRows.length - 1; i >= 0; i--) if (reviewRows[i].test_id === testId) reviewRows.splice(i, 1);
    },
    async testStats(testId) {
      const reviews = reviewRows.filter((r) => r.test_id === testId);
      return { runs: runRows.filter((r) => r.test_id === testId).length, reviews: reviews.length, topics: reviews.filter((r) => r.bcf_topic_id).length };
    },
    async lastRuns(testIds) {
      const out = new Map<string, ClashRunRow>();
      for (const r of [...runRows].reverse()) if (r.test_id && testIds.includes(r.test_id) && !out.has(r.test_id)) out.set(r.test_id, r);
      return out;
    },
    async runs(testId, limit) {
      return runRows.filter((r) => r.test_id === testId).reverse().slice(0, limit);
    },
    async run(runId) {
      return runRows.find((r) => r.id === runId) ?? null;
    },
    async results(runId) {
      return resultRows.filter((r) => r.run_id === runId).map(({ run_id, ...row }) => (void run_id, row));
    },
    async saveRun(run: ClashRunWrite, results: ClashResultRow[]) {
      const row: ClashRunRow = { ...run, id: id("b"), created_at: stamp() };
      runRows.push(row);
      for (const r of results) resultRows.push({ ...r, run_id: row.id });
      return row.id;
    },
    async reviews(testId) {
      return reviewRows.filter((r) => r.test_id === testId);
    },
    async setReviews(testId, keys, patch, by) {
      for (const key of keys) {
        const at = reviewRows.findIndex((r) => r.test_id === testId && r.clash_key === key);
        const prev = at >= 0 ? reviewRows[at] : undefined;
        const next: ClashReviewRow = {
          test_id: testId,
          clash_key: key,
          status: patch.status,
          comment: patch.comment !== undefined ? patch.comment : (prev?.comment ?? null),
          bcf_topic_id: prev?.bcf_topic_id ?? null,
          updated_by: by,
          updated_at: stamp(),
        };
        if (at >= 0) reviewRows[at] = next;
        else reviewRows.push(next);
      }
      return keys.length;
    },
    async linkTopic(testId, keys, topicId) {
      for (const key of keys) {
        const prev = reviewRows.find((r) => r.test_id === testId && r.clash_key === key);
        if (prev) prev.bcf_topic_id = topicId;
        else reviewRows.push({ test_id: testId, clash_key: key, status: "open", comment: null, bcf_topic_id: topicId, updated_by: null, updated_at: stamp() });
      }
    },
    async topicNumbers(topicIds) {
      return new Map(topicIds.flatMap((t) => (topics.has(t) ? [[t, topics.get(t)!] as const] : [])));
    },
    async deleteRun(runId: string) {
      const at = runRows.findIndex((r) => r.id === runId);
      if (at >= 0) runRows.splice(at, 1);
      for (let i = resultRows.length - 1; i >= 0; i--) if (resultRows[i].run_id === runId) resultRows.splice(i, 1);
    },
  } as MemoryClashStore & { deleteRun(id: string): Promise<void> };
}

export interface MemoryBcf extends ClashBcfPort {
  created: Array<Parameters<ClashBcfPort["create"]>[0] & { id: string; number: number }>;
  notified: number;
}

/** BCF vrstva v pamäti: témy dostávajú čísla od 1; `store.topics` sa dopĺňa, aby `topicNumbers` odpovedalo. */
export function memoryBcf(store?: MemoryClashStore): MemoryBcf {
  const created: MemoryBcf["created"] = [];
  const bcf: MemoryBcf = {
    created,
    notified: 0,
    async create(row) {
      const topic = { ...row, id: `d${String(created.length + 1).padStart(7, "0")}-0000-4000-8000-000000000000`, number: created.length + 1 };
      created.push(topic);
      store?.topics.set(topic.id, topic.number);
      return { id: topic.id, number: topic.number };
    },
    async notify() {
      bcf.notified++;
    },
  };
  return bcf;
}
