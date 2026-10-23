# AIM #199 krok 3: snímka výrezu PDF pri pripomienke (D-158)

AIM #199, host Menezeris/AIMviewer (PR "Closes #199", kroky 3 a 4). Stavia na kroku 2 (#141).

## Čo to robí
- Lokálna pripomienka na PDF (tlačidlo "Pripomienka", krok 2) si po založení témy stiahne z hosta snímku výrezu strany so zapáleným červeným rámikom (`GET <host>/api/drawing/<id>/snapshot?page=N&region=x_y_w_h`, render pdf.js na serveri hosta, keš v buckete) a dostane pohľad s ňou. Upstream export `.bcfzip` (2.1 aj 3.0) ju tak nesie ako snímku pohľadu už pred uložením v chate.
- BCF 3.0 vyžaduje v každom pohľade kameru: pohľad so snímkou preberie kameru (a rez) prvého pohľadu témy z upstream formulára; téma bez kamery snímku nedostane (inak by zlyhal export celého archívu). Pridáva sa za existujúce pohľady, takže `view_state.bcf_local` (prvý pohľad) ostáva 3D pohľad témy.
- Témy z hosta (`AIM_BCF_LOAD`) sa načítajú so snímkami (`includeSnapshots: true`). Host dáva snímku len pohľadom odkazov na stranu dokumentu, ostatné pohľady sa nesondujú; BCF panel aj export majú obrázok každej uloženej pripomienky.
- `parseDocIssueUrl` rozloží aj `#page=N&viewrect=...` (RFC 8118 viewrect, ktorý host pridáva do odkazu).

## Upstream súbory (len AIM-FORK bloky)
- žiadne, všetky zmeny sú v `apps/viewer/src/aim/` (+ dôkazy). `check-aim-fork-only`: `aim-only`.

## Overenie
- `docIssueModel.test.ts` (+3 prípady: adresa snímky, pohľad s kamerou a bez nej, export 3.0 so snímkou a `bcf_local`), `bcf-protocol.test.ts`; všetky `src/aim/*.test.ts` a 6 súvisiacich testov viewera: 314/314 (lokálne so zostavenými balíkmi, WASM a design-kit nahradené kópiou z hosta).
- Mutačné dôkazy: 3 mutácie `OBSERVED`, obnova overená (`docs/architecture/evidence/aim-d158-snapshot/mutations/`). Štítok `revert-oracle-exempt` pri otvorení PR.
- Brány: `npx oxlint apps/viewer/src/aim` 0 chýb, `check-module-size` exit 0, `check-jsx-a11y` a `check-type-scale` OK; viewer `tsc` bez chyby v zmenených súboroch. `hide/isolate/show/colors` sa nevolajú (`check-isolate-expansion-routing` netreba).
- Balík: zmeny sú len v lenivých moduloch (`docIssues.ts`/`docIssueModel.ts` v chunku karty dokumentu, `aimBcf.ts` pri prvom `AIM_BCF_LOAD`); vstup sa nemení. Meranie ratchetu v CI.
- Živo neoverené (cloud session bez produkčného viewera, D-135); postup nižšie.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>` (s hostom z AIMviewer PR k #199 a po migrácii `20261023100000`).
1. Otvor dokument (napr. pôdorys 1NP), klikni "Pripomienka" a ťahaj obdĺžnik na strane; v paneli BCF vyplň "New topic" a ulož.
2. V paneli BCF pri novej téme je druhý pohľad s obrázkom výrezu strany a červeným rámikom.
3. Export BCF (2.1 aj 3.0) a otvorenie v inom nástroji (napr. BIMcollab Zoom alebo znova v paneli cez Import): pri téme je snímka výrezu.
4. V Claude: "ulož moje pripomienky" (`bcf_topic action=from_viewer`); po obnove panela má uložená téma #N snímku z hosta (ten istý obrázok).
