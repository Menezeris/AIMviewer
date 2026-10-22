# perf(viewer): most AIM lenivo v embede, menší vstupný a eager balík

Vstupný chunk viewera rástol s každým AIM balíkom o 3 až 5 kB (strop `viewer-entry-js-bytes` dnes dvakrát zdvihnutý), otvorené bolo aj "+22 kB eager" z Menezeris/AIMviewer#203. Príčina: App.tsx importoval `AimBridge` staticky, takže celý most (príkazy pohľadu, protokoly, doc*, lens, záložky) bol vo vstupe alebo v eager chunkoch, aj keď ho potrebuje len viewer vnorený v hostovi AIM.

## Čo to robí
- `AimBridgeMount.tsx` (App.tsx, riadok v AIM-FORK bloku) namiesto `AimBridge`: mimo embedu nerenderuje nič, v embede `React.lazy(AimBridge)`. Vo vstupe ostáva len príznak embedu (`setEmbedded`), závoj počas `?models=` autoloadu (ten istý markup, od prvého renderu) a latch konca autoloadu (`autoloadLatch.ts`): most pripojený až po konci autoloadu ohlási `MODELS_LOADED` hneď.
- Listener, brána príkazov (D-101) aj `READY` sú v moste bez zmeny. Host (`components/ifc-viewer.tsx`) posiela správy až po `READY` (dáta a príkazy až po `MODELS_LOADED`, predtým ich radí v `pendingRef`) a na `READY` nemá timeout, takže sa žiadny príkaz nestratí ani nepreusporiada.
- Pomocníky zo vstupu (`bim`, `selectPickedGlobalId`, `toggleGlobalIdInSelection`) dostane lenivý most cez props z Mountu (aj `docBridge.wireDocumentEvents`), aby bundler nevytiahol `viewport-selection.ts` zo vstupu do zdieľaného chunku (FORK_MAINTENANCE, Pre-approved raises bod 1).
- `bridge-core.ts`: `SOURCE` a `guidForEntity` bez ďalších importov (`bridge-protocol.ts` ich znova exportuje, 458 -> 450 riadkov); `aimPanelStore`, `derivations-protocol` a `hierarchyPanel` ich berú odtiaľ. `AimDerivedRelations` berie `resolveGuids` až v lenivom tele. `bridge-protocol.ts` tak už nie je v eager balíku.
- Stropy `bundle` znížené na namerané hodnoty (samostatný commit).

## Čísla (vite build + `measure-bundle.mjs`, base `release/aim-2026-10-22-6` @ 9711d534)
| Metrika | Pred | Po | Rozdiel |
|---|---|---|---|
| `viewer-entry-js-bytes` | 3 178 068 | 3 156 601 | -21 467 |
| `viewer-eager-js-bytes` | 19 387 319 | 19 344 560 | -42 759 |
| eager súborov | 315 | 312 | -3 |

Strop entry 3 178 068 -> 3 156 601, eager 19 369 949 -> 19 344 560 (base bol nad stropom eager, v tolerancii). `perf-ratchet check` s nameraným: OK.

AIM kód podľa sourcemáp pred zmenou: vstup 31,7 kB, eager 57,9 kB. Po zmene ostáva vo vstupe ~10,9 kB (komponenty v upstream paneloch cez AIM-FORK: `aimListTable`, `useAimCenterPanes`, `AimInspectorTabs`, `DocumentsRibbonTab`, `AimDerivedRelations`, `AimBridgeMount`...). Tie sa zámerne nepresúvali: lenivé načítanie by pri prvom zobrazení dalo prázdny snímok (zmena správania).

## Upstream súbory (len AIM-FORK bloky)
- `apps/viewer/src/App.tsx`: import a JSX v existujúcich AIM-FORK blokoch (`AimBridge` -> `AimBridgeMount`).
- `tests/perf-ratchets/bundle.json`: zníženie stropov.
- `check-aim-fork-only`: OK (režim `fork-blocks`).

## Overenie
- AIM testy `src/aim/*.test.ts`: 317/317 (nový `autoloadLatch.test.ts`, 3 prípady).
- Mutačné dôkazy latchu: 3x `OBSERVED`, obnova overená (`docs/architecture/evidence/aim-lazy-bridge/mutations/`). Štítok `revert-oracle-exempt` pri otvorení PR.
- `npx oxlint apps/viewer/src/aim`: 0 chýb; `check-module-size` (exit 0), `check-jsx-a11y`, `check-type-scale`, `check-i18n-literals`, `check-aim-fork-only`, `check-tla-chunk-await` nad buildom: OK. Viewer `tsc`: bez chyby v zmenených súboroch (8 chýb v `aimPanelList.test.ts` sú už na base).
- Živo (zostavený viewer pred a po, vnorený v host stránke, `AC20-FZK-Haus.ifc` z `public/_fixtures`, Playwright): host po `MODELS_LOADED` synchrónne poslal `QUERY bounds`, `SET_SECTION` 40 %, `FOCUS`, `SET_SECTION` 60 %, `ACK_REQUEST`. Oba buildy odpovedali rovnako: `READY`, `MODELS_LOADED`, `QUERY_RESULT` ok, `APPLIED` ok bez problémov, rez 60 % (3,391 m), focus 1 prvok; závoj od prvých snímok. Samostatný viewer (bez rodiča) už nesťahuje chunky mosta (`viewQueries`, `sectionBox`). Swiftshader v cloude stratil WebGPU zariadenie, model sa nevykreslil; vykreslenie overí odkaz nižšie.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>`
1. Otvor stavbu: počas načítania modelu je závoj "Loading model…", potom model; žiadne prebliknutie uvítacej obrazovky IFClite.
2. Klik na prvok: AIM karta v paneli vlastností sa naplní (ENTITY_SELECTED -> AIM_PANEL_DATA).
3. V Claude s konektorom: "ukáž dvere na 1. NP a sprav rez vo výške 1,2 m", potom "aký je stav viewera": oranžové dvere, rez, `get_viewer_state` vráti rez a focus.
4. Deep link `?focus=<GUID>` z karty prvku: viewer po načítaní zvýrazní prvok.
5. DevTools > Network: `AimBridge-*.js` sa stiahne hneď po štarte v embede; samostatne otvorený viewer (bez hosta) ho nesťahuje.
