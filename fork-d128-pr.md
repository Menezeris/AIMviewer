# feat(aim): kamera na cieľ v reze s okrajom a časťou cieľa, vzor šrafy z chatu (AIM D-128)

Štítok: revert-oracle-exempt (pri otvorení)

AIM D-128, AIMviewer#172 a #173. Párový PR: Menezeris/AIMviewer#197 (zlučuje sa po tomto).

## Čo sa mení
- `SET_CAMERA` nesie `padding` (1 až 4) a `area` (`left|right|top|bottom|front|back`). Fork zarámuje obálky cieľa alebo výberu existujúcim `cameraCallbacks.frameBounds(min, max, {padding})`; `area` vyberie prvky so stredom v krajnej tretine obrazu podľa smeru (nový čistý modul `aim/cameraArea.ts` s testom). Smer kamery ostáva (preset `section` = kolmo na rez, potom rámovanie).
- Rámovanie sa čaká do konca animácie, takže `APPLIED` hlási koncovú kameru (predtým pózu presetu: "target ostal X 46.6" z #172). Platí aj pre staré cesty `flyTo`, `fitAll`, `frameSelection`.
- `SET_SECTION_CAP` nesie `pattern`, `angleDeg`, `secondaryAngleDeg`, `spacingPx`, `widthPx`; zapisuje ich setter `setSectionCapStyle`, ten istý ako popover Cap (rozsahy ako jeho polia). Bez vzoru ostáva správanie D-120.
- Bez zmeny `packages/renderer` a upstream súborov (režim aim-only). `viewQueries.renderBoundsOfIds` je len exportovaná.

## Overenie
- AIM testy 173/173, `tsc`, guardy (rtc-frame-copies, module-size, i18n-literals, test-glob-coverage, unused-locals).
- Revert oracle: 8 mutácií OBSERVED, dôkazy v `docs/architecture/evidence/aim-d128-camera-hatch/mutations/`, štítok `revert-oracle-exempt`.
- Bundle: `viewer-entry-js-bytes` +875 B oproti main, v strope a tolerancii, strop sa nemení.
- Živo (FZK-Haus v embednutom vieweri): po zvislom reze a `preset=section` `area=left` posunie cieľ na X 3.705, `area=right` na X 9.705, `APPLIED` = nasledný `QUERY view_state`. Uložená zvislá šrafa sa po `pattern=diagonal angleDeg=45` zmení v uloženom štýle na diagonálu 45°, 12 px.

## Ako vyskúšať
Odkaz: https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR> (s AIMviewer#197 nasadeným, inak nové parametre AIMviewer neposiela).
1. V Claude s konektorom aim-viewer: "Sprav zvislý rez po dĺžke budovy a priblíž mi atiku na ľavej strane." Má stačiť set_section, search_objects(PARAPET), set_camera(preset=section, area=left); kamera kolmo na rez, ľavá atika s okrajom.
2. "Daj na rez diagonálnu šrafu pod 45 stupňov s rozstupom 12 px." Šrafa v reze je šikmá, aj keď bola predtým zvislá.
3. "Daj krížovú šrafu" a "bodky": vzor sa zmení, popover Cap ukazuje ten istý vzor, uhol a rozstup.
4. Odpoveď set_camera obsahuje visible (šírka a výška záberu v m) bez get_viewer_state.
