import Link from "next/link";
import { Eye, FileText } from "lucide-react";

import type { FloorDrawing } from "@/lib/data/relations";

/**
 * Elements shown in the drawings of a node (E4 auto-linking, D-041). Grouped by
 * drawing; each element leads to its card (`asset_type` -> `/type/[id]`).
 */
export function DrawingElements({ drawings }: { drawings: FloorDrawing[] }) {
  if (drawings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Žiadne prvky auto-prepojené z výkresov.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {drawings.map(({ drawing, elements }) => (
        <div key={drawing.id}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/drawing/${drawing.id}`}
              className="text-sm font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {drawing.name ?? drawing.objectRef ?? drawing.id}
            </Link>
            <span className="text-xs text-muted-foreground">
              ({elements.length} prvkov)
            </span>
            <Link
              href={`/drawing/${drawing.id}`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Eye className="size-3.5" /> Prehliadačka
            </Link>
            {drawing.location && (
              <a
                href={drawing.location}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <FileText className="size-3.5" /> PDF
              </a>
            )}
          </div>
          <ul className="divide-y divide-border rounded-md ring-1 ring-border">
            {elements.map((e) => (
              <li key={e.id}>
                <Link
                  href={e.objectType === "asset_type" ? `/type/${e.id}` : `/node/${e.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:text-foreground"
                >
                  <span className="flex items-center gap-2">
                    {e.name ?? e.objectRef ?? e.id}
                    {e.objectType === "asset_type" && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-secondary-foreground">
                        typ
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {e.objectRef}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
