# AIM #211: úchytka stĺpca vlastností sa chytá ľahšie, pôdorys sa po zmene veľkosti znova vyplní

AIM #211, oprava len vo forku (AIMviewer len nesie balík). Pri ťahaní okraja panela vlastností vpravo sa "chytil" okraj pôdorysu, plocha sa posunula a vedľa ostala prázdna plocha.

## Príčina (z kódu, živo sa v cloude nedalo)
- Panel vlastností je `SidebarDock` (pravý stĺpec). Jeho úchytka je 6 px široká obyčajná `div` priamo pri canvase, bez zóny navyše.
- Pôdorys v záložke je `enterDrawingView`: zamknutý kolmý pohľad zhora v 3D canvase, kde ťahanie posúva pohľad. Zásah mimo 6 px úchytky padol na canvas a posunul pôdorys.
- Po zmene veľkosti plochy (aj správnym ťahaním stĺpca) si ortografická kamera držala staré mierky a posun, takže pôdorys ostal ako malý blok pri okraji a vedľa neho prázdno. Nič ho nevyplnilo znova.

## Čo to robí
- `SidebarDock.tsx` (AIM-FORK blok): úchytka dostane `::before` zónu 6 px do canvasu (`relative z-10`), spolu 12 px. Hover a aktívna farba platia aj nad touto zónou, takže je vidno, čo sa chytí.
- `aim/planRefit.ts` (nový, čistý): rozhodnutie a debounce. Pôdorys sa prispôsobí len keď je v canvase pôdorys podlažia so zamknutým kolmým pohľadom, plocha má aspoň 80 px a veľkosť sa zmenila o 4 px a viac; kamera sa hýbe až 180 ms po poslednej zmene (ťahanie úchytky = jedno prispôsobenie, nie desiatky). Voľná 3D, uložený pohľad a dokument na celú plochu sa nemenia.
- `aim/useAimPlanRefit.ts`: ResizeObserver na stredný región (`data-floating-snap-bounds`), po ustálení volá `fitAll` upstreamu (priblíženie bez zmeny smeru pohľadu, D-098). Pripojené z `useAimCenterPanes.ts` (3 riadky).
- Nové správy mosta ani tooly niet; rozhodnutie D netreba (oprava chyby).

## Upstream súbory (len AIM-FORK bloky)
- `SidebarDock.tsx`: nahradený element úchytky v bloku (riadok je už v `FORK_MAINTENANCE.md`). `check-aim-fork-only`: `fork-blocks`.

## Overenie
- `planRefit.test.ts` (11 prípadov) prechádza; všetky `src/aim/*.test.ts` 213/216, tie 3 červené (`aimLensLegend`, `aimLensPlan`, `aimListPlan`) padajú rovnako na `main` (prostredie bez zostavených balíkov).
- Mutačné dôkazy: 9 mutácií `OBSERVED`, obnova overená (`docs/architecture/evidence/aim-211-panel-resize/mutations/`). **Pri otvorení PR daj štítok `revert-oracle-exempt`.**
- Brány: `check-rtc-frame-copies`, `check-module-size`, `check-i18n-literals`, `check-test-glob-coverage` OK; viewer `tsc`: žiadna chyba v zmenených súboroch (zvyšné chyby sú z nezostavených balíkov prostredia).

## Neoverené v session
- Živý viewer: cloud nemá WebGPU a súkromný `design-kit` sa nedal stiahnuť, takže pôdorys sa nevykreslil a ťahanie sa nevyskúšalo. Príčina je preto odvodená z kódu; overí ju odkaz nižšie.
- Veľkosť balíka (`perf-ratchet`) som nemeril z toho istého dôvodu. Očakávam stovky bajtov (dva malé moduly v vstupnom reťazci cez `useAimCenterPanes`); ak by strop pretiekol, zdvih do 2 kB je predschválený.
- Plán vedľa 3D (`DrawingPlanPane`, "Vedľa") a ModelWorkspace plán majú vlastné panely a týmto sa nemenia.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>`
1. V Claude s konektorom: "Otvor pôdorys 1NP v novej záložke." Potom otvor panel vlastností vpravo (napr. klikni na prvok alebo "otvor panel vlastnosti").
2. Chyť okraj medzi pôdorysom a panelom vlastností (aj pár pixelov vľavo od čiary) a ťahaj doľava a doprava: mení sa šírka panela, pôdorys sa nehýbe.
3. Po pustení (asi pol sekundy) sa pôdorys znova vycentruje a vyplní plochu, bez prázdneho miesta pri okraji.
4. To isté s ľavým stromom hierarchie: potiahni jeho okraj, pôdorys sa po ustálení znova vyplní.
5. Kontrola, že sa nič nepokazilo: v záložke 3D ťahanie panela pohľad neprenastaví; uložený pohľad ostane, ako bol.
