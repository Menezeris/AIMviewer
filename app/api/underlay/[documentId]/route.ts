import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import { isValidGeorefV1 } from "@/lib/data/drawing";
import { calibrationFromV1, isValidCalibration, mergeCalibration, type GeorefCalibration, type GeorefV1 } from "@/lib/data/georef";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Zápis georeferencie výkresu (D-072): PATCH uloží kalibráciu do `_georef` v
 * `properties` dokumentového objektu (`objects.properties`, rezervovaný
 * `_` kľúč ako `_drawing_links` — tabuľka `documents` properties nemá).
 * Volá ho host stránka po bridge správe `UNDERLAY_SAVE` z embed viewera.
 * D-133: `_georef` je v2 (zoznam kalibrácií); v1 z panela sa zlúči ako
 * `source: manual` na miesto tej istej strany a podlažia, `calibration` (v2
 * položka) sa zlúči tak, ako prišla. Ručná je posledné slovo, preto tu `force`.
 *
 * Ochrana: viewer je zatiaľ verejný read-only (D-025/D-026), takže JEDINÝ
 * zapisovací endpoint je za env bránou — default VYPNUTÝ, demo/staging si ho
 * zapne cez `UNDERLAY_WRITE_ENABLED=true`. K tomu origin guard + per-IP
 * rate limit (vzor D-068). Poctivý vedomý limit, kým nepríde auth.
 */

const WRITE_ENABLED = process.env.UNDERLAY_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(
  process.env.UNDERLAY_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 30 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.UNDERLAY_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000
);
const underlayLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});

/** UUID formát `objects.id` — lacná validácia pred DB dotazom. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  if (!WRITE_ENABLED) {
    return NextResponse.json(
      { error: "zápis georeferencie je vypnutý (UNDERLAY_WRITE_ENABLED)" },
      { status: 403 }
    );
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }
  if (RATE_LIMIT_MAX > 0) {
    const rate = underlayLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  const { documentId } = await params;
  if (!UUID_RE.test(documentId)) {
    return NextResponse.json({ error: "invalid document id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = body as { georef?: unknown; calibration?: unknown } | null;
  let next: GeorefCalibration;
  if (isValidGeorefV1(b?.georef)) next = calibrationFromV1(b!.georef as GeorefV1, "manual");
  else if (isValidCalibration(b?.calibration)) next = b!.calibration as GeorefCalibration;
  else return NextResponse.json({ error: "invalid _georef payload" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Cieľ musí byť existujúci dokument — properties sa merguje, nie prepisuje.
  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .select("id, object_type, properties")
    .eq("id", documentId)
    .maybeSingle();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!obj || obj.object_type !== "document") {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  const current = (obj.properties as Record<string, unknown> | null) ?? {};
  const merged = mergeCalibration(current._georef, next, true);
  if (!merged.ok) return NextResponse.json({ error: "merge failed" }, { status: 409 });
  const properties = { ...current, _georef: merged.georef };
  const { error: uErr } = await supabase
    .from("objects")
    .update({ properties })
    .eq("id", documentId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Viewer/drawing dáta sa čítajú cez ISR tag `aim`. Next 16 vyžaduje
  // profil; `{expire: 0}` na legacy unstable_cache tagu sa môže správať ako
  // stale-while-revalidate (jeden request ešte stará odpoveď, ďalší čerstvá)
  // — pre podklady to stačí, viewer drží georef v session. Overiť live (F7).
  revalidateTag("aim", { expire: 0 });

  return NextResponse.json({ ok: true });
}
