#!/usr/bin/env node
// D-194 phase 6 preparation: catalogue of Slovak/Czech string literals still in code.
// Read-only. Prints a markdown report to stdout:
//   node scripts/d194_string_catalogue.mjs > docs/d194-phase6-catalogue.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "lib", "scripts", "etc"];
const EXCLUDE_DIRS = new Set(["node_modules", ".next", ".claude", "__fixtures__", "vendor"]);
const SELF = "scripts/d194_string_catalogue.mjs";
const MAX_LINES = 580;
const EXAMPLES_PER_FILE = 2;
const EXAMPLE_MAX = 100;

// A string "looks Slovak/Czech" if it has a diacritic or at least 2 common Slovak words.
const DIACRITIC = /[áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽěřůĚŘŮ]/;
const WORDS = new Set([
  "je", "sa", "nie", "pre", "ale", "alebo", "ako", "pri", "bez", "musi", "musí",
  "nebol", "nebola", "nebolo", "zlyhalo", "zlyhal", "chyba", "ktory", "ktorý",
  "ktore", "ktoré", "tiez", "tiež", "len", "ani", "aj", "ked", "keď", "ak",
  "lebo", "alebo", "nema", "nemá", "nenajdeny", "nenájdený", "neplatny",
  "neplatný", "vsetky", "všetky", "ziadny", "žiadny", "ziadne", "žiadne",
]);

function looksSlovak(text) {
  if (DIACRITIC.test(text)) return true;
  const words = text.toLowerCase().match(/[a-zá-žA-Ž]+/g) || [];
  let hits = 0;
  for (const w of words) if (WORDS.has(w)) hits++;
  return hits >= 2;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(path.join(dir, e.name));
    }
  }
}

function collect(file) {
  const src = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const add = (text) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && looksSlovak(t)) found.push(t);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node.text);
    else if (ts.isJsxText(node)) add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function classify(rel) {
  const base = path.posix.basename(rel);
  if (rel.startsWith("lib/llm/") || rel.startsWith("lib/mcp/") || rel.startsWith("app/api/mcp/")) return "AI";
  if (rel.startsWith("lib/engine/tool-defs")) return "AI";
  if (/^tools?[-.]/.test(base) || /^tools\.[a-z]+$/.test(base) || /tool-registry/.test(base)) return "AI";
  if (/-tools?\.(ts|tsx|mjs)$/.test(base)) return "AI";
  if (rel.startsWith("lib/feedback/") && /tool/.test(base)) return "AI";
  if (/MCP-TOOLS/i.test(base)) return "AI";
  if (rel.startsWith("components/") || (rel.startsWith("app/") && !rel.startsWith("app/api/mcp/"))) return "USER";
  if (rel.startsWith("scripts/") || rel.startsWith("etc/")) return "LOG/CLI";
  return "OTHER";
}

function area(rel) {
  const p = rel.split("/");
  if (p[0] === "lib") return p.length === 2 ? "lib (root files)" : `lib/${p[1]}`;
  if (p[0] === "app") return p[1] === "api" ? "app/api" : "app pages";
  return p[0];
}

