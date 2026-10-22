# Fork patch AIM #210 krok 2 (D-157, dlazdice vo vieweri)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d zlucene s PR #106
(`claude/ecstatic-euler-n7wrl1` @ 2982d8e2f98ff0bb8a70c0d0207efc79ec736b19, D-136).
sha256 `aim-210-d157-dlazdice.patch`: 1609289d0de35d1e08a0c8bdb23287dae73504979441693c865b12af6bad9dba

```bash
git checkout -b claude/aim-d157-dlazdice c988e100fbc1249ffcec4c8c5828f6063c1f0f4d
git merge 2982d8e2f98ff0bb8a70c0d0207efc79ec736b19
# konflikt apps/viewer/src/aim/aimPanelsPlan.ts: nechaj oba riadky, najprv
#   if (key === 'drawing') return s.drawing2DPanelVisible ? ... (z #106)
# a potom blok sideDockedPanels(...) z main
git am aim-210-d157-dlazdice.patch
```

Ked je #106 uz v main (balik 10), staci `git am` na main (rovnake riesenie konfliktu ako vyssie).
Overene: na takto zlucenom zaklade sa patch aplikuje a strom je zhodny s pracovnou vetvou.

Telo PR: `PR_BODY.md` (pri otvarani stitok `revert-oracle-exempt`). Host: AIMviewer PR s "Closes #210",
stavia na #215 (D-136); poradie zlucenia fork (#106, potom tento), potom AIMviewer (#215, potom D-157).
