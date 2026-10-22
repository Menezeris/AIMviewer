## Čo a prečo
Ikona vlastností v pravom ráile sa nespráva ako prepínač (#243). Príčina: vlastnosti sú záloha pravého stĺpca, `toggleWorkspacePanel('properties')` pri aktívnych vlastnostiach volá `showWorkspacePanel('properties')`, čo ich len znova otvorí. Teraz klik na otvorené vlastnosti zbalí stĺpec (rovnako ako `SET_PANELS` v `aimPanels.ts`), ikona zhasne (#212, `sideDockedPanels`).

Logika je v `aim/aimRailToggle.ts`; upstream `hooks/usePanelControls.ts` len v bloku AIM-FORK. Odpojené (plávajúce/okno) vlastnosti, iný panel v stĺpci a zbalený stĺpec sa správajú ako doteraz.

## Ako vyskúšať
Testovací model AC20-FZK-Haus.ifc (nie produkčný), pravý ráil:
1. Klik na ikonu vlastností, keď je otvorený iný panel: vlastnosti sa otvoria.
2. Opakovaný klik na ikonu vlastností: stĺpec sa zbalí a ikona prestane svietiť.
3. Klik na ikonu iného panela a znova na ňu: panel sa zatvorí, stĺpec ukáže vlastnosti (bez zmeny).
4. Plávajúce vlastnosti: klik ich vráti do stĺpca (bez zmeny).
