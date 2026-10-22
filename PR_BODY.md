## Co
Zalozka 3D je vzdy perspektivna a volna (AIM #216, regresia po zalozkach D-132).

- `show_in_3d select` (FOCUS) uz neprepina 3D zalozku do 2D: rozhodovanie o pohlade ide podla aktivnej zalozky (`sceneMode`), zvysny 2D zamok sa v zalozke 3D berie ako 3D. Z pôdorysu ide prechod na iny pôdorys alebo spat na 3D cez zalozky (`openPlan`, `activate('3d')`), nie cez stary `setMode`.
- `set_view_mode mode=3d` po aktivacii zalozky zrusi zvysny zamok kamery, rez podlazia a ortograficku projekciu (`settle3d`), aj ked bola 3D zalozka uz aktivna (predtym aktivacia nic nespravila a stav hlasil `2d orthographic`).
- Zmena len v `apps/viewer/src/aim/` (novy `sceneMode.ts` + test, malý zásah do `useAimViewCommands.ts`); wire protokol sa nemeni.

## Ako vyskusat
1. Spusti viewer s mostom na malom testovacom modeli (AC20-FZK-Haus, nie produkcne IFC, D-135).
2. Otvor zalozku 3D, `style_in_3d action=isolate` na dvere, potom `show_in_3d select=true` s `highlight`.
3. Zalozka 3D ostane perspektivna, da sa orbitovat; `get_viewer_state` hlasi mode 3d, projection perspective.
4. Otvor pôdorys (`set_view_mode mode=2d floor=...`) a vrat sa `set_view_mode mode=3d`: perspektiva, orbit odomknuty.

## Poznamky
- `tsc` a viewer testy sa v cloud session nespustili (`pnpm install` padol na 403 pri design-kit); `sceneMode.test.ts` presiel cez `tsx --test` (4/4) a `useAimViewCommands.ts` prešiel syntaktickou kontrolou esbuild. CI to overi.
- Mutacne dokazy (3 patche) su v `docs/architecture/evidence/aim-216-scene-mode/`; pri otvarani PR pridaj stitok `revert-oracle-exempt`.
- Stary 2D zamok mimo zalozkovych prikazov (ViewModeSwitcher, DocumentsPanel `setMode`) stale obchadza zalozky; tu sa rieši len čo sa dá z AIM vrstvy.
- Host (AIMviewer) sa nemeni. Kandidat na samostatnu pripomienku: tool by nemal hlasit ok, ked stav po prikaze nezodpoveda poziadavke.
