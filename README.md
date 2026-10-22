# Fork patch: most AIM lenivo v embede (vstupný a eager balík viewera)

Base: Menezeris/ifc-lite `release/aim-2026-10-22-6` @ 9711d5349abff3b90577058d7bb27f18294cf91a.
sha256 `aim-lazy-bridge.patch`: ccff495192361d03bdd24fcdde15938807f2d18a1577418d52ed2d0d7704030b

```bash
git checkout -b claude/aim-lazy-bridge 9711d5349abff3b90577058d7bb27f18294cf91a
git am aim-lazy-bridge.patch
```

Tri commity: kód (`apps/viewer/src/aim/` + riadok v AIM-FORK bloku `App.tsx`), zníženie stropov
`tests/perf-ratchets/bundle.json` (provenance = commit kódu pred `git am`, 8df30e22) a mutačné dôkazy
`docs/architecture/evidence/aim-lazy-bridge/mutations/` (3x OBSERVED). Pri otvorení PR daj štítok
`revert-oracle-exempt`. Telo PR: `PR_BODY.md`.

Host (Menezeris/AIMviewer) sa nemení: posiela správy až po `READY`, na `READY` nemá timeout.
`READY` príde o načítanie chunku mosta neskôr (na lokálnom builde nemerateľné; host overlay zhadzuje na `READY`,
viewer počas toho ukazuje vlastný závoj).
