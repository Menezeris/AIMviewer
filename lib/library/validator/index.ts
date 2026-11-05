/**
 * Validátor knižnice (port `assetin/engine/validator`, D-186 krok 5): beží registrované pravidlá grafu nad
 * načítanou knižnicou; diagnostiky loadera a grafu idú prvé. Pravidlá so schémou IFC a bSDD (F2b) tu nie sú.
 */

import type { Kniznica } from "../graph";
import type { Diagnostika } from "../loader";
import { Kontext, REGISTER, type Pravidlo } from "./context";
import "./rules-a-c";
import "./rules-d-e";
import "./rules-f-h";

export { REGISTER, type Pravidlo } from "./context";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `validuj`: diagnostiky loadera a grafu + pravidlá; zoradené podľa (súbor, riadok, kód) stabilne. */
export function validuj(k: Kniznica, o: { preflight?: boolean } = {}): Diagnostika[] {
  const out: Diagnostika[] = [...k.diagnostiky];
  const ctx = new Kontext(k, !!o.preflight);
  for (const p of REGISTER.values()) {
    if (p.potrebuje !== "graf") continue;
    if (p.preflight && !o.preflight) continue;
    ctx.kod = p.kod;
    ctx.uroven = p.uroven;
    for (const d of p.fn(ctx)) out.push(d);
  }
  return out
    .map((d, i) => [d, i] as const)
    .sort(([a, ia], [b, ib]) => cmp(a.subor ?? "", b.subor ?? "") || (a.riadok ?? 0) - (b.riadok ?? 0) || cmp(a.kod, b.kod) || ia - ib)
    .map(([d]) => d);
}

/** `zoznam_pravidiel`: pravidlá zoradené podľa písmena a čísla kódu. */
export function zoznamPravidiel(): Pravidlo[] {
  return [...REGISTER.values()].sort((a, b) => cmp(a.kod[0], b.kod[0]) || Number(a.kod.slice(1)) - Number(b.kod.slice(1)));
}
