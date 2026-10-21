AIM D-130 (AIMviewer #167). Pár k Menezeris/AIMviewer#201. Poradie zlúčenia: najprv tento fork PR (balík, D-116), potom AIMviewer #201.

## What and why
Bubliny na výkrese (napr. `08 DD01`) a kódy miestností majú byť odkazy: klik otvorí panel vlastností zodpovedajúceho IFC prvku (DD01.08.0001), ako to vedel pôvodný PDF prehliadač. Párovanie popisku s prvkom robí host (AIMviewer, `lib/data/drawing-labels.ts`) nad textovou vrstvou PDF ako AIM vrstvu (odvodenie, nie IFC; D-129). Fork len kreslí a vyberá (D-091, D-098).

Zmeny len v `apps/viewer/src/aim/` a dôkazoch:
- **`docLinks.ts` (nový):** správa `DOCUMENT_LINKS {documents: [{documentId, page, links: [{x, y, w, h, label, status, targets: [{guid, ref, name?}]}]}]}` (oblasti v zlomkoch strany). Overenie nedôveryhodného drôtu (source, strana, poloha, orezanie do strany, strop 600 oblastí na stranu a 12 kandidátov, stav podľa počtu platných cieľov), store (každá správa nahradí všetko) a imperatívna vrstva nad stranou karty (ako rámiky D-123). Klik: `selectPickedGlobalId` + panel vlastností, teda výber ako klik do modelu (D-082), hostovi ide `ENTITY_SELECTED`; kamera sa nehýbe. Viac kandidátov = malý výber "AIM · <popisok> · kandidáti na podlaží: N". Popis oblasti hovorí "AIM: odvodené z popisku". Prvok mimo načítaných modelov oblasť sčervená.
- **`AimBridge.tsx`:** jeden riadok handlera a import.
- **`docRegion.ts`:** `useAimDocRegion` pripojí vrstvu ku karte (jeden riadok), `PdfDocumentView` sa nemení.

Starší AIMviewer správu neposiela, nový AIMviewer so starším viewerom nič nerozbije (viewer neznámu správu ignoruje). Existujúce odkazy D-076 (`PageIdentifierLinks`, predvolene vypnuté) ostávajú.

## How it was verified
- `npx tsc --noEmit -p .` (viewer) čistý; AIM testy 168/168 (`src/aim/*.test.ts`, nový `docLinks.test.ts` 7 testov); súvisiace viewer testy z `check-aim-fork-only` (6 súborov, 22 testov) prešli; `check-rtc-frame-copies`, `check-module-size`, `check-i18n-literals`, `check-test-glob-coverage` OK. `check-aim-fork-only`: režim `aim-only`.
- **Balík** (lokálny build vetvy a `main` rovnako): `viewer-entry-js-bytes` 3 166 384 (main 3 166 728), `viewer-eager-js-bytes` 19 358 235 (main 19 352 630, +5 605); `perf-ratchet check` prechádza, strop sa nemení.
- **Revert oracle:** test importuje nový modul, preto 8 chirurgických mutácií `docLinks.ts`, všetky `OBSERVED` s overenou obnovou: `docs/architecture/evidence/aim-d130-doc-links/mutations/`. **Štítok `revert-oracle-exempt` treba dať pri otvorení PR.**
- **Živo** (lokálny viewer v iframe hostiteľskej stránky, Playwright, `ASR.ifc` a PDF `D.1.1.01 Pôdorys 1NP` z produkcie AIM, `DOCUMENT_LINKS` vygenerovaný funkciami AIMviewera nad skutočnými riadkami strany): 97 oblastí na strane; klik na `DD01 08` poslal `ENTITY_SELECTED` `1_YiIDK5n2fvfP1VGIobML` a panel vlastností ukázal DD01.08.0001 (IfcDoor, 1NP); `OV01 01` otvoril výber dvoch kandidátov, voľba poslala `ENTITY_SELECTED` OV01.01.234 a výber zavrela. Raster PDF sa v headless Chromiu (swiftshader, strata WebGPU) nevykreslil, vrstva a kliky áno.
- Patch sa aplikuje (`git apply --check`) na `main` aj na vetvy `claude/aim-d127-panely`, `claude/aim-182-stav-viewera` a `claude/applied-camera` (každú zvlášť); riadky v `AimBridge.tsx` a `docRegion.ts` sú mimo ich hunkov.

## Ako vyskúšať
Odkaz: https://ai-mviewer.vercel.app/ifc?viewer=pr-<ČÍSLO> (s AIMviewer #201 v náhľade alebo po jeho zlúčení; bez neho host `DOCUMENT_LINKS` neposiela a odkazy nevidno)
1. V lište AIM otvor Documents a pôdorys `D.1.1.01 Pôdorys 1NP`. Popisky prvkov a čísla miestností majú jemné zelené podfarbenie, kandidáti modré.
2. Klikni na bublinu `DD01 08` (hlavný vstup, dole v strede): vyberú sa dvere DD01.08.0001 a vpravo sa otvorí panel vlastností. Tooltip oblasti: "DD01 08 -> DD01.08.0001 (AIM: odvodené z popisku)".
3. Klikni na bublinu `SN05 01`: otvorí sa výber kandidátov s odznakom AIM; voľba vyberie prvok, druhý klik na bublinu výber zavrie.
4. Klikni na číslo miestnosti `1.01`: vyberie sa miestnosť Lobby (ak sú IfcSpace načítané).

## Checklist
- [x] Test asserts the new behavior and FAILS against the unfixed code: 8 mutácií `OBSERVED` (README v dôkazoch).
- [x] Žiadny `packages/*`, žiadna zmena geometrie.
- [x] House rules: bez `as any` / `@ts-ignore`, bez tichého `catch {}`, žiadny modul nad 400 riadkov (`AimBridge.tsx` 397).
- [x] Bez identifikátorov klienta v kóde a testoch (test má syntetický GUID; živý záznam v README dôkazov menuje kódy a GUID z demo modelu).
