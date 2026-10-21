AIM D-127 (AIMviewer #168, #169, #179, #166). Pár k Menezeris/AIMviewer#190. Poradie zlúčenia: najprv tento fork PR (balík, D-116), potom AIMviewer #190.

## Čo sa mení (len `apps/viewer/src/aim/` a dôkazy)
- **#168 zvýraznenie vlastnosti z chatu** (`aimPanelView.ts`): SELECT s `panel.focus` už nejde cez upstream `pendingPropertyFocus`, ktorý po 2,4 s zhasne. Nová cesta nad DOM panela nájde riadok v Properties (výskyt aj pset typu) aj v Quantities (Qto, BaseQuantities). Zbalenú sadu rozbalí, riadok vycentruje a označí `data-aim-focus` (štýl v `assetin-theme.css`). Označenie drží do ďalšieho výberu. `view_state` / `APPLIED` nesú `property_focus` {found, section, from_type}. Nenájdená vlastnosť je problém v `APPLIED`.
- **#169 panel len IFC podľa AIM D-129** (`AimInspectorTabs.tsx`, `AimCard.tsx` zmazaný, `AimDocumentsControls.tsx`, `documentsQuery.ts`): záložka AIM aj AIM karta vypadli. Posledná zmena prvku receptom (`AimPanelData.lastChange`: revízia, model, BCF téma) a história GUID sú riadky vrstvy AIM v rámiku s odznakom nad IFC obsahom (vzor D-089). Dokumenty zdedené cez vzťah (`aim: true`) majú v paneli Documents ("Len pre výber") odznak AIM. `panel.tab` sa ešte prijme a nič nenastaví.
- **#179 panely z chatu** (`aimPanels.ts`, `aimPanelsPlan.ts`, `view-protocol.ts` `SET_PANELS`): open, close a toggle pre lens, properties, underlays, documents, lists a model_tree, plus `all: close`. Volajú sa existujúce akcie store (lišta, rail, krížik). `view_state.panels` hlási open, where (left/right/bottom/floating/window), snap, veľkosť a šírku pravého stĺpca.
- **#166 výrez dokumentu** (`docRegion.ts`, `AimBridge.tsx`): výrez sa prepočíta pri zmene plochy karty alebo pomeru strany, kým kartou nepohne používateľ. `APPLIED` čaká na vykonanie výrezu. `view_state.document` nesie viditeľnú časť strany v %, veľkosť karty, zoom a `region_fully_visible`.

## Overenie
- `tsc --noEmit` (viewer) je čistý. AIM testy prešli 172/172. Prešli aj `check-rtc-frame-copies`, `check-module-size`, `check-i18n-literals`, `check-test-glob-coverage`. `check-unused-locals`: viewer bez nálezu, skript padá len na `packages/embed-sdk` (lokálne sa samostatne nekompiluje, nesúvisí so zmenou). `check-aim-fork-only` hlási režim `aim-only`.
- **Balík** (lokálny build vetvy a `main`): entry -1 748 B (bez lišty záložiek a karty), eager +3 211 B (v tolerancii), `perf-ratchet check` prechádza bez zvýšenia stropu.
- **Revert oracle:** testy importujú nové exporty, preto 11 chirurgických mutácií (všetky `OBSERVED`, obnova overená). Sú v `docs/architecture/evidence/aim-d127-panels/mutations/`. Štítok `revert-oracle-exempt` treba dať pri otvorení PR.
- **Živo** (lokálny viewer v iframe, model BURKWIL, Playwright):
  - Zvýraznenie drží po 7,5 s. Zbalený pset sa rozbalí. BaseQuantities.Width sa zvýrazní. Chýbajúca vlastnosť vráti found=false.
  - Výber iného prvku zvýraznenie zruší.
  - `all=close` a otvorenie lens, stromu a lists sedí so stavom.
  - Výrez 30 % v karte 378 px aj 264 px je celý v zábere.

## Ako vyskúšať
Odkaz: https://ai-mviewer.vercel.app/ifc?viewer=pr-<ČÍSLO> (s AIMviewer #190 v náhľade alebo po jeho zlúčení; samotný fork stačí na body 1 a 2 cez klik)
1. Klikni na prvok: panel vlastností nemá prepínač AIM | IFC ani AIM kartu. Hore je rámik s odznakom AIM (posledná zmena receptom, história GUID). V lište AIM otvor Documents a zapni "Len pre výber": dokumenty zdedené cez zónu alebo podlažie majú odznak AIM.
2. V Claude s konektorom: "Vyber dvere DD01.08.0001 a ukáž vlastnosť AIM_FireSafety.FireCompartments". Pset sa rozbalí, riadok je v strede a žltý. Žltý ostane, kým nevyberieš iný prvok.
3. "Zavri všetky panely okrem vlastností": zostane len panel vlastností a odpoveď vypíše stav panelov.
4. "Otvor pôdorys 1NP a priblíž tabuľku miestností vpravo dole": odpoveď nesie `region_fully_visible: true` a tabuľka je celá v karte.
