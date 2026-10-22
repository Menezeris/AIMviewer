# Fork patch AIM #223 (čiara trasy, ROUTE_SHOW, D-137)

Base: Menezeris/ifc-lite `main` @ 660ebd8635496c3f0150f29a8f009adcaa761e7c.
sha256 `aim-223-route-line.patch`: ad6d6f524cd9a7b78867ab29a92146eacb46c55044a06178d0d9195e9cfcf51b

```bash
git checkout -b claude/aim-223-route-line 660ebd863
git am aim-223-route-line.patch
```

Dva commity: kód v `apps/viewer/src/aim/` (režim `aim-only`) a mutačné dôkazy
`docs/architecture/evidence/aim-d137-route-line/mutations/` (5x OBSERVED). Pri otvorení PR daj štítok
`revert-oracle-exempt`. Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer (PR "Closes #223").
Varovanie `git am` o medzerách na konci riadkov sú kontextové riadky v súboroch `.patch` dôkazov (ako pri iných dôkazoch).

Poradie: fork sa zlúči a nasadí pred hostom alebo spolu s ním. Starý fork s novým hostom správu
`ROUTE_SHOW` zahodí (neznámy typ), nič sa nerozbije; čiara sa len nezobrazí.
