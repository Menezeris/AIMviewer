import { docRegionInput, parseDocRegion } from "../viewer-ops";

import { parseMarkup, type Markup } from "./markup";
import { viewrect } from "./snapshot-plan";

import type { BcfStore, DocumentInfo, TopicDocumentRow, TopicDocumentWrite } from "./store";

/**
 * Odkaz BCF témy na dokument, stranu a oblasť strany (D-158): riadok
 * `model_task_documents` = BCF DocumentReference. Téma ostáva v `model_tasks`
 * (D-099), prvky IFC v jej `components`. Tu je čistá logika pre chat
 * (`bcf_topic document`) aj BCF API (`document_references`); DB je za `BcfStore`.
 */

/** Najviac odkazov na dokumenty pri jednej téme. */
export const MAX_TOPIC_DOCUMENTS = 20;
const MAX_DESCRIPTION = 2000;
const MAX_URL = 2000;

export class TopicDocumentError extends Error {}

export interface DocumentArg {
  id_or_ref: string;
  page?: number;
  region?: unknown;
  description?: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DRAWING_PATH = new RegExp(`^/drawing/(${UUID})/?$`, "i");

/** Parameter `document` toolu: objekt, alebo len id/kód dokumentu. */
export function parseDocumentArg(raw: unknown): DocumentArg {
  if (typeof raw === "string" && raw.trim()) return { id_or_ref: raw.trim() };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TopicDocumentError("document: {id_or_ref, page, region, description} (id_or_ref = objects.id, object_ref alebo kód dokumentu).");
  }
  const r = raw as Record<string, unknown>;
  const id = typeof r.id_or_ref === "string" ? r.id_or_ref.trim() : typeof r.document_id === "string" ? r.document_id.trim() : "";
  if (!id) throw new TopicDocumentError("document.id_or_ref: objects.id, object_ref alebo kód dokumentu (search_documents ho nájde).");
  let page: number | undefined;
  if (r.page !== undefined && r.page !== null) {
    const n = Number(r.page);
    if (!Number.isInteger(n) || n < 1) throw new TopicDocumentError(`document.page musí byť celé číslo od 1, nie '${String(r.page)}'.`);
    page = n;
  }
  const description = typeof r.description === "string" && r.description.trim() ? r.description.trim().slice(0, MAX_DESCRIPTION) : undefined;
  return { id_or_ref: id, page, region: r.region ?? undefined, description };
}

/** Výrez v tvare `open_drawing region` (%, 2 desatinné miesta); chybný = chyba, nie tichá celá strana. */
export function regionArg(raw: unknown): TopicDocumentRow["region"] {
  if (raw === undefined || raw === null) return null;
  const r = docRegionInput(raw);
  if (!r) {
    throw new TopicDocumentError("document.region: {x, y, width, height} v % strany (0-100, počiatok vľavo hore), aspoň čiastočne na strane.");
  }
  const p = (v: number) => +v.toFixed(2);
  return { x: p(r.x), y: p(r.y), width: p(r.w), height: p(r.h) };
}

/** Riadok odkazu z dokumentu v AIM; strana sa overí voči extrahovaným stranám, ak sú. */
export function documentWrite(
  info: DocumentInfo,
  input: { page?: number; region?: unknown; description?: string; markup?: unknown },
  taskId: string,
  author: string | null,
): TopicDocumentWrite {
  const region = regionArg(input.region);
  let page = input.page ?? info.reference_page ?? null;
  if (page === null && region) {
    // Oblasť bez strany má zmysel len pri jednostranovom dokumente.
    if (info.pages === 1) page = 1;
    else throw new TopicDocumentError("document.region potrebuje page (oblasť je na konkrétnej strane).");
  }
  if (page !== null && info.pages !== null && page > info.pages) {
    throw new TopicDocumentError(`Dokument ${label(info)} má ${info.pages} strán, strana ${page} nie je.`);
  }
  // Značky patria na konkrétnu stranu; bez strany sa zahodia (rovnako neplatné tvary, nie celá téma).
  const markup = page !== null ? parseMarkup(input.markup) : [];
  return {
    task_id: taskId,
    document_id: info.id,
    document_ref: info.identification ?? info.object_ref,
    document_name: info.name,
    document_revision: info.revision,
    page,
    region,
    markup: markup.length ? markup : null,
    url: null,
    description: input.description ?? null,
    author,
    document_sha256: info.sha256 ?? null,
  };
}

