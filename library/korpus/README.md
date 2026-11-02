# Korpus zhody (DECISIONS V30, QUESTIONS Q70)

Vygenerované `assetin korpus export` z repa assetin-library. **Needitovať ručne.** Je to to, čo
Python engine (orákulum) vyrobí pre pevné vstupy. TypeScript engine v AIMviewer musí dať to isté,
kým Python engine existuje. Inventár a sha256 každého súboru sú v `MANIFEST.json`.

## Čo s čím porovnať

| Súbor | Vstup | Čo musí TS vrátiť | Ako porovnať |
|---|---|---|---|
| `schema/<TYP>.json` | zod schéma typu | JSON Schema odvodená zo zod | ako JSON (poradie kľúčov nerozhoduje) |
| `stromy/<s>/subory.json` | - | vstup: cesta -> presný text súboru (aj `KNIZNICA.md`) | - |
| `stromy/<s>/bloky.json` | text súboru | blokový model: `frontmatter` (raw, riadok, yaml_text, data, chyba) a `telo` (druh, raw, riadok, polia druhu) | ako JSON; a `"".join(raw)` = vstupný text **bajtovo** (princíp 7) |
| `stromy/<s>/poznamky.json` | všetky súbory stromu | pre každú cestu: id, typ, zlúčené `data`, `zdroje` poľa, typovaný `model` (alebo null), pod-záznamy, diagnostiky loadera, `verzia` (sha256 textu) | ako JSON; diagnostiky podľa pravidla nižšie |
| `stromy/<s>/validacia.json` | všetky súbory stromu | všetky diagnostiky validátora | podľa pravidla nižšie |
| `stromy/<s>/editor.json` | všetky súbory stromu | payload editora (`app_json.dokument`) | ako JSON; slúži na zhodu reťazca, inšpektora, grafu a registrov |
| `upravy/NN-*.json` | `vstup.zmeny` (id, pointer, hodnota) alebo `vstup.nova` nad stromom `vzor` | `vysledok` (ok, odmietnute, zapisane, vytvorene, premenovane, konflikt) a `texty_po` (cesta -> nový text) a `zmazane` | `texty_po` **bajtovo**, `vysledok` ako JSON, diagnostiky podľa pravidla |
| `ids/<ER>_<poskytovateľ>.ids` | strom `vzor` | IDS 1.0 bez dátumu | **bajtovo** |

**Diagnostiky** sa porovnávajú na `(note_id, json_pointer, uroven, kod, subor, riadok)`. Text `sprava` je informatívny: správy pydantic a zod sa líšia a nemusia sa zhodovať.

Stromy: `vzor` = `zadanie/` + `KNIZNICA.md`; `kniznica` = syntetické fixtures pre typy bez vzoru (GOAL, PROJ, PROP, PROT); `chybne` = negatívne fixtures (každé pravidlo validátora má aspoň jeden nález).
