## AIM D-149: úpravy otvoreného zoznamu z chatu (maximalizácia, filter, zoradenie, súčet, stav)

"Excel hlasom" nad panelom Lists (Menezeris/AIMviewer#250): chat upravuje jeden otvorený zoznam po krokoch, bez zakladania nového.

- `OPEN_LIST` dostane pole `view` a pribudne správa `LIST_UPDATE {groups?, view?}` (v `lens-protocol.ts`). `view` = `maximize`, `sort {column, dir} | null`, `sum`, `groupBy`, `search`; stĺpec je menom (`source`, `propertyName`, `psetName`), viewer ho nájde v stĺpcoch zoznamu. Chýbajúci stĺpec je problém v `APPLIED` a tú časť úpravy nevykoná (preklep nezmaže súčty).
- `LIST_UPDATE.groups` pribudnú ako AND ku každej skupine filtrov zoznamu a zoznam sa spustí znova cestou D-148 (nové id definície); zoradenie a hľadanie sa prenesú na nový výsledok.
- Zoskupenie a súčty idú do upstream `ListDefinition.grouping` tou istou cestou ako hlavička tabuľky (`summariseListRows` + `carryListRun`, uložený zoznam sa prepíše ako pri `handleGroupingFromTable`).
- Zoradenie a hľadanie (lokálny stav `ListResultsTable`) a maximalizácia (lokálny `isMaximized` v `BottomStrip`, to isté ako tlačidlo Maximize) cez háky v AIM-FORK blokoch; logika v `aim/`.
- Stav zoznamu `list` je vo `view_state` aj v `APPLIED.state.list`: názov, `has_result`, `rows`, `visible_rows`, stĺpce, filtre (krátky opis), zoradenie, hľadanie, `group_by`, `sum_columns`, `sums` (súčty zobrazených riadkov v jednotke tabuľky, tie isté čísla ako päta tabuľky), `maximized`. Platí aj pre zoznam zostavený používateľom.

Starší host `view` ani `LIST_UPDATE` neposiela; starší fork ich ignoruje (host vtedy úpravy nepotvrdí).

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným).
2. Po zlúčení hostu D-149 v Claude s konektorom: "otvor tabuľku stĺpov s objemom a hneď ju spusti", potom "daj ju na celú obrazovku", "nechaj len 3NP", "zoraď podľa objemu zostupne", "sčítaj NetVolume", "zoskup podľa podlažia". Bez hostu: z hostiteľskej stránky pošli `OPEN_LIST` s `run: true` a `view: {maximize: true, sum: [...]}`, potom `LIST_UPDATE`.
3. Očakávané: panel Lists na celú plochu, tabuľka zúžená na podlažie, zoradená, so súčtom v päte; `APPLIED.state.list.sums` nesie súčet, `get_viewer_state` vráti ten istý stav. `maximize: false` vráti pruh späť.

### Overenie
- Živé: lokálny viewer v iframe, `AC20-FZK-Haus.ifc`, Playwright: `OPEN_LIST run + maximize + sum` (13 stien), `LIST_UPDATE` storey Erdgeschoss + zoradenie desc (9 riadkov, súčet GrossVolume 49.081442 m³), `groupBy` podlažie, neznámy stĺpec (problém v APPLIED, súčty ostali) + `maximize: false` (`maximized: false` v APPLIED aj vo `view_state`).
- `tsx --test` `aimListViewPlan.test.ts`, `aimListPlan.test.ts`, `aimListRunPlan.test.ts` (16/16), `tsc --noEmit` viewera (0 chýb), `oxlint apps/viewer/src/aim` (0 chýb), `check-jsx-a11y` (bez nárastu), `check-module-size` (exit 0; `ListResultsTable.tsx` 434/467), `check-type-scale`, `check-i18n-literals`, `check-test-glob-coverage`, `check-aim-fork-only` (fork-blocks).
- Bundle (vite build vetvy a základu balíka 8, `measure-bundle`): entry +1 335 B, eager +2 264 B (v predschválenom 2 kB / 10 kB). Základ balíka 8 je nad stropom entry už bez tohto PR (3 173 311 B pri strope 3 169 867 + 0,1 %); strop som nezdvíhal, patrí to balíku.
- Neurobené: mutačné dôkazy revert oracle (test importuje nové exporty, oracle bude INCONCLUSIVE, pri otvorení PR štítok `revert-oracle-exempt`), plné CI.

Host: Menezeris/AIMviewer#250 (D-149). Poradie: najprv tento PR, potom host.
