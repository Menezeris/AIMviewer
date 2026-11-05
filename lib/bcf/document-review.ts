import type { DocumentInfo, TopicDocumentRow, TopicStatus } from "./store";

/**
 * Review of a document comment after a new document revision (D-158 step 6, #199). The model is BCF with IFC:
 * a topic is not bound to a version, a human changes the status. The reference (`model_task_documents`) points to
 * `document_id`, which is the same information container across revisions (D-183 K1), so it carries over
 * to a new revision by itself. Here it is only DERIVED whether a check is needed; nothing is stored except
 * the confirmation (`reviewed_*`). The original revision, page and region in the row stay.
 */

/** Statuses in which a topic is handled: the flag is not set and nobody reopens a closed one. */
export const SETTLED_STATUSES: readonly TopicStatus[] = ["closed", "resolved"];

export interface ReviewState {
  /** The document revision or sha256 has changed since creation. */
  revision_changed: boolean;
  revision_current: string | null;
  /** An open topic whose reference needs a check after a new revision (and nobody has confirmed yet). */
  needs_review: boolean;
  position_uncertain: boolean;
  position_reason: string | null;
}

const sameSize = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

/** Has the document revision changed since the reference was created? (revision number or file sha256) */
export function revisionChanged(link: TopicDocumentRow, now: DocumentInfo | null): boolean {
  if (!now) return false;
  return (link.document_revision ?? null) !== (now.revision ?? null) || Boolean(link.document_sha256 && now.sha256 && link.document_sha256 !== now.sha256);
}

/** Did a human confirm the check for exactly the current revision? */
function reviewedNow(link: TopicDocumentRow, now: DocumentInfo): boolean {
  if (!link.reviewed_at) return false;
  if (now.sha256 && link.reviewed_sha256) return link.reviewed_sha256 === now.sha256;
  return (link.reviewed_revision ?? null) === (now.revision ?? null);
}

/**
 * The marker position is carried over relatively (same page and region in % of the page). It is uncertain when the new
 * revision lacks this page, has a different page count or a different page size (a different drawing calibration).
 * Without an anchor (old reference) only a missing page is assessed.
 */
export function positionCheck(link: TopicDocumentRow, now: DocumentInfo): string | null {
  if (!link.page) return null;
  if (now.pages !== null && link.page > now.pages) return `nová revízia má ${now.pages} strán, strana ${link.page} v nej nie je`;
  if (link.anchor_pages && now.pages !== null && link.anchor_pages !== now.pages) {
    return `počet strán sa zmenil z ${link.anchor_pages} na ${now.pages}`;
  }
  if (link.anchor_page_size && link.page_size && !sameSize(link.anchor_page_size, link.page_size)) {
    return `veľkosť strany sa zmenila z ${link.anchor_page_size.join(" x ")} na ${link.page_size.join(" x ")} bodov`;
  }
  return null;
}

/** State of a reference against the current document revision for a topic in the given status. */
export function reviewState(link: TopicDocumentRow, topicStatus: TopicStatus, now: DocumentInfo | null): ReviewState {
  const changed = revisionChanged(link, now);
  if (!changed || !now) {
    return { revision_changed: false, revision_current: now?.revision ?? null, needs_review: false, position_uncertain: false, position_reason: null };
  }
  const reason = positionCheck(link, now);
  const settled = SETTLED_STATUSES.includes(topicStatus);
  return {
    revision_changed: true,
    revision_current: now.revision ?? null,
    needs_review: !settled && !reviewedNow(link, now),
    position_uncertain: reason !== null,
    position_reason: reason,
  };
}
