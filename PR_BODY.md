## Co
Doplnok AIM D-125 (AIM #175): výplň (podstava) ofarbenej alebo vybranej miestnosti je v 3D perspektíve viditeľná aj s podlahovou krytinou, vo farbe z Lens, zhodnej s pôdorysom.

**Príčina (dve):**
1. *Bledo azúrová:* farebné pravidlo AIM chat lens dáva IfcSpace priesvitnú variantu (`transparent`, alfa 0,3). Renderer override s alfou >= 0,2 presunie do nepriehľadnej pipeline (`overlay-routing.ts`) a shader (`paintEntityOverride`) ho zmieša ako `mix(pôvodná, Lens, 0,3)`: 70 % pôvodnej azúrovej farby miestnosti. Všetky miestnosti boli bledo azúrové, farby Lens nerozlíšiteľné, a zároveň nepriehľadná hmota (AIM #76).
2. *Krytina prekrýva:* `AimRoomFillLayer` (SVG) kreslí len v 2D a v 3D zhora s vodorovným rezom. V perspektíve bola "výplňou" len spodná stena objemu miestnosti, ktorá leží na doske, pod IfcCovering FLOORING.

**Zmena:**
- `aimLensPaint.ts` + blok AIM-FORK v `useLens.ts`: prvky varianty `~vol` AIM chat lens (IfcSpace, IfcSpatialZone) sa do renderera (`pendingColorUpdates`, `lensAppliedColors`) neposielajú, ostanú natívne priesvitné. `lensColorMap`, počty a súhrn lens sa nemenia. Cudzia lens (Color by...) sa nemení.
- `AimRoomFill3d` (v `AimRoomFillLayer.tsx`) + `aimRoomFill3d.ts`: v 3D mimo pôdorysu pošle ofarbené (lensColorMap) a vybrané miestnosti ako polopriehľadnú výplň (farba Lens, alfa 0,45 ako SVG pôdorys) cez existujúce `uploadAnnotationFills3D` (hĺbkový test, bez zápisu hĺbky: steny pred ňou ju zakryjú). Výška = vrch krytiny, ktorá v pôdoryse prekrýva miestnosť a leží do 0,25 m nad jej spodkom, + 3 cm; bez krytiny spodok miestnosti. Jeden polygón (obrys s dierami, hrany rozdelené na T-spojoch) na súvislú časť miestnosti, záloha po trojuholníkoch. Nie pri skrytej miestnosti, nie nad vodorovným rezom, nie keď kreslí SVG pôdorys (farba by sa zdvojila).
- Blok AIM-FORK v `useViewportSymbolicUploads.ts`: renderer má na výplne jeden kanál, AIM výplne sa pridajú k výplniam IfcAnnotation; po nahratí `requestRender` (renderer kreslí na požiadanie).

## Ako vyskúšať
1. Viewer s mostom na malom testovacom modeli s miestnosťami a podlahovou krytinou (syntetický IFC4 z živej skúšky alebo vlastný; AC20-FZK-Haus krytinu nemá), nie produkčné IFC (D-135), alebo preview `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>`.
2. V chate "ofarbi Lobby na zeleno a Retail na modro" (`style_in_3d colorize` na IfcSpace) alebo správa `APPLY_LENS` s dvoma pravidlami colorize: v perspektíve bez rezu je podlaha každej miestnosti v jej farbe nad krytinou, objem miestnosti ostane priesvitný, prvky vnútri vidno. Krytinu netreba skrývať.
3. Otoč kamerou a odsuň ju: výplň sedí na podlahe, stena pred miestnosťou ju zakryje.
4. Vyber miestnosť (klik alebo `show_in_3d select`): jej podlaha je modrá aj bez Lens.
5. `set_section` 1NP + 1,2 m a `set_camera top`: pôdorys ako doteraz (SVG s názvami), farba sa nezdvojí; v perspektíve s rezom má výplň len miestnosť s podlahou pod rezom.
6. Panel Lens: pravidlá a počty ako predtým (varianta "(miestnosti)" sa ráta pod svoje pravidlo).

## Overenie
- `aimRoomFill3d.test.ts` (11) + `aimLensPlan.test.ts` + `aimRoomFill.test.ts` + `viewDelta.test.ts`: 42/42; súvisiace viewer testy z `check-aim-fork-only` (19 súborov, 120 testov) prešli; `tsc --noEmit` viewera čistý; `npx oxlint apps/viewer/src/aim` 0 chýb (2 staré varovania mimo zmeny); `check-module-size`, `check-jsx-a11y`, `check-type-scale`, `check-rtc-frame-copies`, `check-i18n-literals`, `check-test-glob-coverage` exit 0; mód `fork-blocks`.
- Bundle (vite build vetvy a `main` rovnako, `measure-bundle` + `perf-ratchet check` exit 0): `viewer-entry-js-bytes` +122 B, `viewer-eager-js-bytes` +457 B oproti main, v tolerancii stropu, strop sa nedvíha.
- Živo: lokálny viewer v iframe hostu, syntetický IFC4 (doska, dve IfcSpace 5 x 5 m, IfcCovering FLOORING 8 cm v každej, dve steny), Chromium s WebGPU (SwiftShader) pod Xvfb, Playwright `APPLY_LENS`. Pred: obe miestnosti bledo azúrové, bez farieb. Po: zelená a modrá podstava na y 0,11 (krytina 0,08 + 0,03), steny ju zakrývajú, viditeľná aj z diaľky, vybraná miestnosť modrá. 3 mm nad krytinou výplň zmizla pre záporný depth bias pipeline výplní, 2 cm bola vidieť, preto 3 cm.
- Mutačné dôkazy (9 patchov, všetky OBSERVED, obnova overená): `docs/architecture/evidence/aim-175-room-floor-3d/mutations/`; pri otváraní PR pridaj štítok `revert-oracle-exempt`.

## Poznámky
- Zóny (IfcSpatialZone) z AIM chat lens v 3D farbu objemu stratia (predtým len bledá 30 % zmes v nepriehľadnej hmote), ostanú priesvitné; farba je v legende a pôdoryse. Podstavu zóny nekreslíme.
- Užívateľská lens (Color by, panel Lens) farbí miestnosti ako doteraz; podstavu dostanú aj tie (lensColorMap).
- Rozhranie toolov sa nemení; host len zapisuje doplnok D-125 (AIMviewer, Closes #175). Poradie zlúčenia: fork, potom host.
