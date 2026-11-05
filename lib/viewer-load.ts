/**
 * Progress of federation loading in the viewer (D-178, #308). During `?models=` autoload the viewer
 * sends `LOAD_PROGRESS` (also before READY) and `FIRST_GEOMETRY`; the host composes a per-model strip
 * from them and knows when to lift the overlay. Pure functions, no React.
 */

export type LoadPhase = "download" | "process" | "done" | "error";

export interface LoadProgressMsg {
  model: string;
  phase: LoadPhase;
  percent: number;
  index: number;
  total: number;
}

export interface FirstGeometryMsg {
  model: string;
  index: number;
  total: number;
}

export interface LoadEntry {
  model: string;
  phase: LoadPhase;
  percent: number;
}

export interface LoadState {
  /** Number of models according to the viewer (0 = the viewer has not sent progress yet). */
  total: number;
  /** Last state of the model by `index`. */
  entries: Record<number, LoadEntry>;
  /** At least one model is fully in the scene (FIRST_GEOMETRY). */
  firstGeometry: boolean;
}

export const INITIAL_LOAD_STATE: LoadState = { total: 0, entries: {}, firstGeometry: false };

const PHASES: readonly string[] = ["download", "process", "done", "error"];

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Validates the `LOAD_PROGRESS` body from the iframe (unknown phase or index out of range = dropped). */
export function parseLoadProgress(data: unknown): LoadProgressMsg | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.model !== "string" || typeof d.phase !== "string" || !PHASES.includes(d.phase)) return null;
  if (!isCount(d.index) || !isCount(d.total) || d.index >= d.total || d.total > 64) return null;
  if (typeof d.percent !== "number" || !Number.isFinite(d.percent)) return null;
  return {
    model: d.model,
    phase: d.phase as LoadPhase,
    percent: Math.min(100, Math.max(0, d.percent)),
    index: d.index,
    total: d.total,
  };
}

export function parseFirstGeometry(data: unknown): FirstGeometryMsg | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.model !== "string" || !isCount(d.index) || !isCount(d.total) || d.index >= d.total) return null;
  return { model: d.model, index: d.index, total: d.total };
}

export function applyLoadProgress(state: LoadState, msg: LoadProgressMsg): LoadState {
  const prev = state.entries[msg.index];
  // A finished model does not go back (a late download message after `done`).
  if (prev && (prev.phase === "done" || prev.phase === "error") && msg.phase !== "done" && msg.phase !== "error") {
    return state;
  }
  return {
    ...state,
    total: Math.max(state.total, msg.total),
    entries: { ...state.entries, [msg.index]: { model: msg.model, phase: msg.phase, percent: msg.percent } },
  };
}

export function applyFirstGeometry(state: LoadState, msg: FirstGeometryMsg): LoadState {
  if (state.firstGeometry && state.total >= msg.total) return state;
  return { ...state, firstGeometry: true, total: Math.max(state.total, msg.total) };
}

/** The viewer has sent at least one progress message (otherwise it is older and the host keeps MODELS_LOADED). */
export function hasLoadProgress(state: LoadState): boolean {
  return state.total > 0;
}

export type SegmentKind = "waiting" | "download" | "downloaded" | "process" | "done" | "error";

export interface LoadSegment {
  index: number;
  model: string;
  kind: SegmentKind;
  percent: number;
  /** Fill fraction of the segment 0..1: download is the first third, processing the rest. */
  fill: number;
  label: string;
}

/** Segments in `index` order; a model that has not reported yet is "waiting". */
export function loadSegments(state: LoadState): LoadSegment[] {
  const out: LoadSegment[] = [];
  for (let index = 0; index < state.total; index++) {
    const e = state.entries[index];
    if (!e) {
      out.push({ index, model: `Model ${index + 1}`, kind: "waiting", percent: 0, fill: 0, label: `Model ${index + 1} čaká` });
      continue;
    }
    const pct = Math.round(e.percent);
    let kind: SegmentKind;
    let fill: number;
    let label: string;
    if (e.phase === "error") {
      kind = "error";
      fill = 1;
      label = `${e.model} chyba`;
    } else if (e.phase === "done") {
      kind = "done";
      fill = 1;
      label = `${e.model} hotové`;
    } else if (e.phase === "process") {
      kind = "process";
      fill = 0.3 + (0.7 * e.percent) / 100;
      label = `${e.model} ${pct} %`;
    } else if (e.percent >= 99) {
      kind = "downloaded";
      fill = 0.3;
      label = `${e.model} stiahnuté`;
    } else {
      kind = "download";
      fill = (0.3 * e.percent) / 100;
      label = `${e.model} sťahuje sa${pct > 0 ? ` ${pct} %` : ""}`;
    }
    out.push({ index, model: e.model, kind, percent: pct, fill, label });
  }
  return out;
}

/** All models are done or ended with an error (the strip hides even without MODELS_LOADED). */
export function allSettled(state: LoadState): boolean {
  if (state.total === 0) return false;
  for (let i = 0; i < state.total; i++) {
    const p = state.entries[i]?.phase;
    if (p !== "done" && p !== "error") return false;
  }
  return true;
}

/** One line for screen readers and the overlay: "ASR 40 %, VZT stiahnuté" (VZT downloaded). */
export function loadSummary(segments: LoadSegment[]): string {
  return segments.map((s) => s.label).join(", ");
}
