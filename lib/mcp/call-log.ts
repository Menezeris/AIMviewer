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
  // Zlúčené tooly (D-115) majú rozlišovač action, mode alebo source, ifc_measure route (D-121);
  // prvý vyplnený ide do logu.
  for (const key of ["action", "mode", "source", "route"]) {
    if (typeof args[key] === "string" && args[key]) return (args[key] as string).slice(0, 40);
  }
  return null;
}

/**
 * Volanie odmietnuté pre neznámy parameter (D-126) sa nevykoná, ale zapíše sa, aby bolo v logu
 * vidno, koľko volaní stálo: `action` = `unknown_param:<mená>`, `ms` 0, `ok` false.
 */
export function rejectedCallRow(tool: string, unknown: string[], region: string | null): McpCallLogRow {
  return { tool, action: `unknown_param:${unknown.join(",")}`.slice(0, 40), ms: 0, ok: false, cold: false, phases: {}, region };
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
