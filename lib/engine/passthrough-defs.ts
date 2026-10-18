import type { ToolDefinition } from "../llm/provider";

/**
 * Tools `@ifc-lite/mcp` prevzaté takmer 1:1 (D-087, pravidlo 1): rovnaký
 * názov s prefixom `ifc_`, rovnaký opis a rovnaké parametre ako v balíku,
 * žiadna vlastná logika. Jediný doplnok je prepojenie GUIDov výsledku na AIM.
 * Bez závislostí motora (MCP route ich importuje staticky); schémy stráži
 * `passthrough.test.ts` proti registru balíka, takže povýšenie verzie, ktoré
 * ich zmení, padne v teste a nie u Clauda.
 */

export interface PassthroughTool {
  /** Názov toolu v `@ifc-lite/mcp`. */
  upstream: string;
  /** Opis z balíka (anglicky, bez zmeny). */
  description: string;
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  /** Tool pracuje nad modelom federácie (model_id povinný). */
  needsModel: boolean;
}

const modelId = { type: "string" };
const targets = {
  global_id: { type: "string" },
  express_id: { type: "integer" },
  global_ids: { type: "array", items: { type: "string" } },
  express_ids: { type: "array", items: { type: "integer" } },
};

export const PASSTHROUGH_TOOLS: PassthroughTool[] = [
  {
    upstream: "model_info",
    description:
      "Return schema, entity counts, file metadata, georeferencing, and units for the active (or named) model.",
    properties: { model_id: { ...modelId, description: "Model identifier. Optional when only one model is loaded." } },
    needsModel: true,
  },
  {
    upstream: "materials_list",
    description: "All materials present in the model with usage counts.",
    properties: { model_id: modelId },
    needsModel: true,
  },
  {
    upstream: "classifications_list",
    description: "All classification references in the model with usage counts.",
    properties: { model_id: modelId },
    needsModel: true,
  },
  {
    upstream: "geometry_area",
    description:
      "Element surface area (in the file area unit, typically m²) read from IfcElementQuantity. The response `unit` field reports the resolved symbol.",
    properties: { model_id: modelId, ...targets },
    needsModel: true,
  },
  {
    upstream: "geometry_volume",
    description:
      "Element volume (in the file volume unit, typically m³) read from IfcElementQuantity. Returns null per entity when no quantity is present; the response `unit` field reports the resolved symbol.",
    properties: { model_id: modelId, ...targets },
    needsModel: true,
  },
  {
    upstream: "model_audit",
    description:
      "Comprehensive model health check: required entities, GlobalId uniqueness, orphan detection, naming conventions, broken relationships. Returns Lighthouse-style scores per category.",
    properties: { model_id: modelId },
    needsModel: true,
  },
  {
    upstream: "schema_describe",
    description:
      "Describe an IFC entity type: attributes, parents, inheritance chain. Useful for an agent to know the legal shape before mutating. Classes outside the IFC4_ADD2_TC1 codegen pin (IFC2X3-only and IFC4X3-only ones) are answered from the bundled schema union, which carries names but not attribute types — `schemaSource` says which table answered.",
    properties: {
      type: { type: "string", description: "IFC entity name, e.g. IfcWall." },
      include_inherited: { type: "boolean", default: true, description: "Include attributes inherited from parent entities." },
    },
    required: ["type"],
    needsModel: false,
  },
];

export const passthroughName = (upstream: string) => `ifc_${upstream}`;

/** Definície pre MCP: schéma balíka, `model_id` obmedzený na modely federácie. */
export function passthroughDefinitions(models: string[]): ToolDefinition[] {
  return PASSTHROUGH_TOOLS.map((t) => ({
    name: passthroughName(t.upstream),
    description: `${t.description} [@ifc-lite/mcp ${t.upstream}${t.needsModel ? `; model_id: ${models.join(" | ")}` : ""}; GUIDy výsledku nesú object_ref v poli aim, ak ich AIM pozná]`,
    inputSchema: {
      type: "object",
      properties: t.needsModel
        ? { ...t.properties, model_id: { ...t.properties.model_id, enum: models } }
        : t.properties,
      required: t.needsModel ? ["model_id", ...(t.required ?? [])] : (t.required ?? []),
      additionalProperties: false,
    },
  }));
}
