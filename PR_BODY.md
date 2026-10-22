Fork patch AIM #239 (chvenie výkresu pri zoome 100 %)
## AIM #239: stabilná šírka PDF karty

Príčina: `PdfDocumentView` odvodzuje šírku strany od `contentRect.width` posúvanej plochy, výška strany z nej cez pomer strán. Keď je strana pri zoome 100 % o pár pixelov vyššia než plocha, objaví sa zvislý posuvník, plocha sa zúži o ~15 px, strana je nižšia, vojde sa, posuvník zmizne, plocha sa rozšíri a dookola (smyčka rozloženia). Zoom nižší o malú hodnotu strany zmenší natoľko, že posuvník nevznikne.

Oprava (len `aim/` + 3 jednoriadkové AIM-FORK bloky): `scrollbar-gutter: stable` na ploche (posuvník šírku nemení), `aim/docLayout.ts` zahadzuje zlomky pixela a zastaví kmitanie A-B-A (poistka pre prehliadače bez gutteru), pri skutočnej zmene šírky panela sleduje šírku znova. Observer je v `aim/useDocBodyWidth.ts`.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným) a otvor v ňom PDF dokument, ktorého strana pri 100 % mierne presahuje plochu (napr. A3 na výšku v úzkom paneli); nastav systémové posuvníky na "vždy zobrazovať".
2. Očakávané: zobrazenie sa po otvorení ustáli bez chvenia, rovnako aj pri ťahaní deliča panela. Pred opravou: chvenie, ktoré zmizne po oddialení.

### Overenie
Príčina potvrdená v Chromiu (testovací posúvač 800x1100 px so stranou v pomere 1:1,414, klasické posuvníky): bez opravy 90 prepočtov šírky za 1,5 s, s `scrollbar-gutter: stable` 1, s filtrom samotným 3.
Prešlo: `tsx --test aim/docLayout.test.ts`, `oxlint apps/viewer/src/aim`, `check-module-size.mjs`, `check-type-scale.mjs`, `check-aim-fork-only.mjs` (fork-blocks).
Neurobené (cloud session bez závislostí): `tsc --noEmit`, bundle ratchet, mutačné dôkazy (štítok `revert-oracle-exempt`), živé overenie.

Host: bez zmeny. Closes Menezeris/AIMviewer#239 patrí k hostu až po zlúčení forku (host PR nie je potrebný, issue zavrie orchestrátor).
