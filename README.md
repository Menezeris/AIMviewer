# Fork patch AIM #247 (AUTO_ROTATE: plynule otacanie kamery dokola)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-247-auto-rotate.patch`: 5678f8b8507e77de97c136878a702539ffc887716cc945f917a42f4b1927dc0d

```bash
git checkout -b claude/aim-247-auto-rotate c988e100f
git am aim-247-auto-rotate.patch
```

Jeden commit, režim `aim-only` (`check-aim-fork-only.mjs`), len `apps/viewer/src/aim/`: nový `autoRotatePlan.ts` (čistá matematika) s `autoRotatePlan.test.ts`,
nový lenivý `autoRotate.ts` (snímková slučka cez `cameraCallbacks.applyViewpoint`), správa `AUTO_ROTATE` vo `view-protocol.ts` a zapojenie v `useAimViewCommands.ts`.
Upstream súbory ani `bridge-protocol.ts` (458 riadkov) sa nemenia. Upstream fork auto-rotate vo viewer nemá (`autoRotate` je len v hero scéne landing stránky).
Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer#247 (PR nesie D-154). Poradie: najprv fork, potom AIMviewer.

Prešlo: `tsx --test aim/autoRotatePlan.test.ts` (8/8) a súvisiace `view-protocol.test.ts`, `aimPanelScrollPlan.test.ts`, `cameraSettle.test.ts` (spolu 19/19),
mutačné dôkazy (4 mutácie: opačný smer, bez zrezania kroku, bez otáčania `up`, príliš široká tolerancia; každá zhodí aspoň jeden test),
`oxlint apps/viewer/src/aim` (exit 0, 0 chýb, len staré varovania), `check-module-size.mjs` (exit 0), `check-type-scale.mjs` (exit 0), `check-aim-fork-only.mjs` (aim-only).
Neurobené v cloud session (fork nemá nainštalované závislosti): `tsc --noEmit` viewera, `check-jsx-a11y` (patch nemení žiadny JSX, takže bez nárastu), meranie bundle ratchetu
(vstup rastie len o správu v `view-protocol.ts` a malý case v `useAimViewCommands.ts`, odhad pod 1 kB; `autoRotate.ts` je lenivý), živé overenie v iframe.
