## Co
Dlazdice zaloziek vo vieweri (AIM #210 krok 2, D-157), ako Tile Windows v Revite: 1 az 4 okna naraz.

- Rozlozenia: `single`, `split_h` (2 vedla seba), `split_v` (2 pod sebou), tri okna s velkou dlazdicou vlavo / vpravo / hore / dole (`three_left`, `three_right`, `three_top`, `three_bottom`), `three_h`, `three_v` (3 vedla seba / pod sebou), `grid4` (2x2). Kazda dlazdica ukazuje jednu otvorenu zalozku, moze byt prazdna.
- Jedno zive 3D: jediny WebGPU canvas sa nikdy neremountuje, `useAimCenterPanes` ho len posunie do obdlznika zivej dlazdice. Ostatne 3D dlazdice (3D, podorys, ulozeny pohlad) ukazuju snimku (`tileShots.ts`, kopia posledneho snimku canvasu), klik ich urobi zivymi. 3D dlazdica bez snimky sa po nastaveni rozlozenia raz ukaze v canvase (`prerender`, most na to pocka pred `APPLIED`).
- Dokument je v dlazdici vzdy zivy (aj dva rozne naraz); podorys bez podkladu ide do dlazdice ako 3D zalozka.
- UI: prepinac "Rozlozenie" v liste zaloziek, v hlavicke dlazdice vyber zalozky alebo neotvoreneho podorysu. "Vedla" pre dvojicu, ktoru plocha bez dlazdic nevie (podorys bez podkladu vedla 3D, dve 3D, dva dokumenty), prepne na `split_h`.
- Most: `VIEW_TABS {action: 'layout', layout, tiles: [{tab} | {plan} | null]}` (`tiles-protocol.ts`), stav `view_state.layout` aj v `APPLIED`.
- Logika v `aim/viewTilesPlan.ts` s testom; upstream len AIM-FORK blok `ViewerLayout.tsx` (obal 3D canvasu s `data-aim-tiles`); mriezku montuje lenivá lista cez portal. Rezim `fork-blocks`.
- Oprava `aimSideDock.test.ts` po zluceni #106 s main (chybal `drawing2DPanelVisible`).

## Ako vyskusat
Odkaz pre Samuela: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<cislo>` (session neotvara produkcny viewer, D-135).
1. V liste zaloziek zvol "Rozlozenie: 2 vedla seba": vlavo 3D, vpravo dalsia otvorena zalozka alebo prazdna dlazdica; v jej hlavicke vyber "+ Podorys 1NP".
2. Klik na dlazdicu so snimkou ju urobi zivou (zelena hlavicka "zive 3D"), doterajsia ziva ostane ako snimka.
3. Prepni "3: velke dole" a "4 (2x2)", otvor PDF dokument (open_drawing target=tab) a daj ho do dlazdice: listuje sa v nej.
4. Z chatu: `set_view_mode(layout='split_h', tiles=['3D','1NP'])`, `set_view_mode(layout='grid4', tiles=['3D','1NP','2NP','none'])`, spat `set_view_mode(layout='single')`; `get_viewer_state` vrati `layout`.

## Overenie
- `viewTilesPlan.test.ts` 11/11 (tsx --test), AIM testy 266/269 (3 zlyhania su prostredie: nezbuildovany `@ifc-lite/regex-guard`), `tsc` bez chyb v `aim/` a `ViewerLayout.tsx`, `npx oxlint apps/viewer/src/aim` 0 chyb, `check-module-size` (exit 0), `check-jsx-a11y`, `check-type-scale`, `check-i18n-literals`, `check-test-glob-coverage` OK.
- Balik (vite build vetvy a zakladu main + #106 rovnako): `viewer-entry-js-bytes` -80 B, `viewer-eager-js-bytes` +398 B (mriezka, logika a protokol su lenive).
- Mutacne dokazy: 7 patchov, vsetky OBSERVED, `docs/architecture/evidence/aim-d157-tiles/`; stitok `revert-oracle-exempt`.
- Zivo v iframe s mostom na `AC20-FZK-Haus.ifc` (Playwright): `VIEW_TABS layout split_h` -> mriezka, canvas v zivej dlazdici (422x689 px), klik na snimku presunie canvas, `three_bottom`, `grid4`, vyber neotvoreneho podorysu v dlazdici, `single` vrati canvas na celu plochu; `APPLIED.state.layout` sedi. WebGPU v kontajneri stratilo zariadenie (aj pred zmenou), preto pixely snimky naživo overene neboli; citanie je to iste ako pri BCF snimke (`lib/viewport-capture.ts` cita canvas po prezentacii).

## Poznamky
- Zive je naraz len jedno 3D (jeden canvas); skutocne viac zivych 3D by bol zasah do upstream renderera (viewporty) alebo druhy renderer (dvojnasobna pamat GPU), D-157 ich zamieta.
- Na mobile sa dlazdice nekreslia (lista zaloziek tam nie je).
