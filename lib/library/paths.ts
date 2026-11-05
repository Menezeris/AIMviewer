/**
 * PathScheme knižnice (port `assetin/schema/cesty.py`, D-186 krok 2b): jediné miesto, kde sa rozhoduje
 * ID <-> cesta súboru: `rozober` (loader) a `cestaPre` (writer, nová poznámka, premenovanie).
 */

export const VRSTVY = ["zadanie", "aktiva", "projekty"] as const;

/** Priečinok -> typ v organizačnej vrstve (SCHEMA §15). */
export const PRIECINKY: Record<string, string> = {
  GOAL: "GOAL",
  UC: "UC",
  ER: "ER",
  "IU-O": "IU-O",
  "IU-C": "IU-C",
  STD: "STD",
  PROT: "PROT",
  "registre/DEF": "DEF",
  "registre/EV": "EV",
  "registre/ACT": "ACT",
  "registre/PROP": "PROP",
};

/** Prefix ID -> typ (kde priečinok nestačí: `aktiva/`, `projekty/`). */
export const PREFIXY: Record<string, string> = {
  "IU-O": "IU-O",
  "IU-C": "IU-C",
  GOAL: "GOAL",
  UC: "UC",
  ER: "ER",
  STD: "STD",
  PROP: "PROP",
  DEF: "DEF",
  EV: "EV",
  ACT: "ACT",
  PROT: "PROT",
  PROJ: "PROJ",
};

export interface Umiestnenie {
  vrstva: string;
  typ: string;
  id: string;
  nazov_zo_suboru: string | null;
  balik: string | null;
  act_uroven: string | null;
  act_strana: string | null;
}

export class PathError extends Error {}

function typZPrefixu(token: string): string | null {
  for (const p of Object.keys(PREFIXY).sort((a, b) => b.length - a.length)) {
    if (token === p || token.startsWith(`${p}-`)) return PREFIXY[p];
  }
  return null;
}

const um = (vrstva: string, typ: string, id: string, nazov: string | null, balik: string | null, uroven: string | null = null, strana: string | null = null): Umiestnenie => ({
  vrstva,
  typ,
  id,
  nazov_zo_suboru: nazov,
  balik,
  act_uroven: uroven,
  act_strana: strana,
});

/** Rozbor cesty relatívnej ku koreňu knižnice na vrstvu, typ a ID. */
export function rozober(rel: string): Umiestnenie {
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  const meno = parts[parts.length - 1] ?? "";
  if (parts.length < 2 || !(VRSTVY as readonly string[]).includes(parts[0]) || !meno.endsWith(".md") || meno === ".md") {
    throw new PathError(`cesta mimo vrstiev ('zadanie', 'aktiva', 'projekty'): ${rel}`);
  }
  const vrstva = parts[0];
  const stem = meno.slice(0, -3);
  const sp = stem.indexOf(" ");
  const token = sp >= 0 ? stem.slice(0, sp) : stem;
  const nazov = sp >= 0 && stem.slice(sp + 1) ? stem.slice(sp + 1) : null;

  let balik: string | null = null;
  let sub: string[];
  if (vrstva === "zadanie") sub = parts.slice(1, -1);
  else {
    if (parts.length < 3) throw new PathError(`${vrstva}/ vyžaduje <balík>/: ${rel}`);
    balik = parts[1];
    sub = parts.slice(2, -1);
  }

  if (sub.length >= 2 && sub[0] === "registre" && sub[1] === "ACT") {
    const segs = sub.slice(2);
    if (segs.length === 0) throw new PathError(`ACT bez strany: ${rel}`);
    let uroven: string;
    if (stem === segs[segs.length - 1]) uroven = segs.length === 1 ? "strana" : "tim";
    else {
      segs.push(stem);
      uroven = "funkcia";
    }
    if (stem.includes(" ")) throw new PathError(`ACT súbor nemá mať názov za ID: ${rel}`);
    return um(vrstva, "ACT", `ACT-${segs.join("/")}`, null, balik, uroven, segs[0]);
  }

  let typ: string | null = null;
  if (sub.length) typ = PRIECINKY[sub.slice(0, 2).join("/")] ?? PRIECINKY[sub[0]] ?? null;
  typ ??= typZPrefixu(token);
  if (typ === null) throw new PathError(`nedá sa určiť typ z cesty: ${rel}`);
  if (typ === "STD" && stem === "STD") return um(vrstva, "STD", "STD", null, balik);
  return um(vrstva, typ, token, nazov, balik);
}

/** Typ -> pevný priečinok v `zadanie/`. */
export const PRIECINOK_PRE_TYP: Record<string, string> = Object.fromEntries(Object.entries(PRIECINKY).map(([k, v]) => [v, k]));

/** Časť `nazov`, ktorá smie byť v mene súboru: zakázané znaky = medzera, medzery zlúčené, bez bodky na konci. */
export function nameToFile(nazov: string | null | undefined): string {
  if (!nazov) return "";
  let t = nazov.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ");
  t = t.replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim();
  return t;
}

export const fileName = (id: string, nazov: string | null | undefined) => {
  const c = nameToFile(nazov);
  return c ? `${id} ${c}` : id;
};

/** Meno súboru nesie `nazov` (ACT a index `STD.md` nie). */
export const renamable = (typ: string, id: string) => typ !== "ACT" && !(typ === "STD" && id === "STD");

/** Opak `rozober`: kam patrí poznámka s týmto ID. */
export function pathFor(typ: string, id: string, nazov: string | null, vrstva = "zadanie", balik: string | null = null, uroven: string | null = null): string {
  if (!(VRSTVY as readonly string[]).includes(vrstva)) throw new PathError(`neznáma vrstva '${vrstva}'`);
  const koren = vrstva === "zadanie" ? vrstva : `${vrstva}/${balik ?? ""}`;
  if (typ === "ACT") {
    if (!id.startsWith("ACT-")) throw new PathError(`ACT id musí začínať 'ACT-': ${id}`);
    const segs = id.slice(4).split("/");
    const u = uroven ?? (segs.length === 1 ? "strana" : "funkcia");
    const base = `${koren}/registre/ACT`;
    if (u === "strana" || u === "tim") return `${base}/${segs.join("/")}/${segs[segs.length - 1]}.md`;
    return `${base}/${[...segs.slice(0, -1), `${segs[segs.length - 1]}.md`].join("/")}`;
  }
  if (typ === "STD" && id === "STD") return `${koren}/STD/STD.md`;
  const subor = `${fileName(id, nazov)}.md`;
  if (vrstva === "zadanie") {
    const pr = PRIECINOK_PRE_TYP[typ];
    if (!pr) throw new PathError(`'${typ}'`);
    return `${koren}/${pr}/${subor}`;
  }
  return `${koren}/${subor}`;
}

export const typZPrefixuId = (id: string) => typZPrefixu(id);
