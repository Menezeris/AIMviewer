"use client";

import { useEffect, useRef } from "react";
// Poradie je dané: tokeny pred grafikou (D-163).
import "@assetinspace/design-kit/css/tokens.css";
import "@assetinspace/design-kit/css/graphics.css";

declare global {
  interface Window {
    assetinLogoTypewriter?: (
      root: Element,
      opts?: { words?: string[]; speed?: number; hold?: number },
    ) => () => void;
  }
}

const WORDS = ["", "sight", "formation", "telligence"];
// Rýchlejšie ako predvolené 90 / 1800 ms (spätná väzba k #291).
const SPEED_MS = 55;
const HOLD_MS = 1100;
const LONGEST = WORDS.reduce((a, w) => (w.length > a.length ? w : a), "");

/**
 * Jediná obrazovka načítavania AIM Viewera (D-163): biele pozadie a v strede
 * animované logo z design-kitu (assetin. -> assetinsight. -> ...). Skript sa
 * načíta až tu a pri odmontovaní sa zastaví cez stop(). Pri
 * prefers-reduced-motion skript len vymieňa slová a CSS vypne blikanie bodky.
 */
export function LoadingLogo({ label = "Načítavam" }: { label?: string }) {
  const logoRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    import("@assetinspace/design-kit/js/logo-typewriter.js").then(() => {
      if (cancelled || !logoRef.current || !window.assetinLogoTypewriter) return;
      stop = window.assetinLogoTypewriter(logoRef.current, { words: WORDS, speed: SPEED_MS, hold: HOLD_MS });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // Poloha sa nesmie meniť medzi troma inštanciami (loading.tsx, dynamic loader,
  // prekrytie): `fixed inset-0` = vždy celé okno, nie rodič s iným paddingom.
  // Šírku rezervuje neviditeľné najdlhšie slovo a logo je ukotvené vľavo, takže
  // písanie ho neposúva. Font berie z next/font (`--font-sans`), nie z fallbacku kitu.
  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-white"
    >
      <span
        aria-hidden="true"
        className="font-semibold uppercase"
        style={{
          fontFamily: "var(--font-sans), var(--ds-font-sans)",
          fontSize: "var(--ds-text-3xl)",
          letterSpacing: "0.3em",
          paddingLeft: "0.3em",
          color: "var(--ds-text-muted)",
        }}
      >
        Loading
      </span>
      <span className="relative inline-flex" style={{ fontFamily: "var(--font-sans), var(--ds-font-sans)" }}>
        <span className="brand-logo invisible" aria-hidden="true">
          <span className="a">asset</span>
          <span className="i">in{LONGEST}</span>
          <span className="logo-dot"></span>
        </span>
        <span
          ref={logoRef}
          className="brand-logo absolute left-0 top-0"
          style={{ fontFamily: "inherit" }}
          aria-hidden="true"
        >
          <span className="a">asset</span>
          <span className="i">
            in<span data-typed></span>
          </span>
          <span className="logo-dot" aria-hidden="true"></span>
        </span>
      </span>
    </div>
  );
}
