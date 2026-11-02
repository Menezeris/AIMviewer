/**
 * Výpis čistých dát do YAML presne ako ruamel s nastavením knižnice (port `writer.dump_yaml(_do_ruamel(x))`,
 * D-186 krok 3): `indent(mapping=2, sequence=4, offset=2)`, `width=4096`, unicode bez escapov.
 *
 * Štýl ako `_do_ruamel`: text s `[[` v dvojitých úvodzovkách, zoznam samých skalárov vo flow `[a, b]`, mapy a
 * zoznamy záznamov blokovo; text, ktorý by YAML prečítal inak (bool, null, číslo, dátum, indikátor), v
 * jednoduchých úvodzovkách. Používa sa pre nové riadky zoznamu, nové kľúče, blokové polia a nové poznámky;
 * existujúci text sa mení riadkovými záplatami (`writer.ts`), nie týmto výpisom.
 */

type V = unknown;

const jeSkalar = (v: V) => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
const jeMapa = (v: V): v is Record<string, V> => !!v && typeof v === "object" && !Array.isArray(v);

/** Čo by ruamel (YAML 1.2, resolver ruamel) prečítal ako iný typ než text. */
const INY_TYP = [
  /^(?:true|True|TRUE|false|False|FALSE)$/,
  /^(?:null|Null|NULL|~)?$/,
  /^[-+]?(?:0|[1-9][0-9_]*)$/,
  /^0o[0-7_]+$/,
  /^0x[0-9a-fA-F_]+$/,
  /^[-+]?(?:\.[0-9_]+|[0-9][0-9_]*(?:\.[0-9_]*)?)(?:[eE][-+]?[0-9]+)?$/,
  /^[-+]?\.(?:inf|Inf|INF)$/,
  /^\.(?:nan|NaN|NAN)$/,
  /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)?$/,
];

/** Text, ktorý ruamel vypíše bez úvodzoviek. */
function plainOk(s: string): boolean {
  if (s === "" || s !== s.trim()) return false;
  if (INY_TYP.some((r) => r.test(s))) return false;
  if (/^[#&*!|>'"%@`[\]{},]/.test(s)) return false;
  if (/^[-?:](?:[ \t]|$)/.test(s)) return false;
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return false;
  if (/[\n\r\t\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x85\u2028\u2029\ufeff]/.test(s)) return false;
  return true;
}

function dvojite(s: string): string {
  let o = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\") o += "\\\\";
    else if (ch === '"') o += '\\"';
    else if (ch === "\n") o += "\\n";
    else if (ch === "\t") o += "\\t";
    else if (ch === "\r") o += "\\r";
    else if (c < 0x20 || c === 0x7f) o += `\\x${c.toString(16).padStart(2, "0")}`;
    else o += ch;
  }
  return `${o}"`;
}

/** Skalár v štýle `_do_ruamel` + ruamel emitter. */
export function skalar(v: V): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? ".nan" : v > 0 ? ".inf" : "-.inf";
  const s = String(v);
  if (s.includes("[[")) return dvojite(s);
  if (plainOk(s)) return s;
  if (/[\n\r\t\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) return dvojite(s);
  return `'${s.replace(/'/g, "''")}'`;
}

/** Hodnota na riadku za kľúčom alebo pomlčkou (flow alebo skalár); null = blokový tvar. */
function vRiadku(v: V): string | null {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every(jeSkalar)) return `[${v.map(skalar).join(", ")}]`;
    return null;
  }
  if (jeMapa(v)) return Object.keys(v).length === 0 ? "{}" : null;
  return skalar(v);
}

const sp = (n: number) => " ".repeat(n);

function mapa(m: Record<string, V>, ind: number, out: string[], prvyPrefix: string | null = null) {
  Object.entries(m).forEach(([k, v], i) => {
    const pre = i === 0 && prvyPrefix !== null ? prvyPrefix : sp(ind);
    const kl = skalar(k);
    const r = vRiadku(v);
    if (r !== null) out.push(r === "" ? `${pre}${kl}:` : `${pre}${kl}: ${r}`);
    else if (Array.isArray(v)) {
      out.push(`${pre}${kl}:`);
      zoznam(v, ind + 2, out);
    } else {
      out.push(`${pre}${kl}:`);
      mapa(v as Record<string, V>, ind + 2, out);
    }
  });
}

/** Blokový zoznam: pomlčka na `ind`, obsah položky na `ind + 2`. */
function zoznam(s: V[], ind: number, out: string[]) {
  for (const x of s) {
    const r = vRiadku(x);
    if (r !== null) out.push(r === "" ? `${sp(ind)}-` : `${sp(ind)}- ${r}`);
    else if (Array.isArray(x)) {
      out.push(`${sp(ind)}-`);
      zoznam(x, ind + 2, out);
    } else mapa(x as Record<string, V>, ind + 2, out, `${sp(ind)}- `);
  }
}

/** `dump_yaml(_do_ruamel(v))` pre mapu (blok, frontmatter, nový kľúč). */
export function dumpYaml(v: Record<string, V>): string {
  const out: string[] = [];
  mapa(v, 0, out);
  return out.map((l) => `${l}\n`).join("");
}

/** `dump_yaml(CommentedSeq([_do_ruamel(x) ...]))`: koreňový blokový zoznam (nové riadky, úroveň 1b). */
export function dumpZoznam(v: V[]): string {
  const out: string[] = [];
  zoznam(v, 2, out);
  return out.map((l) => `${l}\n`).join("");
}
