import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Alias `@/` z tsconfig.json, aby testy mohli importovať moduly, ktoré ho používajú
// (napr. zoznam toolov MCP konektora v `lib/mcp/tool-list.ts`, D-114).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
