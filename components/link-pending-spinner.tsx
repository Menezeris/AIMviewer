"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A spinning wheel visible during an ongoing navigation from the parent
 * `<Link>` (`useLinkStatus`) - instant feedback on click while the server streams
 * the target page. Render as a child of `<Link>`; outside of it it is always hidden.
 * Client island - can also be embedded in server-component lists.
 */
export function LinkPendingSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      aria-label="Načítava sa"
      className={cn("size-3.5 shrink-0 animate-spin text-muted-foreground", className)}
    />
  );
}
