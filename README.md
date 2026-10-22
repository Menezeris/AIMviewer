# Fork patch AIM #94 (zrusenie oranzoveho zvyraznenia FOCUS v UI)

Base: Menezeris/ifc-lite `main` @ 660ebd8635496c3f0150f29a8f009adcaa761e7c.
sha256 `aim-94-focus-dismiss.patch`: ef9951fc2c4aa7b88997c09c593c504b382ef5f8f185f1b43a677028996101e1

```bash
git checkout -b claude/aim-94-focus-dismiss 660ebd8635496c3f0150f29a8f009adcaa761e7c
git am aim-94-focus-dismiss.patch
```

Telo PR: `PR_BODY.md`. Host (AIMviewer) sa nemeni, wire protokol ostava rovnaky (CLEAR_FOCUS, show_in_3d clear=true uz existuju od D-101).
