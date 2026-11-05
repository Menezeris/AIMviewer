import { describe, expect, it } from "vitest";

import { currentProject, currentModels } from "./context";
import { PROJECT_COOKIE, PROJECT_HEADER } from "./current";
import { cookieValue, requestProjectCode, withRequestProject } from "./request";
import { TEST_PROJECT } from "./testing";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("requestProjectCode (D-189)", () => {
  it("URL ?project= first, then the proxy header, then the cookie, then the default", () => {
    expect(requestProjectCode(req("http://x/api/a?project=XYZ", { cookie: `${PROJECT_COOKIE}=OCB` }))).toBe("XYZ");
    expect(requestProjectCode(req("http://x/api/a", { [PROJECT_HEADER]: "H1", cookie: `${PROJECT_COOKIE}=OCB` }))).toBe("H1");
    expect(requestProjectCode(req("http://x/api/a", { cookie: `a=1; ${PROJECT_COOKIE}=XYZ` }))).toBe("XYZ");
    expect(requestProjectCode(req("http://x/api/a"))).toBe("TST");
    // `?project=` (empty) is the default even with a cookie
    expect(requestProjectCode(req("http://x/api/a?project=", { cookie: `${PROJECT_COOKIE}=XYZ` }))).toBe("TST");
  });

  it("the MCP connector reads only its URL", () => {
    const r = req("http://x/api/mcp/t", { cookie: `${PROJECT_COOKIE}=XYZ` });
    expect(requestProjectCode(r, { cookies: false })).toBe("TST");
  });

  it("cookieValue reads one cookie", () => {
    expect(cookieValue("a=1; aim_project=OCB; b=2", "aim_project")).toBe("OCB");
    expect(cookieValue(null, "aim_project")).toBeNull();
  });
});

describe("withRequestProject (D-189)", () => {
  it("runs the handler in the request project; unknown project = 404", async () => {
    const handler = withRequestProject(async () => Response.json({ project: currentProject(), models: currentModels() }));
    const ok = await handler(req("http://x/api/a?project=TST"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).project).toEqual(TEST_PROJECT);
    const missing = await handler(req("http://x/api/a?project=NOPE"));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/NOPE/);
  });

  it("a route may carry the project itself (BCF path)", async () => {
    const handler = withRequestProject(async () => Response.json(currentProject()), { code: () => "NOPE" });
    expect((await handler(req("http://x/api/bcf?project=TST"))).status).toBe(404);
  });
});
