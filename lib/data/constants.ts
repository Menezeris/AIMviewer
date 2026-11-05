/**
 * Shared constants of the data layer - import instead of local definitions.
 */

/** `source` of edges from the auto-linking of drawings (E4, D-041). */
export const PDF_LINK_SOURCE = "pdf_link (E4)";

/** Common ISR setting for cached reads (D-029 perf). */
export const AIM_CACHE = { revalidate: 60, tags: ["aim"] };
