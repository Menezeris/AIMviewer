## Čo
Pri pokuse o orbit v zamknutom pôdoryse (D-132) ukáže nenápadnú ponuku "Pôdorys je zamknutý pohľad zhora. Prepnúť do 3D? (Enter)" (AIM D-147, #188).

- Tlačidlo "Prepnúť do 3D", Enter aj medzerník aktivujú záložku 3D cez existujúce `activate('3d')` (D-098); Esc ponuku zavrie, sama zmizne po 8 s.
- Pokus o orbit = ťah nad 5 px gestom, ktoré by v 3D orbitovalo (ľavé tlačidlo, alebo pravé ako fly). Gesto rozhoduje upstream `resolveNavigationPointerGesture`. Posun (stredné tlačidlo, Shift, nástroj pan), zoom a klik ponuku nespúšťajú.
- Len v zamknutom pôdoryse v záložke; nie v 3D ani v splite.
- Ťah canvasu ostáva upstreamu (poslucháči na okne bez pointer capture); ľavý ťah v pôdoryse posúva ako doteraz.
- Všetko v `apps/viewer/src/aim/` + 2 kľúče v `aim-fork.en.ts`; žiadny upstream súbor.

## Ako vyskúšať
1. Spusti viewer s mostom na malom testovacom modeli (AC20-FZK-Haus, nie produkčné IFC, D-135).
2. Otvor pôdorys podlažia (+ Pôdorys v lište záložiek).
3. Potiahni ľavým tlačidlom (ako orbit): pohľad sa posunie ako doteraz a pod lištou sa ukáže ponuka. Rovnako pravé tlačidlo, ak je zapnutý fly.
4. Enter, medzerník alebo tlačidlo prepnú na záložku 3D (perspektíva, voľný orbit); Esc ponuku zavrie.
5. Posun stredným tlačidlom alebo Shift + ťah a koliesko ponuku neukážu.

## Poznámky
- `tsc`, oxlint, testy a revert oracle sa v tejto session nespustili (spustenie kódu z klonu bolo zamietnuté); overí orchestrátor. `planOrbitHint.test.ts` pokrýva rozhodnutia (prah, gesto, záložka, klávesy). Mutačné dôkazy nie sú, podľa pokynu orchestrátora.
- Text ponuky je slovenský v katalógu `aim-fork.en.ts` (hostiteľské UI je slovenské).
