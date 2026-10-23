# Fork patch AIM #268 (D-160, zóny a ručná oprava odkazov popiskov na výkrese)

Base: Menezeris/ifc-lite `release/aim-2026-10-23` @ b9654415c17738057754a6f708dd31b346f97bc0 (balík 11, nesie #199 krok 2: `aim/docLinks`, karta PDF). `main` forku: cb2182b7edc58e6fc9a9672e8f840e50d740285f.
sha256 `aim-268-zone-links.patch`: 6ba1dc50a77eae77b442a3d275247fb0ed15c0db5c834c1e91fd1ce48bcd0914

```bash
git checkout -b claude/aim-268-zone-links b9654415c
git am aim-268-zone-links.patch
```

Jeden commit, režim `aim-only` (`check-aim-fork-only.mjs`), upstream sa nemení: `aim/docLinks.ts` (cieľ `members`, `manual`, výber členov zóny), nové `aim/docLinkDraftStore.ts` (+ test), lenivý `aim/docLinkDraft.ts` (menu Alt+klik / pravé tlačidlo nad odkazom, Alt+ťah nad textom bez odkazu), `aim/viewQueries.ts` (`view_state.link_draft`), testy v `aim/docLinks.test.ts`.
Telo PR: `PR_BODY.md`. Host: Menezeris/AIMviewer PR s `Closes #268` (D-160). Poradie: najprv fork, potom host; starší fork `members` ignoruje a návrh opravy nevie (ručné priradenie z chatu funguje aj bez neho).

Overenie v cloud session: `apps/viewer/src/aim/docLinks.test.ts` (15/15) a `docLinkDraftStore.test.ts` (4/4) pustené cez esbuild bundle so stubmi `zustand` a `react` (inštalácia balíkov sa nedala, `Menezeris/design-kit` vráti 403); `oxlint apps/viewer/src/aim` 0 chýb, `check-module-size` exit 0, `check-type-scale` exit 0, `check-isolate-expansion-routing` exit 0, `check-aim-fork-only` aim-only. `check-jsx-a11y`, `tsc --noEmit` a `pnpm test` nepobežali (bez inštalácie závislostí), balík JSX nemá.
