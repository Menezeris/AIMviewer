import Link from "next/link";

import type { DocumentRef } from "@/lib/data/relations";
import { DOC_ROLE_LABEL, roleLabel } from "@/lib/object-type";
import { formatDate } from "@/lib/utils";

/**
 * Documents attached to a node (S3, D-014). The name opens the document in the viewer
 * (`/drawing/[id]` - PDF + side panel, D-042 D+), `location` is a direct link to the PDF.
 */
export function DocumentList({ documents }: { documents: DocumentRef[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-muted-foreground">Žiadne dokumenty.</p>;
  }

  return (
    <ul className="space-y-3">
      {documents.map((d) => {
        const role = roleLabel(DOC_ROLE_LABEL, d.role);
        const meta = [d.status, d.revision].filter(Boolean).join(" · ");
        return (
          <li key={d.id} className="rounded-md p-3 ring-1 ring-border">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/drawing/${d.id}`}
                className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {d.name ?? d.identification ?? d.objectRef ?? d.id}
              </Link>
              {role && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-secondary-foreground">
                  {role}
                </span>
              )}
              {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
            </div>
            {d.description && (
              <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
            )}
            {d.location && (
              <a
                href={d.location}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block break-all font-mono text-[0.75rem] text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {d.location}
              </a>
            )}
            {formatDate(d.validFrom) && (
              <p className="mt-1 text-xs text-muted-foreground">
                platné od {formatDate(d.validFrom)}
                {formatDate(d.validUntil) ? ` do ${formatDate(d.validUntil)}` : ""}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
