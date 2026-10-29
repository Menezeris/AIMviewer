import type { ListColumnWire, ListHostKey } from "../viewer-list";

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
  // Vzťahy z IFC súboru (D-171, #277): bunka nesie názvy druhej strany, viac hodnôt oddelených ", ".
  ["referenced", "Referenced"],
  ["space_referenced", "Referenced"],
  ["rel_referenced_in_spatial_structure", "Referenced"],
  ["relation.rel_referenced_in_spatial_structure", "Referenced"],
  ["boundary", "Boundary"],
  ["space_boundary", "Boundary"],
  ["rel_space_boundary", "Boundary"],
  ["relation.rel_space_boundary", "Boundary"],
  ["aggregate", "Aggregate"],
  ["rel_aggregates", "Aggregate"],
  ["relation.rel_aggregates", "Aggregate"],
]);
/** Popis stĺpcov zo vzťahov (inak by hlavička bola len "Referenced"). */
const SPATIAL_LABELS = new Map([
  ["Storey", "Podlažie"],
  ["Referenced", "Priestor (referenced)"],
  ["Boundary", "Hranica priestoru"],
  ["Aggregate", "Zostava (aggregate)"],
]);
/**
 * Odvodené väzby z DB (D-174, #277; `v_space_elements` z geometrie, D-167): hodnoty počíta host podľa GlobalId.
 * Slová sú zámerne iné než `space_referenced` / `space_boundary` (tie čítajú IFC súbor), aby sa zdroj nepomiešal.
 */
const HOST = new Map<string, [ListHostKey, string]>([
  ["derived_referenced", ["derived_referenced", "Priestor (odvodený z DB)"]],
  ["space_derived", ["derived_referenced", "Priestor (odvodený z DB)"]],
  ["space_referenced_db", ["derived_referenced", "Priestor (odvodený z DB)"]],
  ["derived_boundary", ["derived_boundary", "Hranica priestoru (odvodená z DB)"]],
  ["space_boundary_derived", ["derived_boundary", "Hranica priestoru (odvodená z DB)"]],
  ["space_boundary_db", ["derived_boundary", "Hranica priestoru (odvodená z DB)"]],
]);
/** Meno a popis ako stĺpce builderu panela Lists (inak má stĺpec prázdnu hlavičku aj v exporte). */
const SIMPLE = new Map<string, [ListColumnWire["s"], string]>([
  ["material", ["material", "Material"]],
  ["classification", ["classification", "Classification"]],
  ["model", ["model", "Model"]],
]);

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Stĺpec zadaný slovom (`Name`, `storey`, `Pset_DoorCommon.FireRating`, `Qto_DoorBaseQuantities.Width`). */
export function parseListColumn(raw: string): ListColumnWire {
  const text = raw.trim();
  const key = fold(text);
  const attr = ATTRIBUTES.get(key);
  if (attr) return { s: "attribute", k: attr };
  const host = HOST.get(key);
  if (host) return { s: "host", k: host[0], l: host[1] };
  const level = SPATIAL.get(key);
  if (level) return { s: "spatial", k: level, ...(SPATIAL_LABELS.has(level) ? { l: SPATIAL_LABELS.get(level) } : {}) };
  const simple = SIMPLE.get(key);
  if (simple) return { s: simple[0], k: simple[1], l: simple[1] };
  const m = /^([A-Za-z0-9_]+)\.([^.]+)$/.exec(text);
  if (m) return { s: /^Qto_/i.test(m[1]) ? "quantity" : "property", p: m[1], k: m[2] };
  throw new StyleInputError(
    `Stĺpec '${raw}' nepoznám. Použi atribút (Name, GlobalId, Description, ObjectType, Tag, PredefinedType), ` +
      "storey / space / building, space_referenced / space_boundary / aggregate (vzťahy zo súboru), space_derived / space_boundary_derived (odvodené z DB), material, classification, model alebo Pset.Vlastnosť / Qto_X.Množstvo.",
  );
}
