# AIM D-135: autoload rozbalí gzip archív revízie a zachová meno modelu

AIM #207 / D-135, host Menezeris/AIMviewer (PR "Closes #207"). Cieľ: znížiť egress Supabase Storage.

## Čo to robí
- Host posiela v `?models=` nemenný archív revízie `.../ifc/archive/<MODEL>/vNNN.ifc.gz` (gzip, `Cache-Control: max-age=31536000, immutable`) namiesto `.../ifc/<MODEL>.ifc` (`max-age=60`). Prehliadač tak model stiahne raz na revíziu a cca 5-krát menej bajtov (ASR 24,7 MB -> 4,5 MB, VZT 9,8 MB -> 2,7 MB).
- Archív nemá `Content-Encoding`, `fetch` vráti gzip bajty. Nový `aim/modelFile.ts` ich podľa magického čísla `1f 8b` rozbalí cez `DecompressionStream('gzip')`; obyčajné IFC prejde bez zmeny.
- Meno modelu ostáva `ASR.ifc` (z `archive/ASR/v078.ifc.gz`), lebo most, revízie (`aim/derivations.ts` `modelKey`) a filtre (`"VZT" ~ "VZT.ifc"`) párujú model podľa mena.
- Modul sa načíta lenivo (`await import`) až pri autoloade, vstupný balík sa nemení.
- Skilly `aim-feature`, `steward`, `release-train`: živé overenie nikdy na produkčných modeloch AIM. Odkaz "Ako vyskúšať" je len pre Samuela, session skúša na lokálnom vieweri s testovacím modelom. Dôvod: cached egress Supabase 14,66 GB z 5 GB, cca 75 načítaní z prehliadačov za deň (D-135).

## Upstream súbory (len AIM-FORK bloky, režim `fork-blocks`)
- `hooks/useModelUrlAutoload.ts`: v existujúcom bloku `loadOne` volá `aimModelFile` namiesto ručného `new File`.
- `docs/FORK_MAINTENANCE.md`: riadok súboru doplnený.

## Overenie
- `src/aim/modelFile.test.ts` (tsx --test): 5/5.
- Revert oracle: 5 chirurgických mutácií, všetky OBSERVED, obnova overená (`docs/architecture/evidence/aim-d135-archive-autoload/mutations/`). **Pri otvorení PR daj štítok `revert-oracle-exempt`.**
- `tsc --strict` nad modulom a testom: 0 chýb. `check-aim-fork-only`: `fork-blocks`, 7 súvisiacich viewer testov. `check-rtc-frame-copies`, `check-module-size`, `check-test-glob-coverage`: OK.
- Chromium (Playwright): `fetch` gzip archívu testovacieho `AC20-FZK-Haus.ifc` zo servera bez `Content-Encoding` (ako Supabase) -> `aimModelFile` vrátil `Test.ifc`, `application/x-step`, 2 526 511 B, začiatok `ISO-10303-21;` (zhoda s originálom).

## Neoverené v session
- `pnpm install` padol na privátnej závislosti (`Menezeris/design-kit`, 403), preto nebežal viewer `tsc`, 7 súvisiacich viewer testov (vrátane `useModelUrlAutoload.test.tsx`), `check-i18n-literals` (bez závislostí padá aj na base), bundle ratchet ani živý viewer v iframe. Overí ich rýchle CI (`aim-fast.yml`).

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>` (s hostom z AIMviewer PR k #207, kým nie je v main).
1. Otvor odkaz, v DevTools > Network: modely idú z `.../ifc/archive/ASR/v078.ifc.gz` (cca 4,5 MB) a `.../archive/VZT/v004.ifc.gz` (cca 2,7 MB).
2. Model sa zobrazí ako doteraz; v paneli modelov sú mená `ASR.ifc` a `VZT.ifc`, odznak revízie v078 / v004 sedí.
3. Obnov stránku: archívy sú "(disk cache)", žiadna požiadavka na Supabase.
4. V Claude s konektorom: "Ukáž VZT jednotky v 3D." Výber funguje ako predtým (párovanie modelu podľa mena).
