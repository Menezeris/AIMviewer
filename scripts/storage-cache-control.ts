/**
 * Dodatočné nastavenie Cache-Control na existujúcich objektoch Supabase Storage (D-135 dodatok).
 *
 * Objekty nahrané s `private, no-cache` sa pri každom otvorení viewera sťahujú znova. Storage nemá
 * "zmeň hlavičku", preto skript nahrá TIE ISTÉ bajty s `upsert: true` a `cacheControl`.
 *
 * Politika (`cacheSecondsFor`):
 *   ifc/archive/<MODEL>/vNNN.ifc.gz   31536000 (nemenný archív revízie, D-086/D-135)
 *   ifc/<MODEL>.ifc                   60       (aktuálny kľúč, prepisuje ho každá revízia)
 *   documents/*                       3600     (PDF sa pod rovnakým menom môže prepísať)
 *   ostatné buckety a kľúče           preskočené
 *
 * Predvolene DRY-RUN: len zoznam a hlavičky (žiadne sťahovanie tela, žiadny zápis). Ostrý režim
 * len s `--apply`. Pri ostrom behu sa každý objekt spracuje samostatne a poistky sú:
 *   1. etag z `info()` pred stiahnutím a znova tesne pred zápisom (zmenil sa => preskočí, nezapíše);
 *   2. stiahnuté bajty musia sedieť s veľkosťou z metadát; sha256 sa spočíta pred zápisom;
 *   3. po zápise sa objekt stiahne znova a musí mať rovnakú veľkosť aj sha256, inak sa rovnaké
 *      bajty (držané v pamäti) nahrajú ešte raz; ak ani to neprejde, skript skončí chybou;
 *   4. po zápise sa overí hlavička `cache-control` na verejnej URL; nezhoda na PRVOM zapísanom
 *      objekte skript zastaví (mechanizmus nefunguje, ďalej nepokračuje).
 *
 * Egress: dry-run nesťahuje telá. Ostrý beh stiahne každý objekt dvakrát (pred a po zápise).
 *
 * Použitie (z koreňa, env SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY z .env.local alebo shellu):
 *   npx tsx scripts/storage-cache-control.ts                          # dry-run, všetky buckety `ifc` a `documents`
 *   npx tsx scripts/storage-cache-control.ts --bucket ifc             # len jeden bucket
 *   npx tsx scripts/storage-cache-control.ts --key ifc/archive/ASR/v078.ifc.gz   # konkrétne objekty (opakovateľné)
 *   npx tsx scripts/storage-cache-control.ts --key ... --apply        # ostrý zápis
 *
 * `--key` v dry-run režime beží aj bez service kľúča (verejná URL, len HEAD; hash nie je k dispozícii).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const IMMUTABLE_SECONDS = 31536000;
export const CURRENT_MODEL_SECONDS = 60;
export const DOCUMENT_SECONDS = 3600;
export const DEFAULT_BUCKETS = ["ifc", "documents"];

const ARCHIVE_KEY = /^archive\/[^/]+\/v\d{3,}\.ifc\.gz$/;

/** Cieľová doba cache v sekundách, alebo null, ak sa objekt nemá meniť. */
export function cacheSecondsFor(bucket: string, key: string): number | null {
  if (bucket === "ifc") {
    if (ARCHIVE_KEY.test(key)) return IMMUTABLE_SECONDS;
    if (/^[^/]+\.ifc$/.test(key)) return CURRENT_MODEL_SECONDS;
    return null;
  }
  if (bucket === "documents") return DOCUMENT_SECONDS;
  return null;
}

/** `max-age=N` z hlavičky, alebo null (napr. `private, no-cache`). */
export function maxAgeOf(header: string | null | undefined): number | null {
  const m = /(?:^|[\s,])max-age=(\d+)/i.exec(header ?? "");
  return m ? Number(m[1]) : null;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface Args {
  apply: boolean;
  buckets: string[];
  keys: { bucket: string; key: string }[];
  max: number;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, buckets: [], keys: [], max: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} chce hodnotu`);
      return v;
    };
    if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--bucket") args.buckets.push(next());
    else if (a === "--max") args.max = Number(next());
    else if (a === "--key") {
      const v = next();
      const slash = v.indexOf("/");
      if (slash < 1) throw new Error(`--key chce <bucket>/<kľúč>, dostal ${v}`);
      args.keys.push({ bucket: v.slice(0, slash), key: v.slice(slash + 1) });
    } else throw new Error(`neznámy argument ${a}`);
  }
  if (!args.buckets.length) args.buckets = DEFAULT_BUCKETS;
  return args;
}

function loadEnvFile(): void {
  for (const name of [".env.local", ".env"]) {
    const p = join(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

interface Target {
  bucket: string;
  key: string;
  seconds: number;
  size: number | null;
  mime: string | null;
}

async function listAll(sb: SupabaseClient, bucket: string, prefix = ""): Promise<{ key: string; size: number; mime: string }[]> {
  const out: { key: string; size: number; mime: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await listAll(sb, bucket, path)));
      else out.push({ key: path, size: Number(e.metadata?.size ?? 0), mime: String(e.metadata?.mimetype ?? "application/octet-stream") });
    }
    if (data.length < 100) break;
  }
  return out;
}

const publicUrl = (base: string, bucket: string, key: string) =>
  `${base}/storage/v1/object/public/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function head(url: string): Promise<{ size: number; cacheControl: string | null; etag: string | null }> {
  const res = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!res.ok) throw new Error(`HEAD ${url} -> ${res.status}`);
  return {
    size: Number(res.headers.get("content-length") ?? 0),
    cacheControl: res.headers.get("cache-control"),
    etag: res.headers.get("etag"),
  };
}

