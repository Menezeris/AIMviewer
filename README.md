# Fork patch AIM #248 (open_list run=true)

Base: Menezeris/ifc-lite `main` @ bd90e3ecc19a0c70a532effa2af2789c5c7eece0.
sha256 `aim-248-open-list-run.patch`: 3b2bd0aab143ec718bd721f439be8dc81571c10155c21af512cffe3149cd68a7

```bash
git checkout -b claude/aim-248-open-list-run bd90e3ecc
git am aim-248-open-list-run.patch
```

Jeden commit, režim `fork-blocks` (`check-aim-fork-only.mjs`): nové `aim/aimListRun.ts`, `aim/aimListRunPlan.ts` (+ test), úprava `aimList.ts`, `aimListPlan.ts`,
`lens-protocol.ts`, `AimBridge.tsx` a jediný AIM-FORK blok (import + volanie hooku) v `ListPanel.tsx`; riadok v `docs/FORK_MAINTENANCE.md`.
Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer#248 (PR k nemu nesie D-148). Poradie: najprv fork, potom AIMviewer.
V balíku forku čaká Menezeris/ifc-lite#123 (#119 plán, #120 posun panela vlastností, #121 toast); súbory sa nekrížia (ListPanel.tsx a aim/aimList* nemení nič z nich, nekontrolované proti ich diffom).

Neurobené v cloud session (chýbajú závislosti, registry pnpm je nedostupný): `tsc --noEmit` viewera, bundle ratchet (krok 3 skillu aim-feature), mutačné dôkazy
revert oracle (krok 4: test importuje nové exporty, oracle bude INCONCLUSIVE, preto pri otvorení PR štítok `revert-oracle-exempt`), živé overenie (krok 5).
Prešlo: `tsx --test aim/aimListRunPlan.test.ts` (6/6), `oxlint apps/viewer/src/aim` (0 chýb), `check-module-size.mjs` (exit 0), `check-aim-fork-only.mjs` (fork-blocks).
`aimListPlan.test.ts` sa lokálne nespustil (importuje `@ifc-lite/rules`).
