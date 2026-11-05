import { BOX_MARGIN_RANGE, MIN_TILE_SHARE, TILE_COUNTS, checkTileSizes, TILE_LAYOUTS, sectionBoxAroundOp, tabOp, type TileLayout, type TileWire } from "../viewer-tabs";
import { ViewInputError, type ViewPlan } from "./view-plan";

/**
 * Viewer tabs from the chat (D-132): `set_view_mode` with `tab`, `beside`, `close_tab`
 * and the section box `set_section box=true`. Opening a view into a tab is done by restoring a
 * saved view (`lib/views/plan.ts`), a floor plan by `mode=2d` (the fork maps it to a
 * tab). The state of the tabs is returned by the viewer in `APPLIED` / `view_state.tabs`.
 * Tiles (D-157): `layout` + `tiles`, state in `view_state.layout`.
 * Views from Presentation (D-161, step 4): `tiles`, `tab` and `beside` also accept a view name; the host
 * translates it to an id from `saved_views` (the viewer gets the id, not the name, which can change).
 */

/** View from Presentation (a `saved_views` row with the shape `ViewWire`): id and name. */
export interface PresentationView { id: string; name: string }

const EXCLUDED_REFS = new Set(["3d", "none", "all"]);

/** View by name (case-insensitive); '3D', 'none' and 'all' are reserved. */
export function viewByName(views: readonly PresentationView[] | undefined, name: string): PresentationView | undefined {
  const want = name.trim().toLowerCase();
  if (!views || EXCLUDED_REFS.has(want)) return undefined;
  return views.find((v) => v.name.trim().toLowerCase() === want);
}

const MAX_REF = 200;

const ref = (v: unknown, field: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim() === "" || v.length > MAX_REF) {
    throw new ViewInputError(`${field}: menovka záložky (napr. '3D' alebo meno dokumentu)${field === "close_tab" ? " alebo 'all'" : ""}.`);
  }
  return v.trim();
};

/** Does the `set_view_mode` call have tab parameters? */
export function hasTabParams(input: Record<string, unknown>): boolean {
  return input.tab !== undefined || input.beside !== undefined || input.close_tab !== undefined;
}

/** `tab` switches, `beside` puts beside the active one (`none` cancels), `close_tab` closes; in this order. A view name is translated to its id. */
export function planViewTabs(input: Record<string, unknown>, views?: readonly PresentationView[]): ViewPlan {
  if (input.mode !== undefined || input.saved_view !== undefined || input.view !== undefined || input.reset !== undefined) {
    throw new ViewInputError("tab, beside a close_tab sa nekombinujú s mode, view ani reset; zavolaj set_view_mode dvakrát.");
  }
  const tab = ref(input.tab, "tab");
  const beside = ref(input.beside, "beside");
  const close = ref(input.close_tab, "close_tab");
  const ops: string[] = [];
  const done: string[] = [];
  if (tab) {
    const view = viewByName(views, tab);
    ops.push(tabOp("activate", { tab: view?.id ?? tab }));
    done.push(view ? `pohľad ${view.name}` : `záložka ${tab}`);
  }
  if (beside) {
    const none = beside.toLowerCase() === "none";
    const view = viewByName(views, beside);
    ops.push(none ? tabOp("unbeside") : tabOp("beside", { tab: view?.id ?? beside }));
    done.push(none ? "bez Vedľa" : `vedľa ${view ? `pohľad ${view.name}` : beside}`);
  }
  if (close) {
    ops.push(tabOp("close", { tab: close }));
    done.push(close.toLowerCase() === "all" ? "zavreté všetky okrem 3D" : `zavretá ${close}`);
  }
  return {
    ops,
    label: `Záložky: ${done.join(", ")}`,
    result: {
      ok: true,
      tabs: done,
      note: "Zoznam záložiek (aktívna, vedľa) vráti viewer v stave po príkaze (tabs). Dvojicu, ktorú plocha bez dlaždíc nevie (dve 3D, dva dokumenty), dá viewer do dvoch dlaždíc vedľa seba (layout v stave, D-157).",
    },
  };
}

/** `set_section box=true`: box around elements with a margin (D-132). */
export function planSectionBox(input: Record<string, unknown>, guids: string[]): ViewPlan {
  if (guids.length === 0) throw new ViewInputError("box=true potrebuje cieľ: target_ids_or_refs alebo global_ids.");
  // Without margin_m the viewer decides itself (auto: margin by size, a space from slab to slab with the walls).
  let margin: number | undefined;
  if (input.margin_m !== undefined) {
    const m = input.margin_m;
    if (typeof m !== "number" || !Number.isFinite(m) || m < BOX_MARGIN_RANGE.min || m > BOX_MARGIN_RANGE.max) {
      throw new ViewInputError(`margin_m: ${BOX_MARGIN_RANGE.min} až ${BOX_MARGIN_RANGE.max} m.`);
    }
    margin = m;
  }
  return {
    ops: [sectionBoxAroundOp(guids, margin)],
    label: `Rezný box: ${guids.length} prvk${guids.length === 1 ? "y" : "ov"}`,
    result: {
      ok: true,
      box_around: guids.length,
      margin_m: margin ?? "auto",
      note: "Box okolo obálky prvkov (bez margin_m automaticky: okraj 20 % najdlhšej strany, 0,3 až 2 m; miestnosť od podlahovej po stropnú dosku so stenami); v stave viewera je section.box (IFC svet). Ako pohľad ho ulož cez saved_view(action=save, name).",
    },
  };
}

