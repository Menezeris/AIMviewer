/**
 * API stránky editora knižnice v AIM (port `assetin/server`, D-186 krok UI): to isté, čo stránka `app.html` volá pod
 * `assetin edit` (`stav`, `save`, `kontrola`, `nova`, `vydaj`), nad skladom v DB. Server nedrží stav: každá požiadavka
 * číta sklad znova a odpoveď na zápis nesie čerstvo načítaný dokument, takže stránka sa nikdy nerozíde so skladom.
 * Chyby majú tvar FastAPI (`{detail}`), lebo tak ich stránka číta.
 */

import { dokumentEditora, type InfoRevizie } from "./app-json";
import { nacitajKniznicuGraf } from "./graph";
import { kontrola } from "./check";
import { validuj } from "./validator";
import { vydaj as vydajKniznicu, type KontrolaXsd, type SkladVydania, type Uloziste } from "./release";
import { ChybaSkladu, Konflikt, uloz, vytvor, type Sklad, type Zmena } from "./write";

export interface Brana {
  /** `LIBRARY_WRITE_ENABLED` */
  zapis: boolean;
  /** `LIBRARY_RELEASE_ENABLED` (rola vydavateľa) */
  vydanie: boolean;
}

export interface Odpoved {
  status: number;
  telo: Record<string, unknown>;
}

type JS = Record<string, unknown>;
const chyba = (status: number, detail: string): Odpoved => ({ status, telo: { detail, error: detail } });

/** `_dokument`: knižnica zo skladu, validátor, dokument editora s revíziami zo skladu. */
export async function dokument(sklad: Sklad, info: InfoRevizie = {}) {
  const k = nacitajKniznicuGraf(await sklad.texty());
  return dokumentEditora(k, validuj(k), { ...info, vyzadujeAutora: true });
}

export function stav(kniznica: string, b: Brana) {
  return { api: true, koren: `db:${kniznica}`, zapis: b.zapis, nova: b.zapis, kontrola: true, vydanie: b.vydanie, autor_povinny: true };
  // `vydanie` stránka ukáže len s povinným autorom (databázový sklad), ako `assetin/server`
}

function zmeny(v: unknown): Zmena[] {
  return Array.isArray(v)
    ? (v as JS[]).filter((z) => z && typeof z.id === "string" && typeof z.pointer === "string").map((z) => ({ id: z.id as string, pointer: z.pointer as string, hodnota: z.hodnota ?? null }))
    : [];
}

function podpis(b: Brana, vstup: JS): { autor: string } | Odpoved {
  if (!b.zapis) return chyba(403, "zápis do knižnice v AIM je vypnutý (LIBRARY_WRITE_ENABLED)");
  const autor = typeof vstup.autor === "string" ? vstup.autor.trim().slice(0, 120) : "";
  if (!autor) return chyba(400, "zadaj meno autora - podpisuje revíziu v databáze");
  return { autor };
}

/** `POST save`: zmeny z editora cez writer do skladu; súbeh = 409 a nič sa neprepíše. */
export async function save(novySklad: () => Sklad, b: Brana, vstup: JS, info: () => Promise<InfoRevizie>): Promise<Odpoved> {
  const p = podpis(b, vstup);
  if ("status" in p) return p;
  const verzie = vstup.verzie && typeof vstup.verzie === "object" ? (Object.fromEntries(Object.entries(vstup.verzie as JS).filter(([, v]) => typeof v === "string")) as Record<string, string>) : {};
  const v = await uloz(novySklad(), zmeny(vstup.zmeny), { autor: p.autor, zdroj: "editor", sprava: null }, verzie);
  return { status: v.konflikt ? 409 : 200, telo: { ...v, dokument: await dokument(novySklad(), await info()) } };
}

/** `POST kontrola`: diagnostiky pracovnej kópie, nič sa nezapisuje. */
export async function over(sklad: Sklad, vstup: JS): Promise<Odpoved> {
  const nova = vstup.nova && typeof vstup.nova === "object" && !Array.isArray(vstup.nova) ? (vstup.nova as JS) : null;
  return { status: 200, telo: { ...(await kontrola(sklad, zmeny(vstup.zmeny), nova)) } };
}

/** `POST nova`: nová poznámka zo šablóny typu. */
export async function nova(novySklad: () => Sklad, b: Brana, vstup: JS, info: () => Promise<InfoRevizie>): Promise<Odpoved> {
  const p = podpis(b, vstup);
  if ("status" in p) return p;
  if (typeof vstup.typ !== "string" || typeof vstup.id !== "string" || typeof vstup.nazov !== "string") return chyba(422, "typ, id a nazov sú povinné");
  const data = vstup.data && typeof vstup.data === "object" && !Array.isArray(vstup.data) ? (vstup.data as JS) : {};
  const v = await vytvor(
    novySklad(),
    { typ: vstup.typ, id: vstup.id, nazov: vstup.nazov.slice(0, 300), data, vrstva: typeof vstup.vrstva === "string" ? vstup.vrstva : "zadanie", balik: typeof vstup.balik === "string" ? vstup.balik : null },
    { autor: p.autor, zdroj: "nova" },
  );
  return { status: 200, telo: { ...v, dokument: await dokument(novySklad(), await info()) } };
}

/**
 * `POST vydaj`: validácia (0 chýb), snímka, IDS do katalógu AIM, export MD (port `api_vydaj`). Za bránou
 * `LIBRARY_RELEASE_ENABLED` (rola vydavateľa); kód vydania volí vydavateľ, podpisuje meno z editora.
 */
export async function vydaj(sklad: () => SkladVydania, b: Brana, vstup: JS, o: { xsd?: KontrolaXsd | null; uloziste?: Uloziste | null } = {}): Promise<Odpoved> {
  if (!b.vydanie) return chyba(403, "vydávanie v AIM je vypnuté (LIBRARY_RELEASE_ENABLED)");
  const autor = typeof vstup.autor === "string" ? vstup.autor.trim().slice(0, 120) : "";
  if (!autor) return chyba(400, "zadaj meno autora - podpisuje vydanie");
  const kod = typeof vstup.kod === "string" ? vstup.kod.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(kod)) return chyba(400, "kód vydania: písmená, číslice, bodka, pomlčka (napr. 2026.11.2)");
  const sprava = typeof vstup.sprava === "string" ? vstup.sprava.slice(0, 500) : "";
  try {
    const v = await vydajKniznicu(sklad(), kod, autor, sprava, { xsd: o.xsd ?? null, uloziste: o.uloziste ?? null });
    return { status: v.ok ? 200 : 422, telo: { ...v } };
  } catch (e) {
    if (e instanceof Konflikt) return { status: 409, telo: { ok: false, sprava: e.message, konflikt: true } };
    if (e instanceof ChybaSkladu) return { status: 400, telo: { ok: false, sprava: e.message } };
    throw e;
  }
}
