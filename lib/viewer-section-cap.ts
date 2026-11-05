/**
 * Appearance of the section cap from chat (D-120, #138; hatch pattern D-128, #173): op `section_cap`
 * in `/ifc?ops=`, its translation to the bridge message `SET_SECTION_CAP` of the viewer fork
 * (`apps/viewer/src/aim/sectionCap.ts`) and the plan from the `set_section` parameters
 * (`cap_style`, `cap_color`, `hatch_*`). The fork calls the same setters as the Fill slice button
 * and the Cap popover, so the choice applies to all planes and the viewer remembers it. No dependencies.
 *
 * Op: `section_cap:<none|solid|hatch>[~c=<rrggbb>][~p=<pattern>~a=<°>[~a2=<°>]~s=<px>~w=<px>]:`
 * (the pattern and angles are already in the renderer's form, the mapping from `hatch_pattern` is done by the host).
 */

export const SECTION_CAPS = ["hatch", "solid", "none"] as const;
export type SectionCap = (typeof SECTION_CAPS)[number];

/** Hatch patterns drawn by the fork renderer (`HATCH_PATTERN_IDS`, except `solid`). */
export const RENDER_HATCHES = ["diagonal", "crossHatch", "horizontal", "vertical", "concrete", "brick", "insulation"] as const;
export type RenderHatch = (typeof RENDER_HATCHES)[number];

/** Patterns for the model (D-128); `dots` = concrete (dots), cross ones are two sets of lines. */
export const HATCH_PATTERNS = [
  "diagonal",
  "diagonal_reverse",
  "cross",
  "crosshatch",
  "horizontal",
  "vertical",
  "dots",
  "brick",
  "insulation",
] as const;
export type HatchPattern = (typeof HATCH_PATTERNS)[number];

/** Ranges as in the fork's Cap popover (`SectionCapControls`). */
export const HATCH_RANGES = {
  angleDeg: { min: -180, max: 180 },
  spacingPx: { min: 2, max: 64 },
  widthPx: { min: 1, max: 16 },
} as const;

/** Upstream defaults (`DEFAULT_CAP_STYLE`): diagonal 45°, 8 px, 1 px. */
export const HATCH_DEFAULTS = { pattern: "diagonal" as HatchPattern, angleDeg: 45, spacingPx: 8, widthPx: 1 };

/** Model pattern -> renderer pattern and default angle; only line patterns with rotation have an angle. */
const PATTERN_MAP: Record<HatchPattern, { render: RenderHatch; angle?: number }> = {
  diagonal: { render: "diagonal", angle: 45 },
  diagonal_reverse: { render: "diagonal", angle: 45 },
  cross: { render: "crossHatch", angle: 0 },
  crosshatch: { render: "crossHatch", angle: 45 },
  horizontal: { render: "horizontal" },
  vertical: { render: "vertical" },
  dots: { render: "concrete" },
  brick: { render: "brick" },
  insulation: { render: "insulation" },
};

export interface HatchSpec {
  pattern: RenderHatch;
  /** Angle in degrees as the Angle field in the Cap popover (only diagonal and crossHatch). */
  angleDeg?: number;
  /** Second set of lines (crossHatch). */
  secondaryAngleDeg?: number;
  spacingPx: number;
  widthPx: number;
}

export interface SectionCapOp {
  op: "section_cap";
  cap: SectionCap;
  /** `#rrggbb` */
  fillColor?: string;
  /** Only with `hatch` (D-128); without it the fork returns the saved hatch (old behavior D-120). */
  hatch?: HatchSpec;
}

const HEX6 = /^[0-9a-fA-F]{6}$/;

export function sectionCapOp(cap: SectionCap, fillColor?: string, hatch?: HatchSpec): string {
  const parts: string[] = [cap];
  if (fillColor) parts.push(`c=${fillColor.replace(/^#/, "").toLowerCase()}`);
  if (cap === "hatch" && hatch) {
    parts.push(`p=${hatch.pattern}`);
    if (hatch.angleDeg !== undefined) parts.push(`a=${hatch.angleDeg}`);
    if (hatch.secondaryAngleDeg !== undefined) parts.push(`a2=${hatch.secondaryAngleDeg}`);
    parts.push(`s=${hatch.spacingPx}`, `w=${hatch.widthPx}`);
  }
  return `section_cap:${parts.join("~")}:`;
}

