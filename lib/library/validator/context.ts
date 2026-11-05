/**
 * Validátor knižnice (port `assetin/engine/validator/__init__.py` a `spolocne.py`, D-186 krok 5): pravidlá ako
 * registrované funkcie nad načítaným grafom; čo pravidlo vidí (`Kontext`) a pomocné funkcie zdieľané sekciami.
 * Pravidlá nikdy nehádžu výnimku, vracajú diagnostiky v tom istom tvare ako loader a graf.
 */

import { noteId, noteType, type Library } from "../graph";
import { rowForPointer, type Diagnostic, type PodZaznam, type Note, type Uroven } from "../loader";
import { parseWikilink } from "../projection";

export type M = Record<string, unknown>;
export type Potrebuje = "graf" | "ifc" | "bsdd";

export interface Pravidlo {
  kod: string;
  uroven: Uroven;
  popis: string;
  zdroj: string;
  potrebuje: Potrebuje;
  fn: (ctx: Kontext) => Iterable<Diagnostic>;
  /** pravidlo beží len v preflighte generátora (H2), nie v obyčajnej validácii */
  preflight: boolean;
}

export const REGISTER = new Map<string, Pravidlo>();

/** `@pravidlo`: zaregistruje pravidlo pod kódom z docs/VALIDATION-RULES.md (poradie registrácie = poradie behu). */
export function pravidlo(
  kod: string,
  uroven: Uroven,
  o: { popis: string; zdroj: string; potrebuje?: Potrebuje; preflight?: boolean },
  fn: (ctx: Kontext) => Iterable<Diagnostic>,
) {
  if (REGISTER.has(kod)) throw new Error(`pravidlo ${kod} je už registrované`);
  REGISTER.set(kod, { kod, uroven, popis: o.popis, zdroj: o.zdroj, potrebuje: o.potrebuje ?? "graf", fn, preflight: !!o.preflight });
}

// ------------------------------------------------------------------------------------------------ odkazy a hodnoty

export interface Link {
  ciel: string;
  kotva: string | null;
  alias: string | null;
  raw: string;
}

/** WikiLink z hodnoty modelu (text `[[...]]`); iné hodnoty nie sú odkaz. */
export function link(v: unknown): Link | null {
  if (typeof v !== "string") return null;
  const w = parseWikilink(v);
  return w ? { ...w, raw: v.trim() } : null;
}

/** `odkazy_pola`: hodnota poľa ako zoznam odkazov (jeden, zoznam alebo nič). */
export function odkazyPola(model: unknown, nazov: string): Link[] {
  const v = obj(model)?.[nazov];
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(link).filter((x): x is Link => x !== null);
  const l = link(v);
  return l ? [l] : [];
}
export const ciele = (model: unknown, nazov: string) => odkazyPola(model, nazov).map((w) => w.ciel);

export const obj = (v: unknown): M | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as M) : null);
export const zoznam = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const zoznamM = (v: unknown): M[] => zoznam(v).map((x) => obj(x) ?? {});
/** `getattr(x, k, None)`: hodnota poľa alebo null (aj keď x nie je model). */
export const attr = (x: unknown, k: string): unknown => obj(x)?.[k] ?? null;
/** `x is not None`. */
export const je = (v: unknown) => v !== null && v !== undefined;
/** Pravdivosť ako v Pythone. */
export const pravda = (v: unknown) =>
  !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (obj(v) !== null && Object.keys(v as object).length === 0));

/** `str(v)` v Pythone pre hodnoty modelu. */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (Array.isArray(v)) return pyRepr(v);
  return String(v);
}

