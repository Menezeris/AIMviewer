import { z } from "zod";

import { ZNACKA } from "./pomocky";

/**
 * JSON Schema zo zod schémy knižnice v tvare pydantic (`assetin schema export`, korpus `schema/*.json`):
 * draft 2020-12, `$defs` podľa `id` z `.meta`, `default` zo vstupu, bez `id` v definíciách, `format: date` bez vzoru,
 * celé číslo bez rozsahu, diskriminovaná únia ako `oneOf` s `discriminator.mapping`.
 */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
    override: (ctx) => {
      const js = ctx.jsonSchema as Record<string, unknown>;
      const zs = ctx.zodSchema as unknown as z.ZodType;
      delete js.id;
      const vlastne = ZNACKA.odkaz.get(zs);
      if (vlastne) for (const k of ["title", "description"]) if (!(k in vlastne)) delete js[k];
      if (ZNACKA.datum.has(zs)) delete js.pattern;
      if (ZNACKA.cele.has(zs)) {
        delete js.minimum;
        delete js.maximum;
      }
      if (ZNACKA.slovnik.has(zs)) {
        delete js.propertyNames;
        const ap = js.additionalProperties as Record<string, unknown> | undefined;
        if (ap && Object.keys(ap).length === 0) js.additionalProperties = true;
      }
      if (ZNACKA.oneOf.has(zs) && Array.isArray(js.anyOf)) {
        js.oneOf = js.anyOf;
        delete js.anyOf;
      }
      const def = (zs as unknown as { _zod: { def: { type: string; discriminator?: string; options?: z.ZodType[]; defaultValue?: unknown } } })._zod.def;
      // default nad typom s transformáciou (validátor) zod vo vstupnom tvare vynechá; pydantic ho píše
      if (def.type === "default" && !("default" in js)) js.default = JSON.parse(JSON.stringify(def.defaultValue));
      if (def.type === "union" && def.discriminator && Array.isArray(js.anyOf ?? js.oneOf)) {
        const refs = (js.anyOf ?? js.oneOf) as Array<{ $ref?: string }>;
        const mapping: Record<string, string> = {};
        def.options!.forEach((o, i) => {
          const shape = (o as unknown as { shape: Record<string, { value?: unknown }> }).shape;
          const v = shape[def.discriminator!]?.value;
          if (typeof v === "string" && refs[i]?.$ref) mapping[v] = refs[i].$ref!;
        });
        js.oneOf = refs;
        delete js.anyOf;
        js.discriminator = { mapping, propertyName: def.discriminator };
      }
    },
  }) as Record<string, unknown>;
  // `id` z `.meta` určuje meno v `$defs`, pydantic ho v definícii nemá
  for (const d of Object.values((out.$defs ?? {}) as Record<string, Record<string, unknown>>)) delete d.id;
  return out;
}
