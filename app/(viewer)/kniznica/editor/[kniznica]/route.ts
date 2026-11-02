import { dokument } from "@/lib/kniznica/editor-api";
import { info, kodKniznice, neznamaKniznica, sklad } from "@/lib/kniznica/editor-server";
import { vykresliHtml } from "@/lib/kniznica/nahlad";
import { ZapisMigraciaChyba } from "@/lib/kniznica/sklad-db";

/**
 * Editor knižnice požiadaviek v AIM (D-186 krok UI): tá istá stránka ako `assetin edit` (vendorovaná `app.html`),
 * dokument z knižnice v DB, API na `/api/library/editor/<kód>/`. Čítanie je verejné ako `/kniznica`; zápis je za
 * bránou `LIBRARY_WRITE_ENABLED`.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ kniznica: string }> }) {
  const k = kodKniznice((await ctx.params).kniznica);
  if (!k) return neznamaKniznica();
  try {
    const html = vykresliHtml(await dokument(sklad(k), await info(k)()), `/api/library/editor/${k}/`);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    const sprava = err instanceof ZapisMigraciaChyba ? err.message : err instanceof Error ? err.message : "editor sa nedá načítať";
    return new Response(sprava, { status: err instanceof ZapisMigraciaChyba ? 503 : 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
