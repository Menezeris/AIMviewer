import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

/**
  * Write of an MCP tool call into `mcp_call_log` (D-100). Called only after the
  * response is sent (`after()` in the route), so it does not add to the tool latency. A write
  * error (e.g. the table is not migrated yet) is only logged - the measurement must not
  * bring the tool down.
 */

export interface McpCallLogRow {
  tool: string;
  action: string | null;
  ms: number;
  ok: boolean;
  cold: boolean;
  phases: Record<string, number>;
  region: string | null;
    /** Client and conversation (`claude-ai#sid`, D-159); a column from migration 20261023120000. */
  client?: string | null;
  /** Project of the call (D-189, `?project=` on the connector URL); nullable column. */
  project_id?: string | null;
}

/** `args.action`, if the tool has it (style_in_3d, set_section...); otherwise null. */
export function callAction(args: Record<string, unknown>): string | null {
    // Merged tools (D-115) have a discriminator action, mode or source, the ifc_measure route (D-121) and verify (D-185);
    // the first one that is filled goes into the log.
  for (const key of ["action", "mode", "source", "route"]) {
    if (typeof args[key] === "string" && args[key]) return (args[key] as string).slice(0, 40);
  }
    // ifc_measure verify=true (D-185) is a boolean discriminator.
  if (args.verify === true) return args.save === true ? "verify:save" : "verify";
  return null;
}

/**
  * A call rejected for an unknown parameter (D-126) is not executed, but it is written so that the log
  * shows how many calls it cost: `action` = `unknown_param:<names>`, `ms` 0, `ok` false.
 */
export function rejectedCallRow(tool: string, unknown: string[], region: string | null, projectId: string | null = null): McpCallLogRow {
  return { tool, action: `unknown_param:${unknown.join(",")}`.slice(0, 40), ms: 0, ok: false, cold: false, phases: {}, region, project_id: projectId };
}

type Insert = (row: McpCallLogRow) => Promise<{ error: { message: string } | null }>;

const defaultInsert: Insert = async (row) => {
  const { error } = await getSupabaseAdmin().from("mcp_call_log").insert(row);
  return { error };
};

export async function writeCallLog(row: McpCallLogRow, insert: Insert = defaultInsert): Promise<void> {
  try {
    let { error } = await insert(row);
        // Before the migration of the `client` column (D-159) the row is written without it, the measurement is not lost.
    if (error && row.client !== undefined && /client/.test(error.message)) {
      const { client: _c, ...rest } = row;
      void _c;
      ({ error } = await insert(rest));
    }
    if (error) console.warn(`[mcp] call log: ${error.message}`);
  } catch (err) {
    console.warn(`[mcp] call log: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Volal niekto tool motora od `sinceIso` (D-135)? Pre `engineUsedSince` v `engine-warm.ts`. */
export async function engineUseQuery(sinceIso: string, tools: string[]): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("mcp_call_log")
    .select("id")
    .gte("created_at", sinceIso)
    .in("tool", tools)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
