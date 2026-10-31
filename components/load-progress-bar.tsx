import { loadSummary, type LoadSegment } from "@/lib/viewer-load";

/**
 * Pásik priebehu federácie, jeden segment na model v poradí `index` (D-178).
 * Ten istý komponent je v prekrytí loadera (nad logom) aj ako tenký pásik pri hornom
 * okraji viewera po prvej geometrii; nie sú teda dva rôzne pásiky.
 */
export function LoadProgressBar({
  segments,
  variant,
}: {
  segments: LoadSegment[];
  variant: "overlay" | "strip";
}) {
  const summary = loadSummary(segments);
  const strip = variant === "strip";
  return (
    <div
      role="status"
      aria-label={`Načítavanie modelov: ${summary}`}
      className={
        strip
          ? "pointer-events-none absolute inset-x-0 top-0 z-30"
          : "flex w-48 flex-col items-center gap-1.5"
      }
    >
      <div className={`flex w-full gap-0.5 ${strip ? "h-[3px]" : "h-0.5"}`} aria-hidden="true">
        {segments.map((s) => (
          <span
            key={s.index}
            className="relative h-full flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--ds-border)" }}
          >
            <span
              className="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{
                transform: `scaleX(${s.fill})`,
                background: s.kind === "error" ? "var(--ds-danger, #dc2626)" : "var(--ds-brand-green)",
              }}
            />
          </span>
        ))}
      </div>
      {!strip && (
        <span
          aria-hidden="true"
          className="whitespace-nowrap text-[11px] tabular-nums"
          style={{ color: "var(--ds-text-muted)" }}
        >
          {summary}
        </span>
      )}
    </div>
  );
}
