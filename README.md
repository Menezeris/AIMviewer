# Fork patch AIM #179 (vsetky panely UI v SET_PANELS, posun a zoom panelov)

Base: Menezeris/ifc-lite vetva `release/aim-2026-10-22-5` (balik 8, obsahuje #120 scroll panela) @ 63408cd5231266915716ea61a00e742e12316394.
sha256 `aim-179-panels.patch`: 076751846f3ddcdbb752697f3c8f5df88e4b2cff08762ed453778af8fa10d12a

```bash
git checkout -b claude/aim-179-panels 63408cd5231266915716ea61a00e742e12316394
git am aim-179-panels.patch
```

Telo PR: `PR_BODY.md`. Host (AIMviewer, vetva `claude/mcp-179-panely-bcf-scroll`, D-150) pridava `set_view_mode panels` pre vsetky panely, `panel_scroll` ako objekt a `panel_zoom`; poradie zlucenia: fork, potom host. Host stoji na vetve D-146 (#183), zlucit ju pred nim.
Patch meni `apps/viewer/src/aim/` (nove `aimPanelList.ts` + test; `aimPanels.ts`, `aimPanelsPlan.ts`, `aimPanelScroll.ts`, `aimPanelScrollPlan.ts`, `view-protocol.ts`, `viewQueries.ts`, `useAimViewCommands.ts` + testy) a jeden upstream subor v bloku AIM-FORK: `lib/panels/renderPanelBody.tsx` (obalka `data-aim-panel`, `display: contents`). `check-aim-fork-only.mjs` hlasi `fork-blocks`. Nedotyka sa `bridge-protocol.ts` (ostava 458 riadkov).
Lokalne spustene: `tsx --test` pre aimPanelList/aimPanelsPlan/aimPanelScrollPlan (17/17), `npx oxlint apps/viewer/src/aim` (0 chyb), `check-jsx-a11y` (bez narastu), `check-module-size`, `check-type-scale` (OK), `tsc` bez chyb v zmenenych suboroch. Nespustene: build a perf ratchet, viewer testy s balikmi (workspace balicky sa v cloud session nezostavili, design-kit vrati 403), zivy test v prehliadaci, mutacne dokazy revert oracle (plytky klon bez origin/main).
