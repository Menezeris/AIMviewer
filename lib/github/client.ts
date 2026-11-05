import "server-only";

/**
  * Minimal GitHub REST API client (D-090) - only what the requests
  * from the MCP connector need: issue, comment, labels, list and issue timeline.
  * No dependency (fetch), `fetchImpl` is injected for tests. The token is a
  * fine-grained PAT with Issues: write only on the target repo; it never leaves the server.
 */

const API = "https://api.github.com";

export interface GithubRepo {
  owner: string;
  repo: string;
}

export interface GithubIssue {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  state_reason?: string | null;
  body?: string | null;
  labels: { name: string }[];
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  pull_request?: unknown;
}

export interface GithubComment {
  id: number;
  html_url: string;
  body: string;
  user: { login: string } | null;
  created_at: string;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** `owner/repo` from env (default AIMviewer, where the connector code lives). */
export function parseRepo(value: string | undefined, fallback = "Menezeris/AIMviewer"): GithubRepo {
  const v = (value?.trim() || fallback).replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  const [owner, repo, ...rest] = v.split("/");
  if (!owner || !repo || rest.length > 0) throw new Error(`Neplatné repo '${v}', čakám owner/repo.`);
  return { owner, repo };
}

export class GithubClient {
  constructor(
    private readonly token: string,
    readonly target: GithubRepo,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "aim-viewer-mcp",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // the body is not JSON, we keep the text
      }
      throw new GithubError(`GitHub ${method} ${path}: HTTP ${res.status} ${message.slice(0, 200)}`, res.status);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private get base() {
    return `/repos/${this.target.owner}/${this.target.repo}`;
  }

  createIssue(input: { title: string; body: string; labels: string[] }): Promise<GithubIssue> {
    return this.call("POST", `${this.base}/issues`, input);
  }

    /** Login of the account the token belongs to (to whom the server attributes its comments). */
  async viewerLogin(): Promise<string> {
    return (await this.call<{ login: string }>("GET", "/user")).login;
  }

  getIssue(number: number): Promise<GithubIssue> {
    return this.call("GET", `${this.base}/issues/${number}`);
  }

    /** Open issues with a label (without PRs), most recently updated first. */
  listOpenIssues(label: string, perPage = 100): Promise<GithubIssue[]> {
    return this.listIssues(label, "open", perPage);
  }

    /** Issues with a label in the given state (without PRs), most recently updated first (D-126). */
  async listIssues(label: string, state: "open" | "closed" | "all", perPage = 100): Promise<GithubIssue[]> {
    const q = new URLSearchParams({
      state,
      labels: label,
      sort: "updated",
      direction: "desc",
      per_page: String(perPage),
    });
    const items = await this.call<GithubIssue[]>("GET", `${this.base}/issues?${q}`);
    return items.filter((i) => !i.pull_request);
  }

  reopenIssue(number: number): Promise<GithubIssue> {
    return this.call("PATCH", `${this.base}/issues/${number}`, { state: "open" });
  }

  addComment(number: number, body: string): Promise<GithubComment> {
    return this.call("POST", `${this.base}/issues/${number}/comments`, { body });
  }

  listComments(number: number, perPage = 100): Promise<GithubComment[]> {
    return this.call("GET", `${this.base}/issues/${number}/comments?per_page=${perPage}`);
  }

  async addLabels(number: number, labels: string[]): Promise<void> {
    await this.call("POST", `${this.base}/issues/${number}/labels`, { labels });
  }

    /** Removes a label; a missing label (404) is not an error. */
  async removeLabel(number: number, label: string): Promise<void> {
    try {
      await this.call("DELETE", `${this.base}/issues/${number}/labels/${encodeURIComponent(label)}`);
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 404)) throw err;
    }
  }

    /** PRs that reference the issue (`cross-referenced` events from the timeline). */
  async linkedPullRequests(
    number: number,
  ): Promise<{ number: number; html_url: string; title: string; state: string; merged: boolean }[]> {
    type Ev = {
      event: string;
      source?: {
        issue?: {
          number: number;
          html_url: string;
          title: string;
          state: string;
          pull_request?: { merged_at?: string | null };
          repository?: { full_name?: string };
        };
      };
    };
    const events = await this.call<Ev[]>("GET", `${this.base}/issues/${number}/timeline?per_page=100`);
    const seen = new Map<number, { number: number; html_url: string; title: string; state: string; merged: boolean }>();
    for (const e of events) {
      const i = e.source?.issue;
      if (e.event !== "cross-referenced" || !i?.pull_request) continue;
      seen.set(i.number, {
        number: i.number,
        html_url: i.html_url,
        title: i.title,
        state: i.state,
        merged: Boolean(i.pull_request.merged_at),
      });
    }
    return [...seen.values()];
  }
}
