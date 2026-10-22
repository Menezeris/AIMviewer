# Fork patch AIM #170 (SET_UNDERLAYS_3D: PDF podklady v 3D zapnut / vypnut)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-170-underlays-3d.patch`: ae466cadb6591fb8d49d970677db410fdd375211d4f639b8c2cb360c73d6657f

```bash
git checkout -b claude/aim-170-underlays-3d c988e100f
git am aim-170-underlays-3d.patch
```

Jeden commit, režim `fork-blocks` (`check-aim-fork-only.mjs`). Nová správa mosta `SET_UNDERLAYS_3D { show }` a stav viewera "podklady v 3D".
Vypnuté = uložené PDF podklady sa v 3D plátne nekreslia; kalibrácia, ghost náhľad počas kalibrácie, pôdorys v 2D/split paneli aj zamknutý pôdorysný pohľad ostávajú.
Je to iný stav než `placement.visible` (oko pri výkrese): to sa ukladá do DB (`UNDERLAY_SAVE`) a skrýva podklad aj v 2D.

Súbory:
- v `apps/viewer/src/aim/`: nový `aimUnderlays3d.ts` (store a čistá logika) s `aimUnderlays3d.test.ts`, nový lenivý `AimUnderlays3dToggle.tsx`, správa vo `view-protocol.ts`, case v `useAimViewCommands.ts`, pole `underlays_3d` vo `viewQueries.ts` (`view_state`) a v `appliedViewState` (`APPLIED`);
- katalóg `aim-fork.en.ts` (2 reťazce);
- upstream len v `AIM-FORK` blokoch: `hooks/useDrawingUnderlay.ts` (kópia placementu s `visible: false`, prepočet pri zmene) a `lib/panels/renderPanelBody.tsx` (lenivý prepínač pod panelom Underlays; `DrawingUnderlayPanel.tsx` sa nemení, je na svojom budgete 763 riadkov).
`bridge-protocol.ts` sa nemení (ostáva na 458 riadkoch).
Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer#170 (doplnok D-133). Poradie: najprv fork, potom AIMviewer.

Prešlo: `tsx --test aim/aimUnderlays3d.test.ts` (6/6) a `bridge-protocol.test.ts`, `aimPanelsPlan.test.ts` (spolu 39/39);
mutačné dôkazy (každá zhodí test): ignorovanie zámku pôdorysu (`viewLocked`), obrátené `setShown`; `oxlint apps/viewer/src/aim` (0 chýb, len staré varovania);
`check-module-size.mjs` (exit 0), `check-type-scale.mjs` (exit 0), `check-jsx-a11y.mjs` (exit 0), `check-i18n-literals.mjs` (exit 0),
`check-source-text-assertions.mjs` (exit 0, 0 nových), `check-test-glob-coverage.mjs` (exit 0), `check-aim-fork-only.mjs` (fork-blocks); patch sa aplikuje cez `git am` na base.
Neurobené v cloud session (fork nemá nainštalované závislosti, privátny registry): `tsc --noEmit` viewera, meranie bundle ratchetu (vstup rastie o malý store a import v hooku, odhad pod 1 kB; prepínač je lenivý), živé overenie v iframe, mutačné dôkazy revert oracle.
