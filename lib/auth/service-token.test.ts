import { describe, expect, it, vi } from "vitest";

import { auditHeaders } from "@/lib/audit/context";

import { TELEGRAM_USER_HEADER, withServiceToken, type BotTokenRow } from "./service-token";

const PERSON = "0198a000-0000-7000-8000-000000000001";
const TOKEN = "test-bot-token-not-a-real-one";
const TELEGRAM_USER = "123456789";

const row: BotTokenRow = {
  token_id: "0198a000-0000-7000-8000-0000000000t1",
  scope: "incident",
  user_id: "0198a000-0000-7000-8000-0000000000a1",
  person_id: PERSON,
};

const echoHeaders = async () => Response.json(auditHeaders());

function request(headers: Record<string, string>) {
  return new Request("https://aim.test/api/incidents", { method: "POST", headers });
}

function route(found: BotTokenRow | null) {
  const lookUp = vi.fn(async () => found);
  return { lookUp, handler: withServiceToken(echoHeaders, { scope: "incident", source: "telegram" }, lookUp) };
}

const valid = { authorization: `Bearer ${TOKEN}`, [TELEGRAM_USER_HEADER]: TELEGRAM_USER };

describe("withServiceToken (D-200)", () => {
  it("runs with the paired person and the source telegram", async () => {
    const { lookUp, handler } = route(row);
    const res = await handler(request(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "x-aim-source": "telegram", "x-aim-person-id": PERSON });
    expect(lookUp).toHaveBeenCalledWith(TOKEN, TELEGRAM_USER);
  });

  it("refuses an unknown, revoked or unpaired token", async () => {
    const { handler } = route(null);
    expect((await handler(request(valid))).status).toBe(401);
  });

  it("refuses a token of another scope", async () => {
    const { handler } = route({ ...row, scope: "other" });
    expect((await handler(request(valid))).status).toBe(403);
  });

  it("refuses a request without the bearer token or a valid Telegram user id", async () => {
    const { lookUp, handler } = route(row);
    const cases: Array<Record<string, string>> = [
      { [TELEGRAM_USER_HEADER]: TELEGRAM_USER },
      { authorization: TOKEN, [TELEGRAM_USER_HEADER]: TELEGRAM_USER },
      { authorization: `Bearer ${TOKEN}` },
      { authorization: `Bearer ${TOKEN}`, [TELEGRAM_USER_HEADER]: "abc" },
      { authorization: "Bearer ", [TELEGRAM_USER_HEADER]: TELEGRAM_USER },
    ];
    for (const headers of cases) {
      expect((await handler(request(headers))).status, JSON.stringify(headers)).toBe(401);
    }
    expect(lookUp).not.toHaveBeenCalled();
  });
});
