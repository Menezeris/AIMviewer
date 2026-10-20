/**
 * Vzhľad reznej plochy z chatu (D-120, #138): op `section_cap` v `/ifc?ops=`,
 * jej preklad na bridge správu `SET_SECTION_CAP` forku viewera
 * (`apps/viewer/src/aim/sectionCap.ts`) a plán z parametrov `set_section`
 * (`cap_style`, `cap_color`). Fork volá tie isté setery ako tlačidlo Fill slice,
 * takže voľba platí pre všetky roviny a viewer si ju pamätá. Bez závislostí.
 *
 * Op: `section_cap:<none|solid|hatch>[~c=<rrggbb>]:`.
 */

export const SECTION_CAPS = ["hatch", "solid", "none"] as const;
export type SectionCap = (typeof SECTION_CAPS)[number];

export interface SectionCapOp {
  op: "section_cap";
  cap: SectionCap;
  /** `#rrggbb` */
  fillColor?: string;
}

const HEX6 = /^[0-9a-fA-F]{6}$/;

export function sectionCapOp(cap: SectionCap, fillColor?: string): string {
  return `section_cap:${cap}${fillColor ? `~c=${fillColor.replace(/^#/, "").toLowerCase()}` : ""}:`;
}

/** Argument op `section_cap` (`<cap>[~c=<hex>]`); chybný = null (vstup je z URL). */
export function parseSectionCapArg(arg: string): SectionCapOp | null {
  const [cap, ...rest] = arg.split("~");
  if (!(SECTION_CAPS as readonly string[]).includes(cap)) return null;
  let fillColor: string | undefined;
  for (const r of rest) {
    if (!r.startsWith("c=")) continue;
    if (!HEX6.test(r.slice(2))) return null;
    fillColor = `#${r.slice(2).toLowerCase()}`;
  }
  return { op: "section_cap", cap: cap as SectionCap, ...(fillColor ? { fillColor } : {}) };
}

export function sectionCapBridgeMessage(o: SectionCapOp): Record<string, unknown> {
  return { type: "SET_SECTION_CAP", cap: o.cap, ...(o.fillColor ? { fillColor: o.fillColor } : {}) };
}

const CAP_LABEL: Record<SectionCap, string> = { hatch: "šrafa", solid: "plná výplň", none: "bez reznej plochy" };

/**
 * `cap_style` a `cap_color` zo vstupu `set_section` -> op, popis a pole výsledku;
 * bez nich null. Chybu vráti ako text, typ chyby volí volajúci.
 */
export function planSectionCap(
  input: Record<string, unknown>,
): { op: string; label: string; result: Record<string, unknown> } | { error: string } | null {
  const style = input.cap_style;
  const color = input.cap_color;
  if (style === undefined && color === undefined) return null;
  if (style !== undefined && !(SECTION_CAPS as readonly unknown[]).includes(style)) {
    return { error: "cap_style musí byť hatch, solid alebo none." };
  }
  let hex: string | undefined;
  if (color !== undefined) {
    hex = typeof color === "string" ? color.trim().replace(/^#/, "") : "";
    if (!HEX6.test(hex)) return { error: "cap_color musí byť farba #rrggbb, napr. #ffffff." };
  }
  // Farba bez vzhľadu znamená plnú výplň tou farbou.
  const cap = (style ?? "solid") as SectionCap;
  if (cap === "none" && hex) return { error: "cap_color nemá zmysel s cap_style=none." };
  const fill = hex ? `#${hex.toLowerCase()}` : undefined;
  return {
    op: sectionCapOp(cap, fill),
    label: `rezná plocha: ${CAP_LABEL[cap]}${fill ? ` ${fill}` : ""}`,
    result: { cap_style: cap, ...(fill ? { cap_color: fill } : {}) },
  };
}
