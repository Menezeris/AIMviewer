import type { ToolDefinition } from "../llm/provider";

import type { ToolGroup } from "./tool-list";

/**
 * Inventár toolov MCP konektora (D-114) ako Markdown: jedno miesto, kde session
 * pred návrhom nového toolu hľadá, či schopnosť nepatrí do existujúceho. Súbor
 * `MCP-TOOLS.md` sa generuje testom `tool-registry.test.ts` (`npx vitest run
 * lib/mcp/tool-registry.test.ts -u`), ručne sa needituje.
 */

const MAX_ENUM = 10;

/** Skratky, za ktorými bodka nekončí vetu. */
const ABBREVIATIONS = new Set(["napr", "tzv", "resp", "príp", "atď", "vr", "č"]);
/** Kratšia prvá veta (napr. "ZDROJ: graf AIM v DB.") povie málo, pridá sa ďalšia. */
const MIN_SUMMARY = 60;

/**
 * Začiatok opisu po koniec vety (bodka, za ktorou ide veľké písmeno, mimo zátvorky
 * a nie za skratkou), aby inventár ostal krátky.
 */
export function firstSentence(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  let depth = 0;
  for (let i = 0; i < flat.length - 2; i++) {
    const c = flat[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "." && depth === 0 && flat[i + 1] === " " && /\p{Lu}/u.test(flat[i + 2])) {
      const word = /([\p{L}]+)$/u.exec(flat.slice(0, i))?.[1]?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(word) || i + 1 < MIN_SUMMARY) continue;
      return flat.slice(0, i + 1);
    }
  }
  return flat;
}

function paramText(name: string, schema: unknown, required: boolean): string {
  const s = (schema ?? {}) as { enum?: unknown[]; items?: { enum?: unknown[] } };
  const values = s.enum ?? s.items?.enum;
  const shown = values?.slice(0, MAX_ENUM).map(String).join("|");
  const more = values && values.length > MAX_ENUM ? "|..." : "";
  return `\`${name}${required ? "*" : ""}${shown ? `=${shown}${more}` : ""}\``;
}

function access(t: ToolDefinition): string {
  const mode = t.annotations?.readOnlyHint === false ? "zápis" : "čítanie";
  return t.meta?.["anthropic/alwaysLoad"] === true ? `${mode}, vždy načítaný` : mode;
}

function toolEntry(t: ToolDefinition, decision: string | undefined): string {
  const required = new Set(t.inputSchema.required ?? []);
  const params = Object.entries(t.inputSchema.properties).map(([n, s]) => paramText(n, s, required.has(n)));
  return [
    `- **\`${t.name}\`** (${decision ?? "bez rozhodnutia"}, ${access(t)}) - ${firstSentence(t.description)}`,
    `  Parametre: ${params.length ? params.join(", ") : "žiadne"}`,
  ].join("\n");
}

export function inventoryMarkdown(groups: ToolGroup[], registry: Record<string, string>): string {
  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  const lines = [
    "# Inventár toolov MCP konektora",
    "",
    "> Generované z definícií toolov (`lib/mcp/tool-list.ts`), needituj ručne. Obnova:",
    "> `npx vitest run lib/mcp/tool-registry.test.ts -u`.",
    "",
    `Konektor má ${total} toolov (s IFC motorom, \`ENGINE_ENABLED=1\`).`,
    "",
    "**Pravidlo D-114 - najprv napasuj, až potom nový tool:**",
    "1. Tu nájdi 2-3 najbližšie tooly k tomu, čo treba.",
    "2. Skús schopnosť dať do nich v tomto poradí: nový parameter alebo hodnota enumu",
    "   (`action`, `mode`, `include`...), pole vo výsledku, lepší opis alebo inštrukcia",
    "   (ak schopnosť už existuje, len ju agent nenašiel).",
    "3. Nový tool len keď nejde ani jedno; záznam rozhodnutia má sekciu",
    "   \"Zavrhnuté rozšírenie: `<tool>` - prečo nie\" a nový riadok v",
    "   `lib/mcp/tool-registry.json` schvaľuje Samuel v issue.",
    "",
    "Legenda: `*` = povinný parameter, `=a|b` = povolené hodnoty, v zátvorke rozhodnutie,",
    "ktoré tool zaviedlo, a či číta alebo zapisuje (zápis si v claude.ai pýta súhlas);",
    "\"vždy načítaný\" = `_meta` `anthropic/alwaysLoad`, klient ho nemusí hľadať cez tool_search (D-153).",
  ];
  for (const g of groups) {
    lines.push(
      "",
      `## ${g.group} (${g.tools.length})`,
      "",
      `Zdroj: ${g.source}. Definície: ${g.file}.${g.mcpOnly ? " Len MCP." : " Aj chat `/api/ask`."}`,
      "",
      ...g.tools.map((t) => toolEntry(t, registry[t.name])),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Veľkosť toho, čo klient načíta pri `tools/list` (bez inštrukcií). */
export function definitionChars(tools: ToolDefinition[]): number {
  return tools.reduce((n, t) => n + JSON.stringify(t).length, 0);
}
