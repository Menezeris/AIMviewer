import { describe, expect, it } from "vitest";

import { fitPage, pageInfo } from "./query-view";

const rows = Array.from({ length: 100 }, (_, i) => ({ id: `row-${String(i).padStart(3, "0")}`, name: "x".repeat(100) }));

describe("fitPage: strana sa skráti po celých riadkoch (eval D-126)", () => {
  it("príliš dlhá strana: returned a next_offset zodpovedajú riadkom, ktoré model vidí", () => {
    const page = fitPage({ ...pageInfo(139, 0, 100), rows }, 5_000) as ReturnType<typeof pageInfo> & { rows: unknown[] };
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(5_000);
    expect(page.rows.length).toBeGreaterThan(10);
    expect(page).toMatchObject({ total: 139, returned: page.rows.length, truncated: true, next_offset: page.rows.length });
  });

  it("strana, ktorá sa zmestí, a výsledok bez stránkovania ostanú bez zmeny", () => {
    const small = { ...pageInfo(3, 0, 3), rows: rows.slice(0, 3) };
    expect(fitPage(small, 5_000)).toBe(small);
    const plain = rows;
    expect(fitPage(plain, 10)).toBe(plain);
  });

  it("ani jeden riadok sa nezmestí: aspoň jeden, aby sa stránkovanie posunulo", () => {
    const page = fitPage({ ...pageInfo(7, 5, 2), rows: rows.slice(0, 2) }, 50) as { rows: unknown[]; next_offset: number };
    expect(page.rows).toHaveLength(1);
    expect(page.next_offset).toBe(6);
  });
});
