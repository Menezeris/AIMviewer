"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";

// Interval for watching for a new deploy. 60 s = a compromise between "notices quickly" and
// "does not hammer the endpoint"; the check also runs on every return to the tab.
const POLL_MS = 60_000;

async function fetchSha(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  } catch {
    // Network outage/offline - skip silently, it will be tried again after POLL_MS.
    return null;
  }
}

/**
 * Watches whether a new deploy has appeared on Vercel while you have the tab open.
 * Remembers the SHA of the live deploy on load and compares it periodically (+ on return to the
 * tab); on a change it offers an unobtrusive refresh. Solves the "stale UI after
 * deploy" problem - an open tab runs old JS and does not know about the new build itself (HTML has
 * `no-store` and chunks are hashed, so a fresh reload is always enough).
 *
 * A toast, not an auto-reload: refreshing is always on click, it never throws you out in the middle of
 * work. Client-only; in dev the SHA is always "dev" so it never pops up.
 */
export function VersionWatcher() {
  const initial = useRef<string | null>(null);
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;

    async function check() {
      const sha = await fetchSha();
      if (!active || sha === null) return;
      if (initial.current === null) {
        initial.current = sha; // first seen version = reference
      } else if (sha !== initial.current) {
        setStale(true);
      }
    }

    check();
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div className="fixed top-16 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-lg">
      <RefreshCw className="size-4 shrink-0 text-primary" />
      <span className="text-foreground">Je dostupná nová verzia.</span>
      <Button size="sm" onClick={() => window.location.reload()}>
        Obnoviť
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Zavrieť"
        onClick={() => setDismissed(true)}
      >
        <X />
      </Button>
    </div>
  );
}
