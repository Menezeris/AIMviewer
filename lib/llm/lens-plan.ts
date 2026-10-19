/**
 * Čistá stavba pravidiel Lens pre `style_in_3d` (D-096): vyriešený filter
 * (mená systémov a podlaží z grafu AIM, GUIDy konkrétnych prvkov, id zón) ->
 * `FilterGroup` z `@ifc-lite/rules`. Všetky kritériá jednej skupiny platia
 * naraz (combinator AND). DB sa tu nečíta; to robí `style-lens.ts`.
 */

import type { AimZoneRule, AutoColorSource, LensFilterGroup, LensFilterRule, LensWire } from "@/lib/viewer-lens";
import { StyleInputError } from "./style-plan";

export interface ResolvedLensFilter {
  types: string[];
  predefinedType?: string;
  /** Mená podlaží v IFC (z grafu AIM). */
  storeys?: string[];
  /** Presné mená systémov (IfcSystem a podtriedy). */
  systemNames?: string[];
  notInSystem?: boolean;
  property?: { pset?: string; name: string; value: string };
  /** Časť názvu prvku. */
  query?: string;
  /** Meno modelu federácie (VZT, ASR); viewer ho preloží na identitu modelu. */
  model?: string;
  /** IFC GlobalId konkrétnych prvkov. */
  guids?: string[];
  /** objects.id zón (IfcZone, IfcSpatialZone, IfcGroup); členov doplní klient. */
  zoneIds?: string[];
}

/** Regex na presnú zhodu s jedným z mien (pravidlo `group` porovnáva názov skupiny). */
export function exactNamesRegex(names: string[]): string {
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(?:${esc.join("|")})$`;
}

const BOOL = /^(true|false)$/i;

/** Vyriešený filter -> jedna skupina pravidiel Lens (AND). */
export function lensGroup(f: ResolvedLensFilter): LensFilterGroup {
  const rules: (LensFilterRule | AimZoneRule)[] = [];
  if (f.types.length > 0) rules.push({ kind: "ifcType", op: "in", values: [...new Set(f.types)] });
  if (f.predefinedType) rules.push({ kind: "predefinedType", op: "in", values: [f.predefinedType.toUpperCase()] });
  if (f.storeys?.length) rules.push({ kind: "storey", op: "in", values: f.storeys });
  if (f.systemNames?.length) {
    rules.push({ kind: "group", groupClass: "IfcSystem", op: "matches", value: exactNamesRegex(f.systemNames), valueKind: "regex" });
  }
  if (f.notInSystem) rules.push({ kind: "group", groupClass: "IfcSystem", op: "isNotSet", value: "" });
  if (f.property) {
    const { pset, name, value } = f.property;
    rules.push({
      kind: "property",
      setName: pset ?? ".*",
      ...(pset ? {} : { setNameKind: "regex" }),
      propertyName: name,
      op: "eq",
      value,
      comparison: { caseMode: BOOL.test(value) ? "lensBoolean" : "fold" },
      inherit: "type",
    });
  }
  if (f.query) rules.push({ kind: "name", op: "contains", value: f.query });
  if (f.model) rules.push({ kind: "model", op: "in", values: [f.model] });
  if (f.guids?.length) rules.push({ kind: "globalId", op: "in", values: f.guids });
  if (f.zoneIds?.length) rules.push({ kind: "aim_zone", ids: f.zoneIds });
  if (rules.length === 0) {
    throw new StyleInputError(
      "Zadaj aspoň jedno kritérium výberu: ifc_type(s)/domain, predefined_type, storey, system, system_type, " +
        "not_in_system, zone, property+value, model, query alebo ids_or_refs.",
    );
  }
  return { combinator: "AND", rules: rules as LensFilterRule[] };
}

/** `color_by` toolu -> autoColor Lens (farba podľa hodnoty, legenda vo vieweri). */
export const COLOR_BY = ["ifc_type", "system", "zone", "material", "model", "classification", "property", "attribute"] as const;

export function autoColorSpec(colorBy: string, key?: string): NonNullable<LensWire["ac"]> {
  const map: Record<string, AutoColorSource> = {
    ifc_type: "ifcType",
    system: "group",
    zone: "group",
    material: "material",
    model: "model",
    classification: "classification",
    property: "property",
    attribute: "attribute",
  };
  const source = map[colorBy];
  if (!source) throw new StyleInputError(`color_by musí byť jedno z: ${COLOR_BY.join(", ")}.`);
  const k = (key ?? "").trim();
  if (source === "property") {
    const dot = k.indexOf(".");
    if (dot <= 0 || dot === k.length - 1) {
      throw new StyleInputError("Pri color_by=property zadaj color_by_key v tvare Pset.Vlastnosť (napr. Pset_WallCommon.FireRating).");
    }
    return { source, psetName: k.slice(0, dot), propertyName: k.slice(dot + 1) };
  }
  if (source === "attribute") {
    if (!k) throw new StyleInputError("Pri color_by=attribute zadaj color_by_key (napr. ObjectType).");
    return { source, propertyName: k };
  }
  return { source };
}
