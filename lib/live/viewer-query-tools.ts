import "server-only";

import { lookupGuids } from "@/lib/engine/aim-lookup";
import type { ToolDefinition } from "@/lib/llm/provider";
import { ViewInputError } from "@/lib/llm/view-plan";
import { resolveTargets } from "@/lib/llm/view-tools";

import { liveChannel } from "./broadcast";
import { MAX_QUERY_GUIDS, type ViewerQuery } from "./protocol";
import { queryLiveViewer, type QueryOutcome } from "./query";
import { lookupSelectionContext } from "./selection-context";
import { DEFAULT_ITEMS_LIMIT, MAX_ITEMS_LIMIT, lookupGuidsFor, summarizeSelection, type ViewerSelection } from "./selection-summary";

/**
 * Tools spätného kanála (D-085), len v MCP konektore: čítajú otvorený živý
 * viewer, preto potrebujú `LIVE_CHANNEL` a viewer s `?live=`. Súradnice sú
 * IFC svet (Z hore, metre), rovnaké ako `set_section.coordinate_m`.
 */

export const VIEWER_QUERY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_bounds",
    description:
      "Obálky (bounding box) v súradniciach IFC modelu (m, Z hore) z OTVORENÉHO živého viewera: celý " +
      "model (rozsah a osi) a voliteľne vybrané prvky (min, max, size, center). Pred presným rezom: " +
      "get_bounds(prvok) -> set_section(orientation, coordinate_m) alebo set_section(cieľ, fit). " +
      "section_axis hovorí, ktorú os IFC ktorá orientation reže. Zostava bez vlastnej geometrie " +
      "(schodisko ako kontajner) sa zráta z častí; missing = prvky bez geometrie vo vieweri.",
    inputSchema: {
      type: "object",
      properties: {
        target_ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: `objects.id alebo object_ref (max ${MAX_QUERY_GUIDS}); bez cieľa len obálka modelu`,
        },
        global_ids: { type: "array", items: { type: "string" }, description: "IFC GlobalId (z ifc_* toolov)" },
      },
    },
  },
  {
    name: "get_viewer_state",
    description:
      "Čo práve ukazuje OTVORENÝ živý viewer: režim (3d/2d/split) a podlažie, aktívny rez (os, " +
      "súradnica v IFC, poloha v %), kamera (pozícia a cieľ v IFC), výber a počty skrytých a izolovaných " +
      "prvkov. Výber: count (celkom), returned a truncated (či viewer poslal všetko), summary (počty podľa " +
      "IFC triedy, podlažia, rodičovskej zostavy a modelu; covers=all|returned) a stránka items (guid, " +
      "object_ref, name, ifc_type, floor, parent). Na 'čo mám vybrané' odpovedaj zo summary, nie zo vzorky " +
      "items; pri truncated povedz, že výber je orezaný. Použi pred úpravou pohľadu a na otázky 'čo mám " +
      "vybrané / čo vidím'.",
    inputSchema: {
      type: "object",
      properties: {
        items_offset: { type: "number", description: "Od ktorej položky výberu (stránkovanie items, default 0)" },
        items_limit: {
          type: "number",
          description: `Koľko položiek výberu (default ${DEFAULT_ITEMS_LIMIT}, strop ${MAX_ITEMS_LIMIT}); súhrn je vždy za celý výber`,
        },
      },
    },
  },
];

export const VIEWER_QUERY_TOOL_NAMES = new Set(VIEWER_QUERY_TOOL_DEFINITIONS.map((t) => t.name));

/** Chybová hláška pre model: čo chýba a ako to používateľ napraví. */
export function outcomeError(outcome: Exclude<QueryOutcome, { ok: true }>, channel: string | null, site: string): string {
  if (outcome.reason === "not_configured" || !channel) {
    return "Živý viewer nie je nastavený na serveri (LIVE_CHANNEL alebo Supabase), stav viewera sa nedá prečítať.";
  }
  if (outcome.reason === "timeout") {
    return (
      `Živý viewer neodpovedal. Používateľ musí mať otvorený ${site}/ifc?live=${channel} ` +
      "(vľavo dole zelené Live) s načítaným modelom."
    );
  }
  return "Pripojenie na živý kanál zlyhalo, skús znova.";
}

/**
 * Výsledok viewera doplní z AIM: prvky obálok o object_ref a názov, výber o súhrn,
 * príznak orezania a stránku položiek (D-093). Prvky mimo AIM ostanú bez object_ref.
 */
async function withAimRefs(result: unknown, input: Record<string, unknown>): Promise<unknown> {
  if (!result || typeof result !== "object") return result;
  const r = result as { elements?: { guid: string }[]; selection?: ViewerSelection };
  const elementGuids = (r.elements ?? []).map((e) => e.guid);
  const selectionGuids = r.selection ? lookupGuidsFor(r.selection) : [];
  let refs: Awaited<ReturnType<typeof lookupGuids>> = new Map();
  let ctx: Awaited<ReturnType<typeof lookupSelectionContext>> = new Map();
  let aimError: string | undefined;
  try {
    [refs, ctx] = await Promise.all([
      elementGuids.length ? lookupGuids([...new Set(elementGuids)]) : refs,
      selectionGuids.length ? lookupSelectionContext(selectionGuids) : ctx,
    ]);
  } catch (err) {
    // Odpoveď viewera platí aj bez AIM - výpadok DB ju nemá zahodiť, len to povie.
    aimError = err instanceof Error ? err.message : String(err);
  }
  const ref = (g: string) => {
    const a = refs.get(g);
    return a ? { object_ref: a.object_ref, name: a.name } : {};
  };
  let selection: unknown = r.selection;
  if (r.selection) {
    // Surové zoznamy GUID nahradí stránka items; ostatné polia viewera (napr. bbox) ostanú.
    const rest: Record<string, unknown> = { ...r.selection };
    delete rest.guids;
    delete rest.items;
    selection = { ...rest, ...summarizeSelection(r.selection, ctx, input) };
  }
  return {
    ...r,
    ...(r.elements ? { elements: r.elements.map((e) => ({ ...e, ...ref(e.guid) })) } : {}),
    ...(r.selection ? { selection } : {}),
    ...(aimError ? { aim_refs_error: aimError } : {}),
  };
}

export async function execViewerQueryTool(
  name: string,
  input: Record<string, unknown>,
  site: string,
): Promise<{ text: string; isError: boolean }> {
  const channel = liveChannel();
  try {
    const query: ViewerQuery = name === "get_bounds" ? "bounds" : "view_state";
    const guids = query === "bounds" && (input.target_ids_or_refs || input.global_ids) ? await resolveTargets(input) : [];
    const outcome = channel ? await queryLiveViewer(channel, query, guids.slice(0, MAX_QUERY_GUIDS)) : null;
    if (!outcome || !outcome.ok) {
      return { text: outcomeError(outcome ?? { ok: false, reason: "not_configured" }, channel, site), isError: true };
    }
    if (!outcome.reply.ok) return { text: `Viewer odpovedal chybou: ${outcome.reply.error}`, isError: true };
    return { text: JSON.stringify(await withAimRefs(outcome.reply.result, input)), isError: false };
  } catch (err) {
    if (err instanceof ViewInputError) return { text: err.message, isError: true };
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
