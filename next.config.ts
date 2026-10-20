import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (default in Next.js 16).
  turbopack: {},
  // IFC motor (D-084): @ifc-lite/* beží v Node runtime ako externé balíky -
  // používajú top-level await, `import.meta.url` a dynamické importy, ktoré
  // bundler nemá prepisovať. Súbory, ktoré trasovanie nevidí (WASM pre kolízie
  // resolvnutý cez createRequire, xmldom importovaný vypočítaným názvom pre
  // IDS), sa do funkcie MCP konektora pribalia explicitne.
  serverExternalPackages: ["@ifc-lite/mcp", "@ifc-lite/parser", "@ifc-lite/sdk", "@ifc-lite/clash", "@ifc-lite/geometry", "@ifc-lite/query"],
  outputFileTracingIncludes: {
    "/api/mcp/[token]": [
      "./node_modules/@ifc-lite/wasm/pkg/*.wasm",
      "./node_modules/@xmldom/xmldom/**/*",
    ],
  },
  // Paralelný dev server (devtest popri bežnom `npm run dev`): Next 16 drží
  // single-instance lock na distDir, override umožní druhú inštanciu.
  distDir: process.env.NEXT_DIST_DIR_OVERRIDE ?? ".next",
  experimental: {
    // Klientská router cache: opakovaná navigácia na nedávno navštívený /
    // prefetchnutý uzol sa vykreslí z cache bez server round-tripu. Viewer je
    // verejný read-only s ISR 60 s, takže krátka klientská staleness je OK.
    staleTimes: { dynamic: 30, static: 300 },
  },
  // Koreň → IFC workspace (D-077 viewer-first) na úrovni configu: žiadna
  // stránka `/` = žiadny build-time prerender (layout ťahá Supabase a build
  // padal na prechodnom „JWT issued at future" clock skewe build stroja).
  async redirects() {
    return [{ source: "/", destination: "/ifc", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
