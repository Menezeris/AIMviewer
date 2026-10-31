import { isOwnStorageUrl } from "./snapshot";
import { MAX_ARCHIVE_BYTES } from "./import";
import { BcfInputError } from "./tools";

/**
 * Odkiaľ príde `.bcfzip` pri importe (D-158 krok 8): `data_base64` (malý súbor priamo v tooli) alebo
 * `url`. Server nesťahuje hocijakú adresu (SSRF): len https z verejného úložiska tohto projektu
 * alebo z hostov v `BCF_IMPORT_HOSTS` (čiarkou oddelené mená), bez presmerovania.
 */

export interface ImportSourceConfig {
  supabaseUrl?: string;
  /** Povolené mená hostov okrem úložiska projektu. */
  hosts: string[];
}

export function importSourceConfig(): ImportSourceConfig {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    hosts: (process.env.BCF_IMPORT_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function checkImportUrl(raw: string, cfg: ImportSourceConfig): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BcfInputError("url nie je platná adresa.");
  }
  if (u.protocol !== "https:" || u.username || u.password) throw new BcfInputError("url musí byť https bez prihlasovacích údajov.");
  if (isOwnStorageUrl(u.href, cfg.supabaseUrl) || cfg.hosts.includes(u.hostname.toLowerCase())) return u;
  throw new BcfInputError(
    "url nie je z povoleného zdroja (verejné úložisko projektu alebo host z BCF_IMPORT_HOSTS); súbor pošli ako data_base64 alebo nahraj do úložiska.",
  );
}

/** Stiahne súbor s limitom veľkosti a času; bez presmerovania. */
export async function fetchArchive(raw: string, cfg: ImportSourceConfig, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const u = checkImportUrl(raw, cfg);
  const res = await fetchImpl(u, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new BcfInputError(`Stiahnutie súboru zlyhalo (HTTP ${res.status}).`);
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_ARCHIVE_BYTES) throw new BcfInputError("Súbor je príliš veľký.");
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      await reader.cancel();
      throw new BcfInputError("Súbor je príliš veľký.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Argumenty toolu -> bajty archívu. */
export async function archiveFromArgs(args: Record<string, unknown>, cfg: ImportSourceConfig = importSourceConfig(), fetchImpl?: typeof fetch): Promise<Uint8Array> {
  const b64 = typeof args.data_base64 === "string" ? args.data_base64.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (b64 && url) throw new BcfInputError("Zadaj buď url, alebo data_base64, nie oboje.");
  if (b64) {
    if (b64.length > Math.ceil((MAX_ARCHIVE_BYTES * 4) / 3) + 4) throw new BcfInputError("Súbor je príliš veľký.");
    return Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64");
  }
  if (url) return fetchArchive(url, cfg, fetchImpl);
  throw new BcfInputError("import potrebuje url (https, verejné úložisko) alebo data_base64 (.bcfzip).");
}
