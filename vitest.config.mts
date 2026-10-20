import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Alias `@/` ako v tsconfig, aby testy smeli importovať moduly, ktoré ho používajú.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