async function download(sb: SupabaseClient, t: Target): Promise<Uint8Array> {
  const { data, error } = await sb.storage.from(t.bucket).download(t.key);
  if (error || !data) throw new Error(`download ${t.bucket}/${t.key}: ${error?.message ?? "bez dát"}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function etagOf(sb: SupabaseClient, t: Target): Promise<string | null> {
  const { data, error } = await sb.storage.from(t.bucket).info(t.key);
  if (error) throw new Error(`info ${t.bucket}/${t.key}: ${error.message}`);
  return data?.etag ?? null;
}

async function upload(sb: SupabaseClient, t: Target, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: t.mime ?? undefined });
  const { error } = await sb.storage
    .from(t.bucket)
    .upload(t.key, blob, { contentType: t.mime ?? undefined, upsert: true, cacheControl: String(t.seconds) });
  if (error) throw new Error(`upload ${t.bucket}/${t.key}: ${error.message}`);
}

const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;

async function applyOne(sb: SupabaseClient, base: string, t: Target, first: boolean): Promise<"written" | "skipped"> {
  const label = `${t.bucket}/${t.key}`;
  const etag0 = await etagOf(sb, t);
  const bytes = await download(sb, t);
  if (t.size !== null && bytes.length !== t.size) throw new Error(`${label}: stiahnuté ${bytes.length} B, metadáta ${t.size} B`);
  const hash = sha256(bytes);
  if ((await etagOf(sb, t)) !== etag0) {
    console.log(`  PRESKOČENÉ ${label}: objekt sa medzitým zmenil (etag), nič som nezapísal`);
    return "skipped";
  }

  await upload(sb, t, bytes);

  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    const back = await download(sb, t);
    ok = back.length === bytes.length && sha256(back) === hash;
    if (!ok) {
      console.error(`  ! ${label}: po zápise nesedí veľkosť alebo hash, nahrávam pôvodné bajty znova`);
      await upload(sb, t, bytes);
    }
  }
  if (!ok) throw new Error(`${label}: obsah po zápise nesedí ani po obnove, skontroluj ručne (sha256 pôvodného ${hash})`);

  const h = await head(publicUrl(base, t.bucket, t.key));
  const cc = maxAgeOf(h.cacheControl);
  console.log(`  OK ${label}: ${bytes.length} B, sha256 ${hash.slice(0, 16)}..., cache-control "${h.cacheControl}"`);
  if (cc !== t.seconds && first) {
    throw new Error(`${label}: hlavička po zápise je "${h.cacheControl}", čakal som max-age=${t.seconds}. Zastavujem, Storage cacheControl nepreberá.`);
  }
  if (cc !== t.seconds) console.warn(`  ! ${label}: hlavička "${h.cacheControl}" nezodpovedá max-age=${t.seconds} (CDN môže chvíľu držať starú)`);
  return "written";
}

async function main(): Promise<void> {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const base = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!base) throw new Error("Chýba SUPABASE_URL");
  if (args.apply && !serviceKey) throw new Error("--apply vyžaduje SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey && !args.keys.length) throw new Error("Bez SUPABASE_SERVICE_ROLE_KEY ide len dry-run s --key <bucket>/<kľúč>");

  console.log(args.apply ? "REŽIM: OSTRÝ ZÁPIS (--apply)" : "REŽIM: dry-run (nič sa nezapisuje, telá sa nesťahujú)");
  const sb = serviceKey ? createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  const targets: Target[] = [];
  const skipped: string[] = [];
  const add = (bucket: string, key: string, size: number | null, mime: string | null) => {
    const seconds = cacheSecondsFor(bucket, key);
    if (seconds === null) skipped.push(`${bucket}/${key}`);
    else targets.push({ bucket, key, seconds, size, mime });
  };
  if (args.keys.length) {
    for (const k of args.keys) add(k.bucket, k.key, null, null);
  } else if (sb) {
    for (const bucket of args.buckets) for (const o of await listAll(sb, bucket)) add(bucket, o.key, o.size, o.mime);
  }

  let needChange = 0, bytesTotal = 0, written = 0;
  for (const t of targets) {
    if (written >= args.max) break;
    const h = await head(publicUrl(base, t.bucket, t.key));
    t.size = t.size ?? h.size;
    const label = `${t.bucket}/${t.key}`;
    if (maxAgeOf(h.cacheControl) === t.seconds) {
      console.log(`= ${label}  ${mb(h.size)}  už má max-age=${t.seconds}`);
      continue;
    }
    needChange++;
    bytesTotal += h.size;
    console.log(`~ ${label}  ${mb(h.size)}  "${h.cacheControl}" -> max-age=${t.seconds}`);
    if (args.apply && sb) {
      if (t.mime === null) t.mime = (await mimeOf(sb, t)) ?? "application/octet-stream";
      if ((await applyOne(sb, base, t, written === 0)) === "written") written++;
    }
  }
  console.log(`\nZmenilo by sa ${needChange} objektov (${mb(bytesTotal)}), preskočené mimo politiky: ${skipped.length}.`);
  if (!args.apply) console.log("Dry-run: nič som nezapísal. Ostrý beh: pridaj --apply.");
  else console.log(`Zapísané ${written}.`);
}

/** mimetype objektu z `info()` (pri `--key` ho listing nedal). */
async function mimeOf(sb: SupabaseClient, t: Target): Promise<string | null> {
  const { data } = await sb.storage.from(t.bucket).info(t.key);
  return data?.contentType ?? null;
}

if (process.argv[1] && /storage-cache-control\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