function num(raw: string | undefined, range: { min: number; max: number }): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= range.min && n <= range.max ? n : null;
}

/** Argument of the `section_cap` op; faulty = null (input is from the URL). */
export function parseSectionCapArg(arg: string): SectionCapOp | null {
  const [cap, ...rest] = arg.split("~");
  if (!(SECTION_CAPS as readonly string[]).includes(cap)) return null;
  const kv: Record<string, string> = {};
  for (const r of rest) {
    const i = r.indexOf("=");
    if (i > 0) kv[r.slice(0, i)] = r.slice(i + 1);
  }
  let fillColor: string | undefined;
  if (kv.c !== undefined) {
    if (!HEX6.test(kv.c)) return null;
    fillColor = `#${kv.c.toLowerCase()}`;
  }
  let hatch: HatchSpec | undefined;
  if (cap === "hatch" && kv.p !== undefined) {
    if (!(RENDER_HATCHES as readonly string[]).includes(kv.p)) return null;
    const angleDeg = num(kv.a, HATCH_RANGES.angleDeg);
    const secondaryAngleDeg = num(kv.a2, { min: -270, max: 270 });
    const spacingPx = num(kv.s, HATCH_RANGES.spacingPx);
    const widthPx = num(kv.w, HATCH_RANGES.widthPx);
    if (angleDeg === null || secondaryAngleDeg === null || spacingPx === null || widthPx === null) return null;
    hatch = {
      pattern: kv.p as RenderHatch,
      ...(angleDeg !== undefined ? { angleDeg } : {}),
      ...(secondaryAngleDeg !== undefined ? { secondaryAngleDeg } : {}),
      spacingPx: spacingPx ?? HATCH_DEFAULTS.spacingPx,
      widthPx: widthPx ?? HATCH_DEFAULTS.widthPx,
    };
  }
  return { op: "section_cap", cap: cap as SectionCap, ...(fillColor ? { fillColor } : {}), ...(hatch ? { hatch } : {}) };
}

export function sectionCapBridgeMessage(o: SectionCapOp): Record<string, unknown> {
  return {
    type: "SET_SECTION_CAP",
    cap: o.cap,
    ...(o.fillColor ? { fillColor: o.fillColor } : {}),
    // An older fork ignores these fields and returns the saved hatch.
    ...(o.hatch ? { ...o.hatch } : {}),
  };
}

const CAP_LABEL: Record<SectionCap, string> = { hatch: "šrafa", solid: "plná výplň", none: "bez reznej plochy" };

const PATTERN_LABEL: Record<HatchPattern, string> = {
  diagonal: "diagonálna",
  diagonal_reverse: "diagonálna opačná",
  cross: "mriežka",
  crosshatch: "krížová",
  horizontal: "vodorovná",
  vertical: "zvislá",
  dots: "bodky",
  brick: "tehla",
  insulation: "izolácia",
};

const HATCH_KEYS = ["hatch_pattern", "hatch_angle_deg", "hatch_spacing_px", "hatch_line_width_px"] as const;

type Plan = { op: string; label: string; result: Record<string, unknown> } | { error: string };

function rangedNumber(raw: unknown, name: string, range: { min: number; max: number }): number | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < range.min || raw > range.max) {
    return { error: `${name} musí byť číslo v rozsahu ${range.min} až ${range.max}.` };
  }
  return raw;
}

