# Fork patch AIM #216 (zalozka 3D ostava perspektivna a volna)

Base: Menezeris/ifc-lite `main` @ 660ebd8635496c3f0150f29a8f009adcaa761e7c.
sha256 `aim-216-3d-zalozka.patch`: 573eaa367dec967d404d0d65e4b642c6429cdf9789eecdc0c62dc627225cccc4

```bash
git checkout -b claude/aim-216-3d-zalozka 660ebd8635496c3f0150f29a8f009adcaa761e7c
git am aim-216-3d-zalozka.patch
```

Telo PR: `PR_BODY.md`. Host (AIMviewer) sa nemeni. Patch sa nedotyka suborov balika #108, #109 (visibility-commands.ts, bridge-protocol.ts) ani #110 (AimRouteLayer); meni len useAimViewCommands.ts a pridava sceneMode.ts (+ test, dokazy).
