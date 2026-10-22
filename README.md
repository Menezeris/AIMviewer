# Fork patch AIM #250 krok 2 (doplnok D-149: stĺpce, triedy, filtre, podlažie a model, farby, export)

Base: Menezeris/ifc-lite `claude/aim-250-list-control` @ cf83e5c994c108847e0411239867e87e00ecacf1 (krok 1, D-149, fork PR #126).
sha256 `aim-250-krok2-list-edit.patch`: 8e57ec6a0388a68ba212fc3f2408548a6799df5069b7ca75fda11fc04c0717d5

```bash
git checkout claude/aim-250-list-control   # hlava cf83e5c9
git am aim-250-krok2-list-edit.patch
```

Jeden commit, režim `fork-blocks` (`check-aim-fork-only.mjs`): nové `aim/aimListEditPlan.ts` (+ test), `aim/AimListExportCue.tsx` (lenivé);
úprava `aimListControl.ts`, `aimListState.ts`, `aimListTable.ts`, `aimListViewPlan.ts`, `aimListViewStore.ts`, `lens-protocol.ts`,
`i18n/catalogues/aim-fork.en.ts`; AIM-FORK bloky v `ListResultsTable.tsx` (hák presunutý pod `handleExport`, jednoriadkový blok pre `actions`);
riadok v `docs/FORK_MAINTENANCE.md`. `bridge-protocol.ts` ani `BottomStrip.tsx` sa nemenia. Telo PR: `PR_BODY.md`.
Host: Menezeris/AIMviewer PR s `Refs #250` (doplnok D-149). Poradie: krok 1 forku, tento patch, potom AIMviewer.

Bundle oproti `cf83e5c9`: entry -541 B, eager +2 816 B.

Živé overenie: `live-list-export-cue.png` (AC20-FZK-Haus, steny + stropy + nosníky bez filtra podlažia, prvky ofarbené podľa
ThermalTransmittance, zvýraznené tlačidlo "Download CSV (.csv)" nad Exportom).
