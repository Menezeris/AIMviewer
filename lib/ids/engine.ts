import { openEngineSession, type EngineSession } from "../engine/session";

/**
  * IDS tools of the `@ifc-lite/mcp` package (`ids_read`, `ids_apply_ops`, `ids_write`, `ids_audit`, `ids_lint`)
  * through an engine session without models (D-162). The package is the only source of logic; here the
  * tool result is only converted to data or to an `IdsEngineError` with structured details.
 */

export type IdsEngine = Pick<EngineSession, "call">;
export type IdsUpstreamTool = "ids_read" | "ids_apply_ops" | "ids_write" | "ids_audit" | "ids_lint";

export const defaultIdsEngine = (): Promise<IdsEngine> => openEngineSession([]);

export class IdsEngineError extends Error {
  constructor(
    public readonly tool: IdsUpstreamTool,
    message: string,
    public readonly code: string | null,
    public readonly details: Record<string, unknown> | null,
    public readonly hint: string | null,
  ) {
    super(message);
  }
}

export async function callIds(engine: IdsEngine, tool: IdsUpstreamTool, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await engine.call(tool, args);
  const data = (res.structuredContent ?? {}) as Record<string, unknown>;
  if (res.isError) {
    const text = res.content.map((c) => c.text ?? "").join("\n").trim();
    throw new IdsEngineError(
      tool,
      typeof data.message === "string" ? data.message : text || `${tool} zlyhal`,
      typeof data.code === "string" ? data.code : null,
      data.details && typeof data.details === "object" ? (data.details as Record<string, unknown>) : null,
      typeof data.hint === "string" ? data.hint : null,
    );
  }
  return data;
}
