import type { PageRegion, TextBlock } from "@/lib/llm/document-text";
import { normLabel, pairLabels } from "@/lib/data/drawing-labels";
import { assignableTexts, parseLinkEdit, type LinkEditInput } from "@/lib/data/drawing-link-overrides";

/**
 * Ručné priradenie, zrušenie a vrátenie odkazu popisku (D-160) pre `open_drawing link`.
 * Logika je nezávislá od DB: zápis, cieľ, riadky strany a návrh z vieweru idú cez `deps`.
 */

export interface LinkTargetRow {
  id: string;
  object_ref: string;
  name: string | null;
  ifc_guid: string | null;
  object_type: string;
}

/** Návrh priradenia z viewera (`view_state.link_draft`): označený text na strane a vybraný prvok. */
export interface LinkDraft {
  document_id: string;
  page: number;
  /** Prázdny = text pod oblasťou určí host z riadkov strany. */
  text: string;
  bbox: PageRegion | null;
  action: "assign" | "clear" | "reset";
  /** IFC GlobalId prvku vybraného v 3D (pri assign); dopĺňa host z `selection` viewera. */
  target_guid?: string;
}

/** Text riadkov strany, ktorých stred leží v oblasti (zhora nadol, zľava doprava). */
export function textInRegion(blocks: readonly TextBlock[], r: PageRegion): string {
  const inside = blocks.filter((b) => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
  });
  return inside
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((b) => b.t.trim())
    .filter(Boolean)
    .join(" ");
}

export interface LinkEditDeps {
  blocks(documentId: string, page: number): Promise<TextBlock[] | null>;
  resolveTarget(input: string): Promise<{ ok: true; row: LinkTargetRow } | { ok: false; error: string }>;
  write(w: {
    documentId: string;
    documentRef: string | null;
    page: number;
    text: string;
    bbox: PageRegion | null;
    action: "assign" | "suppress" | "reset";
    target: LinkTargetRow | null;
  }): Promise<{ replaced: number }>;
  readDraft(): Promise<LinkDraft | string>;
}

const isRegion = (b: unknown): b is PageRegion => {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k] as number));
};

export function parseDraft(state: unknown): LinkDraft | string {
  const d = (state as { link_draft?: unknown } | null)?.link_draft as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== "object") return "Vo vieweri nie je žiadny návrh odkazu (označ text na výkrese a vyber prvok).";
  const action = d.action === "clear" || d.action === "reset" ? d.action : "assign";
  if (typeof d.document_id !== "string" || typeof d.page !== "number" || !isRegion(d.bbox)) {
    return "Návrh odkazu vo vieweri je neúplný (dokument, strana, oblasť).";
  }
  // Cieľ priradenia = jediný prvok vybraný v 3D (selection.items), ak ho návrh sám nenesie.
  const items = (state as { selection?: { items?: { guid?: unknown }[] } } | null)?.selection?.items ?? [];
  const guid = typeof d.target_guid === "string" ? d.target_guid : items.length === 1 && typeof items[0].guid === "string" ? items[0].guid : undefined;
  if (action === "assign" && !guid) return "Na priradenie vyber vo vieweri v 3D práve jeden prvok (alebo zónu).";
  return {
    document_id: d.document_id,
    page: d.page,
    text: typeof d.text === "string" ? d.text : "",
    bbox: d.bbox,
    action,
    ...(guid ? { target_guid: guid } : {}),
  };
}

export async function editDrawingLink(
  doc: { id: string; object_ref: string | null },
  page: number | null,
  raw: unknown,
  deps: LinkEditDeps
): Promise<Record<string, unknown>> {
  let input: LinkEditInput | string;
  let pageNo = page;
  if (raw && typeof raw === "object" && (raw as { from_draft?: unknown }).from_draft === true) {
    const draft = await deps.readDraft();
    if (typeof draft === "string") throw new Error(draft);
    if (draft.document_id !== doc.id) throw new Error("Návrh vo vieweri patrí inému dokumentu než document_id.");
    pageNo = draft.page;
    input = {
      text: draft.text,
      action: draft.action,
      ...(draft.target_guid ? { target: draft.target_guid } : {}),
      bbox: draft.bbox,
    };
    if (input.action === "assign" && !input.target) throw new Error("Návrh vo vieweri nemá vybraný prvok (cieľ).");
  } else {
    input = parseLinkEdit(raw);
    if (typeof input === "string") throw new Error(input);
  }
  if (!pageNo) throw new Error("link: zadaj page (strana s popiskom).");

  const blocks = await deps.blocks(doc.id, pageNo);
  if (!blocks) throw new Error(`Strana ${pageNo} nemá extrahovaný text.`);
  if (!input.text.trim() && input.bbox) input = { ...input, text: textInRegion(blocks, input.bbox) };
  if (!input.text.trim()) throw new Error("V označenej oblasti nie je žiadny text strany; označ riadok textu.");
  const text = normLabel(input.text);
  if (!assignableTexts(blocks, pairLabels(blocks)).has(text) && !(input.action === "assign" && input.bbox)) {
    throw new Error(
      `Text '${input.text}' na strane ${pageNo} nie je (search_documents include_blocks); pre text mimo ` +
        "textovej vrstvy zadaj link.bbox (oblasť v % strany)."
    );
  }

  let target: LinkTargetRow | null = null;
  if (input.action === "assign") {
    const r = await deps.resolveTarget(input.target ?? "");
    if (!r.ok) throw new Error(r.error);
    target = r.row;
  }
  const action = input.action === "clear" ? "suppress" : input.action;
  const { replaced } = await deps.write({
    documentId: doc.id,
    documentRef: doc.object_ref,
    page: pageNo,
    text,
    bbox: input.bbox,
    action,
    target,
  });
  return {
    ok: true,
    action: input.action,
    page: pageNo,
    text: input.text,
    scope: input.bbox ? "bbox" : "page",
    ...(target ? { target: { object_ref: target.object_ref, name: target.name, object_type: target.object_type } } : {}),
    ...(replaced ? { replaced_previous: replaced } : {}),
    note:
      input.action === "reset"
        ? "Ručná oprava zrušená, platí automatické párovanie (D-130)."
        : "Ručný odkaz má prednosť pred automatickým; vo vieweri sa zobrazí po otvorení dokumentu.",
  };
}
