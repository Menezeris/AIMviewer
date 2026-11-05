import { NextResponse, type NextRequest } from "next/server";

import { PROJECT_COOKIE, PROJECT_HEADER, isProjectCode } from "@/lib/project/current";

/**
 * `?project=<code>` on a page (D-189): the project sticks for the browser session in the cookie
 * `aim_project` (no Max-Age), and the same request already sees it through the request header,
 * because the layout cannot read `searchParams`. `?project=` (empty) or `default` clears it. API
 * routes read `?project=` themselves (`withRequestProject`); the proxy runs only on pages that
 * carry the parameter. Step 6 (shared sign-in) replaces the cookie with the session.
 */
export function proxy(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  const clear = raw === "" || raw.toLowerCase() === "default";
  const headers = new Headers(req.headers);
  if (clear) headers.set(PROJECT_HEADER, "default");
  else headers.set(PROJECT_HEADER, raw);
  const res = NextResponse.next({ request: { headers } });
  if (clear) res.cookies.delete(PROJECT_COOKIE);
  else if (isProjectCode(raw)) res.cookies.set(PROJECT_COOKIE, raw, { path: "/", sameSite: "lax", httpOnly: true });
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api|_next|.*\\..*).*)", has: [{ type: "query", key: "project" }] }],
};
