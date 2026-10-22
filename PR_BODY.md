## AIM D-148: `open_list run=true` spustí tabuľku po otvorení

Správa `OPEN_LIST` dostane pole `run` (boolean). S `run: true` hook `useAimListAutoRun` v `ListPanel` po zobrazení panela zavolá existujúci `handleExecuteList` (raz, keď panel má dáta). `APPLIED.state.list` hlási `{name, status: opened|running|done|failed|not_started, rows?, error?, reason?}`, takže host vie povedať, či tabuľka beží alebo prečo nie. Bez `run` sa nič nemení (builder, status `opened`). Starší host pole `run` neposiela, starší fork ho ignoruje.

Logika je v `aim/aimListRun.ts` a čistom `aimListRunPlan.ts` (test). Upstream `ListPanel.tsx`: jeden AIM-FORK blok (import) a jeden (volanie hooku), riadok vo `FORK_MAINTENANCE.md`.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným).
2. Z hostu pošli `OPEN_LIST` s `run: true` (alebo v Claude s konektorom: "ukáž tabuľku všetkých stĺpov s objemom" po zlúčení hostu D-148).
3. Očakávané: panel Lists sa otvorí rovno na výsledkoch, bez kliku na Run; `APPLIED.state.list.status` je `done` s počtom riadkov. Bez modelu: `not_started` s dôvodom po ~2,5 s. Bez `run`: builder a `opened`.

### Overenie
Prešlo: `tsx --test aim/aimListRunPlan.test.ts`, `oxlint apps/viewer/src/aim` (0 chýb), `check-module-size.mjs`, `check-aim-fork-only.mjs` (fork-blocks).
Neurobené (cloud session bez závislostí): `tsc --noEmit`, bundle ratchet, mutačné dôkazy (pridať štítok `revert-oracle-exempt`), živé overenie.

Host: Menezeris/AIMviewer#248. Poradie: najprv tento PR, potom host.
