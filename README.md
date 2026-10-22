# Fork patch AIM #187 (X-ray kontext len pre zvolené podlažie)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-187-xray-kontext-podlazia.patch`: 8c97ca79e9fb85f70a332dc28c145f88b7372554d7c9f28c85727ae81f9347d9

```bash
git checkout -b claude/aim-187-xray-kontext-podlazia c988e100
git am aim-187-xray-kontext-podlazia.patch
```

Jeden commit, režim `aim-only` (`check-aim-fork-only.mjs`): nové `aim/aimXrayStoreysPlan.ts` (+ test), `aim/aimXrayStoreys.ts`, úprava `aimLens.ts`, `aimLensPlan.ts`, `lens-protocol.ts`.
Žiadny upstream súbor, žiadny AIM-FORK blok, žiadny riadok vo `FORK_MAINTENANCE.md`. Telo PR: `PR_BODY.md`.
Host: Menezeris/AIMviewer#187 (PR nesie dodatok k D-140). Poradie: najprv fork, potom AIMviewer. Starší fork pole `xrayStoreys` ignoruje (X-ray ostane s celým modelom + varovanie hosta).

Prešlo: `tsx --test aim/aimXrayStoreysPlan.test.ts aim/aimLensPlan.test.ts aim/aimListPlan.test.ts` (29/29), `npx oxlint apps/viewer/src/aim` (exit 0, 0 chýb, 2 staré varovania mimo zmeny),
`check-module-size.mjs` (exit 0), `check-jsx-a11y.mjs` (exit 0), `check-type-scale.mjs` (exit 0), `check-aim-fork-only.mjs` (aim-only), `tsc --noEmit` bez chýb v `src/aim` zmenených súborov
(zvyšné chyby sú z nezbuildovaných balíkov, napr. `@ifc-lite/drawing-underlay`). `bridge-protocol.ts` sa nemenil (458 riadkov).
Mutačné skúšky lokálne (4 z 4 zachytené testom): vynechanie výnimky zdieľaného prvku, vynechanie `keep`, vynechanie normalizácie prípony modelu, vynechanie prekladu na globálne id.

Neurobené v cloud session: bundle ratchet (build viewera nejde bez súkromnej závislosti design-kit, 403) - nové moduly sú lenivé (`aimLens.ts` a po ňom `aimXrayStoreys*.ts`); do vstupného
balíka ide len typ a komentár v `lens-protocol.ts` a ~3 riadky v `aimLensPlan.ts` (tá sa importuje z `AimLensLegendCard`, `aimLensScope`, `aimListPlan`) - zmeraj pred mergom podľa kroku 3 skillu aim-feature.
Revert oracle (krok 4): test importuje nové exporty, bude INCONCLUSIVE, pri otvorení PR štítok `revert-oracle-exempt`. Živé overenie (krok 5) sa nerobilo: store lepidlo `aimXrayStoreys.ts`
(čítanie `spatialHierarchy`, skrytie cez `hideEntities`) je overené len typmi, nie behom v prehliadači.
