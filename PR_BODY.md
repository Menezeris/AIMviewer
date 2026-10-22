## Co
Vsetky panely UI ovladatelne z chatu, posun obsahu na polozku alebo poziciu a zoom panela (AIM #179, D-150 v AIMvieweri).

- **Zoznam panelov odvodeny z registra** (`WORKSPACE_PANELS`), nie z rucneho zoznamu: `aim/aimPanelList.ts`. Meno na drote je id panela (`bcf`, `compare`, `validation`, `clash`, `script`...), historicke `underlays` a `model_tree` ostavaju. Klavesova skratka Alt+N je podla poradia v registri ako v ActivityBar (BCF topics = Alt+3). Test `aimPanelList.test.ts` straží, ze kazdy panel registra ma meno, je jedinecne a je vo `view_state`.
- **`SET_PANELS` pre vsetky panely:** otvorenie cez `showWorkspacePanel` (ako rail), zatvorenie podla domova (spodny pas: jeho priznak; split: uvolni dolnu polovicu; panel s priznakom: priznak; panel bez priznaka: stlpec spat na vlastnosti). Vlastnosti sa pri `all=close` zatvaraju posledne. Nezname meno uz nezahodi celu spravu: `APPLIED` ho nahlasi so zoznamom platnych.
- **`view_state.panels`** nesie kazdy panel registra: `open`, `where`, `home`, `shortcut`.
- **`SCROLL_PANEL`** dostal `panel`, `item` (text polozky, bez diakritiky, vycentruje ju `revealRow` z #183) a `percent` (prave jedno z `direction`, `item`, `percent`). Nova sprava **`ZOOM_PANEL`** (`in` / `out` / `reset` alebo nasobok 0,5 az 2,5, CSS `zoom` na obsahu panela, zabudne sa so zatvorenim). `view_state.panel_view` vracia poziciu v %, `at_top`, `at_bottom` a zoom posledne posuvaneho panela.
- Upstream subor: `lib/panels/renderPanelBody.tsx`, jeden riadok vymeneny v bloku AIM-FORK (obalka `<div data-aim-panel className="contents">`, bez vplyvu na rozlozenie).

## Ako vyskusat
1. Spusti viewer s mostom na malom testovacom modeli (AC20-FZK-Haus, nie produkcne IFC, D-135) alebo v preview `https://ai-mviewer.vercel.app/ifc?viewer=pr-<cislo>`.
2. Posli `SET_PANELS` `{ bcf: 'open' }`: otvori sa panel BCF topics (Alt+3). `{ all: 'close', properties: 'open' }`: zostanu len vlastnosti. `{ script: 'toggle', zones: 'toggle' }`: spodny pas a panel zon.
3. Posli `QUERY view_state`: `panels` obsahuje vsetky panely z railu s `shortcut` (Alt+1 az Alt+0), `home` a `open`.
4. Otvor panel BCF a posli `SCROLL_PANEL` `{ panel: 'bcf', percent: 50 }`, potom `{ panel: 'bcf', item: '<text temy>' }` a `{ panel: 'bcf', direction: 'top' }`; `view_state.panel_view` ukaze poziciu. Zly text: v `APPLIED` problem "polozka ... sa nenasla".
5. `ZOOM_PANEL` `{ panel: 'bcf', zoom: 'in' }` dvakrat, potom `'reset'`; panel sa zvacsi o 25 % za krok. Zavri panel: zoom sa zabudne.

## Poznamky
- Lokalne: `tsx --test` aimPanelList, aimPanelsPlan, aimPanelScrollPlan (17/17), `npx oxlint apps/viewer/src/aim` bez chyb, `check-jsx-a11y`, `check-module-size`, `check-type-scale` OK, `tsc` bez chyb v zmenenych suboroch. `bridge-protocol.ts` sa nemenil (458 riadkov).
- **Nespustene** (cloud session, workspace balicky nezostavene, design-kit 403): build a perf ratchet (nova logika je v lenivych moduloch, vstup nesie len `aimPanelList.ts` a konstanty), viewer testy s balikmi, zivy test v prehliadaci. **CSS `zoom` na obsahu panela a `display: contents` obalka nie su zivo overene**: ak by zoom clipol obsah panela s `h-full`, treba zmenit na `transform`/font-size.
- Mutacne dokazy pre revert oracle chybaju (plytky klon bez `origin/main`); pri otvarani PR treba pridat stitok `revert-oracle-exempt` a mutacie dorobit.
- Host (AIMviewer, D-150) sa zlucuje az po tomto PR.
