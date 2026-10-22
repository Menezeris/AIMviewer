# Fork patch AIM #235 (MEASURE_SHOW s prázdnymi úsekmi zmaže kóty od hosta)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-235-clear-measure.patch`: 64e1c9be5eabd8f1e04a15aa18f3483608d0608195971c7cf85b9e2481342965

```bash
git checkout -b claude/aim-235-clear-measure c988e100f
git am aim-235-clear-measure.patch
```

Jeden commit, režim `aim-only` (`check-aim-fork-only.mjs`): `aim/view-protocol.ts` (kontrola správy `MEASURE_SHOW` pripúšťa prázdne `segments`) a `aim/measure-show.test.ts`.
Upstream ani `bridge-protocol.ts` (458 riadkov) sa nemenia; `hostMeasurements.ts` mazanie kót od hosta už vedel.
Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer#235 (PR nesie D-152). Poradie: najprv fork, potom AIMviewer.

Prešlo: `tsx --test aim/measure-show.test.ts` (4/4), mutačný dôkaz (bez zmeny v `view-protocol.ts` nový test padá, 3 pass / 1 fail), `oxlint apps/viewer/src/aim` (0 chýb, len staré varovania),
`check-module-size.mjs` (exit 0), `check-type-scale.mjs` (exit 0), `check-aim-fork-only.mjs` (aim-only).
Neurobené v cloud session (chýbajú závislosti forku, pnpm install padá): `tsc --noEmit` viewera, `check-jsx-a11y` (oxlint v kontrolnom skripte nie je nainštalovaný; patch nemení žiadny JSX), bundle ratchet, živé overenie.
