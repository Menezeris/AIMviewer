# Fork patch AIM #239 (chvenie výkresu pri zoome 100 %)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-239-doc-width.patch`: 6355ecdaec43b1a4bc900ecd427323329865bb468ba4a7f9bbc137cd76518c85

```bash
git checkout -b claude/aim-239-doc-width c988e100f
git am aim-239-doc-width.patch
```

Jeden commit, režim `fork-blocks` (`check-aim-fork-only.mjs`): nové `aim/docLayout.ts` (+ test), `aim/useDocBodyWidth.ts`, riadok vo `docs/FORK_MAINTENANCE.md`
a tri jednoriadkové AIM-FORK bloky v `PdfDocumentView.tsx` (import, volanie hooku namiesto ResizeObservera, `scrollbarGutter: 'stable'`). Súbor ide z 806 na 797 riadkov
(rozpočet 806 v allowliste ostáva, `check-module-size.mjs` hlási len poznámku "lower the budget"; úprava allowlistu by vyradila PR z `fork-blocks`).
Telo PR: `PR_BODY.md`. Host: žiadna zmena (príčina je vo forku). Súvisí s #238, ten tento patch NErieši (viď PR_BODY).

Prešlo: `tsx --test aim/docLayout.test.ts` (5/5), `oxlint apps/viewer/src/aim` (0 chýb v nových súboroch; 2 staré varovania inde), `check-module-size.mjs` (exit 0),
`check-type-scale.mjs` (OK), `check-aim-fork-only.mjs` (fork-blocks). `check-jsx-a11y.mjs` v cloud session padá aj bez zmien (oxlint JSON "undefined"), nové JSX prvky patch nepridáva.
Neurobené (cloud session, `pnpm install` padá na privátnom Menezeris/design-kit, 403): `tsc --noEmit`, bundle ratchet, mutačné dôkazy (pri PR štítok `revert-oracle-exempt`), živé overenie na viewer-e2e.
