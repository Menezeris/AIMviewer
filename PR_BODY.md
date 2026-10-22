## AIM D-149 krok 2: obsah otvoreného zoznamu z chatu (stĺpce, triedy, filtre, podlažie a model, farby, export)

Druhý krok "Excel hlasom" nad panelom Lists (Menezeris/AIMviewer#250, doplnok D-149). Stavia na prvom kroku (PR s `aim/aimListControl.ts`, vetva `claude/aim-250-list-control`), patch je jeden commit nad ním.

- `LIST_UPDATE` dostane `edit` (v `lens-protocol.ts`): `addColumns` / `removeColumns` (stĺpec menom; nový na koniec s novým id, existujúci sa nezdvojí, odobratý zmizne aj zo zoskupenia, súčtov a zoradenia), `addTypes` / `removeTypes` (pravidlo "IFC trieda je jedna z" sa v každej skupine rozšíri alebo zúži), `removeFilters` (druhy pravidiel, `all` = všetky okrem tried). Logika v novom čistom module `aim/aimListEditPlan.ts` (+ test); chyba (neznámy stĺpec, trieda, posledná trieda, zoznam bez filtra) je problém v `APPLIED` a zoznam sa nemení. Úprava spustí zoznam znova cestou D-148.
- Podlažie a model pri `LIST_UPDATE` nahradia doterajšie pravidlo toho druhu (`andGroups`); ostatné filtre ďalej AND. Predtým dával AND dvoch podlaží prázdny zoznam.
- `view.colorBy` (stĺpec alebo `null`) volá upstream "Color by" tabuľky (`handleColorByColumn` -> `activateAutoColorFromColumn(columnToAutoColor(col))`), tú istú Lens auto-color cestu; stĺpce podlažie, priestor, zóna a geometria Lens nevie, viewer to hlási v `APPLIED`. `null` vypne len "Color by" z tabuľky, Lens "AIM chat" nechá.
- `view.export` (`csv` | `xlsx` | `pdf`): stiahnutie bez kliku iframe nepustí (D-111), preto hák ukáže pri Exporte zvýraznené tlačidlo "Download <formát>" (`aim/AimListExportCue.tsx`, lenivo cez `React.lazy`); klik používateľa zavolá upstream `handleExport(format)` a tlačidlo zmizne.
- Stav zoznamu (`view_state`, `APPLIED.state.list`) má navyše `color_by` a `export_ready`.
- Upstream: len `ListResultsTable.tsx`, AIM-FORK blok háku presunutý pod `handleExport` a jednoriadkový blok pre prop `actions` (436/467 riadkov). `bridge-protocol.ts` ani `BottomStrip.tsx` sa nemenia.

Starší host `edit`, `colorBy` ani `export` neposiela; starší fork ich ignoruje (host vtedy farby ani export nepotvrdí).

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným).
2. Po zlúčení hostu (doplnok D-149) v Claude s konektorom: "otvor tabuľku stien a hneď ju spusti", potom "nechaj len prízemie", "prepni na podkrovie", "pridaj aj stropy a nosníky a stĺpec materiál", "zruš filter podlažia", "ofarbi prvky podľa ThermalTransmittance", "priprav export do CSV". Bez hostu: z hostiteľskej stránky pošli `OPEN_LIST` a potom `LIST_UPDATE` s `groups`, `edit` a `view`.
3. Očakávané: po "prepni" je v tabuľke druhé podlažie (nie prázdna tabuľka), pribudnú triedy a stĺpec, farby prvkov s legendou v Lens, nad ikonou Export svieti "Download CSV (.csv)" a klik stiahne súbor. `APPLIED.state.list` povie `filters`, `columns`, `color_by`, `export_ready`.

### Overenie
- Živé: lokálny viewer v iframe, `AC20-FZK-Haus.ifc`, Playwright, správy vyrobené kódom hostu (`listBridgeMessage`): `OPEN_LIST` stien (run, maximize); storey Erdgeschoss (9 riadkov); storey Dachgeschoss (4 riadky, filter `storey in Dachgeschoss`, nie AND); `edit` +IfcSlab +IfcBeam, +Material +ObjectType, -GlobalId (10 riadkov); `removeFilters [storey]` (21 riadkov); `colorBy` ThermalTransmittance + `export csv` (`color_by`, `export_ready: csv`, tlačidlo viditeľné, klik stiahol `Steny.csv` s hlavičkou `Name,Podlažie,ThermalTransmittance (W/(m²·K)),Material,ObjectType`, tlačidlo zmizlo); `colorBy` podlažie (problém v APPLIED); `colorBy null` (farby preč); `removeTypes` (13 riadkov); neznáma trieda IfcDoor (problém, zoznam nezmenený). Snímka `live-list-export-cue.png`.
- `tsx --test src/aim/*.test.ts` (296/296), `tsc --noEmit` viewera (0 chýb), `oxlint apps/viewer/src/aim` (0 chýb, žiadne varovanie v nových súboroch), `check-jsx-a11y` (bez nárastu, žiadne `role`), `check-module-size` (exit 0; `ListResultsTable.tsx` 436/467), `check-type-scale` (`text-2xs`), `check-i18n-literals`, `check-rtc-frame-copies`, `check-aim-fork-only` (fork-blocks). Tlačidlá `min-h-6`.
- Bundle (vite build tejto vetvy a jej základu `cf83e5c9`, `measure-bundle`): entry -541 B, eager +2 816 B (tlačidlo je lenivé; v predschválenom 2 kB / 10 kB). Strop entry prekračuje už základ `cf83e5c9` (3 174 646 B pri strope 3 169 867 + 0,1 %), tento patch ho mierne znižuje; strop som nezdvíhal, patrí to balíku.
- Neurobené: mutačné dôkazy revert oracle (test importuje nový modul, oracle bude INCONCLUSIVE; pri otvorení PR štítok `revert-oracle-exempt`), plné CI.

Host: Menezeris/AIMviewer#250 (doplnok D-149). Poradie: najprv fork (krok 1, potom tento), potom host.
