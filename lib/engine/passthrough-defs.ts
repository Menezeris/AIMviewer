import type { ToolDefinition } from "../llm/provider";

/**
 * Tools of `@ifc-lite/mcp` taken over almost 1:1 (D-087, rule 1): the same
 * parameters as in the bundle, no own logic, the only addition is linking the
 * GUIDs of the result to AIM. Since D-115 Claude calls them via `ifc_models` (action) and
 * `ifc_measure` (qto); the names `ifc_<upstream>` are only internal keys now (aliases removed).
 * Without engine dependencies (the MCP route imports them statically); the schemas are guarded
 * by `passthrough.test.ts` against the bundle registry, so a version bump that
 * changes them fails in the test and not at Claude.
 */

export interface PassthroughTool {
  /** Tool name in `@ifc-lite/mcp`. */
  upstream: string;
  /** Description from the bundle (in English, unchanged). */
  description: string;
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  /** The tool works over a federation model (model_id required). */
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

/** Definitions for MCP: the bundle schema, `model_id` restricted to federation models. */
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
