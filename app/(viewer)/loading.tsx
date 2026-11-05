/**
 * Skeleton during navigation (S3 polish). Pages are `force-dynamic` (server render
 * on click) - `loading.tsx` gives immediate visual feedback until the render finishes,
 * so the click does not feel frozen.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse" aria-hidden>
      <div className="mb-6">
        <div className="h-5 w-20 rounded-full bg-muted" />
        <div className="mt-3 h-7 w-64 rounded bg-muted" />
        <div className="mt-2 h-4 w-32 rounded bg-muted" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-6 rounded-xl border p-6">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-5/6 rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
