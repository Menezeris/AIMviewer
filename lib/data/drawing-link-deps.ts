import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";
import { parseBlocks } from "@/lib/llm/document-text";
import { parseDraft, type LinkEditDeps } from "@/lib/data/drawing-link-edit";
import { resolveLinkTarget, writeOverride } from "@/lib/data/drawing-link-store";

/** Produkčné závislosti `open_drawing link` (D-160): DB a živý viewer. */
export function realLinkEditDeps(): LinkEditDeps {
  return {
    async blocks(documentId, page) {
      const { data, error } = await getSupabaseAdmin()
        .from("document_pages")
        .select("blocks")
        .eq("document_id", documentId)
        .eq("page", page)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? parseBlocks((data as { blocks: unknown }).blocks) : null;
    },
    async resolveTarget(input) {
      const r = await resolveLinkTarget(input);
      return r.ok
        ? { ok: true, row: { id: r.row.id, object_ref: r.row.object_ref, name: r.row.name, ifc_guid: r.row.ifc_guid, object_type: r.row.object_type } }
        : r;
    },
    async write(w) {
      return writeOverride({
        ...w,
        target: w.target
          ? { id: w.target.id, object_ref: w.target.object_ref, name: w.target.name, ifc_guid: w.target.ifc_guid, ifc_type: null, object_type: w.target.object_type }
          : null,
        author: "chat",
      });
    },
    async readDraft() {
      const channel = liveChannel();
      if (!channel) return "živý viewer nie je nastavený (LIVE_CHANNEL)";
      const outcome = await queryLiveViewer(channel, "view_state");
      if (!outcome.ok) return outcome.reason === "timeout" ? "viewer neodpovedal (nie je otvorený s ?live=)" : "kanál viewera zlyhal";
      if (!outcome.reply.ok) return `viewer odpovedal chybou: ${outcome.reply.error}`;
      return parseDraft(outcome.reply.result);
    },
  };
}
