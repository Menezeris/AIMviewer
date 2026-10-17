# AIMviewer

Asset Information Model platforma — **AIM Viewer** (prvý use case, D-003).
Viewer správne previazaných dát o stavbe počas životného cyklu.

Stack (D-026): **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**,
dáta **výhradne server-side** cez Supabase `service_role` (RLS odložené, D-025),
hosting **Vercel** (D-006). Konvencie: [`AGENTS.md`](AGENTS.md),
rozhodnutia: [`DECISIONS.md`](DECISIONS.md), plán: [`ROADMAP.md`](ROADMAP.md).

## Štruktúra repa

```
.                      ← Next.js app v roote
├── app/               ← App Router (page.tsx = Server Component, test-fetch)
├── components/ui/     ← shadcn/ui komponenty
├── lib/supabase/      ← server-only Supabase klient (service_role)
└── supabase/          ← DB migrácie + seed (Supabase Cloud)
```

## Lokálny vývoj

1. **Env:** skopíruj `.env.example` → `.env.local` a doplň hodnoty zo
   Supabase → *Project Settings → API*:
   - `SUPABASE_URL` = `https://acwoupricatirhlfkhvk.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role kľúč (tajný)
   - `GEMINI_API_KEY` = kľúč pre LLM rozhranie `/ask` (D-056; free tier stačí.
     Bez kľúča stránka zobrazí, že AI asistent nie je nakonfigurovaný — zvyšok
     appky beží). Alternatíva: `ANTHROPIC_API_KEY` — provider sa auto-detekuje.
   - voliteľné: `LLM_PROVIDER` (`gemini` | `anthropic` | `mock` — mock je pre
     vývoj/testy bez kľúča), `LLM_MODEL` (default `gemini-flash-lite-latest`,
     resp. `claude-sonnet-5` pri Anthropicu)

   > `.env.local` je gitignored — **nikdy** ho necommituj. `service_role`
   > kľúč sa číta len server-side a nikdy sa nedostane do prehliadača.

2. **Inštalácia + beh:**
   ```bash
   npm install
   npm run dev
   ```
   Otvor http://localhost:3000 — stránka ukáže „Supabase connected ✅" a
   `select count(*) from objects` (seed = **13**).

## Deploy na Vercel

1. **Import repa:** [vercel.com/new](https://vercel.com/new) → *Add New… → Project*
   → vyber GitHub repo `AssetinSpace/AIMviewer`. Vercel autodetekuje Next.js
   (root, build `next build`) — nič netreba meniť.
2. **Environment Variables** (pred prvým deployom, *Settings → Environment
   Variables* alebo v import obrazovke):
   - `SUPABASE_URL` = `https://acwoupricatirhlfkhvk.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role kľúč
   - `GEMINI_API_KEY` = kľúč pre LLM rozhranie `/ask` (D-056; free tier)
   - Scope: Production + Preview + Development. Kľúče sú **secret** (nie sú
     `NEXT_PUBLIC_*`, takže sa nedostanú do client bundle).
3. **Deploy** → appka beží na `*.vercel.app`. Push do `main` = auto-deploy.

Vlastná doména sa rieši až keď je demo verejné (po S3, D-026).

## Claude ako chat vedľa viewera (MCP konektor + živý kanál, D-079)

Claude (napr. predplatné Max) sa pripojí k dátam budovy cez custom connector a 3D
príkazy („ukáž VZT vyústenia na 2. NP", „skry architektúru") sa vykonajú vo vieweri,
ktorý je otvorený vedľa.

1. **Migrácia (najprv!):** `supabase db push` — `20261016120000_revoke_anon_grants.sql`
   odoberie anon kľúču prístup k DB. Bez nej nikdy nedávaj anon kľúč do Vercelu.
2. **Vercel env:**
   - `MCP_TOKEN` = dlhý náhodný reťazec (napr. `openssl rand -hex 24`) — bez neho je
     endpoint vypnutý.
   - `LIVE_CHANNEL` = názov kanála pre demo (netriviálny, napr. `bencont-7f3k`).
   - `NEXT_PUBLIC_SUPABASE_URL` = rovnaká hodnota ako `SUPABASE_URL`.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon/publishable kľúč (Supabase → Project
     Settings → API). Po zmene `NEXT_PUBLIC_*` treba redeploy.
3. **Claude:** Settings → Connectors → *Add custom connector* → URL
   `https://ai-mviewer.vercel.app/api/mcp/<MCP_TOKEN>` (bez OAuth). V konverzácii
   konektor zapni.
4. **Viewer:** otvor `https://ai-mviewer.vercel.app/ifc?live=<LIVE_CHANNEL>` — vľavo dole
   sa ukáže zelené „Live". Kanál si tab pamätá; `?live=off` ho vypne.

Ak viewer nie je otvorený alebo kanál nie je nastavený, tool vráti Claude odkaz, ktorým
sa dá výsledok otvoriť ručne.

**Pohľad (D-083):** `set_section` (rez nad podlažím alebo zvislý), `set_camera` (top/front/
.../iso, rámovanie na prvky), `set_view_mode` (3D/2D/Split, podlažie, `reset`) a
`open_drawing` s `in_viewer=true` (dokument vedľa 3D). Vyžadujú fork viewera s bridge
správami `SET_SECTION`/`SET_CAMERA`/`SET_VIEW_MODE` (nasadzujú sa spolu).

**IFC motor (D-084, voliteľne):** env `ENGINE_ENABLED=1` pridá tools `ifc_models`,
`ifc_query`, `ifc_get`, `ifc_count`, `ifc_property_values`, `ifc_ids_validate`, ktoré čítajú
priamo IFC súbory federácie cez `@ifc-lite/mcp` (číselné filtre psetov, histogramy, IDS
kontrola teraz). IDS pre `ifc_ids_validate` sa berú z env `IDS_SOURCES` =
`{"<id>": "<https URL .ids>"}` (bez neho je kontrola nedostupná). `ENGINE_SPIKE=1`
(len preview) pridá diagnostický `ifc_engine_probe`.

