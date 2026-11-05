/**
 * One-off port tool (D-186 step 2): from the JSON Schema corpus (`library/korpus/schema/*.json`, produced
 * from the pydantic models of assetin-library) it prints the zod source `lib/kniznica/schema/modely.ts`.
 *
 * Since the port the output is the source of truth of the schema in TS and is edited by hand; validators that JSON Schema does not carry
 * (pydantic `field_validator` / `model_validator`) are in `lib/kniznica/schema/validatory.ts`. The generator is run
 * again only when the schema changes in Python during the port (changes only at once in both engines) and the conformance test
 * `lib/kniznica/schema/schema.test.ts` tells whether the result fits.
 *
 * Usage: `npx tsx scripts/kniznica/zod-zo-schem.ts`
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type J = Record<string, unknown>;

const DIR = join(process.cwd(), "library", "korpus", "schema");
/** Field order of pydantic (`model_fields`) per class; the corpus JSON Schema has sorted keys. A one-off dump from Python. */
const PORADIE = JSON.parse(readFileSync(join(process.cwd(), "scripts", "kniznica", "poradie-poli.json"), "utf8")) as Record<string, string[]>;
const OUT = join(process.cwd(), "lib", "kniznica", "schema", "modely.ts");
const WIKILINK_PATTERN = "^\\[\\[[^\\[\\]]+\\]\\]$";
const META_KEYS = ["title", "description", "x-assetin"] as const;

const lit = (v: unknown) => JSON.stringify(v);
const ident = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_");
const refName = (ref: string) => ident(ref.replace("#/$defs/", ""));

function meta(n: J, extra: J = {}): string {
  const m: J = { ...extra };
  for (const k of META_KEYS) if (k in n) m[k] = n[k];
  return Object.keys(m).length ? `.meta(${lit(m)})` : "";
}

function isWikilink(n: J) {
  return n.type === "string" && n.pattern === WIKILINK_PATTERN && JSON.stringify(n["x-assetin"]) === JSON.stringify({ widget: "wikilink" });
}

/** The zod expression for a node; `withMeta` = add the title / description / x-assetin and the default of the node. */
function expr(n: J, withMeta = true): string {
  let e = base(n);
  if (withMeta) {
    if ("default" in n) e += `.default(${lit(n.default)})`;
    if (typeof n.$ref === "string" && Object.keys(n).length > 1) {
      // `$ref` with the field's own keys: pydantic does not inherit the title / description of the definition
      const m: J = {};
      for (const k of META_KEYS) if (k in n) m[k] = n[k];
      e = `odkaz(${refName(n.$ref)}${"default" in n ? `, ${lit(n.default)}` : ", undefined"}, ${lit(m)})`;
    } else if (!isWikilink(n)) e += meta(n);
  }
  return e;
}

function base(n: J): string {
  if (isWikilink(n)) return "wikilink()";
  if (typeof n.$ref === "string") return refName(n.$ref);
  if (Array.isArray(n.anyOf)) return `z.union([${(n.anyOf as J[]).map((x) => expr(x)).join(", ")}])`;
  if (Array.isArray(n.oneOf)) {
    const refs = (n.oneOf as J[]).map((x) => expr(x));
    const d = n.discriminator as { propertyName: string } | undefined;
    return d ? `z.discriminatedUnion(${lit(d.propertyName)}, [${refs.join(", ")}])` : `oneOf([${refs.join(", ")}])`;
  }
  if (Array.isArray(n.enum)) return `z.enum(${lit(n.enum)})`;
  if ("const" in n) return `z.literal(${lit(n.const)})`;
  switch (n.type) {
    case "string": {
      if (n.format === "date") return "datum()";
      let e = "z.string()";
      if (typeof n.pattern === "string") e += `.regex(new RegExp(${lit(n.pattern)}))`;
      if (typeof n.minLength === "number") e += `.min(${n.minLength})`;
      return e;
    }
    case "number":
      return "z.number()";
    case "integer":
      return "celeCislo()";
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array": {
      let e = `z.array(${n.items ? expr(n.items as J) : "z.unknown()"})`;
      if (typeof n.minItems === "number") e += `.min(${n.minItems})`;
      return e;
    }
    case "object":
      return objekt(n);
  }
  if (Object.keys(n).every((k) => (META_KEYS as readonly string[]).includes(k) || k === "default")) return "z.unknown()";
  throw new Error(`neznámy uzol JSON Schema: ${JSON.stringify(n).slice(0, 200)}`);
}

