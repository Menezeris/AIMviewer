# Fork patch AIM #199 krok 3 (snímka výrezu PDF, D-158)

Base: Menezeris/ifc-lite `claude/aim-199-doc-issues` (krok 2, Menezeris/ifc-lite#141) @ 3510a1db354b6b079d4d8eedf47ff5a1408fe7f7.
sha256 `aim-199-krok3-snimka.patch`: 701b64698fbd604888cdcb84af57a39ee65d52b0bf7aaebf31f2e1cf9e279d80

```bash
git checkout -b claude/aim-199-krok3-snimka 3510a1db
git am aim-199-krok3-snimka.patch
```

Dva commity: kód v `apps/viewer/src/aim/` (režim `aim-only`) a mutačné dôkazy
`docs/architecture/evidence/aim-d158-snapshot/mutations/` (3x OBSERVED). Pri otvorení PR daj štítok
`revert-oracle-exempt`. Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer (PR "Closes #199", vetva
`claude/mcp-199-krok34`, stavia na `claude/mcp-199-bcf-dokumenty`).
Varovanie `git am` o medzerách na konci riadkov sú kontextové riadky v súboroch `.patch` dôkazov.

Poradie: krok 2 (fork #141 a host #266), potom tento patch a host PR krokov 3 a 4. Kombinácie:
starý fork s novým hostom snímky v paneli nesťahuje (`includeSnapshots: false`), nič sa nerozbije;
nový fork so starým hostom: host pohľad so snímkou neponúkne, `/api/drawing/<id>/snapshot` vráti
404 a lokálna pripomienka ostane bez snímky.
