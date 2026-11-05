import "server-only";

import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "../api-guard";

import type { RevisionInfo } from "./app-json";
import { writeAllowed } from "./gate";
import type { Gate, Reply } from "./editor-api";
import { supabaseHlavaStore } from "./head-store";
import { supabaseStore } from "./store-db";

/**
 * Spoločné pre route editora knižnice (D-186 krok UI): kód knižnice z cesty, sklad v DB, revízie hlavy (autor, čas)
 * pre pruh poznámky, brána a ochrana POST (origin, rate limit ako `assetin/server` a D-068).
 */

export const NO_STORE = { "Cache-Control": "no-store" };
const KOD_RE = /^[A-Za-z0-9._-]{1,80}$/;
export const MAX_BODY = 500_000;
const MAX = Number(process.env.LIBRARY_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 60 : 0));
const limiter = createRateLimiter({ windowMs: 60_000, max: MAX });

export const kodKniznice = (k: string) => (KOD_RE.test(k) ? k : null);
export const brana = (): Gate => ({ zapis: writeAllowed(), vydanie: process.env.LIBRARY_RELEASE_ENABLED === "true" });
export const sklad = (kniznica: string) => supabaseStore(kniznica);

/** `sklad_db.info()`: rel -> {rev, autor, vytvorena, zdroj} hlavy. */
export const info = (kniznica: string) => async (): Promise<RevisionInfo> => {
  const rows = (await supabaseHlavaStore().zoznam(kniznica)) ?? [];
  const mapa = Object.fromEntries(rows.map((r) => [r.cesta, { rev: r.rev, autor: r.autor, vytvorena: r.vytvorena, zdroj: r.zdroj }]));
  return { info: () => mapa };
};

export const odpoved = (o: Reply) => NextResponse.json(o.telo, { status: o.status, headers: NO_STORE });
const detail = (status: number, d: string) => NextResponse.json({ detail: d, error: d }, { status, headers: NO_STORE });

/** POST: origin, rate limit, telo ako JSON objekt; vráti chybovú odpoveď alebo telo. */
export async function vstup(req: Request): Promise<NextResponse | Record<string, unknown>> {
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) return detail(403, "cross-origin request denied");
  if (MAX > 0 && !limiter.check(clientIpKey(req.headers)).allowed) return detail(429, "príliš veľa požiadaviek, skús o minútu");
  const raw = await req.text();
  if (raw.length > MAX_BODY) return detail(413, "telo je príliš veľké");
  try {
    const b = JSON.parse(raw) as unknown;
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    /* nižšie */
  }
  return detail(422, "telo musí byť JSON objekt");
}

export const chybaServera = (err: unknown) => detail(500, err instanceof Error ? err.message : "požiadavka zlyhala");
export const neznamaKniznica = () => detail(400, "kód knižnice");
