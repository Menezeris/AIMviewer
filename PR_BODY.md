## Co
Posun panela vlastnosti z chatu a oprava, ze zvyraznený riadok (aj Qto) uniká pod viditeľnú časť (AIM #183).

- **Nová správa mosta `SCROLL_PANEL { direction: up | down | top | bottom }`** posunie skrolovací kontajner panela vlastností (`up`/`down` o 80 % výšky okna). Host ju posiela z `set_view_mode panel_scroll` (AIMviewer PR #241). Bez otvoreného panela príde v `APPLIED` problém.
- **`revealRow` namiesto jednorazového `scrollIntoView`:** `SELECT` s `highlight` riadok vycentruje a 3 s drží vo výreze: keď panel po výbere dokreslí obsah nad riadkom (atribúty, sady z typu, rozbalená sada Qto) a riadok vypadne, vycentruje ho znova bez animácie. Končí pri koliesku, dotyku, klávese, kliku alebo novom výbere. Posúva len skrolovací kontajner panela, nie okolité stránky.
- Zmena len v `apps/viewer/src/aim/` (nové `aimPanelScroll.ts`, `aimPanelScrollPlan.ts` + test; zásahy do `aimPanelView.ts`, `useAimViewCommands.ts`, `view-protocol.ts`), rýchle CI `aim-fast.yml`.

## Ako vyskúšať
1. Spusti viewer s mostom na malom testovacom modeli (AC20-FZK-Haus, nie produkčné IFC, D-135) alebo v preview `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>`.
2. Vyber prvok s výmerami a pošli `SELECT` s `panel: { focus: { pset: 'Qto_...', property: '...' } }` (v chate `show_in_3d select=true highlight=Qto_ColumnBaseQuantities.NetVolume`): panel sa posunie, riadok je vycentrovaný a zvýraznený aj pri dokresľovaní.
3. Pošli `SCROLL_PANEL` so smerom `down`, `up`, `top`, `bottom`: panel sa posunie plynulo; koliesko myši pohyb preberie.
4. Zavri panel vlastností a pošli `SCROLL_PANEL`: `APPLIED` nesie problém "panel vlastností nie je otvorený".

## Poznámky
- `pnpm install` v cloud session padol na 403 pri design-kit, takže `tsc`, build a viewer testy sa nespustili; `aimPanelScrollPlan.test.ts` + `aimPanelViewPlan.test.ts` + `view-protocol.test.ts` prešli cez `tsx --test` (21/21), `npx oxlint apps/viewer/src/aim` bez chýb (jedno staré varovanie v `command-gate.ts`), `check-module-size` a `check-aim-fork-only` (aim-only) OK. Perf ratchet bundle sa nemeral: nový kód je v lenivom `aimPanelScroll.js`, vstup nesie len `aimPanelScrollPlan.ts` (konštanty a jedna funkcia).
- Príčina uniku riadka je odvodená z kódu, nie z živej reprodukcie (produkčné modely sa neotvárajú). Ak by riadok stále unikal, treba živý záznam polohy riadka a skrolovacieho kontajnera.
- Mutačné dôkazy (5 patchov, všetky OBSERVED) sú v `docs/architecture/evidence/aim-183-panel-scroll/mutations/`; pri otváraní PR pridaj štítok `revert-oracle-exempt`.
- Host (AIMviewer PR #241) sa zlučuje až po tomto PR.
