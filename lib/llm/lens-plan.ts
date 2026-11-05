/**
 * Pure construction of Lens rules for `style_in_3d` (D-096): a resolved filter
 * (names of systems and storeys from the AIM graph, GUIDs of specific elements, zone ids) ->
 * `FilterGroup` from `@ifc-lite/rules`. All criteria of one group apply
 * at once (combinator AND). The DB is not read here; that is done by `style-lens.ts`.
 */

import type { AimDocumentRule, AimZoneRule, AutoColorSource, LensFilterGroup, LensFilterRule, LensWire } from "@/lib/viewer-lens";
import { StyleInputError } from "./style-plan";

export interface ResolvedLensFilter {
  types: string[];
  predefinedType?: string;
  /** Storey names in IFC (from the AIM graph). */
  storeys?: string[];
  /** Exact names of systems (IfcSystem and subclasses). */
  systemNames?: string[];
  notInSystem?: boolean;
  property?: { pset?: string; name: string; value: string };
  /** Part of the element name. */
  query?: string;
  /** Name of the federation model (VZT, ASR); the viewer translates it to the model identity. */
  model?: string;
  /** IFC GlobalId of specific elements. */
  guids?: string[];
  /** objects.id of zones (IfcZone, IfcSpatialZone, IfcGroup); members are added by the client. */
  zoneIds?: string[];
  /** Document or a reference to its part (objects.id), optionally a page; elements are added by the client (D-104). */
  document?: { id: string; page?: number };
}

/** Regex for an exact match with one of the names (the `group` rule compares the group name). */
export function exactNamesRegex(names: string[]): string {
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(?:${esc.join("|")})$`;
}

const BOOL = /^(true|false)$/i;

/** Resolved filter -> one group of Lens rules (AND). */
export function lensGroup(f: ResolvedLensFilter): LensFilterGroup {
  const rules: (LensFilterRule | AimZoneRule | AimDocumentRule)[] = [];
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
  if (f.document) rules.push({ kind: "aim_document", ...f.document });
  if (rules.length === 0) {
    throw new StyleInputError(
      "Zadaj aspoň jedno kritérium výberu: ifc_type(s)/domain, predefined_type, storey, system, system_type, " +
        "not_in_system, zone, document, property+value, model, query alebo ids_or_refs.",
    );
  }
  return { combinator: "AND", rules: rules as LensFilterRule[] };
}

/** `color_by` of the tool -> autoColor of the Lens (color by value, legend in the viewer). */
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
