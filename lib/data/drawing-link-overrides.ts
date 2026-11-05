/**
 * Manual assignment and cancellation of a label link on a drawing (D-160) - pure functions.
 *
 * A manual row (`drawing_link_overrides`) takes precedence over the D-130 pairing: `assign` replaces
 * or creates a link, `suppress` removes it. Key = normalized label text on the page,
 * optionally with a bbox (without it, it applies to all occurrences of the text on the page).
 */

import type { PageRegion, TextBlock } from "@/lib/llm/document-text";
import {
  normLabel,
  type DrawingLabel,
  type DrawingLink,
  type LabelKind,
  type LinkTarget,
} from "@/lib/data/drawing-labels";

export type OverrideAction = "assign" | "suppress";

export interface OverrideTarget extends LinkTarget {
  objectType: string;
}

export interface LinkOverride {
  page: number;
  /** Normalized label text (`normLabel`). */
  text: string;
  bbox: PageRegion | null;
  action: OverrideAction;
  target: OverrideTarget | null;
}

/** The bbox center must match to within this many % of the page (a bbox from a draft in the viewer is not pixel-exact). */
const BBOX_TOL = 0.6;

const center = (r: PageRegion) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function sameSpot(a: PageRegion, b: PageRegion): boolean {
  const ca = center(a);
  const cb = center(b);
  return Math.abs(ca.x - cb.x) <= BBOX_TOL && Math.abs(ca.y - cb.y) <= BBOX_TOL;
}

/** Kind of label by the target of the manual assignment. */
export function kindOfTarget(objectType: string): LabelKind {
  if (objectType === "space") return "space";
  if (objectType === "zone" || objectType === "spatial_zone") return "zone";
  return "element";
}

const matches = (o: LinkOverride, text: string, bbox: PageRegion) =>
  o.text === normLabel(text) && (o.bbox === null || sameSpot(o.bbox, bbox));

/**
 * The more precise row wins: with a bbox before text without one. Among rows of the same precision
 * the last one applies (the list is sorted from the oldest).
 */
function pick(overrides: readonly LinkOverride[], text: string, bbox: PageRegion): LinkOverride | undefined {
  const hits = overrides.filter((o) => matches(o, text, bbox));
  return hits.filter((o) => o.bbox !== null).at(-1) ?? hits.at(-1);
}

export function overrideTargetToLink(t: OverrideTarget): LinkTarget {
  return { ref: t.ref, guid: t.guid, name: t.name, ifc_type: t.ifc_type, ...(t.members ? { members: t.members } : {}) };
}

/**
 * Applies the manual rows of a single page to the automatic links. An `assign` without a match in the automation
 * creates a link on the page row with the same text (or on the stored bbox).
 */
export function applyOverrides(
  links: readonly DrawingLink[],
  blocks: readonly TextBlock[],
  overrides: readonly LinkOverride[]
): DrawingLink[] {
  if (overrides.length === 0) return [...links];
  const out: DrawingLink[] = [];
  const used = new Set<LinkOverride>();
  for (const l of links) {
    const o = pick(overrides, l.text, l.bbox);
    if (!o) {
      out.push(l);
      continue;
    }
    used.add(o);
    if (o.action === "suppress" || !o.target) continue;
    const rest: DrawingLink = { ...l };
    delete rest.targets_total;
    out.push({
      ...rest,
      kind: kindOfTarget(o.target.objectType),
      status: "unique",
      via: "manual",
      targets: [overrideTargetToLink(o.target)],
    });
  }
  // Assignment of a text the automation did not find (or that another correction canceled).
  for (const o of overrides) {
    if (o.action !== "assign" || !o.target || used.has(o)) continue;
    const spots: PageRegion[] = blocks
      .filter((b) => normLabel(b.t) === o.text && (o.bbox === null || sameSpot(o.bbox, { x: b.x, y: b.y, width: b.w, height: b.h })))
      .map((b) => ({ x: b.x, y: b.y, width: b.w, height: b.h }));
    if (spots.length === 0 && o.bbox) spots.push(o.bbox);
    for (const bbox of spots) {
      if (out.some((l) => sameSpot(l.bbox, bbox) && normLabel(l.text) === o.text)) continue;
      out.push({
        text: blocks.find((b) => normLabel(b.t) === o.text)?.t.trim() ?? o.text,
        code: o.text,
        kind: kindOfTarget(o.target.objectType),
        bbox,
        status: "unique",
        via: "manual",
        targets: [overrideTargetToLink(o.target)],
      });
    }
  }
  return out.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
}

/** Texts that can be assigned on a page: page rows and texts of automatic labels. */
export function assignableTexts(blocks: readonly TextBlock[], labels: readonly DrawingLabel[]): Set<string> {
  return new Set([...blocks.map((b) => normLabel(b.t)), ...labels.map((l) => normLabel(l.text))].filter(Boolean));
}

export type LinkEditAction = "assign" | "clear" | "reset";

export interface LinkEditInput {
  text: string;
  action: LinkEditAction;
  target?: string;
  bbox: PageRegion | null;
}

/** Input parameter of `open_drawing link` (D-160); returns an error as text, never throws it. */
export function parseLinkEdit(raw: unknown): LinkEditInput | string {
  if (!raw || typeof raw !== "object") return "link musí byť objekt {text, action, target?, bbox?}.";
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text || text.length > 200) return "link.text = text popisku na strane (1 až 200 znakov).";
  if (r.action !== "assign" && r.action !== "clear" && r.action !== "reset") {
    return "link.action: assign (priradiť), clear (zrušiť odkaz) alebo reset (vrátiť automatiku).";
  }
  const target = typeof r.target === "string" ? r.target.trim() : "";
  if (r.action === "assign" && !target) return "link.target (object_ref, GUID alebo meno zóny) je pri assign povinný.";
  let bbox: PageRegion | null = null;
  if (r.scope === "bbox" || r.bbox !== undefined) {
    const b = r.bbox as Record<string, unknown> | undefined;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const x = n(b?.x), y = n(b?.y), width = n(b?.width), height = n(b?.height);
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      return "link.bbox = {x, y, width, height} v % strany (scope=bbox ju vyžaduje).";
    }
    bbox = { x, y, width, height };
  }
  return { text, action: r.action, ...(target ? { target } : {}), bbox };
}
