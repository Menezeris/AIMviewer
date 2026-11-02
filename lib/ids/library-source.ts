/**
 * Knižnica požiadaviek ako zdroj hotových IDS (D-182, #351): čítanie repa knižnice cez GitHub API len na serveri.
 *
 * Knižnica je len miesto, kde sa IDS pripravuje; AIM z nej nič nepreberá samo. Karta "Requirements library" ukáže
 * všetky `*.ids` z priečinka `LIBRARY_IDS_DIR` (predvolene `ids`) na vetve `LIBRARY_REF` (predvolene `main`) a do
 * projektu sa dostanú len vedomým priradením. Token (`LIBRARY_GITHUB_TOKEN`, fine-grained, len čítanie repa
 * knižnice) nikdy nejde do prehliadača.
 *
 * Vždy vylúčené: priečinky `dss/` a `bsi/` a súbor `Configurations.ids` (DSS pod copyrightom ČAS a oficiálne
 * testcases buildingSMART sa nesmú ukázať ani priradiť), aj keby sa ocitli v `LIBRARY_IDS_DIR`.
 */

export const DEFAULT_LIBRARY_REPO = "Menezeris/assetin-library";
export const DEFAULT_LIBRARY_REF = "main";
export const DEFAULT_LIBRARY_IDS_DIR = "ids";
/** Strop veľkosti jedného IDS (rovnaký ako `MAX_IDS_XML` pri ukladaní z viewera). */
export const MAX_LIBRARY_IDS_BYTES = 2_000_000;
/** Strop počtu súborov v karte; viac hotových IDS v jednom priečinku sa nečaká. */
export const MAX_LIBRARY_FILES = 200;

const API = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const EXCLUDED_DIRS = new Set(["dss", "bsi"]);
const EXCLUDED_FILES = new Set(["configurations.ids"]);

export interface LibraryConfig {
  token: string | null;
  repo: string;
  ref: string;
  dir: string;
}

export function libraryConfig(env: Record<string, string | undefined> = process.env): LibraryConfig {
  const repo = env.LIBRARY_REPO?.trim() || DEFAULT_LIBRARY_REPO;
  const ref = env.LIBRARY_REF?.trim() || DEFAULT_LIBRARY_REF;
  const dir = (env.LIBRARY_IDS_DIR?.trim() || DEFAULT_LIBRARY_IDS_DIR).replace(/^\/+|\/+$/g, "");
  if (!REPO_RE.test(repo)) throw new Error(`LIBRARY_REPO '${repo}' nemá tvar vlastník/repo`);
  if (!REF_RE.test(ref) || ref.includes("..")) throw new Error(`LIBRARY_REF '${ref}' nie je platná vetva alebo tag`);
  if (!dir || dir.split("/").some((s) => s === ".." || s === "." || s === "")) throw new Error(`LIBRARY_IDS_DIR '${dir}' nie je platný priečinok`);
  return { token: env.LIBRARY_GITHUB_TOKEN?.trim() || null, repo, ref, dir };
}

/** Patrí cesta medzi hotové IDS knižnice? (`.ids` pod `dir`, mimo vylúčených priečinkov a súborov) */
export function isLibraryIdsPath(path: string, dir: string): boolean {
  if (!path.startsWith(`${dir}/`) || !/\.ids$/i.test(path)) return false;
  const parts = path.split("/");
  if (parts.some((p) => p === ".." || p === "")) return false;
  if (parts.slice(0, -1).some((p) => EXCLUDED_DIRS.has(p.toLowerCase()))) return false;
  return !EXCLUDED_FILES.has(parts[parts.length - 1].toLowerCase());
}

/** Kód IDS = meno súboru bez `.ids` (kódy sa v knižnici môžu meniť, D-182). */
export const codeOfPath = (path: string) => path.split("/").pop()!.replace(/\.ids$/i, "");

export interface LibraryHead {
  sha: string;
  date: string | null;
}

export interface LibraryFile {
  path: string;
  /** Git blob sha (nie sha256 obsahu). */
  blob: string;
  size: number;
}

export interface LibraryChange {
  sha: string;
  date: string | null;
  author: string | null;
  message: string | null;
}

