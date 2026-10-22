# AIM #217: SELECT s viac GUIDmi označí všetky prvky

AIM #217, host Menezeris/AIMviewer (PR "Closes #217"). `show_in_3d(select=true, ids_or_refs=[A, B])` označilo len prvý prvok.

## Čo to robí
- Správa mosta `SELECT` dostane voliteľné `guids` (pole reťazcov); `guid` ostáva prvý prvok a nesie `panel`. Bez `guids` sa správa správa ako doteraz.
- `visibility-commands.ts`: rozloží všetky GUIDy, prvý vyberie ako klik (`selectPickedGlobalId`), ostatné pridá ako Ctrl+klik (`toggleGlobalIdInSelection`, cez nový dep `addToSelection`). Kamera zarámuje všetky. Čo sa vo vieweri nenašlo, sa zapíše ako problém pre `APPLIED`.
- `bridge-protocol.ts`: `guids` musí byť pole reťazcov, inak sa správa zahodí.

## Upstream súbory (len AIM-FORK bloky)
- žiadne, všetky zmeny sú v `apps/viewer/src/aim/`.

## Overenie
- Test `aimPanelViewPlan.test.ts` (nový prípad pre `guids`).
- NEPREBEHLO v cloud session: `pnpm install` (privátna závislosť), viewer `tsc`, testy, živý viewer. Overí rýchle CI.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo tohto PR>` (s hostom z AIMviewer PR k #217).
1. V Claude s konektorom: "Označ miestnosti Retail" (dve miestnosti, napr. 1.02 a 1.03).
2. Vo vieweri sú označené obe miestnosti, kamera ich zarámuje.
3. `get_viewer_state`: `selection_count` = 2, odpoveď `show_in_3d` vrátila zoznam oboch.
4. Jeden prvok ("vyber 1.02") funguje ako doteraz.
