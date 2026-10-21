# AIM D-131: médiá Reality Capture v paneli Documents, zoskupené podľa druhu média

Stavia na vetve `claude/aim-d127-panely` @ `626ed8707` (PR #97, D-127/D-129). AIM rozhodnutie **D-131**, issue Menezeris/AIMviewer#192, AIMviewer časť v PR na vetve `claude/mcp-192-reality-capture`.

## Čo sa mení
- `AimPanelData.captureMedia` (bridge-protocol.ts): médiá Reality Capture vybraného priestoru z hosta (vrstva AIM v DB, nie IFC dokument, nie v `DOCUMENTS_LOAD`).
- Panel Documents, režim "Len pre výber": pod dokumentmi výberu skupiny podľa druhu média (napr. "360° panoráma", "Fotografia") s počtom. Riadok má náhľad (inak ikonu fotoaparátu), dátum snímky, odznak AIM a cestu ("v miestnosti X" alebo "cez miestnosť X"). Klik pošle `AIM_NAVIGATE` na galériu priestoru v hostovi.
- Čistá funkcia `selectionMedia` (documentsQuery.ts): zoskupí, zoradí skupiny podľa mena, filtruje rovnakým filtrom ako dokumenty (názov, druh, cesta, dátum) a zahodí náhľad, ktorý nie je http(s).
- Piny Reality Capture bez zmeny. Starší host pole nepošle a panel sa nezmení.

## Rozsah
Len `apps/viewer/src/aim/` + dôkazy: `check-aim-fork-only` = **aim-only**.

## Overenie
- AIM testy `documentsQuery.test.ts` + `bridge-protocol.test.ts`: 39/39; `tsc --noEmit -p apps/viewer` čisté (po builde balíkov).
- Guardy: rtc-frame-copies, module-size (exit 0, `bridge-protocol.ts` 458/458), i18n-literals, test-glob-coverage OK.
- Bundle: vstup +4 B, ratchet `check` prešiel bez zvýšenia stropu.
- Mutačné dôkazy (`docs/architecture/evidence/aim-d131-capture-media/mutations/`): 3/3 `OBSERVED`, obnova overená. Štítok **`revert-oracle-exempt`** pri otvorení PR.
- Živo: viewer v iframe (FZK-Haus, Playwright), `AIM_PANEL_DATA` pre IfcSpace Buero s 1 dokumentom a 3 médiami. Skupiny "360° panoráma · 1" a "Fotografia · 2" s odznakom AIM, náhľad `https` sa zobrazil, `javascript:` nie. Klik poslal `AIM_NAVIGATE /ifc?captures=s1`, filter "panorama" nechal len panorámu.

## Ako vyskúšať
`https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s AIMviewer PR pre #192: vyber miestnosť s Reality Capture (na produkcii sú 2 body), otvor Documents a zapni "Len pre výber".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_011qHFgBHEAYai1dRf16Feve
