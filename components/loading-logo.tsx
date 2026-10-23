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
      stop = window.assetinLogoTypewriter(logoRef.current, { words: WORDS });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white"
    >
      <span ref={logoRef} className="brand-logo" aria-hidden="true">
        <span className="a">asset</span>
        <span className="i">
          in<span data-typed></span>
        </span>
        <span className="logo-dot" aria-hidden="true"></span>
      </span>
    </div>
  );
}
