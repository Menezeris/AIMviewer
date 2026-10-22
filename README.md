# Fork patch AIM #211 (úchytka stĺpca vlastností, refit pôdorysu)

Base: Menezeris/ifc-lite `main` @ 660ebd8635496c3f0150f29a8f009adcaa761e7c.
sha256 `aim-211-panel-resize.patch`: 4b54d2e98e8d00037de8156becbdf9a27502403a84ead02e315c9488a46cbea2

```bash
git checkout -b claude/aim-211-panel-resize 660ebd863
git am aim-211-panel-resize.patch
```

Dva commity: kód (`apps/viewer/src/aim/` + jeden AIM-FORK blok v `SidebarDock.tsx`, režim `fork-blocks`) a mutačné dôkazy
`docs/architecture/evidence/aim-211-panel-resize/mutations/` (9x OBSERVED). Pri otvorení PR daj štítok
`revert-oracle-exempt`. Telo PR: `PR_BODY.md`. Host: nič, oprava je len vo forku (Menezeris/AIMviewer#211, PR k nemu je len balík).
Varovania `git am` o medzerách na konci riadkov sú kontextové riadky v súboroch `.patch` dôkazov.

Súbežný balík: #108 až #111 a #216, #223 stoja na tom istom `main`. Tento patch mení `useAimCenterPanes.ts` (3 riadky),
`SidebarDock.tsx` (blok) a pridáva `planRefit.ts`, `useAimPlanRefit.ts`; `useAimViewCommands.ts` a `sceneMode.ts` (#111) nechávam bez zmeny.
Poradie nezáleží.
