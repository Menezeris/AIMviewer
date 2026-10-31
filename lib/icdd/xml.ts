/**
 * Malý XML parser pre RDF/XML v ICDD (D-181): index, linksety a ontológie ISO 21597.
 * Bez závislostí, aby bežal v prehliadači aj v Node (kontrola kontajnera pri importe).
 * Vie elementy, atribúty, text, CDATA, komentáre, inštrukcie a preddefinované a číselné entity;
 * DTD s vlastnými entitami odmietne (ontológie ISO ich nemajú, a cudzí obsah ich nemá dostať).
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    const v = ENTITIES[e];
    if (v === undefined) throw new Error(`XML: neznáma entita ${m}`);
    return v;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Rozparsuje dokument a vráti koreňový element. */
export function parseXml(input: string): XmlElement {
  let s = input;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const push = (node: XmlNode) => {
    const top = stack[stack.length - 1];
    if (top) top.children.push(node);
    else if (typeof node !== "string" && root === null) root = node;
    else if (typeof node === "string" && node.trim() !== "") throw new Error("XML: text mimo koreňa");
  };

  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      push(decodeEntities(s.slice(i)));
      break;
    }
    if (lt > i) push(decodeEntities(s.slice(i, lt)));
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("XML: neukončený komentár");
      i = end + 3;
    } else if (s.startsWith("<![CDATA[", lt)) {
      const end = s.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("XML: neukončená CDATA");
      push(s.slice(lt + 9, end));
      i = end + 3;
    } else if (s.startsWith("<?", lt)) {
      const end = s.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("XML: neukončená inštrukcia");
      i = end + 2;
    } else if (s.startsWith("<!DOCTYPE", lt)) {
      const end = s.indexOf(">", lt);
      const body = s.slice(lt, end + 1);
      if (body.includes("[")) throw new Error("XML: DTD s vnútornou podmnožinou (entity) nie je podporované");
      i = end + 1;
    } else if (s[lt + 1] === "/") {
      const end = s.indexOf(">", lt);
      const name = s.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML: nečakaný koniec </${name}>`);
      if (stack.length === 0) root = root ?? top;
      i = end + 1;
    } else {
      // začiatočný tag; atribúty môžu obsahovať '>' v úvodzovkách
      let j = lt + 1;
      let quote: string | null = null;
      while (j < s.length) {
        const c = s[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= s.length) throw new Error("XML: neukončený tag");
      let raw = s.slice(lt + 1, j);
      const selfClosing = raw.endsWith("/");
      if (selfClosing) raw = raw.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(raw);
      if (!m) throw new Error("XML: tag bez mena");
      const el: XmlElement = { name: m[1], attrs: {}, children: [] };
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const rest = raw.slice(m[1].length);
      while ((a = attrRe.exec(rest))) el.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? "");
      push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  if (stack.length) throw new Error(`XML: neukončený element <${stack[stack.length - 1].name}>`);
  if (!root) throw new Error("XML: prázdny dokument");
  return root;
}
