import "server-only";

import { compactLocalTopics } from "@/lib/bcf/viewer-local";
import { lookupGuids } from "@/lib/engine/aim-lookup";
import type { ToolDefinition } from "@/lib/llm/provider";
import { ViewInputError } from "@/lib/llm/view-plan";
import { resolveTargets } from "@/lib/llm/view-tools";
import { defaultSavedViewDeps } from "@/lib/views/runtime";
import { listSavedViews } from "@/lib/views/tools";

import { liveChannel } from "./broadcast";
import { MAX_QUERY_GUIDS, type ViewerQuery } from "./protocol";
import { queryLiveViewer, type QueryOutcome } from "./query";
import { withSectionOrientation } from "./section-orientation";
import { lookupSelectionContext } from "./selection-context";
import { DEFAULT_ITEMS_LIMIT, MAX_ITEMS_LIMIT, lookupGuidsFor, summarizeSelection, type ViewerSelection } from "./selection-summary";

/**
 * Tools spätného kanála (D-085), len v MCP konektore: čítajú otvorený živý
 * viewer, preto potrebujú `LIVE_CHANNEL` a viewer s `?live=`. Súradnice sú
 * IFC svet (Z hore, metre), rovnaké ako `set_section.coordinate_m`.
 */

export const VIEWER_QUERY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_viewer_state",
    description:
      "Čo práve ukazuje OTVORENÝ živý viewer: režim (3d/2d/split) a podlažie, aktívny rez (os, súradnica v IFC, " +
      "poloha v %), kamera (pozícia a cieľ v IFC), výber a počty skrytých a izolovaných prvkov. Výber: count, " +
      "truncated, summary (počty podľa IFC triedy, podlažia, rodičovskej zostavy a modelu) a stránka items; na " +
      "'čo mám vybrané' odpovedaj zo summary. lens = AIM chat lens zo style_in_3d (pravidlá s počtami, izolácia " +
      "alebo X-ray s počtom prvkov). list = zoznam v paneli Lists (open_list): stĺpce, filtre, zoradenie, zoskupenie, " +
      "sums = súčty za zobrazené riadky v jednotke tabuľky, maximized; na 'koľko je spolu' v otvorenom zozname odpovedaj z nich. bounds=true alebo cieľ (target_ids_or_refs, global_ids) = namiesto " +
      "stavu obálky v súradniciach IFC (m, Z hore): celý model a prvky (min, max, size, center, section_axis), " +
      "napr. pred presným rezom set_section(orientation, coordinate_m); zostava bez geometrie sa zráta z častí, " +
      "missing = prvky bez geometrie. ULOŽENÉ POHĽADY: saved_views=true = zoznam a opis uložených pohľadov stavby " +
      "(rez, režim, podlažie, kamera, počty prvkov) a 'Posledný pohľad', aj bez otvoreného viewera; obnova cez " +
      "set_view_mode(saved_view).",
    inputSchema: {
      type: "object",
      properties: {
        bounds: { type: "boolean", description: "Obálky namiesto stavu (bez cieľa len obálka modelu)" },
        saved_views: { type: "boolean", description: "Namiesto stavu zoznam uložených pohľadov (D-122)" },
        target_ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: `Obálky prvkov: objects.id alebo object_ref (max ${MAX_QUERY_GUIDS})`,
        },
        global_ids: { type: "array", items: { type: "string" }, description: "Obálky prvkov: IFC GlobalId" },
        items_offset: { type: "number", description: "Stav: od ktorej položky výberu (default 0)" },
        items_limit: {
          type: "number",
          description: `Stav: koľko položiek výberu (default ${DEFAULT_ITEMS_LIMIT}, strop ${MAX_ITEMS_LIMIT}); súhrn je za celý výber`,
        },
      },
    },
  },
];

export const VIEWER_QUERY_TOOL_NAMES = new Set(VIEWER_QUERY_TOOL_DEFINITIONS.map((t) => t.name));

/** Obálky alebo stav: bounds=true alebo zadaný cieľ = obálky (D-115). */
export function viewerQueryOf(input: Record<string, unknown>): ViewerQuery {
  const targets = input.target_ids_or_refs !== undefined || input.global_ids !== undefined;
  return input.bounds === true || targets ? "bounds" : "view_state";
}

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
  // GUIDy skrytých a izolovaných (D-122) sú pre uloženie pohľadu; Claudovi stačia počty.
  const { hidden_guids: _h, isolated_guids: _i, ...state } = r as typeof r & { hidden_guids?: unknown; isolated_guids?: unknown };
  void _h;
  void _i;
  return {
    ...state,
    ...(r.elements ? { elements: r.elements.map((e) => ({ ...e, ...ref(e.guid) })) } : {}),
    ...(r.selection ? { selection } : {}),
    ...(aimError ? { aim_refs_error: aimError } : {}),
  };
}

