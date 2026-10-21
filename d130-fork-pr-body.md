AIM D-130 (AIMviewer #167). Pár k Menezeris/AIMviewer#201. Stojí na hlave #97 (`67d78612a`, D-127). Poradie zlúčenia: #97, tento fork PR (balík, D-116), potom AIMviewer #201.

## What and why
Bubliny na výkrese (napr. `08 DD01`) a kódy miestností majú byť odkazy: klik otvorí panel vlastností zodpovedajúceho IFC prvku (DD01.08.0001), ako to vedel pôvodný PDF prehliadač. Párovanie popisku s prvkom robí host (AIMviewer, `lib/data/drawing-labels.ts`) nad textovou vrstvou PDF ako AIM vrstvu (odvodenie, nie IFC; D-129). Fork len kreslí a vyberá (D-091, D-098).

Zmeny len v `apps/viewer/src/aim/` a dôkazoch:
- **`docLinks.ts` (nový):** správa `DOCUMENT_LINKS {documents: [{documentId, page, links: [{x, y, w, h, label, status, targets: [{guid, ref, name?}]}]}]}` (oblasti v zlomkoch strany). Overenie nedôveryhodného drôtu (source, strana, poloha, orezanie do strany, strop 600 oblastí na stranu a 12 kandidátov, stav podľa počtu platných cieľov), store (každá správa nahradí všetko) a imperatívna vrstva nad stranou karty (ako rámiky D-123). Klik: `selectPickedGlobalId` + panel vlastností, teda výber ako klik do modelu (D-082), hostovi ide `ENTITY_SELECTED`; kamera sa nehýbe. Viac kandidátov = malý výber "AIM · <popisok> · kandidáti na podlaží: N". Popis oblasti hovorí "AIM: odvodené z popisku". Prvok mimo načítaných modelov oblasť sčervená.
- **Príjem správy:** vlastný poslucháč v `docLinks.ts` (`listenDocLinks`) s rovnakou kontrolou rodiča a originu ako most (`acceptsDocLinksEvent`); zapína ho `wireDocumentEvents` v `docBridge.ts` (jeden riadok). `AimBridge.tsx` ani `bridge-protocol.ts` sa nemenia (`isInboundMessage` neznáme typy odmietne a bridge-protocol mení D-131).
- **`docRegion.ts`:** `useAimDocRegion` pripojí vrstvu ku karte (jeden riadok); `PdfDocumentView` sa nemení.

Starší AIMviewer správu neposiela, nový AIMviewer so starším viewerom nič nerozbije (viewer neznámu správu ignoruje). Existujúce odkazy D-076 (`PageIdentifierLinks`, predvolene vypnuté) ostávajú.

## How it was verified
- Nad `67d78612a`: `npx tsc --noEmit -p .` (viewer) čistý; AIM testy 181/181 (`src/aim/*.test.ts`, nový `docLinks.test.ts` 9 testov); `check-module-size` exit 0 (AimBridge.tsx 334 riadkov bez zmeny, docBridge.ts 96, allowlist bez zmeny); `check-rtc-frame-copies`, `check-i18n-literals`, `check-test-glob-coverage` OK. `check-aim-fork-only`: režim `aim-only`.
- **Balík** (lokálny build vetvy a bázy `67d78612a` rovnako): `viewer-entry-js-bytes` 3 164 652 (báza 3 165 065), `viewer-eager-js-bytes` 19 361 936 (báza 19 356 020, +5 916); `perf-ratchet check` prechádza, strop sa nemení.
- **Revert oracle:** test importuje nový modul, preto 11 chirurgických mutácií `docLinks.ts` (base `67d78612a`, aj kontrola rodiča a originu poslucháča), všetky `OBSERVED` s overenou obnovou: `docs/architecture/evidence/aim-d130-doc-links/mutations/`. **Štítok `revert-oracle-exempt` treba dať pri otvorení PR.**
- **Živo** (lokálny viewer v iframe hostiteľskej stránky, Playwright, `ASR.ifc` a PDF `D.1.1.01 Pôdorys 1NP` z produkcie AIM, `DOCUMENT_LINKS` vygenerovaný funkciami AIMviewera nad skutočnými riadkami strany): 97 oblastí na strane; klik na `DD01 08` poslal `ENTITY_SELECTED` `1_YiIDK5n2fvfP1VGIobML` a panel vlastností ukázal DD01.08.0001 (IfcDoor, 1NP); `OV01 01` otvoril výber dvoch kandidátov, voľba poslala `ENTITY_SELECTED` OV01.01.234 a výber zavrela. Raster PDF sa v headless Chromiu (swiftshader, strata WebGPU) nevykreslil, vrstva a kliky áno.
- `git am -3` nad `67d78612a` prejde bez konfliktu a dá zhodný strom. Patch sa nedotýka `bridge-protocol.ts`, `AimDocumentsControls.tsx` ani `documentsQuery.ts` (D-131, #192).
- Živý test zopakovaný nad `67d78612a` (správa ide cez nový poslucháč) s rovnakým výsledkom.

## Ako vyskúšať
Odkaz: https://ai-mviewer.vercel.app/ifc?viewer=pr-<ČÍSLO> (s AIMviewer #201 v náhľade alebo po jeho zlúčení; bez neho host `DOCUMENT_LINKS` neposiela a odkazy nevidno)
1. V lište AIM otvor Documents a pôdorys `D.1.1.01 Pôdorys 1NP`. Popisky prvkov a čísla miestností majú jemné zelené podfarbenie, kandidáti modré.
2. Klikni na bublinu `DD01 08` (hlavný vstup, dole v strede): vyberú sa dvere DD01.08.0001 a vpravo sa otvorí panel vlastností. Tooltip oblasti: "DD01 08 -> DD01.08.0001 (AIM: odvodené z popisku)".
3. Klikni na bublinu `SN05 01`: otvorí sa výber kandidátov s odznakom AIM; voľba vyberie prvok, druhý klik na bublinu výber zavrie.
4. Klikni na číslo miestnosti `1.01`: vyberie sa miestnosť Lobby (ak sú IfcSpace načítané).

## Checklist
- [x] Test asserts the new behavior and FAILS against the unfixed code: 11 mutácií `OBSERVED` (README v dôkazoch).
- [x] Žiadny `packages/*`, žiadna zmena geometrie.
- [x] House rules: bez `as any` / `@ts-ignore`, bez tichého `catch {}`, žiadny modul nad 400 riadkov, `AimBridge.tsx` sa nemení.
- [x] Bez identifikátorov klienta v kóde a testoch (test má syntetický GUID; živý záznam v README dôkazov menuje kódy a GUID z demo modelu).
