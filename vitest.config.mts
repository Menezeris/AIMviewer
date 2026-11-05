import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Alias `@/` z tsconfig.json, aby testy mohli importovať moduly, ktoré ho používajú
// (napr. zoznam toolov MCP konektora v `lib/mcp/tool-list.ts`, D-114).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // D-189: fixture project as the request context, `server-only` mocked (vitest.setup.ts).
  test: { setupFiles: ["./vitest.setup.ts"], env: { AIM_DEFAULT_PROJECT: "TST" } },
});
