/**
 * Kontrola IDS proti ids.xsd pri vydaní (D-186 krok 6, rozhodnutie (d) = variant A, Samuel 2. 11.): libxml2 ako
 * WebAssembly (`xmllint-wasm`, MIT) vo funkcii vydania. IDS, ktoré neprejde, zastaví vydanie a nič sa nezapíše.
 *
 * `ids.xsd` je buildingSMART (CC BY-ND 4.0) a W3C schémy, ktoré importuje (`XMLSchema.xsd` s DTD, `xml.xsd`), sa
 * do repa nekomitujú (assetin-library PLAN R8): funkcia ich stiahne z pinnutých adries, overí sha256 a drží v pamäti
 * inštancie. Bez siete alebo pri inom obsahu sa vydanie zastaví (prísnejšie ako Python, ktorý hlási "neoverené").
 * Importy sa v pamäti presmerujú na stiahnuté súbory, lebo libxml2 vo wasm na sieť nesiaha.
 */

import { createHash } from "node:crypto";

export const IDS_TAG = "v1.0.0";

interface Subor {
  meno: string;
  url: string;
  sha256: string;
  presmeruj?: (text: string) => string;
}

/** Pinnuté zdroje; sha256 stráži, že sa obsah nezmenil potichu. */
export const SCHEMY: Subor[] = [
  {
    meno: "ids.xsd",
    // tag v1.0.0 (commit 1effec6) má schému v Development/; od master sa líši len odkazmi v dokumentácii
    url: `https://raw.githubusercontent.com/buildingSMART/IDS/${IDS_TAG}/Development/ids.xsd`,
    sha256: "8975dc18bd18f08a345a430a22bf317a54d94671b7db01400042fa43b6c0d1f3",
    presmeruj: (t) =>
      t
        .replace('schemaLocation="http://www.w3.org/2001/xml.xsd"', 'schemaLocation="xml.xsd"')
        .replace('schemaLocation="http://www.w3.org/2001/XMLSchema.xsd"', 'schemaLocation="XMLSchema.xsd"')
        // xsi libxml2 pozná sám; import by viedol na neexistujúci súbor
        .replace(/[ \t]*<xs:import namespace="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"[^>]*\/>\r?\n?/, ""),
  },
  {
    meno: "XMLSchema.xsd",
    url: "https://www.w3.org/2001/XMLSchema.xsd",
    sha256: "e767a159c179bd6e4dc2bac2a63a62f50cbd027ec19d6b5cc9eb1c2f33e0cb2e",
    presmeruj: (t) => t.replace('schemaLocation="http://www.w3.org/2001/xml.xsd"', 'schemaLocation="xml.xsd"'),
  },
  { meno: "XMLSchema.dtd", url: "https://www.w3.org/2001/XMLSchema.dtd", sha256: "2032ead9fd47a61b22fe56aa02be1840bd9bb9015b0c0d3f1e8aac75dd91c3b9" },
  { meno: "datatypes.dtd", url: "https://www.w3.org/2001/datatypes.dtd", sha256: "6946432ca7af2e9584f91b48564111fd2c73c8debbbcd9a0e3f5ddd382eeb51c" },
  { meno: "xml.xsd", url: "https://www.w3.org/2001/xml.xsd", sha256: "61960fb3131e38022caad5360e2f33a3382578ab3c80cd58bd74320ede61b20c" },
];

export class ChybaXsd extends Error {}

export type Stahovac = (url: string) => Promise<Uint8Array>;

const predvolenyStahovac: Stahovac = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "aimviewer-kniznica (D-186)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

let cache: Array<{ fileName: string; contents: string }> | null = null;

/** Stiahne a overí schémy (raz na inštanciu); pri chybe hodí `ChybaXsd`. */
export async function nacitajSchemy(stahuj: Stahovac = predvolenyStahovac, pouziCache = true) {
  if (pouziCache && cache) return cache;
  const out: Array<{ fileName: string; contents: string }> = [];
  for (const s of SCHEMY) {
    let data: Uint8Array;
    try {
      data = await stahuj(s.url);
    } catch (e) {
      throw new ChybaXsd(`${s.meno} sa nedá stiahnuť z ${s.url} (${e instanceof Error ? e.message : String(e)}) - bez kontroly XSD sa nevydáva`);
    }
    const sha = createHash("sha256").update(data).digest("hex");
    if (sha !== s.sha256) throw new ChybaXsd(`${s.meno} z ${s.url} má sha256 ${sha}, očakávané ${s.sha256} - zdroj sa zmenil, over a uprav pin`);
    const text = new TextDecoder().decode(data);
    out.push({ fileName: s.meno, contents: s.presmeruj ? s.presmeruj(text) : text });
  }
  if (pouziCache) cache = out;
  return out;
}

/** `over_xsd`: chyby IDS proti ids.xsd, `[]` keď je platné. Schémy sa nedajú načítať = `ChybaXsd`. */
export async function overXsd(xml: string, stahuj?: Stahovac): Promise<string[]> {
  const schemy = await nacitajSchemy(stahuj);
  const { validateXML } = await import("xmllint-wasm");
  const r = await validateXML({
    xml: [{ fileName: "ids.ids", contents: xml }],
    schema: [schemy[0]],
    preload: schemy.slice(1),
  });
  return r.valid ? [] : r.errors.map((e) => e.message);
}
