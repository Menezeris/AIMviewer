# Fork patch AIM #175 (podstava ofarbenej miestnosti v 3D, doplnok D-125)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-175-room-floor-3d.patch`: a3d80214c9d15321e950133ab39e05e160042754e242db86d854d4013210604e

```bash
git checkout -b claude/aim-175-room-floor-3d c988e100fbc1249ffcec4c8c5828f6063c1f0f4d
git am aim-175-room-floor-3d.patch
```

Dva commity: kod + mutacne dokazy. Telo PR: `PR_BODY.md`. Snimka pred/po zo zivej skusky (syntetický IFC, vlavo main, vpravo patch): `aim-175-pred-po.png`.
Logika v `apps/viewer/src/aim/` (nove `aimRoomFill3d.ts` + test, `aimLensPaint.ts`, `aimRoomFill3dStore.ts`; zmeny `AimRoomFillLayer.tsx`, `aimLensPlan.ts`),
upstream len v blokoch AIM-FORK (`hooks/useLens.ts`, `components/viewer/useViewportSymbolicUploads.ts`) a dva riadky v `docs/FORK_MAINTENANCE.md`;
`check-aim-fork-only.mjs` hlasi `fork-blocks`. Pri otvarani PR stitok `revert-oracle-exempt`.
Host (AIMviewer, Closes #175) len zapisuje doplnok D-125, rozhranie toolu sa nemeni; poradie zlucenia: fork, potom host.