/** Súhrn lens k stavu čaká kratšie než samotný stav: lens, ktorá sa ešte vyhodnocuje, stav nezdrží. */
const LENS_IN_STATE_TIMEOUT_MS = 2_500;
/** Po prvej odpovedi sa ešte toľko čaká na ďalšie okná viewera (D-125). */
export const VIEWERS_COLLECT_MS = 400;

const repliesOf = (o: QueryOutcome | null | undefined) => (o?.ok ? [o.reply, ...(o.others ?? [])] : []);

/**
 * AIM chat lens k stavu viewera (#97): `lens_state` bez verzie = posledná lens a izolácia
 * či X-ray z chatu (pravidlá, počty, bez GUID). Z toho istého okna ako stav (D-125); bez
 * odpovede sa kľúč vynechá.
 */
export function lensOfState(outcome: QueryOutcome | null, viewer: string | undefined): unknown {
  const replies = repliesOf(outcome);
  const reply = replies.find((r) => viewer !== undefined && r.viewer === viewer) ?? (viewer === undefined ? replies[0] : undefined);
  return reply?.ok ? reply.result : undefined;
}

/** Viac okien viewera na kanáli (D-125): každé má vlastný stav, prvá odpoveď nemusí byť obrazovka používateľa. */
export function viewersNote(...outcomes: (QueryOutcome | null | undefined)[]): { count: number; warning: string } | null {
  const ids = new Set(outcomes.flatMap(repliesOf).map((r) => r.viewer).filter((v): v is string => !!v));
  if (ids.size < 2) return null;
  return {
    count: ids.size,
    warning:
      `Na živý kanál odpovedá ${ids.size} okien viewera (karty alebo zariadenia s ?live=). Stav je z jedného z nich, ` +
      "príkazy idú do všetkých a ich stav sa môže líšiť; ak používateľ vidí niečo iné, nech zavrie ostatné okná.",
  };
}

export async function execViewerQueryTool(
  name: string,
  input: Record<string, unknown>,
  site: string,
  query: typeof queryLiveViewer = queryLiveViewer,
): Promise<{ text: string; isError: boolean }> {
  const channel = liveChannel();
  try {
    if (input.saved_views === true) {
      return { text: JSON.stringify(await listSavedViews(defaultSavedViewDeps())), isError: false };
    }
    const kind = viewerQueryOf(input);
    const guids = kind === "bounds" && (input.target_ids_or_refs || input.global_ids) ? await resolveTargets(input) : [];
    const state = kind === "view_state";
    const collect = state ? { collectMs: VIEWERS_COLLECT_MS } : {};
    const lens =
      channel && state
        ? query(channel, "lens_state", [], { timeoutMs: LENS_IN_STATE_TIMEOUT_MS, ...collect }).catch(() => null)
        : undefined;
    const outcome = channel ? await query(channel, kind, guids.slice(0, MAX_QUERY_GUIDS), collect) : null;
    if (!outcome || !outcome.ok) {
      return { text: outcomeError(outcome ?? { ok: false, reason: "not_configured" }, channel, site), isError: true };
    }
    if (!outcome.reply.ok) return { text: `Viewer odpovedal chybou: ${outcome.reply.error}`, isError: true };
    const result = withSectionOrientation(await withAimRefs(outcome.reply.result, input));
    const lensOutcome = (await lens) ?? null;
    const lensState = lensOfState(lensOutcome, outcome.reply.viewer);
    const viewers = viewersNote(outcome, lensOutcome);
    const extra = { ...(lensState !== undefined ? { lens: lensState } : {}), ...(viewers ? { viewers } : {}) };
    // Lokálne BCF témy viewera (D-158) len ako súhrn; celé ich číta bcf_topic(action=from_viewer).
    const local = state ? compactLocalTopics(result) : undefined;
    const out = result && typeof result === "object" ? { ...result, bcf_local: local, ...extra } : result;
    return { text: JSON.stringify(out), isError: false };
  } catch (err) {
    if (err instanceof ViewInputError) return { text: err.message, isError: true };
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
