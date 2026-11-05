/**
 * Paginated loading of all rows via PostgREST `range()`.
 *
 * Supabase caps every response at `db-max-rows` (1000) REGARDLESS of
 * `.limit()` - a query that may return more rows MUST paginate,
 * otherwise PostgREST silently truncates the result (no error). After the VZT federation
 * (D-049) there are more than 1000 assets and edges, so this concerns objects, spatial
 * edges and the GUID map.
 *
 * `page` receives the range `[from, to]` (inclusive) and must keep
 * a stable order (`order(...)`) over the query, otherwise the pages are not deterministic.
 */
export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
