import type { GuidHistoryEntry } from "@/lib/data/relations";
import { cn, formatDate } from "@/lib/utils";

/**
 * IFC GUID history panel (S3, D-010). The IFC GUID is not an identity - it changes on
 * re-export. The active GUID (`valid_until` NULL) matches `objects.ifc_guid`.
 * Without records it shows at least the current GUID with a note.
 */
export function GuidHistory({
  currentGuid,
  history,
}: {
  currentGuid: string | null;
  history: GuidHistoryEntry[];
}) {
  if (history.length === 0) {
    return (
      <div className="text-sm">
        {currentGuid ? (
          <p className="font-mono text-[0.8rem]">
            {currentGuid}{" "}
            <span className="font-sans text-xs text-muted-foreground">
              · aktuálny
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">Bez IFC GUID.</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Žiadna zaznamenaná zmena GUIDu.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {history.map((h) => (
        <li key={h.id} className="flex gap-3 text-sm">
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              h.active ? "bg-primary" : "bg-border"
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 break-all font-mono text-[0.8rem]">
              {h.ifcGuid}
              {h.active && (
                <span className="rounded bg-primary px-1.5 py-0.5 font-sans text-[0.65rem] font-medium uppercase tracking-wide text-primary-foreground">
                  aktuálny
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(h.validFrom) ?? "—"} → {formatDate(h.validUntil) ?? "dnes"}
              {h.source ? ` · ${h.source}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
