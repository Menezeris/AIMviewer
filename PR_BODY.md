# AIM #223: čiara trasy od hosta (ROUTE_SHOW, D-137)

AIM #223, host Menezeris/AIMviewer (PR "Closes #223"). `ifc_measure route=escape show=true` vracal len kroky a dĺžku, vo vieweri sa nekreslilo nič.

## Čo to robí
- Nová správa mosta `ROUTE_SHOW { points, color? }`: body lomenej čiary v IFC svete (Z hore, m), najviac 400; prázdne body čiaru zmažú, jeden bod sa odmietne, farba len `#rrggbb` (predvolene `#dc2626`). Body počíta host (1,6 m nad doskou a podlahovou krytinou, na schodisku plynulo rovnobežne s čiarou nábehových hrán stupňov podľa Samuela, stredom každých dverí), fork len kreslí (AIM D-098).
- `aimRoute.ts`: prevod IFC svet -> render rámec (`ifcPointToRender`, ten istý ako pri kótach D-124) a SVG cesta z premietnutých bodov; bod za kamerou čiaru preruší.
- `AimRouteLayer.tsx`: plná červená čiara 3 px (s tenkým bielym lemom kvôli kontrastu) nad scénou ako `AimRoomFillLayer`, prekreslí sa pri pohybe kamery (`useProjectorTick`); kliky prechádzajú do scény. Pripojená v `CapturePinLayer` (lenivý modul). Čiara je bez hĺbky, takže trasu cez viac podlaží vidno aj cez dosky.
- `routeShow.ts` (lenivo z `useAimViewCommands.ts`) + `aimRouteStore.ts` (zustand): nová správa nahradí predošlú čiaru.
- Upstream polyline meranie sa nepoužilo: nemá farbu ani plnú čiaru a pridáva popis dĺžky (D-137).

## Upstream súbory (len AIM-FORK bloky)
- žiadne, všetky zmeny sú v `apps/viewer/src/aim/` (+ dôkazy). `check-aim-fork-only`: `aim-only`.

## Overenie
- `route-show.test.ts` (3 prípady) a súvisiace testy `src/aim` (view-protocol, measure-show, aimPanelsPlan, view-camera): 23/23.
- Mutačné dôkazy: 5 mutácií `OBSERVED`, obnova overená (`docs/architecture/evidence/aim-d137-route-line/mutations/`). Štítok `revert-oracle-exempt` pri otvorení PR.
- Brány: `check-rtc-frame-copies`, `check-module-size`, `check-i18n-literals`, `check-test-glob-coverage` OK; viewer `tsc` bez chyby v zmenených súboroch.
- Balík (lokálne, rovnaký build vetvy a `main`, WASM a design-kit nahradené rovnako v oboch): `viewer-entry-js-bytes` +355 B (3 170 361), `viewer-eager-js-bytes` +528 B; `perf-ratchet check`: všetko v strope a tolerancii, strop sa nezdvíha. Ak by sa v dávke s inými AIM PR stropu dotklo, zdvih do 2 kB je predschválený.
- Živo: lokálny viewer vo vnorenom okne, `AC20-FZK-Haus.ifc` z `public/_fixtures`, body z hosta (`ifc_measure route=escape` z Galerie 7 cez točité schodisko k Terrassentuer). `ROUTE_SHOW` nakreslil červenú čiaru (prvá verzia bodov, 35; teraz plynulá po schodisku, 17 bodov) a prázdne body ju zmazali. Swiftshader v cloude stratil WebGPU zariadenie, takže model ani pohyb kamery sa nevykreslili; čiaru nad modelom overí odkaz nižšie.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>` (s hostom z AIMviewer PR k #223).
1. V Claude s konektorom: "Ukáž únikovú cestu z miestnosti 2.01 vo vieweri."
2. Claude zavolá `ifc_measure(route=escape, a=2.01, show=true)`; vo vieweri je červená plná čiara zo stredu 2.01 cez dvere, po točitom schodisku plynulo šikmo (rovnobežne s nábehmi stupňov) až k vonkajším dverám.
3. Čiara sedí 1,6 m nad podlahou (pri pohľade zboku 1,6 m nad hranou každého stupňa, na podeste vodorovne), prechádza stredmi dverí a pri otáčaní kamery ostáva na mieste.
4. Ďalšia trasa čiaru nahradí; "zruš farby" (`style_in_3d action=reset_colors`) ju zmaže.
