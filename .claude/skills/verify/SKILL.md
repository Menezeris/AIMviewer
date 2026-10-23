---
name: verify
description: Ako overiť zmeny AIM Viewera naživo v tomto repe — build/launch/drive recept (Playwright + devtest harness bez Supabase). Použi pri verifikácii frontend zmien pred commitom.
---

# Verify — AIM Viewer

## Kontext prostredia
- Remote sessions **nemajú Supabase creds** (`.env.local` chýba) → reálne routes (`/drawing/[id]`,
  `/node/[id]`…) padnú na DB fetchi. Layouty pod `app/(viewer)/` ťahajú dáta z DB.
- Komponentové zmeny sa preto overujú cez **dočasnú stránku MIMO `(viewer)` groupu**
  (root layout je bez DB) — napr. `app/devtest/page.tsx` (`"use client"`), ktorá renderuje
  testovaný komponent s lokálnymi props. **Pred commitom ju zmaž.**
- Chromium: `/opt/pw-browsers/chromium`; playwright modul nainštaluj do scratchpadu
  (`npm i playwright`), NIE do repa. Nespúšťaj `playwright install`.

## Modely: nikdy produkčné IFC (D-135)
- Bucket Supabase má bezplatný egress; jedno otvorenie produkčnej federácie stálo 34,5 MB. Živé
  overenie **nesťahuje** `.../public/ifc/*` (ani archív): nepúšťaj `/ifc` ani IFC motor s predvoleným
  zoznamom modelov a nevolaj `ifc_*` tools konektora len kvôli overeniu.
- Testovací model `AC20-FZK-Haus.ifc` (2,5 MB, fixtures forku, GitHub release, nie Supabase):
  `curl -sSL -o <scratchpad>/fzk/AC20-FZK-Haus.ifc https://github.com/LTplus-AG/ifc-lite/releases/download/fixtures-v1/d42ab0dee01173106c16cd823b4614efe188fa15dd65195d95b9879bec59acc5`
  (meno = sha256 z `tests/models/manifest.json` forku), servíruj lokálne (`python3 -m http.server`
  v adresári modelu, alebo `public/` dev servera) a nastav `NEXT_PUBLIC_IFC_URLS="Test|http://localhost:<port>/AC20-FZK-Haus.ifc"`.
  Produkčný viewer forku pustí len origin bucketu, preto k lokálnemu modelu spusti lokálny viewer
  forku s `VITE_AIM_MODEL_ORIGINS=http://localhost:<port>` a `NEXT_PUBLIC_IFC_VIEWER_URL` naň.
- Motor a unit testy: fixtures v `lib/engine/__fixtures__/` (mini budova v pamäti).
- Hlavičky bucketu (Cache-Control, veľkosť) len `curl -I` alebo `curl -r 0-0 -D -`.

## Živý kanál: nikdy produkčný (D-159)
- UI tooly konektora session na overenie nevolá; zo session idú len na testovací kanál
  `<LIVE_CHANNEL>-test`. `components/live-channel.tsx` sa overuje na devtest stránke proti falošnému
  Realtime serveru: Node `ws` na `/realtime/v1/websocket` (Phoenix vsn 2.0.0: text = pole
  `[join_ref, ref, topic, event, payload]`, odpoveď `phx_reply` na `phx_join`/`heartbeat`; push klienta
  je binárny, JSON payload je na konci rámca) a `NEXT_PUBLIC_SUPABASE_URL=http://localhost:<port>`.

## Recept (PDF prehliadačka / drawing-*)
1. Testovacie viacstranové PDF sa dá vygenerovať čistým Pythonom (raw PDF syntax,
   `zlib` streamy, base-14 Helvetica — bez závislostí) do `public/devtest-drawing.pdf`;
   text na známych súradniciach → `DrawingRegion.bbox` presne sedí na overlay.
2. `app/devtest/page.tsx`: `DrawingWorkspace` s `pdfUrl="/devtest-drawing.pdf"`,
   ručnými `links` a fake `DocumentPanelData`. Vonkajší wrapper **`w-full`, NIE `mx-auto`**
   (auto marginy vo flex-col body zrušia stretch → stĺpec shrink-wrapne na obsah
   a fitWidth „dýcha" s contentom — falošné merania).
3. `npx next dev -p 3210` na pozadí; drive Playwrightom:
   - mobil: `{ viewport: 390x844, hasTouch: true, isMobile: true }`, `locator.tap()`,
     pinch cez CDP `Input.dispatchTouchEvent` (dva touchpointy, postupný rozstup);
   - desktop: `mouse.wheel` burst (kurzor NAJPRV `mouse.move` nad canvas!), klik, pan.
4. `/api/element/[id]` vráti 400 (bez DB) → panel ukáže „Detail sa nepodarilo načítať" —
   očakávané, layout panelov sa dá overiť aj tak.

## Range/lazy loading PDF (kadencia 3)
- Veľké testovacie PDF: generátor s pseudo-náhodnými úsečkami (zle komprimovateľné),
  40 strán ≈ 4 MB. `next dev` aj prod podporujú Range na `public/` (`curl -r 0-99` → 206).
- **Meraj `performance.getEntriesByType("resource")[].transferSize`**, NIE `Content-Length`
  hlavičky z Playwright response eventov — pdf.js prvý plný GET po hlavičkách abortuje
  (hlavička tvrdí celý súbor, reálne sa prenesie len prvý chunk).
- Očakávanie (overené): strana 1 viditeľná po ~10 % súboru; listovanie doťahuje chunky
  on-demand; pri nefunkčnom Range pdf.js potichu spadne na plné stiahnutie.

## LLM rozhranie /ask (F6, D-056)
- Celá slučka bez API kľúča aj bez DB: `LLM_PROVIDER=mock npx next dev -p 3210`.
  Mock provider (`lib/llm/mock.ts`) na prvý vstup zavolá `search_objects` (bez DB
  vráti tool error — overuje error vetvu), po tool výsledku odpovie textom;
  vstup `notool: …` odpovie bez toolu. `/api/ask` sa dá curl-núť priamo.
  POZOR: keď VŠETKY tool cally zlyhajú (typicky bez DB), route vráti poistkovú
  odpoveď „Dáta sa nepodarilo načítať…" namiesto textu modelu (anti-konfabulácia)
  — mock tool flow teda končí touto hláškou, `notool:` vetva textom modelu.
- UI: `AskPanel` renderuj na devtest stránke mimo `(viewer)` (layout ťahá DB).
  Zdroje/deep-linky (karta/3D/výkres chips) otestuj Playwright `page.route()`
  interceptom `/api/ask` s podvrhnutými `sources` — mock bez DB žiadne nevráti.
- 503 vetva (nenakonfigurované): spusti dev BEZ `LLM_PROVIDER`/`ANTHROPIC_API_KEY`.
- `next build` v remote prostredí padá na prerenderi `/` (layout číta DB bez env)
  — pre-existujúce, na Verceli s env prechádza; kompilácia+TS sú relevantný signál.

## Na čo si dať pozor
- Produktové poučenia (pointer capture vs. click, kotva zoomu vs. async raster) žijú
  v `DECISIONS.md` **D-054** — tu sa neduplikujú, prečítaj si ich tam.
- Esc v headless Chromium **neukončí** fullscreen (browser UI) — testuj cez toggle tlačidlo.
- Wrapper transformu je `canvas.closest(".relative")`, nie `canvas.parentElement`.