// Normalise text for the report: ASCII punctuation only, no table-breaking characters.
function clean(s) {
  let t = s
    .replace(/[–—‒―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/\|/g, "/")
    .replace(/`/g, "'")
    .replace(/</g, "(");
  if (t.length > EXAMPLE_MAX) t = t.slice(0, EXAMPLE_MAX - 3) + "...";
  return t;
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
files.sort();

const rows = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  if (rel === SELF) continue;
  const strings = collect(f);
  if (strings.length === 0) continue;
  rows.push({ rel, area: area(rel), cls: classify(rel), count: strings.length, examples: strings.slice(0, EXAMPLES_PER_FILE) });
}

const areas = new Map();
for (const r of rows) {
  if (!areas.has(r.area)) areas.set(r.area, []);
  areas.get(r.area).push(r);
}
const sum = (rs) => rs.reduce((n, r) => n + r.count, 0);
const areaList = [...areas.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
const clsTotals = new Map();
for (const r of rows) clsTotals.set(r.cls, (clsTotals.get(r.cls) || 0) + r.count);

function render(cap) {
  const L = [];
  L.push("# D-194 phase 6: catalogue of Slovak strings in code");
  L.push("");
  L.push("Generated by `scripts/d194_string_catalogue.mjs` (read-only, uses the TypeScript parser). Regenerate with:");
  L.push("");
  L.push("```");
  L.push("node scripts/d194_string_catalogue.mjs > docs/d194-phase6-catalogue.md");
  L.push("```");
  L.push("");
  L.push("## Heuristic");
  L.push("");
  L.push("- Scanned: `.ts`, `.tsx`, `.mjs` under `app/`, `components/`, `lib/`, `scripts/`, `etc/` (if present).");
  L.push("- Excluded: `node_modules`, `.next`, `.claude`, `__fixtures__`, `vendor`, `*.test.ts(x)`, `*.d.ts`, and this script.");
  L.push("- Collected: string literals, template literal text chunks (each chunk on its own) and JSX text. Comments and import/export specifiers are ignored.");
  L.push("- A string counts as Slovak/Czech when it contains a diacritic from the Slovak/Czech set, or at least 2 words from a short list of common Slovak words (je, sa, nie, pre, ale, alebo, ako, pri, bez, musi, nebol, zlyhalo, ...). Slovak strings without diacritics and with fewer than 2 such words are not found, so counts are a lower bound.");
  L.push("- Classification per file (first match wins):");
  L.push("  - **AI**: reaches the AI assistant (system prompts, tool descriptions, tool results and errors): `lib/llm/**`, `lib/mcp/**`, `app/api/mcp/**`, `lib/engine/tool-defs*`, `**/tools*.ts`, `**/*-tools.ts`, tool-registry files, MCP-TOOLS sources, `lib/feedback/*tool*`.");
  L.push("  - **USER**: UI text shown to people: `components/**`, app pages, and `app/api/**` route messages returned to the browser.");
  L.push("  - **LOG/CLI**: console output of `scripts/**` (and `etc/**`).");
  L.push("  - **OTHER**: everything else (for example `lib/engine/**` outside tool-defs, `lib/viewer-*.ts`). These may still end up in AI or UI output indirectly and need a manual look in phase 6.");
  L.push("- Examples are the first 2 matching strings per file in source order, cut to 100 characters, with typographic punctuation normalised to ASCII.");
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push("| Area | Files | Strings |");
  L.push("|---|---:|---:|");
  for (const [a, rs] of areaList) L.push(`| ${a} | ${rs.length} | ${sum(rs)} |`);
  L.push(`| **Total** | **${rows.length}** | **${sum(rows)}** |`);
  L.push("");
  L.push("| Classification | Strings |");
  L.push("|---|---:|");
  for (const c of ["AI", "USER", "LOG/CLI", "OTHER"]) L.push(`| ${c} | ${clsTotals.get(c) || 0} |`);
  L.push("");
  L.push("## Data contract: do NOT translate");
  L.push("");
  L.push(DATA_CONTRACT.trim());
  L.push("");
  L.push("## Per area");
  for (const [a, rs] of areaList) {
    L.push("");
    L.push(`### ${a} (${rs.length} files, ${sum(rs)} strings)`);
    L.push("");
    L.push("| File | Class | Strings | Examples |");
    L.push("|---|---|---:|---|");
    const sorted = [...rs].sort((x, y) => y.count - x.count || x.rel.localeCompare(y.rel));
    const shown = sorted.slice(0, cap);
    for (const r of shown) {
      L.push(`| ${r.rel} | ${r.cls} | ${r.count} | ${r.examples.map((e) => `"${clean(e)}"`).join(" / ")} |`);
    }
    if (sorted.length > shown.length) {
      const rest = sorted.slice(cap);
      L.push(`| ...and ${rest.length} more files | | ${sum(rest)} | (smallest counts, list omitted to keep this file short; rerun the script with a larger cap) |`);
    }
  }
  L.push("");
  return L;
}

const DATA_CONTRACT = `
Strings that are part of the data contract and must stay as they are (the list is based on what is obvious from the code, not exhaustive):

- Verification status enum values such as \`overene\` and \`vratene\` (and the other status values stored in the database and compared in code).
- The requirement/object field name \`narocnost\` and other ASCII-folded Slovak column names and jsonb keys (they are keys, not display text).
- Database table and column names, jsonb keys, RPC names and enum labels in \`supabase/\` migrations and in \`SCHEMA.md\`.
- MCP tool names and their argument names (the registry in \`lib/mcp/tool-registry.json\` and \`MCP-TOOLS.md\`): the names are identifiers, only the descriptions are text.
- Keys of JSON objects returned by routes and tools, query-string parameter names, and IFC property set / property names looked up in model data.
- Values read from model data or the library (for example Slovak property values in IFC files): they match data and are not UI text.
`;

// Shrink the per-area file cap until the report fits the line budget.
let cap = Infinity;
let out = render(cap);
for (const c of [60, 40, 30, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1]) {
  if (out.length <= MAX_LINES) break;
  cap = c;
  out = render(cap);
}
process.stdout.write(out.join("\n"));
