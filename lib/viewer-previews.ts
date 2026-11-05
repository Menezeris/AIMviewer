import "server-only";

import { isAllowedViewerUrl, type ViewerPreview } from "./viewer-source";

/**
 * Viewer previews from open PRs of the fork (D-116): GitHub Deployments API, where
 * Vercel reports each preview (`environment: Preview`, `environment_url`). The fork is
 * public, any token will do: `GITHUB_PREVIEWS_TOKEN`, otherwise the connector token
 * `FEEDBACK_GITHUB_TOKEN`. The result is cached for 60 s, so open tabs do not
 * exhaust the limit.
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
  // Without a token the shared IP of the serverless function has 60 requests/h across all
  // Vercel customers, so the limit is usually exhausted; the connector token (D-090)
  // is enough, any token can read the public fork.
  const token = (process.env.GITHUB_PREVIEWS_TOKEN ?? process.env.FEEDBACK_GITHUB_TOKEN)?.trim();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects a request without a User-Agent (403).
    "User-Agent": "aim-viewer-previews",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson<T>(fetchImpl: FetchLike, path: string): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, { headers: headers(), next: { revalidate: REVALIDATE_S } });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** URL of the last successful preview for a commit, or null. */
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
    // Only a preview of our Vercel project; anything else from the API is not embedded.
    if (url && isAllowedViewerUrl(url)) return url;
  }
  return null;
}

/** Open PRs of the fork with a head preview (newest first, max 20). */
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

/** Preview of one PR (also a closed one: the link from it works while the preview lives). */
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
