"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Resizable + collapsible sidebar frame (review polish).
 * - The width changes by dragging the right edge (drag handle), with MIN/MAX limits.
 * - The whole panel can be collapsed into a thin strip and expanded back.
 * - Both states (width, collapsed) are kept in `localStorage` via `useSyncExternalStore`
 *   - they survive navigation and reload, without a hydration warning (server snapshot = default).
 * Content (tree + nav) arrives as `children`.
 */

const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 288;
const WIDTH_KEY = "aim:sidebar-width";
const COLLAPSED_KEY = "aim:sidebar-collapsed";

// A simple pub/sub over localStorage - the `storage` event does not fire in the same tab,
// so we notify about writes ourselves.
const listeners = new Map<string, Set<() => void>>();
function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => set!.delete(cb);
}
function writePersisted(key: string, value: string) {
  localStorage.setItem(key, value);
  listeners.get(key)?.forEach((cb) => cb());
}

function usePersistedWidth() {
  return useSyncExternalStore(
    (cb) => subscribe(WIDTH_KEY, cb),
    () => {
      const n = Number(localStorage.getItem(WIDTH_KEY));
      return n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
    },
    () => DEFAULT_WIDTH
  );
}
function usePersistedCollapsed() {
  return useSyncExternalStore(
    (cb) => subscribe(COLLAPSED_KEY, cb),
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
    () => false
  );
}

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const width = usePersistedWidth();
  const collapsed = usePersistedCollapsed();
  const draggingRef = useRef(false);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Pointer capture - mouse events vanish above the iframe of the 3D viewer (another
    // document), so a mouseup released above it would never end the drag and the panel
    // would then jump after the cursor forever. Capture keeps the events on the handle.
    handle.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      // Safeguard: if a mouseup got lost after all, the first move without a button ends the drag.
      if (ev.buttons === 0) return onUp();
      // The aside starts at x=0, so clientX = the required width.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
      writePersisted(WIDTH_KEY, String(next));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }, []);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r bg-sidebar py-3 text-sidebar-foreground">
        <button
          type="button"
          onClick={() => writePersisted(COLLAPSED_KEY, "0")}
          aria-label="Rozbaliť panel"
          title="Rozbaliť panel"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* assetin mark from the design kit (D-070); a small static icon, next/image not needed */}
          <img src="/assetin-mark.png" alt="" className="size-7 shrink-0" />
          <div className="min-w-0">
            <Link href="/" className="font-heading text-sm font-semibold">
              AIM Viewer
            </Link>
            <p className="truncate text-xs text-muted-foreground">Priestorová hierarchia</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => writePersisted(COLLAPSED_KEY, "1")}
          aria-label="Zbaliť panel"
          title="Zbaliť panel"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">{children}</nav>

      {/* Drag handle - right edge of the panel. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Zmeniť šírku panela"
        onPointerDown={startResize}
        className={cn(
          "absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none",
          "hover:bg-sidebar-accent active:bg-sidebar-accent"
        )}
      />
    </aside>
  );
}
