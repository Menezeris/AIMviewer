import { dokument } from "@/lib/library/editor-api";
import { info, kodKniznice, neznamaKniznica, sklad } from "@/lib/library/editor-server";
import { vykresliHtml } from "@/lib/library/preview";
import { ZapisMigraciaChyba } from "@/lib/library/store-db";

/**
 * Requirements library editor in AIM (D-186 UI step): the same page as `assetin edit` (vendored `app.html`),
 * the document comes from the library in the DB, API at `/api/library/editor/<code>/`. Reading is public like `/library`; writing is behind
 * the `LIBRARY_WRITE_ENABLED` gate.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ library: string }> }) {
  const k = kodKniznice((await ctx.params).library);
  if (!k) return neznamaKniznica();
  try {
    const html = vykresliHtml(await dokument(sklad(k), await info(k)()), `/api/library/editor/${k}/`);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    const sprava = err instanceof ZapisMigraciaChyba ? err.message : err instanceof Error ? err.message : "editor sa nedá načítať";
    return new Response(sprava, { status: err instanceof ZapisMigraciaChyba ? 503 : 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
