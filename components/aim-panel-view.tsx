"use client";

import Link from "next/link";
import { ArrowUpRight, Camera, FileText, History, Users } from "lucide-react";

import type { AimPanelData } from "@/lib/aim-panel";
import { cn } from "@/lib/utils";

/**
 * Host render of AimPanelData (D-077) - the same schema that AimCard draws in
 * the fork (apps/viewer/src/aim/AimCard.tsx), but with Next `<Link>` navigation
 * instead of the bridge `AIM_NAVIGATE`. One source of truth for the "element detail"
 * across 2D (ElementInfoPanel) and 3D (embed viewer): the content changes only
 * in `nodeSummaryToAimPanel`, both sides show it identically.
 */
export function AimPanelView({ data }: { data: AimPanelData }) {
  return (
    <div className="space-y-3">
      {/* Header: badge + title + object_ref */}
      <div>
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {data.badges?.[0]?.label ?? "Prvok"}
        </span>
        <h2 className="mt-1.5 font-heading text-base font-semibold leading-tight">{data.title}</h2>
        {data.subtitle && (
          <p className="font-mono text-xs text-muted-foreground">{data.subtitle}</p>
        )}
      </div>

      {/* Generic sections (IFC rows, overview) */}
      {data.sections?.map((section) => (
        <dl key={section.label} className="divide-y divide-border text-sm">
          {section.rows.map((row, i) => (
            <div key={`${row.label}-${i}`} className="grid grid-cols-[7rem_1fr] gap-2 py-1.5">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className={cn("break-words", row.mono && "font-mono text-[0.8rem]")}>
                {row.href ? (
                  <Link
                    href={row.href}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {row.value}
                  </Link>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ))}

      {/* Documents */}
      {data.documents && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dokumenty ({data.documents.length})
          </h3>
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bez priradených dokumentov.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md ring-1 ring-border">
              {data.documents.map((d, i) => (
                <li key={`${d.href}-${i}`}>
                  <Link
                    href={d.href}
                    className="flex items-start gap-2 px-2.5 py-2 text-sm hover:bg-secondary/60"
                  >
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {d.badge && (
                      <span className="mt-0.5 shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-secondary-foreground">
                        {d.badge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Responsibilities (v2) */}
      {data.responsibilities && data.responsibilities.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Zodpovednosti ({data.responsibilities.length})
          </h3>
          <ul className="divide-y divide-border rounded-md ring-1 ring-border">
            {data.responsibilities.map((r, i) => {
              const body = (
                <>
                  <Users className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.role}
                    {r.org ? ` · ${r.org}` : ""}
                  </span>
                </>
              );
              const cls = "flex items-start gap-2 px-2.5 py-2 text-sm";
              return (
                <li key={`${r.name}-${i}`}>
                  {r.href ? (
                    <Link href={r.href} className={cn(cls, "hover:bg-secondary/60")}>
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Reality Capture summary (v2) */}
      {data.captures && data.captures.count > 0 && (
        <Link
          href={data.captures.href}
          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm ring-1 ring-border hover:bg-secondary/60"
        >
          <Camera className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1">Reality Capture ({data.captures.count})</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {/* GUID history (v2) - bitemporal validity, read-only */}
      {data.history && data.history.length > 0 && (
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <History className="size-3" /> História GUID ({data.history.length})
          </h3>
          <ul className="divide-y divide-border rounded-md ring-1 ring-border text-xs">
            {data.history.map((h, i) => (
              <li key={`${h.guid}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                <span
                  className={cn(
                    "truncate font-mono",
                    h.active ? "font-semibold" : "text-muted-foreground"
                  )}
                  title={h.guid}
                >
                  {h.guid}
                </span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {h.validFrom}
                  {h.validUntil ? ` – ${h.validUntil}` : h.active ? " – teraz" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {data.actions && data.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {data.actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                action.primary
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "ring-1 ring-border hover:bg-secondary/60"
              )}
            >
              {action.label} <ArrowUpRight className="size-3.5" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
