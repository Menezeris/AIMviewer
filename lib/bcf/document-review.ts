import type { DocumentInfo, TopicDocumentRow, TopicStatus } from "./store";

/**
 * Pripomienka na dokumente po novej revízii dokumentu (D-158 krok 6, #199). Vzor je BCF pri IFC:
 * téma nie je viazaná na verziu, stav mení človek. Odkaz (`model_task_documents`) ukazuje na
 * `document_id`, ktorý je ten istý informačný kontajner naprieč revíziami (D-183 K1), takže sa
 * na novú revíziu prenáša sám. Tu sa len ODVODÍ, či treba kontrolu; nič sa neukladá okrem
 * potvrdenia (`reviewed_*`). Pôvodná revízia, strana a oblasť v riadku ostávajú.
 */

/** Stavy, v ktorých je téma vybavená: príznak sa nedáva a uzavretú nikto znova neotvára. */
export const SETTLED_STATUSES: readonly TopicStatus[] = ["closed", "resolved"];

export interface ReviewState {
  /** Revízia alebo sha256 dokumentu sa od založenia zmenila. */
  revision_changed: boolean;
  revision_current: string | null;
  /** Otvorená téma, ktorej odkaz treba skontrolovať po novej revízii (a ešte nikto nepotvrdil). */
  needs_review: boolean;
  position_uncertain: boolean;
  position_reason: string | null;
}

const sameSize = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

/** Zmenila sa revízia dokumentu od založenia odkazu? (číslo revízie alebo sha256 súboru) */
export function revisionChanged(link: TopicDocumentRow, now: DocumentInfo | null): boolean {
  if (!now) return false;
  return (link.document_revision ?? null) !== (now.revision ?? null) || Boolean(link.document_sha256 && now.sha256 && link.document_sha256 !== now.sha256);
}

/** Potvrdil človek kontrolu práve pre aktuálnu revíziu? */
function reviewedNow(link: TopicDocumentRow, now: DocumentInfo): boolean {
  if (!link.reviewed_at) return false;
  if (now.sha256 && link.reviewed_sha256) return link.reviewed_sha256 === now.sha256;
  return (link.reviewed_revision ?? null) === (now.revision ?? null);
}

/**
 * Poloha značky sa prenáša relatívne (rovnaká strana a oblasť v % strany). Neistá je, keď nová
 * revízia nemá túto stranu, má iný počet strán alebo inú veľkosť strany (iná kalibrácia výkresu).
 * Bez kotvy (starý odkaz) sa posúdi len chýbajúca strana.
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

/** Stav odkazu voči aktuálnej revízii dokumentu pre tému v danom stave. */
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
