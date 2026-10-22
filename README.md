# Fork patch AIM #214 (Ukazat v 3D pri PDF: Solo podlazia a rezove nastroje)

Base: Menezeris/ifc-lite `main` @ 660ebd8635496c3f0150f29a8f009adcaa761e7c.
sha256 `aim-214-show3d-solo.patch`: a83317ca0f733e8e796f9fbcf11a82d10a0d9e04c44234f6665f549de735ca19

```bash
git checkout -b claude/mcp-214-show3d-solo 660ebd8635496c3f0150f29a8f009adcaa761e7c
git am aim-214-show3d-solo.patch
```

Telo PR: `PR_BODY.md`. Rezim `check-aim-fork-only`: aim-only (upstream subory nedotknute). Host (AIMviewer) sa nemeni, wire protokol ostava rovnaky (DOCUMENT_SHOW_3D sa pre dokument s podlazim uz neposiela). Treba zapisat D-145 do DECISIONS.md v AIMvieweri (sprístupnenie existujucich funkcii viewera: Solo podlazia a panel Add a plane). Na PR stitok `revert-oracle-exempt` hned pri otvoreni.
