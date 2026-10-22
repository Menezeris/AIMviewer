# Fork patch pre #243 (ikona vlastností ako prepínač)

- Základ: Menezeris/ifc-lite, vetva release/aim-2026-10-22-6, sha 55b995757cecd3f11576410de727226347bab781
- Súbor: 0001-aim-243-properties-rail-toggle.patch (git format-patch, 1 commit)
- sha256: bdccfde9e95c810e1f610b822b0844c38d852215b7658ecb20e762b7b185f0c8
- Použitie: git checkout -b claude/aim-243-properties-toggle 55b99575 && git am 0001-aim-243-properties-rail-toggle.patch
- Zmena: nový aim/aimRailToggle.ts (+ test), v hooks/usePanelControls.ts blok AIM-FORK (import + riadky v toggle()).
- Host sa nemení, PR do AIMviewera nie je.
