import type { NextConfig } from "next";

/**
 * Dáta pdf.js, ktoré trasovanie importov nevidí: písma, CMapy a wasm dekodéry číta
 * `BinaryDataFactory` zo súborov (D-158 krok 3). pdf.js, pracovník a natívny canvas trasovanie
 * nájde samo. Len dátové priečinky: celé balíky pribalili aj druhý natívny canvas spod react-pdf
 * a source mapy (funkcia BCF API 183 MB namiesto 131 MB).
 */
const PDF_RENDER_FILES = [
  "node_modules/pdfjs-dist/cmaps/*",
  "node_modules/pdfjs-dist/standard_fonts/*",
  "node_modules/pdfjs-dist/wasm/*",
];

const nextConfig: NextConfig = {
  // Turbopack (default in Next.js 16).
  turbopack: {},
  // IFC motor (D-084): @ifc-lite/* beží v Node runtime ako externé balíky -
  // používajú top-level await, `import.meta.url` a dynamické importy, ktoré
  // bundler nemá prepisovať. Súbory, ktoré trasovanie nevidí (WASM pre kolízie
  // resolvnutý cez createRequire, xmldom importovaný vypočítaným názvom pre
  // IDS), sa do funkcie MCP konektora pribalia explicitne.
  // Snímka výrezu PDF (D-158 krok 3): pdf.js (legacy build) a natívny canvas v Node route.
  serverExternalPackages: [
    "@ifc-lite/mcp",
    "@ifc-lite/parser",
    "@ifc-lite/sdk",
    "@ifc-lite/clash",
    "@ifc-lite/geometry",
    "@ifc-lite/query",
    "pdfjs-dist",
    "@napi-rs/canvas",
  ],
  outputFileTracingIncludes: {
    "/api/mcp/[token]": [
      "./node_modules/@ifc-lite/wasm/pkg/*.wasm",
      "./node_modules/@xmldom/xmldom/**/*",
    ],
    // Kľúč je glob nad cestou route ([id] by bol trieda znakov), preto zástupné znaky.
    "/api/bcf/**/*": PDF_RENDER_FILES,
    "/api/drawing/**/*": PDF_RENDER_FILES,
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
