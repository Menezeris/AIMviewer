"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";

import { OBJECT_TYPE_LABEL, type ObjectType } from "@/lib/object-type";
import { formatLocalDate } from "@/lib/utils";

/**
 * Side panel with information about a **document** (D-042 D+): the default content of the right
 * panel of the viewer - a mirror of the document detail page (metadata + "Pripojené k" (attached to)).
 * "Pripojené k" can be filtered by object type (storey / asset type / document...)
 * - per the data model (D-018). After clicking a code in the drawing the panel switches to the
 * element detail (`ElementInfoPanel`).
 */
export interface DocAttachment {
  object: {
    id: string;
    object_type: string;
    object_ref: string | null;
    name: string | null;
  };
  role: string | null;
}

export interface DocumentPanelData {
  identification: string | null;
  description: string | null;
  location: string | null;
  purpose: string | null;
  revision: string | null;
  status: string | null;
  documentOwner: string | null;
  validFrom: string | null;
  validUntil: string | null;
  attachedTo: DocAttachment[];
}

// Order of the filter chips (space -> elements -> others), per the D-018 hierarchy.
const TYPE_ORDER: ObjectType[] = [
  "site",
  "building",
  "floor",
  "space",
  "asset",
  "asset_type",
  "document",
  "person",
  "organization",
];

function typeLabel(t: string): string {
  return OBJECT_TYPE_LABEL[t as ObjectType] ?? t;
}

export function DocumentInfoPanel({ document }: { document: DocumentPanelData }) {
  const [filter, setFilter] = useState<string>("all"); // "all" | object_type

  const validity = (() => {
    const from = formatLocalDate(document.validFrom);
    if (!from) return null;
    const until = formatLocalDate(document.validUntil);
    return until ? `${from} – ${until}` : from;
  })();

  // Groups by object_type (only the present ones), in the order TYPE_ORDER + unknown at the end.
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of document.attachedTo) {
      const t = a.object.object_type;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const ordered = TYPE_ORDER.filter((t) => counts.has(t));
    const extra = [...counts.keys()].filter((t) => !TYPE_ORDER.includes(t as ObjectType));
    return [...ordered, ...extra].map((t) => ({ type: t, count: counts.get(t)! }));
  }, [document.attachedTo]);

  const filtered =
    filter === "all"
      ? document.attachedTo
      : document.attachedTo.filter((a) => a.object.object_type === filter);

  return (
    <div className="sticky top-4 space-y-4 rounded-md ring-1 ring-border bg-background p-4">
      <div>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Metadáta
        </h2>
        <dl className="divide-y divide-border text-sm">
          <Row label="Identifikácia" value={document.identification} />
          <Row label="Popis" value={document.description} />
          <Row label="Účel" value={document.purpose} />
          <Row label="Revízia" value={document.revision} />
          <Row label="Status" value={document.status} />
          <Row label="Vlastník" value={document.documentOwner} />
          <Row label="Platnosť" value={validity} />
        </dl>
        {document.location && (
          <a
            href={document.location}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <FileText className="size-3.5" /> Pôvodné PDF
          </a>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Pripojené k ({document.attachedTo.length})
        </h3>
        {document.attachedTo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Dokument nie je pripojený na žiadny objekt.
          </p>
        ) : (
          <>
            {groups.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1">
                <FilterChip
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  label="Všetko"
                  count={document.attachedTo.length}
                />
                {groups.map((g) => (
                  <FilterChip
                    key={g.type}
                    active={filter === g.type}
                    onClick={() => setFilter(g.type)}
                    label={typeLabel(g.type)}
                    count={g.count}
                  />
                ))}
              </div>
            )}
            <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md ring-1 ring-border">
              {filtered.map((a) => (
                <li key={a.object.id}>
                  <Link
                    href={`/${a.object.object_type === "asset_type" ? "type" : "node"}/${a.object.id}`}
                    className="flex items-start justify-between gap-2 px-2.5 py-2 text-sm hover:bg-secondary/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {a.object.name ?? a.object.object_ref ?? a.object.id}
                      </span>
                      {a.role && (
                        <span className="text-xs text-muted-foreground">{a.role}</span>
                      )}
                    </span>
                    {a.object.object_ref && (
                      <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
                        {a.object.object_ref}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
          : "inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/70"
      }
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
