/**
 * Minimálny ElementTree s výpisom ako Python `xml.etree.ElementTree` (D-186 krok 6): `ET.indent(space="  ")` a
 * `ET.tostring(root, encoding="utf-8", xml_declaration=True)` so zaregistrovanými prefixmi. Generátor IDS musí dať
 * bajtovo ten istý súbor ako Python (korpus `ids/*.ids`), preto sa výpis neberie z DOM knižnice.
 */

export interface Prvok {
  /** `{ns}tag` */
  tag: string;
  atributy: Array<[string, string]>;
  text: string | null;
  tail: string | null;
  deti: Prvok[];
}

export function prvok(tag: string, atributy: Record<string, string | null | undefined> = {}): Prvok {
  return { tag, atributy: Object.entries(atributy).filter((x): x is [string, string] => x[1] !== null && x[1] !== undefined), text: null, tail: null, deti: [] };
}

export function podprvok(rodic: Prvok, tag: string, atributy: Record<string, string | null | undefined> = {}): Prvok {
  const p = prvok(tag, atributy);
  rodic.deti.push(p);
  return p;
}

/** `ET.indent(tree, space)`: odsadenie textu a chvostov ako Python 3.9+. */
export function odsad(koren: Prvok, space = "  ") {
  const jePrazdne = (s: string | null) => !s || s.trim() === "";
  const urovne = ["\n"];
  const vnutri = (e: Prvok, uroven: number) => {
    const dieta = uroven + 1;
    if (urovne.length <= dieta) urovne.push(urovne[uroven] + space);
    if (jePrazdne(e.text)) e.text = urovne[dieta];
    for (const d of e.deti) {
      if (d.deti.length) vnutri(d, dieta);
      if (jePrazdne(d.tail)) d.tail = urovne[dieta];
    }
    const posledne = e.deti[e.deti.length - 1];
    if (jePrazdne(posledne.tail)) posledne.tail = urovne[uroven];
  };
  if (koren.deti.length) vnutri(koren, 0);
}

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** `_escape_attrib` Pythonu 3.13: & < > " a \r \n \t. */
const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#09;");

/** `ET.tostring(..., encoding="utf-8", xml_declaration=True)` so zaregistrovanými prefixmi menných priestorov. */
export function vypis(koren: Prvok, prefixy: Record<string, string>): string {
  const pouzite = new Map<string, string>();
  const qn = (meno: string) => {
    const m = /^\{([^}]*)\}(.*)$/.exec(meno);
    if (!m) return meno;
    const prefix = prefixy[m[1]];
    if (!prefix) throw new Error(`neznámy menný priestor ${m[1]}`);
    pouzite.set(m[1], prefix);
    return `${prefix}:${m[2]}`;
  };
  // ElementTree zbiera menné priestory celého stromu pred výpisom (tagy aj atribúty)
  const zber = (e: Prvok) => {
    qn(e.tag);
    for (const [k] of e.atributy) qn(k);
    e.deti.forEach(zber);
  };
  zber(koren);
  const out: string[] = ["<?xml version='1.0' encoding='utf-8'?>\n"];
  const zapis = (e: Prvok, korenovy: boolean) => {
    out.push(`<${qn(e.tag)}`);
    if (korenovy) for (const [uri, p] of [...pouzite.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))) out.push(` xmlns:${p}="${escAttr(uri)}"`);
    for (const [k, v] of e.atributy) out.push(` ${qn(k)}="${escAttr(v)}"`);
    if (e.text || e.deti.length) {
      out.push(">");
      if (e.text) out.push(escText(e.text));
      for (const d of e.deti) zapis(d, false);
      out.push(`</${qn(e.tag)}>`);
    } else out.push(" />");
    if (e.tail) out.push(escText(e.tail));
  };
  zapis(koren, true);
  return out.join("");
}
