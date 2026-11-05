"use client";

import { useEffect, useRef } from "react";
// The order is fixed: tokens before graphics (D-163).
import "@assetinspace/design-kit/css/tokens.css";
import "@assetinspace/design-kit/css/graphics.css";
import { LoadProgressBar } from "@/components/load-progress-bar";
import type { LoadSegment } from "@/lib/viewer-load";

const WORDS = ["", "sight", "formation", "telligence"];
const SPEED_MS = 60; // per letter
const HOLD_MS = 1300; // pause on the whole word
const DELETE_FACTOR = 0.55; // deleting is faster than typing (as in the kit)
const GAP_MS = 350;
const BLINK_MS = 1000;
/** If nothing has been drawn for a longer time, the loader has ended and the next one starts over. */
const RESTART_AFTER_MS = 1500;

type Segment = { word: string; type: number; hold: number; del: number; total: number };
const SEGMENTS: Segment[] = WORDS.map((word) => {
  const type = word.length * SPEED_MS;
  const hold = word ? HOLD_MS : HOLD_MS - 400;
  const del = word.length * SPEED_MS * DELETE_FACTOR;
  return { word, type, hold, del, total: type + hold + del + GAP_MS };
});
const CYCLE_MS = SEGMENTS.reduce((a, s) => a + s.total, 0);

/** Text after `elapsed` ms. Purely from time, not from the tick count: a delayed frame
 *  (main thread flooded) just catches the text up, the rhythm is even. */
function typedAt(elapsed: number, reduced: boolean): string {
  let t = elapsed % CYCLE_MS;
  for (const s of SEGMENTS) {
    if (t >= s.total) {
      t -= s.total;
      continue;
    }
    if (reduced) return s.word;
    if (t < s.type) return s.word.slice(0, Math.floor(t / SPEED_MS) + 1);
    t -= s.type;
    if (t < s.hold) return s.word;
    t -= s.hold;
    if (t < s.del) {
      const left = s.word.length - Math.floor(t / (SPEED_MS * DELETE_FACTOR)) - 1;
      return s.word.slice(0, Math.max(left, 0));
    }
    return "";
  }
  return "";
}

// Shared by all instances: the loader is unmounted and mounted again on a transition (loading.tsx, dynamic
// loader, overlay above the iframe), but the animation
// continues where it left off, it does not start from zero.
let startedAt: number | null = null;
let lastTick = 0;

/**
 * The only loading screen of AIM Viewer (D-163): white background and in the middle an
 * animated logo from the design kit (assetin. -> assetinsight. -> ...). The typewriter
 * is custom and time-driven (the kit script writes with random jitter and from zero
 * on every instance, which looked choppy); the CSS and the logo structure are from the kit.
 * The dot always blinks as a cursor, also with prefers-reduced-motion; with it the words
 * are only swapped without typing.
 */
export function LoadingLogo({ label = "Načítavam", segments }: { label?: string; segments?: LoadSegment[] }) {
  const typedRef = useRef<HTMLSpanElement>(null);
  const dotWrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const now0 = performance.now();
    if (startedAt === null || now0 - lastTick > RESTART_AFTER_MS) startedAt = now0;
    const base = startedAt;
    // The dot continues in the blinking phase even after a remount.
    if (dotWrapRef.current) dotWrapRef.current.style.setProperty("--blink-delay", `${-((now0 - base) % BLINK_MS)}ms`);
    let raf = 0;
    let shown: string | null = null;
    const frame = (now: number) => {
      lastTick = now;
      const text = typedAt(now - base, reduced);
      if (text !== shown && typedRef.current) {
        typedRef.current.textContent = text;
        shown = text;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The position must not change between the three instances: `fixed inset-0`. The whole logo
  // (with the typed word and the dot) is always centered and expands while typing
  // symmetrically to both sides; LOADING stays above the center independently of the word.
  // The height does not change (one line, line-height 1 from the kit).
  const font = "var(--font-sans), var(--ds-font-sans)";
  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-white"
    >
      <div className="relative flex flex-col items-center gap-4">
        {/* The strip above the LOADING label is out of the flow (logo and label stay in place).
            When the viewer sends progress (D-178), it is a per-model strip; otherwise (older viewer,
            or until no message has arrived) indeterminate: fixed width and height, the slider moves
            only by transform, so nothing shifts. With reduced-motion it stands still. */}
        <div className="absolute bottom-full left-1/2 mb-3 -translate-x-1/2">
          {segments && segments.length > 0 ? (
            <LoadProgressBar segments={segments} variant="overlay" />
          ) : (
            <span
              aria-hidden="true"
              className="relative block h-0.5 w-24 overflow-hidden rounded-full"
              style={{ background: "var(--ds-border)" }}
            >
              <span
                className="absolute inset-y-0 left-0 w-2/5 rounded-full motion-safe:animate-[loading-bar_1.4s_ease-in-out_infinite] motion-reduce:left-[30%]"
                style={{ background: "var(--ds-brand-green)" }}
              />
            </span>
          )}
        </div>
        <span
          aria-hidden="true"
          className="font-semibold uppercase"
          style={{
            fontFamily: font,
            fontSize: "var(--ds-text-xs)",
            letterSpacing: "0.35em",
            paddingLeft: "0.35em",
            color: "var(--ds-text-muted)",
          }}
        >
          Loading
        </span>
        <span
          ref={dotWrapRef}
          className="inline-flex [&_.logo-dot]:animate-[logo-dot-blink_1s_step-end_var(--blink-delay,0ms)_infinite]!"
          style={{ fontFamily: font }}
        >
          <span className="brand-logo" aria-hidden="true">
            <span className="a">asset</span>
            <span className="i">
              in<span ref={typedRef} data-typed></span>
            </span>
            <span className="logo-dot" aria-hidden="true"></span>
          </span>
        </span>
      </div>
    </div>
  );
}