function objekt(n: J): string {
  const trieda = typeof n.title === "string" ? PORADIE[n.title] : undefined;
  if (n.properties === undefined && n.additionalProperties !== undefined && n.additionalProperties !== false) {
    // dict[str, X] / dict[str, Any]
    return n.additionalProperties === true ? "slovnik(z.unknown())" : `slovnik(${expr(n.additionalProperties as J)})`;
  }
  const props = (n.properties ?? {}) as Record<string, J>;
  const req = new Set((n.required as string[] | undefined) ?? []);
  // pydantic keeps the field order only in `required` (the corpus has sorted keys): required first, in that order
  let keys = [...((n.required as string[] | undefined) ?? []), ...Object.keys(props).filter((k) => !req.has(k))];
  if (trieda && trieda.length === keys.length && keys.every((k) => trieda.includes(k))) keys = [...trieda];
  const rows = keys.map((k) => [k, props[k]] as const).map(([k, v]) => {
    let e = expr(v);
    if (!req.has(k) && !("default" in v)) e += ".optional()";
    return `    ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : lit(k)}: ${e},`;
  });
  const fn = n.additionalProperties === false ? "z.strictObject" : "z.object";
  if (n.additionalProperties !== false && n.additionalProperties !== undefined) throw new Error("additionalProperties iné než false");
  return `${fn}({\n${rows.join("\n")}\n  })`;
}

function deps(n: unknown, out: Set<string>) {
  if (Array.isArray(n)) n.forEach((x) => deps(x, out));
  else if (n && typeof n === "object") {
    for (const [k, v] of Object.entries(n)) {
      if (k === "$ref" && typeof v === "string") out.add(v.replace("#/$defs/", ""));
      else if (k !== "x-assetin" && k !== "mapping") deps(v, out);
    }
  }
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const roots: Array<{ file: string; name: string; schema: J }> = [];
const defs = new Map<string, J>();
for (const f of files) {
  const s = JSON.parse(readFileSync(join(DIR, f), "utf8")) as J;
  for (const [k, v] of Object.entries((s.$defs ?? {}) as Record<string, J>)) {
    const prev = defs.get(k);
    if (prev && JSON.stringify(prev) !== JSON.stringify(v)) throw new Error(`$defs ${k} sa líši medzi súbormi`);
    defs.set(k, v);
  }
  roots.push({ file: f.replace(/\.json$/, ""), name: String(s.title), schema: s });
}

// topological order of the definitions
const order: string[] = [];
const state = new Map<string, "visiting" | "done">();
const visit = (k: string) => {
  if (state.get(k) === "done") return;
  if (state.get(k) === "visiting") throw new Error(`cyklus v $defs pri ${k}`);
  state.set(k, "visiting");
  const d = new Set<string>();
  deps(defs.get(k), d);
  [...d].sort().forEach(visit);
  state.set(k, "done");
  order.push(k);
};
[...defs.keys()].sort().forEach(visit);

const out: string[] = [
  "/**",
  " * Schéma knižnice požiadaviek v zod (D-186 krok 2; port `assetin/schema`, schéma v1.5).",
  " *",
  " * Vznikla jednorazovo nástrojom `scripts/kniznica/zod-zo-schem.ts` z JSON Schema korpusu (pydantic) a odteraz je",
  " * pravdou schémy v TS: mení sa ručne a naraz s Pythonom, kým port trvá (assetin-library V30). Validátory, ktoré",
  " * JSON Schema nenesie, sú v `validatory.ts`; JSON Schema z tohto zdroja dáva `jsonSchema.ts`, zhodu s korpusom",
  " * stráži `schema.test.ts`.",
  " */",
  "",
  'import { z } from "zod";',
  "",
  'import { celeCislo, datum, odkaz, oneOf, slovnik, wikilink } from "./pomocky";',
  'import { doplnValidator } from "./validatory";',
  "",
  "// ---------------------------------------------------------------------------------------------- vnorené záznamy",
  "",
];
for (const k of order) {
  const n = defs.get(k)!;
  out.push(`export const ${ident(k)} = doplnValidator(${lit(k)}, ${expr(n, false)})${meta(n, { id: k })};`, "");
}
out.push("// ---------------------------------------------------------------------------------------------- typy poznámok a pod-záznamy", "");
for (const r of roots) {
  const { $defs, $schema, ...n } = r.schema;
  void $defs;
  void $schema;
  out.push(`export const ${ident(r.name)} = doplnValidator(${lit(r.name)}, ${expr(n, false)})${meta(n)};`, "");
}
out.push(
  "/** Súbor korpusu `schema/<kľúč>.json` -> model. */",
  "export const SCHEMY = {",
  ...roots.map((r) => `  ${lit(r.file)}: ${ident(r.name)},`),
  "} as const;",
  "",
);
writeFileSync(OUT, out.join("\n"));
console.log(`zapísané ${OUT}: ${order.length} definícií, ${roots.length} modelov`);
