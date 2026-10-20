import type { ListColumnWire } from "../viewer-list";

import { StyleInputError } from "./style-plan";

/**
 * Stĺpce `open_list` (D-111) zadané slovom -> `ListColumnWire`. Čistá funkcia bez
 * DB; tool je v `list-tool.ts`.
 */

const ATTRIBUTES = new Map(
  ["Name", "GlobalId", "Description", "ObjectType", "Tag", "PredefinedType", "LongName"].map((a) => [a.toLowerCase(), a]),
);
const SPATIAL = new Map([
  ["storey", "Storey"],
  ["podlazie", "Storey"],
  ["space", "Container"],
  ["container", "Container"],
  ["miestnost", "Container"],
  ["building", "Building"],
  ["site", "Site"],
]);
const SIMPLE = new Map<string, ListColumnWire["s"]>([
  ["material", "material"],
  ["classification", "classification"],
  ["model", "model"],
]);

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Stĺpec zadaný slovom (`Name`, `storey`, `Pset_DoorCommon.FireRating`, `Qto_DoorBaseQuantities.Width`). */
export function parseListColumn(raw: string): ListColumnWire {
  const text = raw.trim();
  const key = fold(text);
  const attr = ATTRIBUTES.get(key);
  if (attr) return { s: "attribute", k: attr };
  const level = SPATIAL.get(key);
  if (level) return { s: "spatial", k: level, ...(level === "Storey" ? { l: "Podlažie" } : {}) };
  const simple = SIMPLE.get(key);
  if (simple) return { s: simple, k: "" };
  const m = /^([A-Za-z0-9_]+)\.([^.]+)$/.exec(text);
  if (m) return { s: /^Qto_/i.test(m[1]) ? "quantity" : "property", p: m[1], k: m[2] };
  throw new StyleInputError(
    `Stĺpec '${raw}' nepoznám. Použi atribút (Name, GlobalId, Description, ObjectType, Tag, PredefinedType), ` +
      "storey / space / building, material, classification, model alebo Pset.Vlastnosť / Qto_X.Množstvo.",
  );
}
