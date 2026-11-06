import "server-only";

import { NextResponse } from "next/server";

import { withAuditContext } from "@/lib/audit/context";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Service token of the Telegram bot (D-200). The bot sends `Authorization: Bearer <token>` and
 * the Telegram user id of the sender in `x-telegram-user-id`. AIM checks both through the
 * AIMforked function `platform_api.bot_token_person`: the token must be unrevoked (only its
 * SHA-256 is stored), carry the route's scope, and the Telegram account must be paired with a
 * user who has a person. The route then runs with that person and the source `telegram`.
 *
 * Only the incident endpoint (scope `incident`) accepts the token; no other route uses this guard.
 */

export type ServiceTokenScope = "incident";

export type BotTokenRow = {
  token_id: string;
  scope: string;
  user_id: string;
  person_id: string;
};

export type BotTokenLookup = (token: string, telegramUserId: string) => Promise<BotTokenRow | null>;

export type ServiceTokenOptions = {
  scope: ServiceTokenScope;
  /** Writer label for the audit log. */
  source: string;
};

export const TELEGRAM_USER_HEADER = "x-telegram-user-id";
const BEARER_PREFIX = "Bearer ";
const TELEGRAM_USER_ID = /^[1-9][0-9]{0,19}$/;
const API_SCHEMA = "platform_api";
const BOT_FUNCTION = "bot_token_person";
const UNAUTHORIZED_MESSAGE = "invalid service token or unpaired account";
const WRONG_SCOPE_MESSAGE = "service token not valid for this endpoint";

export const lookUpBotTokenInDatabase: BotTokenLookup = async (token, telegramUserId) => {
  const { data, error } = await getSupabaseAdmin()
    .schema(API_SCHEMA)
    .rpc(BOT_FUNCTION, { p_token: token, p_telegram_user_id: telegramUserId });
  if (error) throw new Error(`${API_SCHEMA}.${BOT_FUNCTION} failed: ${error.message}`);
  const rows = (data ?? []) as BotTokenRow[];
  return rows[0] ?? null;
};

export function withServiceToken<A extends [Request, ...unknown[]]>(
  handler: (...args: A) => Promise<Response> | Response,
  opts: ServiceTokenOptions,
  lookUp: BotTokenLookup = lookUpBotTokenInDatabase
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const [req] = args;
    const authorization = req.headers.get("authorization") ?? "";
    const telegramUserId = req.headers.get(TELEGRAM_USER_HEADER) ?? "";
    if (!authorization.startsWith(BEARER_PREFIX) || !TELEGRAM_USER_ID.test(telegramUserId)) {
      return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401 });
    }

    const token = authorization.slice(BEARER_PREFIX.length).trim();
    const row = token ? await lookUp(token, telegramUserId) : null;
    if (!row) return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401 });
    if (row.scope !== opts.scope) return NextResponse.json({ error: WRONG_SCOPE_MESSAGE }, { status: 403 });

    return withAuditContext({ personId: row.person_id, source: opts.source }, () => handler(...args));
  };
}
