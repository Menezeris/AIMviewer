import { z } from "zod";

/**
 * Pomocné typy schémy knižnice (D-186 krok 2), ktoré v zod nemajú presný tvar JSON Schema z pydantic:
 * `jsonSchema.ts` ich podľa značiek vypíše ako pydantic (bez vzoru dátumu, bez rozsahu celého čísla, `oneOf`).
 */

/** `WikiLink` z `assetin/schema/spolocne.py`: `[[ciel]]`, `[[ciel#kotva]]`, `[[ciel|alias]]`. */
export const WIKILINK_PATTERN = "^\\[\\[[^\\[\\]]+\\]\\]$";
export const wikilink = () => z.string().regex(new RegExp(WIKILINK_PATTERN)).meta({ "x-assetin": { widget: "wikilink" } });

/** Značky pre `jsonSchema.ts`. */
export const ZNACKA = { datum: new WeakSet<z.ZodType>(), cele: new WeakSet<z.ZodType>(), oneOf: new WeakSet<z.ZodType>(), slovnik: new WeakSet<z.ZodType>(), odkaz: new WeakMap<z.ZodType, Record<string, unknown>>() };

/** `datetime.date`: YAML ho dá ako `YYYY-MM-DD` (blokový parser), JSON Schema `format: date`. */
export function datum() {
  const s = z.iso.date();
  ZNACKA.datum.add(s);
  return s;
}

/** `int` (pydantic `integer` bez rozsahu). */
export function celeCislo() {
  const s = z.int();
  ZNACKA.cele.add(s);
  return s;
}

/** Únia bez diskriminačného poľa (pydantic `Discriminator(callable)`), JSON Schema `oneOf`. */
export function oneOf<T extends readonly [z.ZodType, z.ZodType, ...z.ZodType[]]>(options: T) {
  const s = z.union(options);
  ZNACKA.oneOf.add(s);
  return s;
}

/** `dict[str, X]`: JSON Schema `type: object` + `additionalProperties` (bez `propertyNames`; `Any` = true). */
export function slovnik<T extends z.ZodType>(hodnota: T) {
  const s = z.record(z.string(), hodnota);
  ZNACKA.slovnik.add(s);
  return s;
}

/** Pole s typom definície (`$ref`) a vlastnými kľúčmi: JSON Schema nesie len kľúče poľa, nie title definície. */
export function odkaz<T extends z.ZodType>(def: T, predvolene: unknown, meta: Record<string, unknown>) {
  const s = (predvolene === undefined ? def : def.default(predvolene as never)).meta(meta);
  ZNACKA.odkaz.set(s, meta);
  return s;
}
