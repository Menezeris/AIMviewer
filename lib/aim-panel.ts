import type { NodeSummary } from "@/lib/data/object";
import type { CaptureSummary } from "@/lib/data/capture-placement";
import type { CaptureMediaEntry } from "@/lib/data/media-kind";
import type { NodeSectionsData } from "@/lib/data/relations";
import type { DerivedRelationWire } from "@/lib/derivations";
import { viaText, type ObjectDocument } from "@/lib/data/object-documents-core";
import { OBJECT_TYPE_LABEL } from "./object-type";

/**
 * AIM card in the native ifclite panel - render schema sent via
 * aim-bridge to the embedded viewer (AIM_PANEL_DATA). The viewer renders it
 * generically (apps/viewer/src/aim/AimCard.tsx in the fork), so new fields /
 * sections are added only here (host deploy), without redeploying the viewer.
 *
 * All `href`s are host-relative paths (/node/{id}, /type/{id},
 * /drawing/{id}); the viewer does not interpret them, it only sends them back via
 * AIM_NAVIGATE and the parent app navigates.
 */
export interface AimPanelData {
  /** v2 (D-077) is additive - all v2 fields are optional, the v1 render keeps working. */
  version: 1 | 2;
  /** Echo of the selected element's GUID - the viewer uses it to discard stale responses. */
  guid: string;
  title: string;
  subtitle?: string;
  badges?: { label: string; tone?: "default" | "accent" }[];
  sections?: {
    label: string;
    rows: { label: string; value: string; href?: string; mono?: boolean }[];
  }[];
  /**
   * Element documents. `documentId`, `page` and `via` (D-104) are optional: with them the viewer
   * opens the PDF itself on the page (AimCardDocumentWire in the fork), without them it navigates via `href`.
   */
  documents?: { name: string; href: string; badge?: string; documentId?: string; page?: number; via?: string; aim?: boolean }[];
  actions?: { label: string; href: string; primary?: boolean }[];
  // --- v2 typed sections (D-077: AIM inspector) ---
  /** Responsible persons/organizations (rel_assigns_to_actor). */
  responsibilities?: { name: string; role: string; org?: string; href?: string }[];
  /** Reality Capture summary - count + host link to the space gallery. */
  captures?: { count: number; href: string };
  /**
   * Reality Capture media of the space (D-131): AIM layer in the Documents panel ("Selection
   * only"), grouped in the viewer by `kindLabel` with an AIM badge.
   */
  captureMedia?: CaptureMediaEntry[];
  /** GUID history (bitemporal validity; `active` = current GUID). */
  history?: { guid: string; validFrom: string; validUntil?: string; active: boolean }[];
  /** Last change of the element by a recipe (D-129): model revision and BCF topic; row with an AIM badge in the IFC panel. */
  lastChange?: { model: string; revision: string; title: string; date: string };
  // --- AIM layer (D-089 phase B) ---
  /** Derived relations of the element for Relationship records with an AIM badge (trimmed per direction). */
  derivedRelations?: DerivedRelationWire[];
  /** Total number of derived relations before trimming. */
  derivedTotal?: number;
}

/**
 * Enriched element detail from GET /api/element/[id] (D-077): NodeSummary +
 * node sections (responsibilities, GUID history) + capture summary. Additive over
 * NodeSummary - an older client (ElementInfoPanel before D-077) ignores the fields.
 */
export interface ElementDetail extends NodeSummary {
  responsibilities?: NodeSectionsData["responsibilities"];
  guidHistory?: NodeSectionsData["guidHistory"];
  captures?: CaptureSummary | null;
  /** Reality Capture media of the space (D-131) - `captureMediaEntries`. */
  captureMedia?: CaptureMediaEntry[];
  /** Last change by a recipe (D-129) - `fetchLastElementChange`. */
  lastChange?: { model: string; revision: string; title: string; date: string } | null;
  /** Derived relations (D-089) - `fetchDerivedRelations`. */
  derived?: { relations: DerivedRelationWire[]; total: number };
  /**
   * Element documents via relations (D-104, `v_object_documents`) with their kind (ISO 19650 code);
   * missing if loading failed - the card then shows direct links as before.
   */
  effectiveDocuments?: (ObjectDocument & { typeCode?: string })[];
}

/** Cap on documents in the card; the full list is in the Documents panel ("selection only"). */
const CARD_DOCUMENTS_MAX = 40;

/** Type badge in the panel; unknown type = "Prvok" (zones, project and groups have their own, D-088). */
const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  asset_type: "Typ assetu",
  ...Object.fromEntries(
    (["project", "site", "building", "floor", "space", "zone", "spatial_zone", "group", "system"] as const).map(
      (t) => [t, OBJECT_TYPE_LABEL[t]]
    )
  ),
};

/** `2026-07-12T09:31:00Z` -> `2026-07-12` (history render; null -> empty string). */
function shortDate(ts: string | null): string {
  return ts ? ts.slice(0, 10) : "";
}

/**
 * ElementDetail (GET /api/element/[id]) -> render schema of the AIM card/inspector.
 * v2 (D-077): typed sections of responsibilities, capture summary and GUID history
 * are mapped from the enriched detail; the `captures` parameter stays for backward
 * compatibility of callers (D-073) and takes precedence over `summary.captures`.
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

  // Capture summary: the explicit parameter (D-073 callers) takes precedence over
  // the value from the enriched detail (D-077 route).
  const cap = captures ?? summary.captures ?? null;

  return {
    version: 2,
    guid,
    title: summary.name ?? guid,
    subtitle: summary.objectRef ?? undefined,
    badges: [{ label: TYPE_LABEL[summary.objectType] ?? "Prvok", tone: "accent" }],
    sections,
    // D-104: documents also via zone, storey, type and group, with page and path; the viewer
    // opens them itself. Without them (read error) direct links to /drawing/{id} as before.
    documents: summary.effectiveDocuments
      ? summary.effectiveDocuments.slice(0, CARD_DOCUMENTS_MAX).map((d) => ({
          name: d.name ?? d.identification ?? d.documentId,
          href: `/drawing/${d.documentId}${d.page ? `?page=${d.page}` : ""}`,
          badge: d.typeCode,
          documentId: d.documentId,
          ...(d.page ? { page: d.page } : {}),
          via: viaText(d),
          // D-129: direct and via type are in the IFC; inherited via zone, storey, group... are the AIM layer.
          ...(d.via !== "direct" && d.via !== "type" ? { aim: true } : {}),
        }))
      : summary.documents.map((d) => ({
          name: d.name ?? d.objectRef ?? d.id,
          href: `/drawing/${d.id}`,
          badge: d.isDrawing ? "výkres" : undefined,
        })),
    // v2 (D-077): responsibilities with a click-through to the actor, GUID history read-only.
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
    ...(summary.lastChange ? { lastChange: summary.lastChange } : {}),
    ...(summary.captureMedia?.length ? { captureMedia: summary.captureMedia } : {}),
    derivedRelations: summary.derived?.relations.length ? summary.derived.relations : undefined,
    derivedTotal: summary.derived?.relations.length ? summary.derived.total : undefined,
    actions: [
      { label: "Otvoriť celý detail", href: `/${summary.route}/${summary.id}`, primary: true },
      // Reality Capture (D-073) - opens the space gallery as an overlay over 3D.
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
