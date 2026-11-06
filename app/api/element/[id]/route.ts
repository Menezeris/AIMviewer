import { NextResponse } from "next/server";

import { fetchNodeSummary } from "@/lib/data/object";
import { fetchNodeSections } from "@/lib/data/relations";
import { fetchCaptureSummaryForObject, fetchCapturesForSpace, type CaptureSummary } from "@/lib/data/captures";
import { captureMediaEntries } from "@/lib/data/media-kind";
import { fetchLastElementChange } from "@/lib/data/model-revisions";
import { fetchDerivedRelations } from "@/lib/data/derivations";
import { fetchDocumentTypes, fetchObjectDocuments } from "@/lib/data/object-documents";
import type { ElementDetail } from "@/lib/aim-panel";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/** Documents of an element via relations with a kind code (D-104); on error the card shows direct links. */
async function effectiveDocuments(id: string): Promise<ElementDetail["effectiveDocuments"]> {
  const projectId = currentProjectId();
  const { documents } = await fetchObjectDocuments(projectId, id);
  const types = await fetchDocumentTypes(projectId, [...new Set(documents.map((d) => d.documentId))]);
  return documents.map((d) => {
    const typeCode = types.get(d.documentId)?.code;
    return typeCode ? { ...d, typeCode } : d;
  });
}

/**
 * Element detail for the AIM inspector in 3D (D-077) and the side info panel of the drawing
 * viewer (D-042 D). Since D-077 enriched with node sections (responsibilities, GUID
 * history) and a capture summary - NodeSummary fields remain additively preserved.
 * Server-side via `service_role` (D-026), cached (ISR).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getHandler(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = currentProjectId();
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const [summary, sections, captures, derived, docs] = await Promise.all([
      fetchNodeSummary(projectId, id),
      fetchNodeSections(projectId, id),
      fetchCaptureSummaryForObject(projectId, id),
      // AIM layer (D-089): derived relations for Relationship records in the viewer.
      fetchDerivedRelations(projectId, id).catch(() => undefined),
      effectiveDocuments(id).catch((err) => {
        console.error(`[api/element/${id}] documents`, err);
        return undefined;
      }),
    ]);
    if (!summary) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const detail: ElementDetail = {
      ...summary,
      responsibilities: sections.responsibilities,
      guidHistory: sections.guidHistory,
      captures,
      derived,
      lastChange: await lastChangeOf(sections.guidHistory),
      captureMedia: await captureMediaOf(captures, summary.objectType !== "space"),
      ...(docs ? { effectiveDocuments: docs } : {}),
    };
    // Read-only summary (revalidated with the other AIM data after 60 s). Cache in the
    // browser + on the CDN -> a repeated click on the same code in a drawing is instant,
    // without an HTTP round trip to the server (D-030 perf, addendum).
    return NextResponse.json(detail, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error(`[api/element/${id}]`, err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

/** D-129: latest change of the active GUID by recipe; a read error does not bring the card down. */
async function lastChangeOf(history: ElementDetail["guidHistory"]): Promise<ElementDetail["lastChange"]> {
  const projectId = currentProjectId();
  const guid = history?.find((h) => h.active)?.ifcGuid;
  if (!guid) return null;
  return fetchLastElementChange(projectId, guid).catch((err) => {
    console.error("[api/element] lastChange", err);
    return null;
  });
}

/** D-131: Reality Capture media of a space (also for an element in it); a read error does not bring the card down. */
async function captureMediaOf(cap: CaptureSummary, inherited: boolean): Promise<ElementDetail["captureMedia"]> {
  const projectId = currentProjectId();
  if (!cap.spaceId || cap.count === 0) return undefined;
  const space = { id: cap.spaceId, name: cap.spaceName };
  return fetchCapturesForSpace(projectId, cap.spaceId)
    .then((points) => captureMediaEntries(points, space, inherited))
    .catch((err) => {
      console.error("[api/element] captureMedia", err);
      return undefined;
    });
}

export const GET = withRequestAuth(withRequestProject(getHandler), { source: "app:/api/element/[id]", write: false });