/** Does the `set_view_mode` call have tile parameters (D-157)? */
export function hasLayoutParams(input: Record<string, unknown>): boolean {
  return input.layout !== undefined || input.tiles !== undefined || input.ratio !== undefined || input.sizes !== undefined;
}

const EMPTY_TILE = new Set(["none", "-", "prázdna", "prazdna"]);

/**
 * `layout` + `tiles` (D-157): tile layout and a tab in each. The label
 * of a storey (1NP) is translated to a GUID and the viewer opens the floor plan itself; the others are
 * labels of open tabs ('3D', document); a view name from Presentation (D-161) is translated to its id
 * (`views`), the viewer opens the view in the tile itself; 'none' = empty.
 * `floorGuid` returns the storey GUID or null (it is not a storey).
 */
export async function planLayout(
  input: Record<string, unknown>,
  floorGuid: (ref: string) => Promise<{ guid: string; label: string } | null>,
  views?: readonly PresentationView[],
): Promise<ViewPlan> {
  if (input.mode !== undefined || input.saved_view !== undefined || input.view !== undefined || input.reset !== undefined || hasTabParams(input)) {
    throw new ViewInputError("layout a tiles sa nekombinujú s mode, view, reset, tab, beside ani close_tab; zavolaj set_view_mode dvakrát (najprv otvor záložky, potom layout).");
  }
  const raw = input.layout;
  const tilesIn = input.tiles;
  if (tilesIn !== undefined && !Array.isArray(tilesIn)) throw new ViewInputError("tiles: pole menoviek záložiek (napr. ['3D', '1NP']).");
  const refs = (tilesIn as unknown[] | undefined) ?? [];
  let layout: TileLayout;
  if (raw === undefined) {
    // Only tiles: layout by count (2 side by side, 3 with a large one on the left, 4 = 2x2).
    const auto: Record<number, TileLayout> = { 1: "single", 2: "split_h", 3: "three_left", 4: "grid4" };
    if (!auto[refs.length]) throw new ViewInputError(
      input.tiles === undefined ? "ratio a sizes potrebujú layout (aktuálny je v get_viewer_state, layout)." : "tiles: 1 až 4 záložky, alebo zadaj layout.",
    );
    layout = auto[refs.length];
  } else if (typeof raw === "string" && (TILE_LAYOUTS as readonly string[]).includes(raw)) {
    layout = raw as TileLayout;
  } else {
    throw new ViewInputError(`layout: ${TILE_LAYOUTS.join(" | ")}.`);
  }
  if (refs.length > TILE_COUNTS[layout]) {
    throw new ViewInputError(`tiles: ${layout} má ${TILE_COUNTS[layout]} ${TILE_COUNTS[layout] === 1 ? "dlaždicu" : "dlaždice"}, zadaných ${refs.length}.`);
  }
  const sizing = checkTileSizes(layout, input.ratio, input.sizes);
  if ("error" in sizing) throw new ViewInputError(sizing.error);
  const tiles: TileWire[] = [];
  const shown: (string | null)[] = [];
  for (const r of refs) {
    if (r === null || (typeof r === "string" && EMPTY_TILE.has(r.trim().toLowerCase()))) {
      tiles.push(null);
      shown.push(null);
      continue;
    }
    const tab = ref(r, "tiles[]");
    if (!tab) continue;
    const floor = tab.toLowerCase() === "3d" ? null : await floorGuid(tab);
    const view = floor ? undefined : viewByName(views, tab);
    tiles.push(floor ? { plan: floor.guid } : view ? { view: view.id } : { tab });
    shown.push(floor ? floor.label : view ? view.name : tab);
  }
  const wire = { layout, ...(layout !== "single" && tiles.length > 0 ? { tiles } : {}), ...sizing };
  const total = sizing.sizes?.reduce((a, b) => a + b, 0);
  const shares = sizing.ratio !== undefined ? [sizing.ratio, 1 - sizing.ratio] : sizing.sizes?.map((n) => n / total!);
  const percents = shares?.map((x) => Math.round(x * 1000) / 10);
  return {
    ops: [tabOp("layout", wire)],
    label:
      (layout === "single" ? "Rozloženie: 1 okno" : `Rozloženie ${layout}${shown.length ? `: ${shown.map((x) => x ?? "prázdna").join(", ")}` : ""}`) +
      (percents ? ` (${percents.join(" / ")} %)` : ""),
    result: {
      ok: true,
      layout,
      tiles: shown,
      ...(percents ? { sizes_pct: percents, ...(percents.some((x) => x < MIN_TILE_SHARE * 100) ? { warning: `Dlaždica pod ${MIN_TILE_SHARE * 100} % sa zdvihne na ${MIN_TILE_SHARE * 100} % (viewer to nahlási v problémoch).` } : {}) } : {}),
      note:
        "Dlaždice a živú 3D dlaždicu vráti viewer v stave po príkaze (layout, pri pohľade view_id a view). Živé 3D je naraz len jedno " +
        "(jeden 3D canvas): ostatné 3D dlaždice (3D, pohľad) ukazujú snímku, klik ju urobí živou; show_in_3d, style_in_3d, set_section " +
        "a set_camera pôsobia na živú. Chýbajúce dlaždice doplní viewer otvorenými záložkami. " +
        "Pomer (ratio / sizes) viewer vráti v stave ako layout.sizes (súčet 1); starší viewer ho nepozná a ohlási neplatnú správu.",
    },
  };
}