/** `hatch_*` from input -> renderer hatch and result field (D-128). */
function planHatch(input: Record<string, unknown>): { spec: HatchSpec; result: Record<string, unknown>; label: string } | { error: string } {
  const rawPattern = input.hatch_pattern ?? HATCH_DEFAULTS.pattern;
  if (!(HATCH_PATTERNS as readonly unknown[]).includes(rawPattern)) {
    return { error: `hatch_pattern musí byť jeden z ${HATCH_PATTERNS.join(", ")}.` };
  }
  const pattern = rawPattern as HatchPattern;
  const map = PATTERN_MAP[pattern];
  const angle = rangedNumber(input.hatch_angle_deg, "hatch_angle_deg", HATCH_RANGES.angleDeg);
  const spacing = rangedNumber(input.hatch_spacing_px, "hatch_spacing_px", HATCH_RANGES.spacingPx);
  const width = rangedNumber(input.hatch_line_width_px, "hatch_line_width_px", HATCH_RANGES.widthPx);
  for (const v of [angle, spacing, width]) if (v && typeof v === "object") return v;
  if (angle !== undefined && map.angle === undefined) {
    return { error: "hatch_angle_deg platí len pre diagonal, diagonal_reverse, cross a crosshatch." };
  }
  const spacingPx = (spacing as number | undefined) ?? HATCH_DEFAULTS.spacingPx;
  const widthPx = (width as number | undefined) ?? HATCH_DEFAULTS.widthPx;
  let angleDeg: number | undefined;
  let secondaryAngleDeg: number | undefined;
  if (map.angle !== undefined) {
    const base = (angle as number | undefined) ?? map.angle;
    // The opposite diagonal is a mirror: 45° -> -45°.
    angleDeg = pattern === "diagonal_reverse" ? -base : base;
    // The second set of a cross hatch is perpendicular to the first.
    if (map.render === "crossHatch") secondaryAngleDeg = angleDeg - 90;
  }
  return {
    spec: {
      pattern: map.render,
      ...(angleDeg !== undefined ? { angleDeg } : {}),
      ...(secondaryAngleDeg !== undefined ? { secondaryAngleDeg } : {}),
      spacingPx,
      widthPx,
    },
    result: {
      hatch_pattern: pattern,
      ...(angleDeg !== undefined ? { hatch_angle_deg: angleDeg } : {}),
      hatch_spacing_px: spacingPx,
      hatch_line_width_px: widthPx,
    },
    label: `${PATTERN_LABEL[pattern]}${angleDeg !== undefined ? ` ${angleDeg}°` : ""}, ${spacingPx} px`,
  };
}

/**
 * `cap_style`, `cap_color` and `hatch_*` from the `set_section` input -> op, description and result field;
 * null without them. It returns the error as text, the caller chooses the error type.
 */
export function planSectionCap(input: Record<string, unknown>): Plan | null {
  const style = input.cap_style;
  const color = input.cap_color;
  const hatchGiven = HATCH_KEYS.some((k) => input[k] !== undefined && input[k] !== null);
  if (style === undefined && color === undefined && !hatchGiven) return null;
  if (style !== undefined && !(SECTION_CAPS as readonly unknown[]).includes(style)) {
    return { error: "cap_style musí byť hatch, solid alebo none." };
  }
  let hex: string | undefined;
  if (color !== undefined) {
    hex = typeof color === "string" ? color.trim().replace(/^#/, "") : "";
    if (!HEX6.test(hex)) return { error: "cap_color musí byť farba #rrggbb, napr. #ffffff." };
  }
  // Hatch parameters mean a hatch; a color alone means a solid fill in that color.
  const cap = (style ?? (hatchGiven ? "hatch" : "solid")) as SectionCap;
  if (cap === "none" && hex) return { error: "cap_color nemá zmysel s cap_style=none." };
  if (cap !== "hatch" && hatchGiven) return { error: `hatch_* parametre platia len pre cap_style=hatch, nie ${cap}.` };
  const fill = hex ? `#${hex.toLowerCase()}` : undefined;
  // A hatch always goes with a pattern (default diagonal 45°), so that it does not depend on the choice stored in the browser (#173).
  const hatch = cap === "hatch" ? planHatch(input) : null;
  if (hatch && "error" in hatch) return hatch;
  return {
    op: sectionCapOp(cap, fill, hatch?.spec),
    label: `rezná plocha: ${CAP_LABEL[cap]}${hatch ? ` ${hatch.label}` : ""}${fill ? ` ${fill}` : ""}`,
    result: { cap_style: cap, ...(fill ? { cap_color: fill } : {}), ...(hatch ? hatch.result : {}) },
  };
}
