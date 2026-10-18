import type { NodeSummary } from "@/lib/data/object";
import type { CaptureSummary } from "@/lib/data/capture-placement";
import type { NodeSectionsData } from "@/lib/data/relations";
import type { DerivedRelationWire } from "@/lib/derivations";
import { OBJECT_TYPE_LABEL } from "./object-type";

/**
 * AIM karta v natívnom paneli ifclite — render schéma posielaná cez
 * aim-bridge do embednutého viewera (AIM_PANEL_DATA). Viewer ju vykresľuje
 * genericky (apps/viewer/src/aim/AimCard.tsx vo forku), takže nové polia /
 * sekcie sa pridávajú len tu (host deploy), bez redeployu viewera.
 *
 * Všetky `href` sú host-relatívne cesty (/node/{id}, /type/{id},
 * /drawing/{id}); viewer ich neinterpretuje, len ich pošle späť cez
 * AIM_NAVIGATE a parent appka naviguje.
 */
export interface AimPanelData {
  /** v2 (D-077) je aditívna — všetky v2 polia sú voliteľné, v1 render beží ďalej. */
  version: 1 | 2;
  /** Echo GUID-u vybraného elementu — viewer ním zahadzuje stale odpovede. */
  guid: string;
  title: string;
  subtitle?: string;
  badges?: { label: string; tone?: "default" | "accent" }[];
  sections?: {
    label: string;
    rows: { label: string; value: string; href?: string; mono?: boolean }[];
  }[];
  documents?: { name: string; href: string; badge?: string }[];
  actions?: { label: string; href: string; primary?: boolean }[];
  // --- v2 typované sekcie (D-077: AIM inspector) ---
  /** Zodpovedné osoby/organizácie (rel_assigns_to_actor). */
  responsibilities?: { name: string; role: string; org?: string; href?: string }[];
  /** Reality Capture súhrn — počet + host link na galériu priestoru. */
  captures?: { count: number; href: string };
  /** História GUID (bitemporálna platnosť; `active` = aktuálny GUID). */
  history?: { guid: string; validFrom: string; validUntil?: string; active: boolean }[];
  // --- vrstva AIM (D-089 fáza B) ---
  /** Odvodené vzťahy prvku pre Relationship records s odznakom AIM (orezané na smer). */
  derivedRelations?: DerivedRelationWire[];
  /** Celkový počet odvodených vzťahov pred orezaním. */
  derivedTotal?: number;
}

/**
 * Obohatený detail elementu z GET /api/element/[id] (D-077): NodeSummary +
 * sekcie uzla (zodpovednosti, história GUID) + capture súhrn. Aditívne nad
 * NodeSummary — starší klient (ElementInfoPanel pred D-077) polia ignoruje.
 */
export interface ElementDetail extends NodeSummary {
  responsibilities?: NodeSectionsData["responsibilities"];
  guidHistory?: NodeSectionsData["guidHistory"];
  captures?: CaptureSummary | null;
  /** Odvodené vzťahy (D-089) - `fetchDerivedRelations`. */
  derived?: { relations: DerivedRelationWire[]; total: number };
}

/** Odznak typu v paneli; neznámy typ = "Prvok" (zóny, projekt a skupiny majú vlastný, D-088). */
const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  asset_type: "Typ assetu",
  ...Object.fromEntries(
    (["project", "site", "building", "floor", "space", "zone", "spatial_zone", "group", "system"] as const).map(
      (t) => [t, OBJECT_TYPE_LABEL[t]]
    )
  ),
};

/** `2026-07-12T09:31:00Z` → `2026-07-12` (render histórie; null → prázdny string). */
function shortDate(ts: string | null): string {
  return ts ? ts.slice(0, 10) : "";
}

/**
 * ElementDetail (GET /api/element/[id]) → render schéma AIM karty/inspectora.
 * v2 (D-077): typované sekcie zodpovedností, capture súhrnu a histórie GUID
 * sa mapujú z obohateného detailu; `captures` parameter ostáva pre spätnú
 * kompatibilitu volajúcich (D-073) a má prednosť pred `summary.captures`.
 */
export function nodeSummaryToAimPanel(
  summary: ElementDetail,
  guid: string,
  captures?: CaptureSummary | null
): AimPanelData {
  const ifcRows: NonNullable<AimPanelData["sections"]>[number]["rows"] = [];
  if (summary.ifcType) ifcRows.push({ label: "IFC typ", value: summary.ifcType, mono: true });
  if (summary.predefinedType)
    ifcRows.push({ label: "PredefinedType", value: summary.predefinedType, mono: true });
  if (summary.userDefinedType)
    ifcRows.push({ label: "ObjectType", value: summary.userDefinedType, mono: true });
  if (summary.type) {
    ifcRows.push({
      label: "Typ",
      value: summary.type.name ?? summary.type.object_ref ?? summary.type.id,
      href: `/type/${summary.type.id}`,
    });
  }

  const overviewRows: NonNullable<AimPanelData["sections"]>[number]["rows"] = [
    { label: "Klasifikácie", value: String(summary.counts.classifications) },
  ];
  if (summary.objectType === "asset_type") {
    overviewRows.push({ label: "Výskyty", value: String(summary.counts.occurrences) });
  }

  const sections: AimPanelData["sections"] = [];
  if (ifcRows.length > 0) sections.push({ label: "IFC", rows: ifcRows });
  sections.push({ label: "Prehľad", rows: overviewRows });

  // Capture súhrn: explicitný parameter (D-073 volajúci) má prednosť pred
  // hodnotou z obohateného detailu (D-077 route).
  const cap = captures ?? summary.captures ?? null;

  return {
    version: 2,
    guid,
    title: summary.name ?? guid,
    subtitle: summary.objectRef ?? undefined,
    badges: [{ label: TYPE_LABEL[summary.objectType] ?? "Prvok", tone: "accent" }],
    sections,
    // Parita so starým ElementInfoPanel: všetky dokumenty vedú na /drawing/{id}.
    documents: summary.documents.map((d) => ({
      name: d.name ?? d.objectRef ?? d.id,
      href: `/drawing/${d.id}`,
      badge: d.isDrawing ? "výkres" : undefined,
    })),
    // v2 (D-077): zodpovednosti s preklikom na aktora, história GUID read-only.
    responsibilities: summary.responsibilities?.map((r) => ({
      name: r.actorName ?? r.actorRef ?? r.actorId,
      role: r.role,
      org: r.org?.name ?? undefined,
      href: `/node/${r.actorId}`,
    })),
    captures:
      cap && cap.count > 0 && cap.spaceId
        ? { count: cap.count, href: `/ifc?captures=${cap.spaceId}` }
        : undefined,
    history: summary.guidHistory?.map((h) => ({
      guid: h.ifcGuid,
      validFrom: shortDate(h.validFrom),
      validUntil: h.validUntil ? shortDate(h.validUntil) : undefined,
      active: h.active,
    })),
    derivedRelations: summary.derived?.relations.length ? summary.derived.relations : undefined,
    derivedTotal: summary.derived?.relations.length ? summary.derived.total : undefined,
    actions: [
      { label: "Otvoriť celý detail", href: `/${summary.route}/${summary.id}`, primary: true },
      // Reality Capture (D-073) — otvorí galériu priestoru ako overlay nad 3D.
      ...(cap && cap.count > 0 && cap.spaceId
        ? [
            {
              label: `Reality Capture (${cap.count})`,
              href: `/ifc?captures=${cap.spaceId}`,
            },
          ]
        : []),
    ],
  };
}
