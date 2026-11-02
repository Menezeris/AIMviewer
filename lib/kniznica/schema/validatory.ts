import { z } from "zod";

/**
 * Validátory schémy knižnice, ktoré JSON Schema nenesie (port pydantic `field_validator` / `model_validator`,
 * D-186 krok 2). `modely.ts` volá `doplnValidator` pri každej definícii a každom modeli; JSON Schema ostáva
 * vstupná strana (`io: "input"`), takže validátory a odvodené polia tvar exportu nemenia.
 *
 * Výstup parsovania = `model_dump(mode="json")` pydanticu: mená atribútov (nie aliasy), odvodené polia dopočítané.
 */

type Obj = Record<string, unknown>;
type Uprava = (s: z.ZodType) => z.ZodType;

/** Pravdivosť ako v Pythone (`if self.hodnoty`): prázdny zoznam, "" a null sú nepravda. */
const pravda = (v: unknown) => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0));

const chyba = (ctx: z.RefinementCtx, message: string) => ctx.addIssue({ code: "custom", message });

/** `_hodnoty_xor` (§16.15). */
const xor = (a: string, b: string, sprava: string): Uprava => (s) =>
  s.superRefine((v, ctx) => {
    const o = v as Obj;
    if (pravda(o[a]) && pravda(o[b])) chyba(ctx, sprava);
  });

const facetXor = xor("hodnoty", "hodnoty_ref", "`hodnoty` a `hodnoty_ref` sa vylučujú (§16.15)");

/** Hlavička poznámky (`assetin/schema/base.py`): `verzia` z čísla na text, `typ` musí sedieť s modelom. */
function hlavicka(typ: string): Uprava {
  return (s) =>
    z.preprocess((v) => {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as Obj).verzia === "number") {
        return { ...(v as Obj), verzia: pyStr((v as Obj).verzia as number) };
      }
      return v;
    }, s.superRefine((v, ctx) => {
      const t = (v as Obj).typ;
      if (t !== typ) ctx.addIssue({ code: "custom", path: ["typ"], message: `typ ${pyRepr(t)} nesedí s modelom ${pyRepr(typ)}` });
    }));
}

/**
 * `str()` čísla v Pythone. Známa medzera: YAML `1.0` je v Pythone float ("1.0"), `js-yaml` ho dá ako 1 ("1");
 * v korpuse sa nevyskytuje (verzie sú `0.1`), loader v kroku 2 to rozlíši z textu bloku.
 */
export const pyStr = (n: number): string => String(n);

const pyRepr = (v: unknown) => (typeof v === "string" ? `'${v}'` : String(v));

const VALIDATORY: Record<string, Uprava> = {
  FacetAttribute: facetXor,
  FacetClassification: facetXor,
  FacetProperty: facetXor,
  FacetMaterial: facetXor,
  PravidloSTD: xor("hodnoty", "zdroj_hodnot", "`hodnoty` a `zdroj_hodnot` sa vylučujú (§16.14)"),
  // ER prepis: hodnoty xor slovník, polozka alebo geometria.profil; atribút pydantic je `geometria_profil`
  Prepis: (s) =>
    s
      .superRefine((v, ctx) => {
        const o = v as Obj;
        if (pravda(o.hodnoty) && pravda(o.hodnoty_ref)) chyba(ctx, "`hodnoty` a `hodnoty_ref` sa vylučujú");
        if ((o.polozka ?? null) === null && (o["geometria.profil"] ?? null) === null) chyba(ctx, "prepis potrebuje `polozka` alebo `geometria.profil`");
      })
      .transform((v) => {
        const { "geometria.profil": g, ...rest } = v as Obj;
        return { ...rest, geometria_profil: g ?? null };
      }),
  // IU-O položka: práve jedno z ifc / prop
  Polozka: (s) =>
    s.superRefine((v, ctx) => {
      const o = v as Obj;
      if (((o.ifc ?? null) === null) === ((o.prop ?? null) === null)) chyba(ctx, "položka má práve jedno z `ifc` / `prop`");
      if (pravda(o.hodnoty) && pravda(o.hodnoty_ref)) chyba(ctx, "`hodnoty` a `hodnoty_ref` sa vylučujú (§16.15)");
    }),
  // odvodené typy požiadavky (V21)
  IU_C: (s) => hlavicka("IU-C")(s.transform((v) => ({ ...(v as Obj), typ_poziadavky: (v as Obj).druh === "dokument" ? "E" : "C" }))),
  IU_O: (s) =>
    hlavicka("IU-O")(
      s.transform((v) => {
        const o = v as Obj;
        const t: string[] = [];
        if (pravda(o.alfanumerika)) t.push("D1");
        if ((o.geometria ?? null) !== null) t.push("D2");
        if (pravda(o.dokumentacia)) t.push("D3");
        return { ...o, typ_poziadavky: t };
      }),
    ),
};
for (const typ of ["GOAL", "UC", "ER", "STD", "PROP", "DEF", "EV", "ACT", "PROT", "PROJ"]) VALIDATORY[typ] = hlavicka(typ);

export function doplnValidator<T extends z.ZodType>(meno: string, schema: T): T {
  const v = VALIDATORY[meno];
  return (v ? v(schema) : schema) as T;
}
