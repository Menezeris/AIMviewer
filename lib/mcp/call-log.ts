import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

/**
 * Zápis volania MCP toolu do `mcp_call_log` (D-100). Volá sa až po odoslaní
 * odpovede (`after()` v route), takže latenciu toolu nezvyšuje. Chyba zápisu
 * (napr. tabuľka ešte nie je zmigrovaná) sa len zaloguje - meranie nesmie
 * zhodiť tool.
 */

export interface McpCallLogRow {
  tool: string;
  action: string | null;
  ms: number;
  ok: boolean;
  cold: boolean;
  phases: Record<string, number>;
  region: string | null;
}

/** `args.action`, ak ju tool má (style_in_3d, set_section...); inak null. */
export function callAction(args: Record<string, unknown>): string | null {
  // Zlúčené tooly (D-115) majú rozlišovač action, mode alebo source; prvý vyplnený ide do logu.
  for (const key of ["action", "mode", "source"]) {
    if (typeof args[key] === "string" && args[key]) return (args[key] as string).slice(0, 40);
  }
  return null;
}

type Insert = (row: McpCallLogRow) => Promise<{ error: { message: string } | null }>;

const defaultInsert: Insert = async (row) => {
  const { error } = await getSupabaseAdmin().from("mcp_call_log").insert(row);
  return { error };
};

export async function writeCallLog(row: McpCallLogRow, insert: Insert = defaultInsert): Promise<void> {
  try {
    const { error } = await insert(row);
    if (error) console.warn(`[mcp] call log: ${error.message}`);
  } catch (err) {
    console.warn(`[mcp] call log: ${err instanceof Error ? err.message : String(err)}`);
  }
}
