import { cn } from "@/lib/utils";
import type { PropertySetGroup, Provenance } from "@/lib/data/asset";

/**
 * Render of property sets (S2). Grouped by pset, standard (`Pset_`/`Qto_`)
 * distinguished from custom (D-022). For an asset `showProvenance` shows the origin of the value
 * (own / inherited / overridden) - here the type->occurrence inheritance is shown (D-021).
 */

const PROV_LABEL: Record<Provenance, string> = {
  own: "vlastné",
  inherited: "zdedené",
  overridden: "prepísané",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "áno" : "nie";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ProvBadge({ p }: { p: Provenance }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide",
        p === "own" && "text-muted-foreground ring-1 ring-inset ring-border",
        p === "inherited" && "bg-secondary text-secondary-foreground",
        p === "overridden" &&
          "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      )}
    >
      {PROV_LABEL[p]}
    </span>
  );
}

export function PropertySets({
  groups,
  showProvenance = true,
}: {
  groups: PropertySetGroup[];
  showProvenance?: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Žiadne property sety.</p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="font-mono text-sm font-medium">{g.name}</h3>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[0.65rem] font-medium",
                g.standard
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground ring-1 ring-inset ring-border"
              )}
            >
              {g.standard ? "štandard" : "custom"}
            </span>
          </div>
          <dl className="divide-y divide-border rounded-md ring-1 ring-border">
            {g.entries.map((e) => (
              <div
                key={e.key}
                className="grid grid-cols-[12rem_1fr] items-baseline gap-2 px-3 py-1.5 text-sm"
              >
                <dt className="truncate text-muted-foreground">{e.key}</dt>
                <dd className="flex flex-wrap items-center gap-2 font-mono text-[0.8rem]">
                  <span>{formatValue(e.value)}</span>
                  {showProvenance && <ProvBadge p={e.provenance} />}
                  {showProvenance && e.provenance === "overridden" && (
                    <span className="text-[0.7rem] text-muted-foreground">
                      (z typu: {formatValue(e.typeValue)})
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