const label = (d: { identification?: string | null; object_ref?: string | null; name?: string | null }) =>
  d.identification ?? d.object_ref ?? d.name ?? "dokument";

/** Dokument z argumentu chatu -> riadok odkazu (bez task_id, ten dá volajúci). */
export async function resolveDocumentArg(store: BcfStore, raw: unknown, author: string | null): Promise<Omit<TopicDocumentWrite, "task_id">> {
  const arg = parseDocumentArg(raw);
  const info = await store.findDocument(arg.id_or_ref);
  if (!info) {
    throw new TopicDocumentError(
      `Dokument '${arg.id_or_ref}' v AIM nie je (objects.id, object_ref alebo jednoznačný kód; nájde ho search_documents alebo get_object include=documents).`,
    );
  }
  const row: Partial<TopicDocumentWrite> = documentWrite(info, arg, "", author);
  delete row.task_id;
  return row as Omit<TopicDocumentWrite, "task_id">;
}

const pct = (v: number) => `${+v.toFixed(2)}`.replace(".", ",");

/** Čitateľný opis odkazu: kód, revízia, strana, oblasť (BCF description, zoznam v chate). */
export function documentLabel(d: Pick<TopicDocumentRow, "document_ref" | "document_name" | "document_revision" | "page" | "region" | "url">): string {
  const parts = [d.document_ref ?? d.document_name ?? d.url ?? "dokument"];
  if (d.document_revision) parts[0] += ` (rev. ${d.document_revision})`;
  if (d.page) parts.push(`strana ${d.page}`);
  if (d.region) {
    const r = d.region;
    parts.push(`oblasť x ${pct(r.x)} %, y ${pct(r.y)} %, ${pct(r.width)} x ${pct(r.height)} %`);
  }
  return parts.join(", ");
}

/** Odkaz v detaile témy pre chat: s pripravenými argumentmi `open_drawing`. */
export function documentView(d: TopicDocumentRow) {
  return {
    guid: d.id,
    document_id: d.document_id,
    document: d.document_ref,
    name: d.document_name,
    revision: d.document_revision,
    page: d.page,
    region: d.region,
    ...markupView(d.markup),
    description: d.description,
    label: documentLabel(d),
    ...(d.url ? { url: d.url } : {}),
    open_drawing: d.document_id
      ? { document_id: d.document_id, ...(d.page ? { page: d.page } : {}), ...(d.region ? { region: d.region } : {}), in_viewer: true }
      : null,
    // Snímka výrezu s rámikom (D-158 krok 3), relatívna adresa hosta; BCF API ju dáva ako snímku pohľadu.
    snapshot_url: snapshotPath(d),
  };
}

/** Značky odkazu v detaile témy: tvary a počet (bez značiek polia nie sú). */
function markupView(markup: Markup[] | null): { markup?: Markup[]; markup_count?: number } {
  const m = parseMarkup(markup);
  return m.length ? { markup: m, markup_count: m.length } : {};
}

const regionParam = (r: NonNullable<TopicDocumentRow["region"]>) => [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(2)).join("_");

/** `/api/drawing/<id>/snapshot?page=N&region=x_y_w_h`; bez dokumentu alebo strany null. */
export function snapshotPath(d: Pick<TopicDocumentRow, "document_id" | "page" | "region">): string | null {
  if (!d.document_id || !d.page) return null;
  const q = new URLSearchParams({ page: String(d.page) });
  if (d.region) q.set("region", regionParam(d.region));
  return `/api/drawing/${d.document_id}/snapshot?${q.toString()}`;
}

