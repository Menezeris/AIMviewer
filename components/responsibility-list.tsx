import Link from "next/link";

import type { Responsibility } from "@/lib/data/relations";
import { ACTING_ROLE_LABEL, roleLabel } from "@/lib/object-type";
import { formatDate } from "@/lib/utils";

/**
 * Responsible actors for a node (S3, D-020). Acting role (operator/maintainer...) +
 * link to the actor; for a person also their company (rel_member_of, D-024). Validity
 * (`valid_from`) shows the handover time axis.
 */
export function ResponsibilityList({ items }: { items: Responsibility[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Žiadne priradené zodpovednosti.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li
          key={`${r.actorId}-${r.role}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          <span className="rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
            {roleLabel(ACTING_ROLE_LABEL, r.role)}
          </span>
          <Link
            href={`/node/${r.actorId}`}
            className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {r.actorName ?? r.actorRef ?? r.actorId}
          </Link>
          <span className="text-xs text-muted-foreground">
            {r.actorType === "person" ? "osoba" : "organizácia"}
          </span>
          {r.org && (
            <span className="text-xs text-muted-foreground">
              ·{" "}
              <Link href={`/node/${r.org.id}`} className="hover:underline">
                {r.org.name ?? "—"}
              </Link>
            </span>
          )}
          {formatDate(r.validFrom) && (
            <span className="ml-auto text-xs text-muted-foreground">
              od {formatDate(r.validFrom)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
