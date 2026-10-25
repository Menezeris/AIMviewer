"use client";

import { useEffect, useRef } from "react";
// Poradie je dané: tokeny pred grafikou (D-163).
import "@assetinspace/design-kit/css/tokens.css";
import "@assetinspace/design-kit/css/graphics.css";

const WORDS = ["", "sight", "formation", "telligence"];
const SPEED_MS = 60; // na písmeno
const HOLD_MS = 1300; // pauza na celom slove
const DELETE_FACTOR = 0.55; // mazanie je rýchlejšie ako písanie (ako v kite)
const GAP_MS = 350;
const BLINK_MS = 1000;
/** Ak sa dlhšie nič nevykreslilo, loader sa skončil a ďalší začne odznova. */
const RESTART_AFTER_MS = 1500;

type Segment = { word: string; type: number; hold: number; del: number; total: number };
const SEGMENTS: Segment[] = WORDS.map((word) => {
  const type = word.length * SPEED_MS;
  const hold = word ? HOLD_MS : HOLD_MS - 400;
  const del = word.length * SPEED_MS * DELETE_FACTOR;
  return { word, type, hold, del, total: type + hold + del + GAP_MS };
});
/** Časová konštanta plnenia pásika: 1 - e^(-t/12 s), po ~30 s okolo 92 %. */
const FILL_TAU_MS = 12_000;
const CYCLE_MS = SEGMENTS.reduce((a, s) => a + s.total, 0);

/** Text za `elapsed` ms. Čisto z času, nie z počtu tikov: oneskorený snímok
 *  (zahltené hlavné vlákno) text len dobehne, rytmus je rovnomerný. */
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

// Spoločné pre všetky inštancie: loader sa pri prechode (loading.tsx, dynamic
// loader, prekrytie nad iframe) odmontuje a znova namontuje, animácia ale
// pokračuje tam, kde skončila, nezačína od nuly.
let startedAt: number | null = null;
let lastTick = 0;

/**
 * Jediná obrazovka načítavania AIM Viewera (D-163): biele pozadie a v strede
 * animované logo z design-kitu (assetin. -> assetinsight. -> ...). Typewriter
 * je vlastný a riadený časom (skript kitu píše s náhodným rozptylom a od nuly
 * pri každej inštancii, čo pôsobilo sekane); CSS a štruktúra loga sú z kitu.
 * Bodka bliká vždy ako kurzor, aj pri prefers-reduced-motion; pri ňom sa slová
 * len vymieňajú bez písania.
 */
export function LoadingLogo({ label = "Načítavam" }: { label?: string }) {
  const typedRef = useRef<HTMLSpanElement>(null);
  const dotWrapRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const now0 = performance.now();
    if (startedAt === null || now0 - lastTick > RESTART_AFTER_MS) startedAt = now0;
    const base = startedAt;
    // Bodka pokračuje vo fáze blikania aj po remounte.
    if (dotWrapRef.current) dotWrapRef.current.style.setProperty("--blink-delay", `${-((now0 - base) % BLINK_MS)}ms`);
    let raf = 0;
    let shown: string | null = null;
    let shownFill = -1;
    const frame = (now: number) => {
      lastTick = now;
      const text = typedAt(now - base, reduced);
      if (text !== shown && typedRef.current) {
        typedRef.current.textContent = text;
        shown = text;
      }
      // Plnenie z rovnakej časovej osi ako písanie, takže po remounte nezačína od nuly.
      // Pri reduced-motion po celých sekundách (bez plynulého prechodu).
      const elapsed = reduced ? Math.floor((now - base) / 1000) * 1000 : now - base;
      const fill = 1 - Math.exp(-elapsed / FILL_TAU_MS);
      if (fill !== shownFill && barRef.current) {
        barRef.current.style.transform = `scaleX(${fill})`;
        shownFill = fill;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Poloha sa nesmie meniť medzi troma inštanciami: `fixed inset-0`. Celé logo
  // (aj s písaným slovom a bodkou) je vždy vycentrované a pri písaní sa rozširuje
  // symetricky do oboch strán; LOADING ostáva nad stredom nezávisle od slova.
  // Výška sa nemení (jeden riadok, line-height 1 z kitu).
  const font = "var(--font-sans), var(--ds-font-sans)";
  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-white"
    >
      <div className="relative flex flex-col items-center gap-4">
        {/* Pásik načítania: plní sa zľava podľa času (most pred MODELS_LOADED
            posiela len READY, skutočný priebeh nie je). Je nad nápisom LOADING mimo
            toku (logo a nápis ostávajú na mieste), fixná šírka a výška. */}
        <span
          aria-hidden="true"
          className="absolute bottom-full left-1/2 mb-3 block h-0.5 w-24 -translate-x-1/2 overflow-hidden rounded-full"
          style={{ background: "var(--ds-border)" }}
        >
          <span
            ref={barRef}
            className="absolute inset-0 origin-left rounded-full"
            style={{ background: "var(--ds-brand-green)", transform: "scaleX(0)" }}
          />
        </span>
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
