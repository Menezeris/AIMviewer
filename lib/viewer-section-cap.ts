/**
 * Vzhľad reznej plochy z chatu (D-120, #138; vzor šrafy D-128, #173): op `section_cap`
 * v `/ifc?ops=`, jej preklad na bridge správu `SET_SECTION_CAP` forku viewera
 * (`apps/viewer/src/aim/sectionCap.ts`) a plán z parametrov `set_section`
 * (`cap_style`, `cap_color`, `hatch_*`). Fork volá tie isté setery ako tlačidlo Fill slice
 * a popover Cap, takže voľba platí pre všetky roviny a viewer si ju pamätá. Bez závislostí.
 *
 * Op: `section_cap:<none|solid|hatch>[~c=<rrggbb>][~p=<vzor>~a=<°>[~a2=<°>]~s=<px>~w=<px>]:`
 * (vzor a uhly sú už vo forme renderera, mapovanie z `hatch_pattern` robí host).
 */

export const SECTION_CAPS = ["hatch", "solid", "none"] as const;
export type SectionCap = (typeof SECTION_CAPS)[number];

/** Vzory šrafy, ktoré kreslí renderer forku (`HATCH_PATTERN_IDS`, okrem `solid`). */
export const RENDER_HATCHES = ["diagonal", "crossHatch", "horizontal", "vertical", "concrete", "brick", "insulation"] as const;
export type RenderHatch = (typeof RENDER_HATCHES)[number];

/** Vzory pre model (D-128); `dots` = betón (bodky), krížové sú dve sady čiar. */
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

/** Rozsahy ako v popoveri Cap forku (`SectionCapControls`). */
export const HATCH_RANGES = {
  angleDeg: { min: -180, max: 180 },
  spacingPx: { min: 2, max: 64 },
  widthPx: { min: 1, max: 16 },
} as const;

/** Predvolené hodnoty upstreamu (`DEFAULT_CAP_STYLE`): diagonála 45°, 8 px, 1 px. */
export const HATCH_DEFAULTS = { pattern: "diagonal" as HatchPattern, angleDeg: 45, spacingPx: 8, widthPx: 1 };

/** Vzor modelu -> vzor renderera a predvolený uhol; uhol majú len čiarové vzory s natočením. */
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
  /** Uhol v stupňoch ako pole Uhol v popoveri Cap (len diagonal a crossHatch). */
  angleDeg?: number;
  /** Druhá sada čiar (crossHatch). */
  secondaryAngleDeg?: number;
  spacingPx: number;
  widthPx: number;
}

export interface SectionCapOp {
  op: "section_cap";
  cap: SectionCap;
  /** `#rrggbb` */
  fillColor?: string;
  /** Len pri `hatch` (D-128); bez neho fork vráti uloženú šrafu (staré správanie D-120). */
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

/** Argument op `section_cap`; chybný = null (vstup je z URL). */
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
    // Starší fork tieto polia ignoruje a vráti uloženú šrafu.
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

/** `hatch_*` zo vstupu -> šrafa renderera a pole výsledku (D-128). */
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
    // Opačná diagonála je zrkadlo: 45° -> -45°.
    angleDeg = pattern === "diagonal_reverse" ? -base : base;
    // Druhá sada krížovej šrafy je kolmá na prvú.
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
 * `cap_style`, `cap_color` a `hatch_*` zo vstupu `set_section` -> op, popis a pole výsledku;
 * bez nich null. Chybu vráti ako text, typ chyby volí volajúci.
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
  // Parametre šrafy znamenajú šrafu; samotná farba plnú výplň tou farbou.
  const cap = (style ?? (hatchGiven ? "hatch" : "solid")) as SectionCap;
  if (cap === "none" && hex) return { error: "cap_color nemá zmysel s cap_style=none." };
  if (cap !== "hatch" && hatchGiven) return { error: `hatch_* parametre platia len pre cap_style=hatch, nie ${cap}.` };
  const fill = hex ? `#${hex.toLowerCase()}` : undefined;
  // Šrafa ide vždy s vzorom (predvolene diagonála 45°), aby nezávisela od voľby uloženej v prehliadači (#173).
  const hatch = cap === "hatch" ? planHatch(input) : null;
  if (hatch && "error" in hatch) return hatch;
  return {
    op: sectionCapOp(cap, fill, hatch?.spec),
    label: `rezná plocha: ${CAP_LABEL[cap]}${hatch ? ` ${hatch.label}` : ""}${fill ? ` ${fill}` : ""}`,
    result: { cap_style: cap, ...(fill ? { cap_color: fill } : {}), ...(hatch ? hatch.result : {}) },
  };
}
