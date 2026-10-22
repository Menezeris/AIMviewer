# Fork patch AIM #188 (ponuka prepnutia do 3D pri pokuse o orbit v zamknutom pôdoryse, D-147)

Base: Menezeris/ifc-lite `main` @ 6a47a50de6321f3174621c00f42f23d43f0ec4eb.
sha256 `aim-188-pdorys-orbit.patch`: 32b03f70538d1ea54e4b373044a4a2a53914ac4b7e726a40e5aeb5407d856d66

```bash
git checkout -b claude/aim-188-pdorys-orbit 6a47a50de6321f3174621c00f42f23d43f0ec4eb
git am aim-188-pdorys-orbit.patch
```

Telo PR: `PR_BODY.md`. Host (AIMviewer) sa nemení. Patch pridáva `aim/planOrbitHint.ts` (+ test), `aim/AimPlanOrbitHint.tsx`, mení `aim/AimViewTabsBar.tsx` (2 riadky) a pridáva 2 kľúče do `aim-fork.en.ts`. Upstream súbory sa nemenia (mód `aim-only`). Nebol spustený tsc, oxlint, testy ani mutačné dôkazy: overí orchestrátor pri aplikovaní.
