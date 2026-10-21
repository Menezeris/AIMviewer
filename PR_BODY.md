# AIM D-132: záložky viewera (3D, pôdorys, pohľad, dokument), Vedľa, rezný box z chatu

AIM #165 / D-132, host Menezeris/AIMviewer#206. Stavia na `claude/aim-d127-panely` (#97).

## Čo to robí
- **Lišta záložiek nad strednou plochou** (`aim/AimViewTabsBar.tsx`):
  - 3D (vždy prvá), pôdorysy podlaží (za behu z IfcBuildingStorey cez `enterDrawingView`, D-072), uložené pohľady z chatu (D-122) a karty dokumentov D-075;
  - aktívna záložka má celú plochu;
  - "+ Pôdorys" otvorí pôdorys, "Vedľa" dá k aktívnej druhú záložku.
- **Dokument na celú plochu:** 3D panel sa zbalí tým istým spôsobom ako režim 2D, canvas sa neremountuje. Vlastná lišta `DocumentPane` sa na desktope skryje (`hideTabs`).
- **Stav canvasu podľa záložky** (`aim/viewTabsApply.ts`): kamera a projekcia, celá sada rovín alebo box, zámok a rez podlažia sa pri odchode uložia a pri návrate vrátia.
- **Vedľa:**
  - ide 3D alebo pohľad + dokument;
  - ide 3D + pôdorys ako 2D plán D-072 (s kalibrovaným podkladom);
  - dve 3D záložky naraz sa odmietnu s problémom v `APPLIED` (jeden WebGPU canvas).
- **Most:**
  - `VIEW_TABS` (open | activate | beside | unbeside | close);
  - `SET_SECTION_BOX` (prvky + okraj, alebo obálka v IFC svete; `setSectionBox` upstreamu);
  - `DOCUMENT_OPEN layout: 'split'`;
  - `view_state.tabs` a `section.box`;
  - `SET_VIEW_MODE` ide cez záložky.

  Moduly záložiek a boxu sa stiahnu pri pripojení mosta, príkazy hosta preto bežia synchrónne a v poradí: rez a kamera po `VIEW_TABS open` patria novej záložke.
- **Pás AIM:** prepínač 3D | 2D | Split zmizol (2D je záložka). Ratchet v `command-labels.guard.test.tsx` klesol na `documents: 0`.

## Upstream súbory (len AIM-FORK bloky, režim `fork-blocks`)
- `ViewerLayout.tsx`:
  - logika stredného panela sa presunula do `aim/useAimCenterPanes.ts`;
  - pribudla lišta;
  - súbor má 481 riadkov pri strope 564 (strop nezvyšujem).
- `DocumentPane.tsx`: prop `hideTabs`.
- `command-labels.guard.test.tsx`: ratchet na 0.
- `docs/FORK_MAINTENANCE.md`: riadky pre tieto súbory.

## Overenie
- AIM testy `viewTabsPlan.test.ts`, `sectionBox.test.ts` + všetky `src/aim/*.test.ts`, súvisiace viewer testy z `check-aim-fork-only` (14) a guard ribbonu: prechádzajú.
  - Výnimka: `panel-text-tours-misc.contrast.test.tsx` padá rovnako aj na base `67d78612a` (prostredie).
- `npx tsc --noEmit` (viewer): 0 chýb.
- `check-module-size`, `check-i18n-literals`, `check-rtc-frame-copies`, `check-test-glob-coverage`: OK.
- Revert oracle: 11 chirurgických mutácií, všetky OBSERVED, obnova overená (`docs/architecture/evidence/aim-d132-view-tabs/mutations/`). **Pri otvorení PR daj štítok `revert-oracle-exempt`.**
- Balík (vite build vetvy a base `67d78612a`, ten istý stroj):
  - `viewer-entry-js-bytes` +2 275 B, `viewer-eager-js-bytes` +3 659 B;
  - `perf-ratchet check` prejde v tolerancii bez zvýšenia stropu.
- Živá skúška: lokálny viewer v iframe hostiteľskej stránky s `AC20-FZK-Haus.ifc`, Playwright posiela správy mosta a `ACK_REQUEST`. Prešlo:
  - `SET_VIEW_MODE 2d` = záložka pôdorysu (orto, zamknuté);
  - `DOCUMENT_OPEN` = PDF na celú plochu;
  - `activate 3D` = perspektíva bez rezu; `beside` = PDF vedľa 3D;
  - pohľad s boxom ostal v svojej záložke a 3D sa vrátila bez neho;
  - `beside 3D` z pohľadu = odmietnuté; `close all` = len 3D.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>` (s hostom z Menezeris/AIMviewer#206).
1. V Claude s konektorom aim-viewer: "Otvor pôdorys 1NP v novej záložke." Nad 3D pribudne záložka 1NP so zamknutým pohľadom zhora.
2. "Otvor výkres pôdorysu 1NP na celú obrazovku." PDF má celú plochu, 3D je v lište.
3. "Prepni späť na 3D." Vráti sa 3D s pôvodnou kamerou a rezom.
4. "Daj výkres vedľa modelu." Dostaneš 3D vľavo a PDF vpravo.
5. "Sprav rezný box okolo stĺpa S12 a ulož ho ako pohľad Výstuž S12, zamknutý spredu." Potom "otvor pohľad Výstuž S12": otvorí sa vo vlastnej záložke.

## Neoverené v session
- Plné CI (Rust, WASM, E2E, viewer shardy) beží až na balíku.
- Skutočný WebGPU: lokálne swiftshader občas hlásil stratu zariadenia, ide o prostredie.
- Mobil má zatiaľ starý prepínač 3D | 2D | Split (`MobileToolbar`), záložky sú len na desktope.
