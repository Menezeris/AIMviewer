# Fork patch AIM #199 krok 2 (D-158: pripomienka na PDF ako BCF téma panela)

Base: Menezeris/ifc-lite `main` @ c988e100fbc1249ffcec4c8c5828f6063c1f0f4d.
sha256 `aim-199-doc-issues.patch`: e8d3d1abfbc503a8b961649ecdb67e4a5c28dbcc1642a132165855010e364207

```bash
git checkout -b claude/aim-199-doc-issues c988e100
git am aim-199-doc-issues.patch      # overené: strom zhodný s commitom fdf64fa6
```

Jeden commit, režim `fork-blocks` (`check-aim-fork-only.mjs`): nové `aim/docIssueModel.ts` (+ test), `aim/docIssues.ts`,
`aim/AimDocumentIssue.tsx`; úprava `aim/aimBcf.ts`, `aim/bcf-protocol.ts` (+ test), `aim/viewQueries.ts`; v
`components/documents/DocumentPane.tsx` len existujúci blok AIM-FORK; riadok v `docs/FORK_MAINTENANCE.md`; dôkazy mutácií
`docs/architecture/evidence/aim-d158-doc-issues/mutations/` (8x OBSERVED). Pri otvorení PR štítok `revert-oracle-exempt`.
Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer#264 (Refs #199). Poradie: fork, potom AIMviewer.

Bundle oproti `c988e100`: entry -713 B, eager +774 B (ratchet v strope).

Živé overenie (testovací host s falošným BCF API, testovacie PDF, bez produkčných dát): `live-doc-issue-local.png`
(neuložená pripomienka N1 na strane 1 a v zozname BCF spolu s témou z chatu, po obnove z hosta ostala),
`live-doc-issue-saved.png` (po uložení chatom tá istá téma ako #2, bez duplicity, klik na rámik otvoril tému).