/** `repr(v)` v Pythone (reťazce, čísla, zoznamy). */
export function pyRepr(v: unknown): string {
  if (typeof v === "string") {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    let s = v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    if (q === "'") s = s.replace(/'/g, "\\'");
    return q + s + q;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  return pyStr(v);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const zorad = (xs: Iterable<string>) => [...xs].sort(cmp);

/** `hodnoty_s_oddelovacom`: (cesta, hodnota) skalárov s `·` mimo kľúčov s prózou (A1, §16.18). */
const PROZA_KLUCE = new Set(["text", "pokyn", "postup", "zdovodnenie", "definicia", "content", "nazov", "poznamka", "vhodne_pre", "popis", "metoda_merania", "hranica_merania", "referencny_dokument", "klasifikacia_19650", "zdroj_normy", "tolerancia", "presnost", "vzor", "revizia_vzor", "jeden_riadok", "definicia_ref", "relativny_termin"]);
export function* hodnotySOddelovacom(data: unknown, cesta: Array<string | number> = []): Generator<[Array<string | number>, string]> {
  if (Array.isArray(data)) {
    for (const [i, v] of data.entries()) yield* hodnotySOddelovacom(v, [...cesta, i]);
  } else if (obj(data)) {
    for (const [k, v] of Object.entries(data as M)) if (!PROZA_KLUCE.has(k)) yield* hodnotySOddelovacom(v, [...cesta, k]);
  } else if (typeof data === "string" && data.includes("·")) yield [cesta, data];
}

/** `cykly`: všetky jednoduché cykly malého orientovaného grafu (prvý uzol na konci zopakovaný). */
export function cykly(hrany: Map<string, Set<string>>): string[][] {
  const najdene: string[][] = [];
  const videne = new Set<string>();
  const rovnake = (a: string[], b: string[]) => {
    const sa = new Set(a);
    const sb = new Set(b);
    return sa.size === sb.size && [...sa].every((x) => sb.has(x));
  };
  const dfs = (uzol: string, cesta: string[], naCeste: Set<string>) => {
    for (const dalsi of zorad(hrany.get(uzol) ?? [])) {
      if (naCeste.has(dalsi)) {
        const cyklus = [...cesta.slice(cesta.indexOf(dalsi)), dalsi];
        if (!najdene.some((c) => rovnake(cyklus, c))) najdene.push(cyklus);
        continue;
      }
      if (videne.has(dalsi)) continue;
      videne.add(dalsi);
      dfs(dalsi, [...cesta, dalsi], new Set([...naCeste, dalsi]));
    }
  };
  for (const uzol of zorad(hrany.keys())) {
    if (!videne.has(uzol)) {
      videne.add(uzol);
      dfs(uzol, [uzol], new Set([uzol]));
    }
  }
  return najdene;
}

const VELKE = "A-ZÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ";
/** `je_sloveso_podstatne` (A12): aspoň dve veľké písmená. */
export const jeSlovesoPodstatne = (text: string) => (text.match(new RegExp(`[${VELKE}]`, "g")) ?? []).length >= 2;

/**
 * `platny_regex`: text chyby, keď `vzor` nie je platný regex Pythonu (`re.compile`), inak null. JS RegExp sa na to
 * nehodí (Python pozná `(?i)`, `a++`, `[]a]`, JS nie), preto je tu skener tvaru Pythonu pre chyby, ktoré `re`
 * hlási najčastejšie; text chyby je ako `re.error` (orákulum `__fixtures__/validator-orakulum.json`).
 */
export function platnyRegex(vzor: string): string | null {
  const ZNAME = new Set([..."AbBdDsSwWZafnrtvx0123456789uUN"]);
  const TRIEDY = new Set([..."dDsSwW"]);
  const zatvorky: number[] = [];
  // stav predchádzajúceho tokenu: "nic" (začiatok, `(`, `|`), "atom", "kvant" (kvantifikátor), "kvant2" (s `?`/`+`)
  let pred: "nic" | "atom" | "kvant" | "kvant2" = "nic";
  const kvantifikator = (i: number): string | null => {
    if (pred === "nic") return `nothing to repeat at position ${i}`;
    if (pred === "kvant2") return `multiple repeat at position ${i}`;
    return null;
  };
  for (let i = 0; i < vzor.length; i++) {
    const c = vzor[i];
    if (c === "\\") {
      if (i === vzor.length - 1) return `bad escape (end of pattern) at position ${i}`;
      const e = vzor[i + 1];
      if (/[A-Za-z]/.test(e) && !ZNAME.has(e)) return `bad escape \\${e} at position ${i}`;
      i++;
      pred = "atom";
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      if (vzor[j] === "^") j++;
      if (vzor[j] === "]") j++;
      while (j < vzor.length && vzor[j] !== "]") {
        const zac = j;
        const lo = vzor[j] === "\\" ? vzor.slice(j, j + 2) : vzor[j];
        j += lo.length;
        if (vzor[j] === "-" && j + 1 < vzor.length && vzor[j + 1] !== "]") {
          const hi = vzor[j + 1] === "\\" ? vzor.slice(j + 1, j + 3) : vzor[j + 1];
          const koniec = j + 1 + hi.length;
          const trieda = (t: string) => t.length === 2 && TRIEDY.has(t[1]);
          const kod = (t: string) => (t.length === 2 ? t.codePointAt(1)! : t.codePointAt(0)!);
          if (trieda(lo) || trieda(hi) || kod(lo) > kod(hi)) return `bad character range ${vzor.slice(zac, koniec)} at position ${zac}`;
          j = koniec;
        }
      }
      if (j >= vzor.length) return `unterminated character set at position ${i}`;
      i = j;
      pred = "atom";
      continue;
    }
    if (c === "(") {
      const f = /^\(\?[aiLmsux]+\)/.exec(vzor.slice(i));
      if (f) {
        if (i !== 0) return `global flags not at the start of the expression at position ${i}`;
        i += f[0].length - 1;
        continue;
      }
      // rozšírenia skupiny: (?P=x) a (?#...) sú celé, ostatné otvoria skupinu
      const r = /^\(\?(?:P=\w+\)|#[^)]*\)|P<\w+>|<=|<!|<\w+>|[:=!>]|[aiLmsux-]+:)/u.exec(vzor.slice(i));
      if (r && r[0].endsWith(")")) {
        i += r[0].length - 1;
        pred = "atom";
        continue;
      }
      zatvorky.push(i);
      if (r) i += r[0].length - 1;
      pred = "nic";
      continue;
    }
    if (c === ")") {
      if (!zatvorky.length) return `unbalanced parenthesis at position ${i}`;
      zatvorky.pop();
      pred = "atom";
      continue;
    }
    if (c === "|") {
      pred = "nic";
      continue;
    }
    if (c === "*" || c === "+" || c === "?") {
      if (pred === "kvant" && c !== "*") {
        pred = "kvant2";
        continue;
      }
      const ch = kvantifikator(i);
      if (ch) return ch;
      if (pred === "kvant") return `multiple repeat at position ${i}`;
      pred = "kvant";
      continue;
    }
    if (c === "{") {
      const m = /^\{(\d*)(?:,(\d*))?\}/.exec(vzor.slice(i));
      if (m && (m[1] !== "" || m[2] !== undefined)) {
        const ch = kvantifikator(i);
        if (ch) return ch;
        if (pred === "kvant") return `multiple repeat at position ${i}`;
        if (m[1] !== "" && m[2] !== undefined && m[2] !== "" && Number(m[1]) > Number(m[2])) return `min repeat greater than max repeat at position ${i + 1}`;
        i += m[0].length - 1;
        pred = "kvant";
        continue;
      }
    }
    pred = "atom";
  }
  if (zatvorky.length) return `missing ), unterminated subpattern at position ${zatvorky[zatvorky.length - 1]}`;
  return null;
}

// ------------------------------------------------------------------------------------------------ kontext

/** `riadok_pola`: 1-based riadok cesty poľa v súbore, nech pole žije v ktoromkoľvek nositeľovi. */
export function fieldRow(n: Note, cesta: Array<string | number>): number | null {
  if (!cesta.length) return null;
  const top = String(cesta[0]);
  const fm = n.dokument.frontmatter;
  if (n.zdroje[top] === "frontmatter" && fm) {
    const r = rowForPointer(fm.yaml_text, cesta);
    return r !== null ? fm.riadok + 1 + r + 1 : null;
  }
  if (top in n.riadky) return n.riadky[top] + 1;
  return null;
}

/** `riadok_pod_zaznamu`: 1-based riadok v YAML bloku pod-záznamu. */
export function subRecordRow(pz: PodZaznam, cesta: Array<string | number>): number {
  const r = cesta.length ? rowForPointer(pz.blok.yaml_text, cesta) : null;
  return pz.blok.riadok + 1 + (r !== null ? r + 1 : 1);
}

type Cesta = Array<string | number>;

export class Kontext {
  kod = "";
  uroven: Uroven = "E";
  constructor(
    public k: Library,
    public preflight = false,
  ) {}

  diag(n: Note, sprava: string, cesta: Cesta = [], uroven?: Uroven): Diagnostic {
    return { note_id: noteId(n), json_pointer: cesta.length ? `/${cesta.join("/")}` : "", uroven: uroven ?? this.uroven, kod: this.kod, sprava, subor: n.rel, riadok: fieldRow(n, cesta) };
  }

  diagPod(n: Note, pz: PodZaznam, sprava: string, cesta: Cesta = [], uroven?: Uroven): Diagnostic {
    return { note_id: noteId(n), json_pointer: `#${pz.id}${cesta.length ? `/${cesta.join("/")}` : ""}`, uroven: uroven ?? this.uroven, kod: this.kod, sprava, subor: n.rel, riadok: subRecordRow(pz, cesta) };
  }

  /** Načítané poznámky daných typov s typovaným modelom, ako [poznámka, model]. */
  typu(...typy: string[]): Array<[Note, M]> {
    return this.k.vsetky.filter((n) => typy.includes(noteType(n) ?? "") && n.model !== null).map((n) => [n, n.model as M]);
  }

  /** Pod-záznamy druhu, ako [rodič, pod-záznam, model]. */
  pod(druh: string): Array<[Note, PodZaznam, M]> {
    const out: Array<[Note, PodZaznam, M]> = [];
    for (const n of this.k.vsetky) for (const pz of n.pod_zaznamy) if (pz.druh === druh && pz.model !== null) out.push([n, pz, pz.model as M]);
    return out;
  }

  poznamka(id: string | null | undefined): Note | null {
    return id ? (this.k.poznamky.get(id) ?? null) : null;
  }

  model(id: string | null | undefined): M | null {
    return (this.poznamka(id)?.model as M | undefined) ?? null;
  }

  /** Typ cieľa odkazu vrátane pod-záznamov (pravidlo STD -> STD, profil GEO -> GEO). */
  typCiela(l: Link | null): string | null {
    if (!l) return null;
    const n = this.k.poznamky.get(l.ciel);
    if (n) return noteType(n);
    const pz = this.k.globalne_pod.get(l.ciel);
    if (pz) return pz.druh === "profil" ? "GEO" : "STD";
    return null;
  }

  /** Pod-záznam, na ktorý odkaz mieri (holý `[[STD-CL-04]]` alebo s kotvou `[[STD-x#id]]`). */
  podZaznamCiela(l: Link | null): PodZaznam | null {
    if (!l) return null;
    if (l.kotva) return this.k.pod_zaznamy.get(`${l.ciel}\u0000${l.kotva}`) ?? null;
    return this.k.globalne_pod.get(l.ciel) ?? null;
  }

  vrstva(n: Note): string {
    return n.umiestnenie ? n.umiestnenie.vrstva : "zadanie";
  }
}
