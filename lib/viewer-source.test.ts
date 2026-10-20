import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isAllowedViewerUrl, parseViewerParam, viewerChoiceLabel, viewerParamValue } from "./viewer-source";
import { listViewerPreviews, previewForPull } from "./viewer-previews";

const PREVIEW = "https://ifc-lite-viewer-ltdf94wdg-assetinspaces-projects.vercel.app";

describe("výber viewera (D-116)", () => {
  it("povolí produkciu a náhľady forku, nič iné", () => {
    expect(isAllowedViewerUrl("https://ifc-lite-viewer.vercel.app")).toBe(true);
    expect(isAllowedViewerUrl(`${PREVIEW}/?models=x`)).toBe(true);
    expect(isAllowedViewerUrl("https://ifc-lite-viewer-git-claude-x-assetinspaces-projects.vercel.app")).toBe(true);
    expect(isAllowedViewerUrl("https://evil.example/ifc-lite-viewer-x-assetinspaces-projects.vercel.app")).toBe(false);
    expect(isAllowedViewerUrl("https://ifc-lite-viewer-x-assetinspaces-projects.vercel.app.evil.example")).toBe(false);
    expect(isAllowedViewerUrl("http://ifc-lite-viewer-x-assetinspaces-projects.vercel.app")).toBe(false);
    expect(isAllowedViewerUrl("https://user:pw@ifc-lite-viewer.vercel.app")).toBe(false);
    expect(isAllowedViewerUrl("https://ifclite.com")).toBe(false);
    expect(isAllowedViewerUrl("javascript:alert(1)")).toBe(false);
  });

  it("localhost len vo vývoji", () => {
    expect(isAllowedViewerUrl("http://localhost:3000")).toBe(false);
    expect(isAllowedViewerUrl("http://localhost:3000", true)).toBe(true);
  });

  it("?viewer= berie pr-N, číslo, prod a povolenú URL; neznáme je null", () => {
    expect(parseViewerParam("pr-73")).toEqual({ kind: "pr", number: 73 });
    expect(parseViewerParam("PR73")).toEqual({ kind: "pr", number: 73 });
    expect(parseViewerParam("73")).toEqual({ kind: "pr", number: 73 });
    expect(parseViewerParam("prod")).toEqual({ kind: "prod" });
    expect(parseViewerParam(PREVIEW)).toEqual({ kind: "url", url: PREVIEW });
    expect(parseViewerParam("https://evil.example")).toBeNull();
    expect(parseViewerParam("pr-x")).toBeNull();
    expect(parseViewerParam("")).toBeNull();
    expect(parseViewerParam(null)).toBeNull();
  });

  it("hodnota do URL je inverzia parsovania a čip má čitateľný popis", () => {
    for (const raw of ["pr-73", "prod", PREVIEW]) expect(viewerParamValue(parseViewerParam(raw)!)).toBe(raw);
    expect(viewerChoiceLabel({ kind: "pr", number: 73 })).toBe("PR #73");
    expect(viewerChoiceLabel({ kind: "prod" })).toBe("Produkcia");
  });
});

/** Falošné GitHub API: PR 73 má hotový náhľad, PR 74 ešte nie, PR 75 cudziu URL. */
function fakeGithub() {
  const routes: Record<string, unknown> = {
    "/repos/Menezeris/ifc-lite/pulls?state=open&sort=updated&direction=desc&per_page=20": [
      { number: 73, title: "Strom odvodených", head: { ref: "claude/a", sha: "aaa" }, updated_at: "t1" },
      { number: 74, title: "Zoznam z chatu", head: { ref: "claude/b", sha: "bbb" }, updated_at: "t2" },
      { number: 75, title: "Cudzí náhľad", head: { ref: "claude/c", sha: "ccc" }, updated_at: "t3" },
    ],
    "/repos/Menezeris/ifc-lite/pulls/73": { number: 73, title: "Strom odvodených", head: { ref: "claude/a", sha: "aaa" }, updated_at: "t1" },
    "/repos/Menezeris/ifc-lite/deployments?sha=aaa&environment=Preview&per_page=5": [{ id: 1 }],
    "/repos/Menezeris/ifc-lite/deployments?sha=bbb&environment=Preview&per_page=5": [{ id: 2 }],
    "/repos/Menezeris/ifc-lite/deployments?sha=ccc&environment=Preview&per_page=5": [{ id: 3 }],
    "/repos/Menezeris/ifc-lite/deployments/1/statuses?per_page=1": [{ state: "success", environment_url: PREVIEW }],
    "/repos/Menezeris/ifc-lite/deployments/2/statuses?per_page=1": [{ state: "in_progress" }],
    "/repos/Menezeris/ifc-lite/deployments/3/statuses?per_page=1": [{ state: "success", environment_url: "https://evil.example" }],
  };
  return async (url: string) => {
    const path = url.replace("https://api.github.com", "");
    if (!(path in routes)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  };
}

describe("náhľady PR forku z GitHub Deployments (D-116)", () => {
  it("vráti URL len pre úspešný náhľad nášho Vercel projektu", async () => {
    const previews = await listViewerPreviews(fakeGithub());
    expect(previews.map((p) => [p.number, p.url])).toEqual([
      [73, PREVIEW],
      [74, null],
      [75, null],
    ]);
  });

  it("jeden PR podľa čísla, neexistujúci je null", async () => {
    expect((await previewForPull(73, fakeGithub()))?.url).toBe(PREVIEW);
    expect(await previewForPull(999, fakeGithub())).toBeNull();
  });
});
