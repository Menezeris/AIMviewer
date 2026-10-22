## AIM D-152: prázdny `MEASURE_SHOW` zmaže kóty od hosta

Kontrola správy `MEASURE_SHOW` odmietala prázdne `segments`, takže host nemal ako povedať "zmaž kóty, ktoré som nakreslil". Teraz prázdny zoznam prejde a `addHostMeasurements` (D-124) zmaže kóty od hosta; merania používateľa a jeho rozpracovaný bod ostanú. Žiadny nový kód okrem uvoľnenej podmienky: upstream `deleteMeasurement` a pamäť id kót od hosta už boli. Bez `bridge-protocol.ts`, bez upstream súborov. Starší host prázdnu správu neposiela; starší fork ju zahodí.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným).
2. Nakresli si vlastné meranie nástrojom Measure. Z hostu (alebo Claude s konektorom po zlúčení D-152) nakresli kótu: `ifc_measure a=<prvok> show=true`.
3. Pošli `{type: 'MEASURE_SHOW', segments: []}` (v Claude: `ifc_measure clear=true`).
4. Očakávané: kóta od Claude zmizne, tvoje meranie ostane. Druhé poslanie nerobí nič.

### Overenie
Prešlo: `tsx --test aim/measure-show.test.ts` (4/4), mutačný dôkaz (revert `view-protocol.ts` -> nový test padá), `oxlint apps/viewer/src/aim` (0 chýb), `check-module-size.mjs`, `check-type-scale.mjs`, `check-aim-fork-only.mjs` (aim-only).
Neurobené (cloud session bez závislostí forku): `tsc --noEmit`, `check-jsx-a11y` (patch nemení JSX), bundle ratchet, živé overenie.

Host: Menezeris/AIMviewer#235. Poradie: najprv tento PR, potom host.
