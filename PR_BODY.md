# AIM #212: ikona panela v pravom raile zodpovedá skutočnému stavu

AIM #212 (host Menezeris/AIMviewer). Po `set_view_mode(panels: {properties: close})` ostala ikona vlastností zvýraznená, hoci stav hlásil `properties open=false`.

## Príčina
`SET_PANELS` zatvára vlastnosti zbalením pravého stĺpca (`sidebarMode = collapsed`). Rail (`usePanelControls`) však považoval `sidebarActivePanel` za ukotvený aj pri zbalenom stĺpci, kým `panelInfo` (stav pre `view_state` / `APPLIED`) zbalenie rešpektoval. Dve rôzne pravdy.

## Čo to robí
- Nový `aim/aimSideDock.ts`: `sideDockedPanels` = jediný zdroj, ktorý bočný panel je naozaj vidno (zbalený stĺpec = nič, odpojený aktívny panel = návrat na vlastnosti, split).
- `aimPanelsPlan.ts` (`panelInfo`) aj rail ho používajú. Platí pre všetky panely, nech sa zatvorili klikom, skratkou alebo cez MCP.

## Upstream súbory (len AIM-FORK bloky)
- `apps/viewer/src/hooks/usePanelControls.ts`: import a náhrada dvoch `useMemo` (`sideDocked`, `secondaryDocked`) v bloku.

## Overenie
- `tsc --noEmit` viewer: čisté. `aimSideDock.test.ts` + `aimPanelsPlan.test.ts`: 7/7 zelené. `check-module-size`, `check-test-glob-coverage`: OK.
- Mutačné dôkazy: `docs/architecture/evidence/aim-212-rail-highlight/mutations/` (2 mutácie, obe zhodia 2 testy).
- NEPREBEHLO: `check-i18n-literals` a revert oracle (bez `pnpm install`), živý viewer. Overí rýchle CI.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>`.
1. Otvor panel Vlastnosti (ikona info v pravom raile svieti).
2. V Claude s konektorom: "Zavri panel vlastností".
3. Ikona info zhasne; `get_viewer_state` hlási `properties open=false`.
4. Zopakuj s Lens / Dokumenty / Podklady (zavri cez chat aj klikom): ikona vždy zodpovedá stavu.
