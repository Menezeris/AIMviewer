# Fork patch AIM #183 (posun panela vlastnosti, sledovanie zvyrazneneho riadka)

Base: Menezeris/ifc-lite `main` @ 6a47a50de6321f3174621c00f42f23d43f0ec4eb.
sha256 `aim-183-panel-scroll.patch`: 18a413d46680775392a26240b074e74fd17dd2c9c7ab984ee558b7fbaeb04739

```bash
git checkout -b claude/aim-183-panel-scroll 6a47a50de6321f3174621c00f42f23d43f0ec4eb
git am aim-183-panel-scroll.patch
```

Telo PR: `PR_BODY.md`. Host (AIMviewer PR #241) pridava `set_view_mode panel_scroll`; poradie zlucenia: fork, potom host.
Patch meni len `apps/viewer/src/aim/` (nove `aimPanelScroll.ts`, `aimPanelScrollPlan.ts` + test; male zasahy do `aimPanelView.ts`, `useAimViewCommands.ts`, `view-protocol.ts`) a dokazy; `check-aim-fork-only.mjs` hlasi `aim-only`. Nedotyka sa suborov balika #114-#116 (Menezeris/ifc-lite#118), pri zluceni po nich mozu byt konflikty len v `useAimViewCommands.ts` a `view-protocol.ts` (po jednom bloku).
