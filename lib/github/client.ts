import "server-only";

/**
 * Minimálny klient GitHub REST API (D-090) - len to, čo potrebujú požiadavky
 * z MCP konektora: issue, komentár, štítky, zoznam a časová os issue.
 * Bez závislosti (fetch), `fetchImpl` sa injektuje kvôli testom. Token je
 * fine-grained PAT s právom Issues: write len na cieľové repo; neopustí server.
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

/** `owner/repo` z env (predvolene AIMviewer, kde žije kód konektora). */
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
        // telo nie je JSON, necháme text
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

  getIssue(number: number): Promise<GithubIssue> {
    return this.call("GET", `${this.base}/issues/${number}`);
  }

  /** Otvorené issues so štítkom (bez PR), najnovšie upravené prvé. */
  async listOpenIssues(label: string, perPage = 100): Promise<GithubIssue[]> {
    const q = new URLSearchParams({
      state: "open",
      labels: label,
      sort: "updated",
      direction: "desc",
      per_page: String(perPage),
    });
    const items = await this.call<GithubIssue[]>("GET", `${this.base}/issues?${q}`);
    return items.filter((i) => !i.pull_request);
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

  /** PR, ktoré na issue odkazujú (udalosti `cross-referenced` z časovej osi). */
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
