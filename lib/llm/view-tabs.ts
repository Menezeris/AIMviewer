import { BOX_MARGIN_RANGE, TILE_COUNTS, TILE_LAYOUTS, sectionBoxAroundOp, tabOp, type TileLayout, type TileWire } from "../viewer-tabs";
import { ViewInputError, type ViewPlan } from "./view-plan";

/**
 * Záložky viewera z chatu (D-132): `set_view_mode` s `tab`, `beside`, `close_tab`
 * a rezný box `set_section box=true`. Otvorenie pohľadu do záložky robí obnova
 * uloženého pohľadu (`lib/views/plan.ts`), pôdorys `mode=2d` (fork ho mapuje na
 * záložku). Stav záložiek vráti viewer v `APPLIED` / `view_state.tabs`.
 * Dlaždice (D-157): `layout` + `tiles`, stav v `view_state.layout`.
 */

const MAX_REF = 200;

const ref = (v: unknown, field: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim() === "" || v.length > MAX_REF) {
    throw new ViewInputError(`${field}: menovka záložky (napr. '3D' alebo meno dokumentu)${field === "close_tab" ? " alebo 'all'" : ""}.`);
  }
  return v.trim();
};

/** Má volanie `set_view_mode` parametre záložiek? */
export function hasTabParams(input: Record<string, unknown>): boolean {
  return input.tab !== undefined || input.beside !== undefined || input.close_tab !== undefined;
}

/** `tab` prepne, `beside` dá vedľa aktívnej (`none` zruší), `close_tab` zavrie; v tomto poradí. */
export function planViewTabs(input: Record<string, unknown>): ViewPlan {
  if (input.mode !== undefined || input.saved_view !== undefined || input.view !== undefined || input.reset !== undefined) {
    throw new ViewInputError("tab, beside a close_tab sa nekombinujú s mode, view ani reset; zavolaj set_view_mode dvakrát.");
  }
  const tab = ref(input.tab, "tab");
  const beside = ref(input.beside, "beside");
  const close = ref(input.close_tab, "close_tab");
  const ops: string[] = [];
  const done: string[] = [];
  if (tab) {
    ops.push(tabOp("activate", { tab }));
    done.push(`záložka ${tab}`);
  }
  if (beside) {
    const none = beside.toLowerCase() === "none";
    ops.push(none ? tabOp("unbeside") : tabOp("beside", { tab: beside }));
    done.push(none ? "bez Vedľa" : `vedľa ${beside}`);
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

/** `set_section box=true`: box okolo prvkov s okrajom (D-132). */
export function planSectionBox(input: Record<string, unknown>, guids: string[]): ViewPlan {
  if (guids.length === 0) throw new ViewInputError("box=true potrebuje cieľ: target_ids_or_refs alebo global_ids.");
  let margin = 0.5;
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
      margin_m: margin,
      note: "Box okolo obálky prvkov; v stave viewera je section.box (IFC svet). Ako pohľad ho ulož cez saved_view(action=save, name).",
    },
  };
}

/** Má volanie `set_view_mode` parametre dlaždíc (D-157)? */
export function hasLayoutParams(input: Record<string, unknown>): boolean {
  return input.layout !== undefined || input.tiles !== undefined;
}

const EMPTY_TILE = new Set(["none", "-", "prázdna", "prazdna"]);

/**
 * `layout` + `tiles` (D-157): rozloženie dlaždíc a záložka v každej. Menovka
 * podlažia (1NP) sa preloží na GUID a viewer pôdorys otvorí sám; ostatné sú
 * menovky otvorených záložiek ('3D', pohľad, dokument); 'none' = prázdna.
 * `floorGuid` vráti GUID podlažia alebo null (nie je to podlažie).
 */
export async function planLayout(
  input: Record<string, unknown>,
  floorGuid: (ref: string) => Promise<{ guid: string; label: string } | null>,
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
    // Len tiles: rozloženie podľa počtu (2 vedľa seba, 3 s veľkou vľavo, 4 = 2x2).
    const auto: Record<number, TileLayout> = { 1: "single", 2: "split_h", 3: "three_left", 4: "grid4" };
    if (!auto[refs.length]) throw new ViewInputError("tiles: 1 až 4 záložky, alebo zadaj layout.");
    layout = auto[refs.length];
  } else if (typeof raw === "string" && (TILE_LAYOUTS as readonly string[]).includes(raw)) {
    layout = raw as TileLayout;
  } else {
    throw new ViewInputError(`layout: ${TILE_LAYOUTS.join(" | ")}.`);
  }
  if (refs.length > TILE_COUNTS[layout]) {
    throw new ViewInputError(`tiles: ${layout} má ${TILE_COUNTS[layout]} ${TILE_COUNTS[layout] === 1 ? "dlaždicu" : "dlaždice"}, zadaných ${refs.length}.`);
  }
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
    const floor = await floorGuid(tab);
    tiles.push(floor ? { plan: floor.guid } : { tab });
    shown.push(floor ? floor.label : tab);
  }
  const wire = { layout, ...(layout !== "single" && tiles.length > 0 ? { tiles } : {}) };
  return {
    ops: [tabOp("layout", wire)],
    label: layout === "single" ? "Rozloženie: 1 okno" : `Rozloženie ${layout}${shown.length ? `: ${shown.map((x) => x ?? "prázdna").join(", ")}` : ""}`,
    result: {
      ok: true,
      layout,
      tiles: shown,
      note:
        "Dlaždice a živú 3D dlaždicu vráti viewer v stave po príkaze (layout). Živé 3D je naraz len jedno (jeden 3D canvas): " +
        "ostatné 3D dlaždice (3D, pôdorys, pohľad) ukazujú snímku, klik ju urobí živou; show_in_3d, style_in_3d, set_section " +
        "a set_camera pôsobia na živú. Chýbajúce dlaždice doplní viewer otvorenými záložkami.",
    },
  };
}