/** Čítanie repa knižnice; v testoch v pamäti. */
export interface LibrarySource {
  readonly repo: string;
  readonly ref: string;
  readonly dir: string;
  /** Commit, na ktorý ukazuje `ref`. */
  head(): Promise<LibraryHead>;
  /** Hotové IDS na commite (už filtrované, zoradené podľa cesty). `truncated` = GitHub strom nevrátil celý. */
  files(commit: string): Promise<{ files: LibraryFile[]; truncated: boolean }>;
  /** Posledný commit, ktorý súbor zmenil (do `commit` vrátane). */
  lastChange(path: string, commit: string): Promise<LibraryChange | null>;
  /** Obsah súboru podľa git blobu (UTF-8). */
  blob(blob: string): Promise<string>;
}

export class LibraryNotConfiguredError extends Error {
  constructor() {
    super("Knižnica nie je pripojená: chýba LIBRARY_GITHUB_TOKEN (Vercel env, len čítanie repa knižnice).");
  }
}

export class LibrarySourceError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
  }
}

type FetchLike = (url: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

/** Zdroj nad GitHub REST API. Odpovede s pevným commitom alebo blobom sa nemenia, preto ich drží cache v pamäti. */
export function githubLibrarySource(cfg: LibraryConfig, fetchImpl: FetchLike = fetch): LibrarySource {
  if (!cfg.token) throw new LibraryNotConfiguredError();
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aim-requirements-library",
    Authorization: `Bearer ${cfg.token}`,
  };
  const blobs = new Map<string, string>();
  const trees = new Map<string, { files: LibraryFile[]; truncated: boolean }>();

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${API}/repos/${cfg.repo}${path}`, { headers, cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new LibrarySourceError(`GitHub odmietol token knižnice (${res.status}); over LIBRARY_GITHUB_TOKEN.`, res.status);
    if (res.status === 404) throw new LibrarySourceError(`GitHub ${cfg.repo}${path.split("?")[0]}: nenájdené (repo, vetva alebo práva tokenu).`, 404);
    if (!res.ok) throw new LibrarySourceError(`GitHub ${cfg.repo}: ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  return {
    repo: cfg.repo,
    ref: cfg.ref,
    dir: cfg.dir,
    async head() {
      const c = await getJson<{ sha: string; commit?: { committer?: { date?: string } } }>(`/commits/${encodeURIComponent(cfg.ref)}`);
      if (!SHA_RE.test(c.sha)) throw new LibrarySourceError("GitHub vrátil neplatný commit.");
      return { sha: c.sha, date: c.commit?.committer?.date ?? null };
    },
    async files(commit) {
      if (!SHA_RE.test(commit)) throw new LibrarySourceError("commit: 40 znakov sha.");
      const hit = trees.get(commit);
      if (hit) return hit;
      const tree = await getJson<{ tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated?: boolean }>(
        `/git/trees/${commit}?recursive=1`,
      );
      const files = tree.tree
        .filter((e) => e.type === "blob" && isLibraryIdsPath(e.path, cfg.dir))
        .map((e) => ({ path: e.path, blob: e.sha, size: e.size ?? 0 }))
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, MAX_LIBRARY_FILES);
      const out = { files, truncated: tree.truncated === true };
      trees.set(commit, out);
      return out;
    },
    async lastChange(path, commit) {
      const list = await getJson<Array<{ sha: string; commit?: { author?: { name?: string; date?: string }; message?: string } }>>(
        `/commits?sha=${commit}&path=${encodeURIComponent(path)}&per_page=1`,
      );
      const c = list[0];
      if (!c) return null;
      return {
        sha: c.sha,
        date: c.commit?.author?.date ?? null,
        author: c.commit?.author?.name ?? null,
        message: c.commit?.message?.split("\n")[0]?.slice(0, 200) ?? null,
      };
    },
    async blob(blob) {
      const hit = blobs.get(blob);
      if (hit !== undefined) return hit;
      const b = await getJson<{ content?: string; encoding?: string; size?: number }>(`/git/blobs/${blob}`);
      if ((b.size ?? 0) > MAX_LIBRARY_IDS_BYTES) throw new LibrarySourceError(`Súbor má ${b.size} B, nad stropom ${MAX_LIBRARY_IDS_BYTES} B.`);
      if (b.encoding !== "base64" || typeof b.content !== "string") throw new LibrarySourceError("GitHub vrátil blob v neznámom kódovaní.");
      const text = Buffer.from(b.content, "base64").toString("utf8");
      blobs.set(blob, text);
      return text;
    },
  };
}