/**
 * Odkaz na stranu vo vieweri AIM: `/drawing/<id>?page=N&region=x_y_w_h#page=N&viewrect=l,t,w,h`.
 * `region` je náš parameter (návrat pri importe), `#page` a `viewrect` (body strany od ľavého
 * horného rohu, len keď je známa veľkosť strany) sú RFC 8118 pre PDF.
 */
export function documentUrl(
  origin: string,
  d: Pick<TopicDocumentRow, "document_id" | "page" | "region"> & { page_size?: [number, number] | null },
): string | null {
  if (!d.document_id) return null;
  const q = new URLSearchParams();
  if (d.page) q.set("page", String(d.page));
  if (d.region) q.set("region", regionParam(d.region));
  const qs = q.toString();
  const rect = d.page ? viewrect(d.page_size ?? null, d.region) : null;
  const frag = d.page ? `#page=${d.page}${rect ? `&viewrect=${rect}` : ""}` : "";
  return `${origin.replace(/\/+$/, "")}/drawing/${d.document_id}${qs ? `?${qs}` : ""}${frag}`;
}

/** BCF API 2.1 DocumentReference GET DTO. */
export function documentReferenceToDto(d: TopicDocumentRow, origin: string): Record<string, unknown> {
  const head = documentLabel(d);
  const markup = parseMarkup(d.markup);
  return {
    guid: d.id,
    url: d.url ?? documentUrl(origin, d),
    description: d.description ? `${head}: ${d.description}` : head,
    // Rozšírenie AIM (D-158 krok 7): tvary značiek; klient, ktorý ho nepozná, ho ignoruje.
    ...(markup.length ? { markup } : {}),
  };
}

export interface ParsedReference {
  /** Dokument AIM z našej adresy (`/drawing/<id>`); inak cudzí odkaz v `url`. */
  document_id: string | null;
  page: number | null;
  region: TopicDocumentRow["region"];
  url: string | null;
  description: string | null;
}

/** BCF DocumentReference PUT/POST DTO -> náš odkaz; adresa AIM sa rozloží na dokument, stranu a oblasť. */
export function parseDocumentReferenceDto(body: unknown, origin: string): ParsedReference {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const url = typeof b.url === "string" ? b.url.trim().slice(0, MAX_URL) : "";
  const rawDescription = typeof b.description === "string" ? b.description.trim().slice(0, MAX_DESCRIPTION) : "";
  if (!url) {
    throw new TopicDocumentError(
      typeof b.document_guid === "string" && b.document_guid
        ? "document_guid (dokumenty projektu BCF) API zatiaľ nepodporuje; pošli url."
        : "Chýba url odkazu na dokument.",
    );
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(url, origin);
  } catch {
    parsed = null;
  }
  const ours = parsed && parsed.origin === new URL(origin).origin ? DRAWING_PATH.exec(parsed.pathname) : null;
  if (!ours || !parsed) return { document_id: null, page: null, region: null, url, description: rawDescription || null };
  const n = Number(parsed.searchParams.get("page") ?? new URLSearchParams(parsed.hash.replace(/^#/, "")).get("page"));
  const page = Number.isInteger(n) && n >= 1 ? n : null;
  const r = parseDocRegion(parsed.searchParams.get("region") ?? undefined);
  const region = r ? { x: r.x, y: r.y, width: r.w, height: r.h } : null;
  return { document_id: ours[1].toLowerCase(), page, region, url: null, description: rawDescription || null };
}

/** Opis z exportu (`<kód, strana...>: <text>`) sa pri návrate zbaví vlastnej hlavičky. */
export function stripOwnLabel(description: string | null, row: Omit<TopicDocumentWrite, "task_id">): string | null {
  if (!description) return null;
  const head = documentLabel(row);
  if (description === head) return null;
  return description.startsWith(`${head}: `) ? description.slice(head.length + 2) || null : description;
}
