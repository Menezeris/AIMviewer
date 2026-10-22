# Fork patch AIM #250 (D-149, "Excel hlasom" nad panelom Lists)

Base: Menezeris/ifc-lite `release/aim-2026-10-22-5` @ 63408cd5231266915716ea61a00e742e12316394 (balík 8 s #124 open_list run=true a #120).
sha256 `aim-250-list-control.patch`: 622a48728c1051819bbfd4d4e0825f995ec2ade13afe4f61c34505aadd6fb524

```bash
git checkout -b claude/aim-250-list-control 63408cd52
git am aim-250-list-control.patch
```

Jeden commit, režim `fork-blocks` (`check-aim-fork-only.mjs`): nové `aim/aimListControl.ts`, `aim/aimListState.ts`, `aim/aimListViewPlan.ts` (+ test),
`aim/aimListViewStore.ts`, `aim/aimListTable.ts`, `aim/aimStripMaximize.ts`; úprava `aimList.ts`, `aimListPlan.ts`, `aimListRun.ts`, `lens-protocol.ts`,
`viewQueries.ts`; AIM-FORK bloky (import + jedno volanie háku) v `ListResultsTable.tsx` a `BottomStrip.tsx`; dva riadky v `docs/FORK_MAINTENANCE.md`.
`bridge-protocol.ts` sa nemení. Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer PR s `Closes #250` (D-149). Poradie: najprv fork, potom AIMviewer.

Súbory panelov s D-150 (#179) sa nekrížia: D-150 mení `aimPanels*`, `view-protocol.ts`, `aimPanelScroll*`; tento patch nie.

Živé overenie: `live-lists-maximized.png` (AC20-FZK-Haus, Lists maximalizovaný, filter Erdgeschoss, zoradenie podľa GrossVolume, zoskupenie podľa podlažia, súčet 49.0814 m³).
