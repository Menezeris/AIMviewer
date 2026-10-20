import "server-only";

import { isAllowedViewerUrl, type ViewerPreview } from "./viewer-source";

/**
 * Náhľady viewera z otvorených PR forku (D-116): GitHub Deployments API, kam
 * Vercel hlási každý náhľad (`environment: Preview`, `environment_url`). Fork je
 * verejný, stačí ľubovoľný token: `GITHUB_PREVIEWS_TOKEN`, inak token konektora
 * `FEEDBACK_GITHUB_TOKEN`. Výsledok sa cachuje 60 s, takže otvorené karty limit
 * nevyčerpajú.
 */

const API = "https://api.github.com";
export const FORK_REPO = "Menezeris/ifc-lite";
const REVALIDATE_S = 60;

interface PullWire {
  number: number;
  title: string;
  head: { ref: string; sha: string };
  updated_at: string;
}

type FetchLike = (url: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

function headers(): HeadersInit {
  // Bez tokenu má zdieľaná IP serverless funkcie 60 požiadaviek/h na všetkých
  // zákazníkov Vercelu, takže limit býva vyčerpaný; token konektora (D-090)
  // stačí, verejný fork vie čítať každý token.
  const token = (process.env.GITHUB_PREVIEWS_TOKEN ?? process.env.FEEDBACK_GITHUB_TOKEN)?.trim();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub odmietne požiadavku bez User-Agent (403).
    "User-Agent": "aim-viewer-previews",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson<T>(fetchImpl: FetchLike, path: string): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, { headers: headers(), next: { revalidate: REVALIDATE_S } });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** URL posledného úspešného náhľadu pre commit, alebo null. */
export async function previewUrlForSha(sha: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const deployments = await getJson<{ id: number }[]>(
    fetchImpl,
    `/repos/${FORK_REPO}/deployments?sha=${encodeURIComponent(sha)}&environment=Preview&per_page=5`,
  );
  for (const d of deployments) {
    const statuses = await getJson<{ state: string; environment_url?: string }[]>(
      fetchImpl,
      `/repos/${FORK_REPO}/deployments/${d.id}/statuses?per_page=1`,
    );
    const url = statuses[0]?.state === "success" ? statuses[0].environment_url : undefined;
    // Len náhľad nášho Vercel projektu; čokoľvek iné z API sa nevloží.
    if (url && isAllowedViewerUrl(url)) return url;
  }
  return null;
}

/** Otvorené PR forku s náhľadom hlavy (najnovšie prvé, max 20). */
export async function listViewerPreviews(fetchImpl: FetchLike = fetch): Promise<ViewerPreview[]> {
  const pulls = await getJson<PullWire[]>(
    fetchImpl,
    `/repos/${FORK_REPO}/pulls?state=open&sort=updated&direction=desc&per_page=20`,
  );
  return Promise.all(
    pulls.map(async (p) => ({
      number: p.number,
      title: p.title,
      branch: p.head.ref,
      url: await previewUrlForSha(p.head.sha, fetchImpl).catch(() => null),
      updatedAt: p.updated_at,
    })),
  );
}

/** Náhľad jedného PR (aj zatvoreného: odkaz z neho funguje, kým náhľad žije). */
export async function previewForPull(number: number, fetchImpl: FetchLike = fetch): Promise<ViewerPreview | null> {
  let p: PullWire;
  try {
    p = await getJson<PullWire>(fetchImpl, `/repos/${FORK_REPO}/pulls/${number}`);
  } catch {
    return null;
  }
  return {
    number: p.number,
    title: p.title,
    branch: p.head.ref,
    url: await previewUrlForSha(p.head.sha, fetchImpl).catch(() => null),
    updatedAt: p.updated_at,
  };
}
