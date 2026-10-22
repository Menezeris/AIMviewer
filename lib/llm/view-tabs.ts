import { BOX_MARGIN_RANGE, sectionBoxAroundOp, tabOp } from "../viewer-tabs";
import { ViewInputError, type ViewPlan } from "./view-plan";

/**
 * Záložky viewera z chatu (D-132): `set_view_mode` s `tab`, `beside`, `close_tab`
 * a rezný box `set_section box=true`. Otvorenie pohľadu do záložky robí obnova
 * uloženého pohľadu (`lib/views/plan.ts`), pôdorys `mode=2d` (fork ho mapuje na
 * záložku). Stav záložiek vráti viewer v `APPLIED` / `view_state.tabs`.
 */

const MAX_REF = 200;

const ref = (v: unknown, field: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim() === "" || v.length > MAX_REF) {
    throw new ViewInputError(`${field}: id, menovka záložky (napr. '3D', 'Pôdorys 1NP', meno pohľadu alebo dokumentu)${field === "close_tab" ? " alebo 'all'" : ""}.`);
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
      note: "Zoznam záložiek (aktívna, vedľa) vráti viewer v stave po príkaze (tabs). Vedľa seba ide 3D alebo pohľad + dokument, alebo 3D + pôdorys s podkladom; dva 3D pohľady nie. Pôdorys bez podkladu pod 3D = set_section(floor) + panels={drawing: 'open'} (D-136).",
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
      note: "Box okolo obálky prvkov; v stave viewera je section.box (IFC svet). Ako pohľad ho ulož cez saved_view(action=save, view_type=detail, locked=true).",
    },
  };
}
