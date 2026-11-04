# PLAN — assetin-library: engine + generický editor

<!-- Vygenerované z plánovacieho kola 2026-09-10 (plan mode, Claude Code). Záväzný zdroj polí: docs/SCHEMA-v1.md. -->

### 0. Východiská

- Plánované proti **SCHEMA v1.2** (`docs/SCHEMA-v1.md`) + navrhovaný **V17** (štruktúrované úlohy UC) + **V18** (`aliases` udržiavané writerom). V17/V18 = SCHEMA v1.3, prvá skriptová migrácia vzoru.
- Testovacie dáta: 18 poznámok UC-0101.
- LOIN-00…09 sú v repe v `docs/vault/` (kópia z `AssetinSpace/ObsidianPKM@284123f`, 2026-09-10); ObsidianPKM je zdroj **len na čítanie**, nikdy sa doň nezapisuje; vaultová `SCHEMA-v1.md` (v1.1) sa ignoruje, platí `docs/SCHEMA-v1.md` (v1.2). DSS `Configurations.ids` je v `tests/fixtures/ids/dss/`. Normatívne podklady (7817-3 Annex B/C, 29481-3 idmXSD) ostávajú mimo repa (`docs/normy/`).
- Typy bez vzoru (GOAL, PROP, PROT, PROJ) sa modelujú v F1 zo schémy so syntetickými fixtures v `tests/fixtures/md/`.

### 1. Rozhodnutia

| # | Rozhodnutie | Dôvod | Zavrhnutá alternatíva | Licencia |
|---|---|---|---|---|
| R1 | **Python 3.12, pydantic v2** — jediné miesto schémy | Diskriminované únie (`facet`, `ifc: {atribut}` / `{pset, nazov}` / `{material}` / `prop`), `model_json_schema()` s vlastným generátorom pre `x-assetin`, XOR pravidlá (§0.10, §16.14–15) ako model validátory | attrs + ručný JSON Schema (dve pravdy); dataclasses | MIT |
| R2 | **ruamel.yaml** round-trip pre frontmatter a YAML bloky | Zachová `#` komentáre, poradie, flow štýl `{hodnota: 0.1, jednotka: m}`, úvodzovky; má `lc` (riadok/stĺpec) pre chirurgický zápis | PyYAML (stráca komentáre); strictyaml (nečíta flow štýl) | MIT |
| R3 | **Vlastný riadkový blokový parser tela**, nie Markdown AST | Stačia: nadpisy, `kluc::` (aj v `- ` položke), ```yaml / ```ids bloky, HTML komentáre; zvyšok = próza bajtovo. AST knižnice text pri zápise preformátujú | markdown-it-py, mistune (nie round-trip); python-frontmatter (PyYAML) | — |
| R4 | **Zápis = chirurgický patch po segmentoch** | Identita nezmeneného súboru zaručená konštrukciou; mení sa len dotknutý riadok/segment | Regenerácia zo šablóny | — |
| R5 | **ID nesie cesta; `id:` vo frontmatter je udržiavaná kópia** (§0.4); `aliases: [<id>]` udržiava writer (V18) | Obsidian rozlišuje odkazy podľa názvu súboru/aliasu, Dataview potrebuje `id` ako pole; validátor kontroluje zhodu. `PathScheme` per typ (plochá / hierarchická ACT) je jediné miesto výnimky, UI vidí len `id`. Ak Obsidian alias so `/` (ACT) nerozlíši, ACT odkazy ostanú v Obsidiane mŕtve — rozhodnuté, tvar ID sa nemení | Premenovať súbory na `ID.md`; ID len vo frontmatter | — |
| R6 | **Verzia schémy na jednom mieste**: `KNIZNICA.md` v koreni balíka (frontmatter `schema_verzia: "1.3"`, `vrstvy`), platí pre `zadanie/`, `aktiva/`, `projekty/` | Princíp 4; migrácia bumpne jeden riadok; loader odmietne nezhodu | `schema_verzia` v každej poznámke (churn, môže klamať) | — |
| R7 | **IfcOpenShell** (IFC 4.3 ADD2 schéma: entity, dedičnosť, atribúty, Pset/Qto šablóny s `ApplicableEntity`; generovanie fixture IFC) + **ifctester** (IDS model, zápis, beh) | Jediná úplná implementácia; LGPL-3.0 importovaná ako modul = princíp 5 | Vlastný EXPRESS parser; IDS ručne cez lxml | LGPL-3.0 |
| R8 | **xmlschema** pre validáciu IDS proti `ids.xsd`; `ids.xsd` + oficiálne testcases sa **nekomitujú** — `scripts/fetch_ids_xsd.py` ich stiahne z github.com/buildingSMART/IDS na pinnutý tag do `tests/fixtures/ids/bsi/` (`.gitignore`); bez siete sa XSD test preskočí s upozornením | Nezávislá kontrola tvaru; licencia cudzieho súboru sa nerieši v repe | lxml (BSD, náhradník); commit XSD do repa | MIT |
| R8a | **bSDD online cez API** (`https://api.bsdd.buildingsmart.org`) pre overenie `uri` a `predefined_type`/vlastností; odpovede cachované na disku (`.cache/bsdd/`), bez siete degraduje na varovanie „neoverené“; `--offline` vypne | Samuelovo rozhodnutie; IFC 4.3 slovník je v bSDD autoritatívny | Len lokálna IFC schéma (nepokryje bSDD URI) | — |
| R9 | **typer** CLI (`assetin validate | migrate | generate | edit | nova | schema export`) | Typované argumenty, help | click (BSD) | MIT |
| R10 | **Balenie: FastAPI + uvicorn**, UI v prehliadači, `assetin edit <priečinok>` | Obsidian robí sync a git; appka len číta/píše ten istý priečinok cez API | Tauri (Rust toolchain bez prínosu), Textual TUI (vnorené listy a výber s kotvou nepoužiteľné), Electron | MIT / BSD-3 |
| ~~R11~~ | **Nahradené R11b.** Frontend: Svelte 5 + Vite + Tabulator 6 (schema-driven) | Tabulator plne MIT (bez Enterprise vrstvy), editory `list`/autocomplete, validátory a `cellClass`/tooltip per bunka, vnorené dáta. Svelte len na rozloženie listov | AG Grid Community (master/detail a editory sú Enterprise), NiceGUI (vlastné editory aj tak v JS), Obsidian plugin (validácia druhýkrát v TS) | MIT |
| R11b | **Editor je jedna vygenerovaná HTML stránka bez build kroku** (`assetin app export`): šablóna + dáta + design-kit + ikony v jednom súbore, vanilla DOM, žiadne npm. Nahrádza R11 | Stránka sa otvorí dvojklikom aj bez Node a bez siete; `app/dist` sa necommituje, lebo neexistuje; licencie tretích strán sú dve vendorované kópie (design-kit, Tabler Icons) namiesto stromu npm závislostí. Mriežka, editory buniek a výber wikilinku sú aj tak generované zo schémy — Tabulator by pribudol ako vrstva, nie ako úspora | Svelte + Vite + Tabulator (build krok, `dist` v gite, licenčná kontrola npm); Obsidian plugin | MIT (Tabler Icons) |
| R11a | **Vizuál: `@assetinspace/design-kit`** (`npm install github:AssetinSpace/design-kit`, pripnúť na tag) — vrstva 0 `css/tokens.css` (`--ds-*`) + vrstva 1a `css/archive.css` (plain CSS primitívy `.btn-*`, `.card`, `.badge-*`, modaly, formy, layout). **Prvotné návrhy obrazoviek editora sú inšpirované design-kitom a jeho showcase `index.html`** (light + dark, Inter, brand zelená). Mapovanie: Tabulator CSS premenné ← `--ds-surface/-border/-text/-primary`; úrovne diagnostiky E/W/I ← `--ds-danger-*` / `--ds-warning-*` / `--ds-info-*` (bunky aj badge v liste Diagnostika); dark mode = trieda `.dark` na `<html>`. Nič nehardcodovať (pravidlo 1 kitu); generické primitívy, ktoré vzniknú pre mriežku, navrhnúť späť do kitu (pravidlo 3) | `shadcn.css` lane (Tailwind + shadcn) — zbytočná vrstva pre Svelte + Tabulator, kým kit nemá vrstvu 2 komponentov; vlastná paleta | vlastný balík Assetin (`UNLICENSED`, interný) |
| R12 | **Vnorené zoznamy = detailný list** otvorený z riadku master listu (karty ako v Exceli) | Jedna komponenta pre registre aj vnorenia | Stromová mriežka | — |
| R13 | **Diagnostika = jedna štruktúra** `(note_id, json_pointer, uroven, kod, sprava)` z loadera aj validátora → bunka + tooltip + list „Diagnostika“ | Bez špeciálneho UI; CLI vypisuje to isté | Panel chýb per typ | — |
| R14 | **Pod-záznamy** = YAML blok pod `## <id> …`: STD pravidlá, GEO profily, slovníky v STD-klasifikacia. **Blokové polia** = YAML blok pod nadpisom s jedným top-level kľúčom = pole poznámky (ER `prepisy`, UC `ulohy`) | Vzor a schéma takto fungujú; loader rozlíši podľa toho, či blok má `id` (pod-záznam) alebo kľúč poľa (`x-assetin.zdroj: blok`) | Pravidlo = súbor; prepisy vo frontmatter | — |
| R15 | **Layout: jeden balík `assetin/`** (`schema`, `engine`, `server`), frontend `app/`, `scripts/` | `schema/`, `engine/` ako top-level balíky sú neimportovateľné mená; jeden CLI vstup. README §Štruktúra sa upraví | Top-level `schema/`, `engine/` | — |
| R16 | **Generátory = protokol** `targets(kniznica)` / `generate(kniznica, target, out_dir)`, výstup `vystupy/<zakazka>/…` | IDS prvý; ostatné len rozhranie | — | — |
| R17 | pytest, hypothesis (voliteľne), ruff, mypy; `license-checker` (npm) a `pip-licenses` v CI | Princíp 5 strojovo | — | MIT |

Odmietnuté kvôli licencii: Handsontable (nekomerčná), AG Grid Enterprise, Jspreadsheet Pro.

### 2. JSON Schema → tabuľkové UI

`assetin schema export` → JSON Schema per typ + `x-assetin` metadáta; server ich vracia na `/api/schema`, UI nič nekóduje napevno.

| JSON Schema | List / stĺpec | Editor bunky |
|---|---|---|
| objekt typu poznámky | **list registra**, riadok = poznámka, prvý stĺpec `id` (readOnly) | — |
| skalár string/number/boolean | stĺpec | text / číslo / checkbox |
| `enum` (§14) | stĺpec | select |
| `pattern`, `minimum`, `required` | — | validátor bunky (červená + správa) |
| vnorený objekt so skalármi (`objekt.ifc_entita`, `forma.format`, `geometria.Location.PositioningType`, `metadata_cde.status`) | stĺpec s bodkovou cestou | podľa skalára |
| pole skalárov (`region`, `hodnoty`, `dokladuje`, `pouzitie`, `aplikovatelne_na`) | stĺpec | tagy / multiselect |
| pole objektov (`alfanumerika`, `dokumentacia`, `klasifikacia`, `filter`, `requirements`, `prepisy`, `ulohy`, `kpi`, `udalosti`, `dataset.struktura`) | **detailný list** z riadku master listu; stĺpce rekurzívne | — |
| `oneOf` s diskriminátorom (`facet`; `ifc` variant atribút/pset/material/prop) | stĺpec diskriminátora + zjednotenie stĺpcov variantov, nepatriace šedé | select diskriminátora |
| mapa s kľúčmi-odkazmi (PROJ `strany`) | detailný list s kľúčom ako prvým stĺpcom | wikilink + skaláre |
| `x-assetin.widget: wikilink` (`cielove_typy`, `kotva: ziadna|volitelna|povinna`, `viac`) | stĺpec | výber cieľa (`/api/notes?typ=…`, aj pod-záznamy) → výber kotvy (`/api/notes/{id}/kotvy`: pod-záznamy, úlohy, nadpisy); alias zachovaný |
| `x-assetin.widget: tag` (`#aktivum`, `#proces`) | stĺpec | select literálov |
| `x-assetin.zdroj: frontmatter|inline|blok` | rovnaký stĺpec — UI nevie, kde pole žije | — |
| `x-assetin.odvodene` (`typ_poziadavky`, predvoľba `overenie` §14b) | stĺpec readOnly s vypočítanou hodnotou; prepis = zápis hodnoty | — |
| pod-záznamy (STD pravidlo, GEO profil, slovník) | vlastný list s readOnly stĺpcom `poznamka` (rodič) | — |

Nadpisy listov = `title` typu, popisky stĺpcov = `Field(title, description)` → aj `docs/POLIA.md`.

### 3. Štruktúra repa

```
assetin-library/
  KNIZNICA.md              schema_verzia, vrstvy (R6)
  zadanie/                 organizácia (§15); aktiva/, projekty/ pribudnú; vystupy/ ignorované
  assetin/
    schema/                base.py, spolocne.py (WikiLink, Tag, Facet, IfcRef, Geometria), typy/{goal,uc,er,iu_o,iu_c,std,geo,prop,def_,ev,act,prot,proj}.py,
                           slovnik.py (pod-záznam STD-klasifikacia), cesty.py (PathScheme), json_schema.py, predvolby.py (§14b, typ_poziadavky)
    engine/
      dokument.py          blokový model súboru
      loader.py            súbor → Dokument → surové dáta + provenance → typovaná poznámka
      writer.py            chirurgický patch
      graf.py              Kniznica: indexy, odkazy, kotvy, vrstvy, efektívne hodnoty (PROJ > ER > IU > STD)
      validator/           pravidlá ako registrované funkcie, diagnostika
      ifc/                 obal nad IfcOpenShell (schéma, podtypy, atribúty, psety), cache
      generators/          base.py, ids.py; skeletony spec7817.py, midp.py, raci.py, pdf.py, checklist.py
      migrations/          v1_2_to_v1_3.py (V17 ulohy, V18 aliases, KNIZNICA.md)
    server/                FastAPI: /api/schema, /api/notes, /api/notes/{id}, /api/notes/{id}/kotvy, /api/validate, /api/save; statika app/dist
    cli.py
  app/                     Svelte + Vite + Tabulator; app/dist commitovaný; `@assetinspace/design-kit` ako npm závislosť (tokens.css + archive.css, logá z assets/)
  scripts/                 build_fixture_ifc.py
  tests/                   test_roundtrip.py, test_writer_golden.py, test_validator.py, test_ids.py, fixtures/{md,ifc,ids}/
  docs/                    SCHEMA-v1.md, PLAN, DATA-MODEL, VALIDATION-RULES, QUESTIONS, POLIA.md (gen.), schema/*.json (gen.), normy/, vault/
```

### 4. Fázy

| Fáza | Obsah | Hotovo, keď | Odhad (dni) |
|---|---|---|---|
| **F1** Schéma ako kód + loader + writer + migrácia v1.3 | pydantic modely 13 typov + pod-záznamy + blokové polia; `PathScheme`; JSON Schema s `x-assetin`; Dokument/loader/writer; graf; migrácia V17 (ulohy) + V18 (aliases) + `KNIZNICA.md` skriptom; text V17/V18 do SCHEMA-v1.md (v1.3); README layout; manuálne overenie aliasov v Obsidiane (aj ACT s `/`) | round-trip test zelený nad všetkými súbormi v `zadanie/` (po migrácii); golden testy writeru; `assetin schema export` generuje `docs/schema/*.json` + `docs/POLIA.md`; `zadanie/` načítané bez chýb (len varovania visiacich odkazov) | 5–7 |
| **F2** Validátor + CLI | Pravidlá A–H z VALIDATION-RULES (§16.1–18 + odvodené), IFC vrstva, `assetin validate <dir> [--format json] [--ifc] [--offline]`, návratový kód | každé pravidlo má pozitívny + negatívny fixture; nad vzorom 0 chýb, len očakávané varovania; < 2 s bez IFC, < 10 s s IFC (cache) | 4–6 |
| **F3** Generický editor *(hotové: registre, stránka poznámky so záložkami Poznámka \| Reťazec, inšpektor, zápis cez `assetin edit`, reťazec ako strom per účel užitia — DECISIONS V23, nová poznámka zo šablóny — `zapis.vytvor`, `/api/nova`, `assetin nova`, premenovanie pri zmene `nazov`, grafový pohľad z toho istého stromu — `graf_stranka.stranka_grafu` → `docs/graf.html`, pod serverom `/graf`, Mermaid pre Obsidian `--format mermaid`; **F3 hotová**)* | server; jedna HTML stránka bez build kroku (R11b, nie Svelte + Tabulator); mapa schéma → listy; wikilink s kotvou; diagnostika v bunkách; uloženie cez writer; nová poznámka zo šablóny sekcií typu; premenovanie súboru pri zmene `nazov`; vizuál z design-kitu (tokens.css + archive.css, light/dark, logo, E/W/I farby zo semantických tokenov); prvý krok F3 = 2–3 skice obrazoviek (register, detailný list, výber wikilinku, diagnostika) inšpirované showcase kitu, odsúhlasené Samuelom pred kódom | každý typ a vnorený zoznam editovateľný bez ručného stĺpca; zmena v editore → Obsidian ukáže zmenu bez straty komentárov; round-trip stále zelený; žiadna hardcodovaná farba/radius/spacing mimo `--ds-*`; `scripts/check_licenses.py` bez AGPL | 7–10 |
| **F4** IDS + fixture IFC | `build_fixture_ifc.py`; `assetin generate ids`; XSD; ifctester | 1 IDS na (ER-0101 × ARCH), prejde `ids.xsd`; ifctester nad fixture dá očakávanú tabuľku (STD-CL-05 fail na proxy, CL-01/03/04/06 pass, IU-O-space fail na vynechanom NetFloorArea) | 4–6 |

Spolu 20–29 dní. F2 a F4 sa dajú prekrývať s F3.

**Vetvenie:** vetva `claude/sleepy-curie-prwi0z` je plánovací PR (kostra, vzor, schéma, plán, LOIN, DSS fixture). Odporúčanie: zlúčiť ju do `main` a F1 začať na novej vetve z `main` (napr. `claude/f1-schema-loader`), jedna fáza = jeden PR; kód a plán sa nemiešajú v jednom PR, revert a bisect ostávajú jemné. Merge do `main` robí Samuel (alebo výslovne zadá).

### 4b. Z revízie 11. 9. 2026 (`docs/REVIEW-2026-09-11.md`) — poradie opráv

Revízne kolo bolo bez kódu (len skripty na overenie). Opravy idú v tomto poradí, každá ako samostatný commit s testom, ktorý dnes padá:

1. ~~**Writer: pridanie / odobratie riadka v zozname bez prepisu bloku**~~ — **hotové 12. 9.** (úroveň 1b, `writer._level1b`, DATA-MODEL §4): pridanie riadka do `alfanumerika` je diff 4 riadkov namiesto 63, komentáre aj `{atribut: Name}` ostávajú; to isté pre blokové `ulohy`. Patch sa prijme, len keď spätné načítanie dá presne požadovanú hodnotu, inak sa vráti text a použije úroveň 2 (zmena vnútri riadka poslaná ako celý zoznam). Testy `test_pridanie_riadka_zachova_komentare`, `test_odobranie_riadka_zmaze_len_jeho_riadky`, `test_riadok_blokoveho_pola_je_tiez_patch`. Pôvodný nález: `nastav(...)` z tabuľky posiela celý zoznam → `writer` úroveň 2 re-dumpne celý top-level kľúč a stratí `#` komentáre aj štýl (`{atribut: Name}` → blok, úvodzovky preč). Oprava: úroveň 1b — vložiť riadky nového záznamu na koniec segmentu zoznamu (a odobratie = vymazať rozsah riadkov záznamu), re-dump len ako posledná možnosť. Test: `test_pridanie_riadka_zachova_komentare` nad `IU-O-space` (diff = len nové riadky).
2. ~~**`dokument()` kvadraticky**~~ — **hotové 12. 9.**: les stromov je memoizovaný na `Kniznica.memo`, pozície poznámok na stromoch sú jeden index postavený z `Retazec.pozicie` (jediná definícia, index z nej nemôže odbehnúť), `podla_typu` / `odkazy_na` / `odkazy_z` sú lenivé dict indexy namiesto lineárnych skenov, a `retazce` si ERka predtriedi podľa `uc`. Merané `scripts/vykon_syntetika.py`: pri 297 poznámkach `dokument()` **5452 → 479 ms**, pri 603 **39 735 → 1360 ms**; `load + validate + dokument` 8,1 → 3,0 s, resp. 45,4 → 6,5 s. Výstup je bajtovo rovnaký (`docs/editor.html`, `docs/graf.html` bez zmeny). **Cieľ „pod 2 s pri 300" splnený nie je** — zvyšok je `nacitaj_kniznicu` (2,5 s, ~8 ms/poznámku), čo je round-trip parser ruamel, ktorý drží princíp 7; ďalší krok je rozhodnutie, nie optimalizácia (QUESTIONS Q41). Pôvodný nález: (`scripts/vykon_syntetika.py`: 8,1 s pri 297 poznámkach, 45 s pri 603). `app_json._poznamka` volá `retazce_pre` + `cesty_pre` per poznámku a obe stavajú celý les (`retazce(k)`); `Kniznica.podla_typu` / `odkazy_z` sú lineárne skeny. Oprava: les raz na `Kniznica` (memo alebo parameter), indexy podľa typu a zdroja odkazu. Cieľ: load + validate + dokument pod 2 s pri 300 (loader ostáva ~9 ms/poznámku — ruamel round-trip, princíp 7).
3. ~~**Únia bez diskriminátora sa nedá prepnúť**~~ — **hotové 12. 9.**: prepínač zakladá kostru variantu (`kostraVariantu`: diskriminátor, inak povinné kľúče prázdne), takže `variantPolozky` variant spozná. Pri overovaní scenára vyšlo najavo druhé dno: `IfcRef.nazov` dostával **textareu**, lebo `dlhy-text` sa háda podľa mena poľa — v textarei Enter vloží nový riadok a hodnota sa nezapíše. `widget="text"` na poli to prebije (meno vlastnosti je identifikátor, nie próza; rovnako `Facet.nazov`, `PROP.nazov`). Scenár S2 je v Chromiu priechodný: 6 klikov, diff presne 4 riadky. Pôvodný nález: (`ifc: atribut | pset+nazov | material`): prepínač uloží `{}` a `variantPolozky` spadne späť na prvý variant. Oprava: prepínač predvyplní `povinne_kluce` prázdnymi reťazcami (a stránka si pamätá zvolený variant do prvého zápisu). Test v `test_stranka_*`.
4. **Nová ER skrýva polia, ktoré validátor žiada** — **prvá polovica hotová 12. 9.**: pole, na ktoré padá diagnostika (E aj W), sa neskrýva nikdy, takže čerstvá ER ukáže `uc`, `spustacia_udalost` aj `obsahuje` s dôvodom hneď. Pri overovaní sa ukázalo, že `obsahuje ≥ 1` **žiadne pravidlo nekontrolovalo**, hoci NORMS-GAP §2 aj táto revízia to tvrdili — doplnené ako **C12** (E, 29481-1 3.3.10, negatívny fixture `ER-9002`). **Dokončené 12. 9., inak než znel návrh** (QUESTIONS Q43, DECISIONS U16): dialóg sa **pýta validátora**, nie schémy. `/api/kontrola` prijme `nova` (typ · id · názov · dáta), zostaví kandidáta zo šablóny typu **iba v pamäti**, vloží ho do knižnice a spustí validátor; diagnostiky nesú pointer, takže dialóg z nich vie, ktoré polia doplniť — čerstvá ER si vypýta `uc`, `spustacia_udalost` aj `obsahuje` s dôvodom pod každým (C3, C2, C12) a po ich vyplnení nálezy zmiznú. Register pravidiel tak ostáva jediným nositeľom toho, čo validátor žiada; pole `povinne_validatorom` v schéme by bola druhá kópia, ktorá sa rozíde pri prvom novom pravidle. Na disk nejde nič, kým autor nestlačí „založiť". Pôvodný nález: (`uc`, `spustacia_udalost`, `obsahuje` sú „nevyplnené voliteľné"; 14 skrytých). Oprava: pole s diagnostikou (E/W na pointeri) je vždy viditeľné; dialóg novej poznámky navyše pýta polia s pravidlom C (schéma nech nesie `zdroj_pravidla`/`povinne_validatorom` odvodené z registra pravidiel).
5. ~~**Diagnostiky sa po zmene neprepočítajú do uloženia**~~ — **hotové 12. 9.**: `/api/kontrola` (`zapis.kontrola`) aplikuje tie isté zmeny ako uloženie, ale **iba v pamäti** — texty poznámok ide loader (`nacitaj_subor(..., text=…)`) namiesto súborov, graf sa rozlíši nad nimi a validátor beží nad výsledkom; na disk nejde ani bajt. Stránka si prepočet vypýta 350 ms po poslednej zmene a prekreslí z neho **všetky** diagnostiky (pole, register, pás diagnostiky aj počty v topbare, ktoré pri neuložených zmenách hovoria „(s neuloženými zmenami)" alebo „(prepočítavam…)"). Bez servera sa prepočítať nedá, preto tam diagnostika na poli s neuloženou zmenou mlčí, kým sa neuloží — netvrdí nič o hodnote, ktorú už stránka nemá. Overené v Chromiu: vpísanie „nájomcu" do `IU-O-space.pokyn` ukáže D19 hneď a `git status` ostáva čistý. Pôvodný nález: po vložení `uc:: [[UC-0102]]` stránka ďalej ukazuje „E C3 · nájdených 0".
6. ~~**U13 register pravidiel**~~ — **hotové 12. 9.**: register typu, ktorý nesie pod-záznamy, sa otvára na nich. Riadok = pravidlo (profil, slovník), zoskupenie = poznámka, ktorá ho nesie, a počet v hlavičke je počet záznamov, nie súborov („6 záznamov · Pravidlá · v 1 poznámke"). Stĺpce sú zo schémy druhu (`PravidloSTD.STLPCE` = nazov · rozsah · plati · overenie · zavaznost), bunky sa editujú cez ten istý pointer `/__pod/<id>/<pole>`, ktorý pozná writer, a záložky ponúkajú ostatné druhy aj pôvodný zoznam poznámok. Stránka nedrží ani jeden názov typu — druhy číta z `TYPY[typ].pod_zaznamy` (`POD_ZAZNAMY` na modeli → `schema/ui.py`). Pôvodný nález: register počítal indexové poznámky (2), pravidlá boli dostupné len cez stránku poznámky.
7. ~~**U15 pruh v náhľade**~~ — **hotové 12. 9.**: pod topbarom je pruh „Náhľad — zmeny sa neukladajú… spusti `assetin edit .`", ktorý zmizne, len keď stránka nájde API (`[hidden]` musel dostať vlastné pravidlo, `display: flex` ho inak prebíjal). Pôvodne: `docs/editor.html`: „náhľad — zmeny sa neukladajú, spusti `assetin edit`".
8. ~~**Inšpektor „AK ZMENÍM" menuje dotknuté poznámky**~~ — **hotové 12. 9.**: pod vetou sú dotknuté poznámky ako klikateľné riadky, výmeny prvé a označené; engine ich vracal (`dopad_zmeny.poznamky`, `.vymeny`), stránka písala len počet. `DEF-plocha-cista` → ER-0101 (výmena) + IU-C-arch-model, IU-O-space, IU-O-storey, IU-O-zone, UC-0101. Pôvodný nález: (dnes „dotkne sa 1 výmeny cez 4 poznámky" bez mien — S3 chcel vidieť ER-0101, IU-O-space, IU-O-zone); engine `dopad_zmeny` ich už vracia, stránka ich neukazuje.
9. ~~**Pásmo „Prečo?" bez cieľa**~~ — **hotové 12. 9.**: keď cieľ chýba alebo je visiaci, pásmo ukáže prvý odsek prózy účelu užitia ako citát s odkazom na záložku Poznámka. Ktorá sekcia to je, hovorí **schéma** (`UC.SEKCIA_PRECO = "Cieľ a rozsah"` → `sekcia_preco` v popise typu), nie stránka; typ bez tejto deklarácie citát nedostane. Pôvodný nález: pri visiacom `GOAL-A-01` bolo pásmo prázdne, hoci odpoveď je v tele poznámky.
10. **Pod-záznam bez pruhu „kde to sedí"** — **polovica hotová 12. 9.**: príčinou nebola len stránka. `retazec._nositelia` bral z pointra **prvý** segment, takže odkaz cez vnorené pole nerátal: `GEO-G2` (`/geometria/profil`) nesedel na strome nikde a `DEF-plocha-cista` len cez `UC.pravidlo`, takže pruh nedošiel k výmene (nález §1.4). Teraz je nositeľom posledný nečíselný segment (`_nosne_pole`) — `GEO-G2` → `GOAL-A-01 › UC-0101 › ER-0101`, `DEF-plocha-cista` dostala aj cestu cez výmenu. **Dokončené 12. 9.**: `app_json` posiela `cesty` aj pod-záznamu a stránka pod-záznamu kreslí ten istý pruh (`#/STD-clenenie/pod/STD-CL-04` → `GOAL-A-01 › UC-0101 › tento záznam`, `GEO-G2` → `… › ER-0101`). Pri tom vyšiel najavo ďalší nález: pravidlo `plati: vzdy` (STD-CL-01) nemá nositeľa, ktorý by ho na strom zavesil, hoci platí všade — otázka Q42, nie tichá oprava. Pôvodný nález: (`#/STD-clenenie/pod/STD-CL-04` má prázdny pruh) — prierezové pravidlo má dostať pruh cez nositeľa (`retazce_pre` už vracia `cez`).

Otázky z revízie pre Samuela (Q35–Q40) sú v QUESTIONS; do schémy sa bez odpovede nič nepridáva.

### 4c. Kolo 4 (14. 9. 2026) — V26, V27 a prestavba reťazca

Zadanie: Samuel, 14. 9. (PAS 1958 6.3.2/6.3.3 ako normový základ — DECISIONS Z4). Poradie bolo dané zadaním a dodržané:

1. ~~**Over, či engine číta `IU-C.obsahuje`**~~ — **hotové**, nález v `docs/REVIEW-2026-09-14.md`: pole čítal len validátor (E2, E3) a mapa knižnice; reťazec, pruh, inšpektor aj dokument editora brali jednotky výhradne z `ER.obsahuje`, takže priradenie bolo dekorácia, ktorá sa mohla s výmenou ticho rozísť.
2. ~~**V27 — rozsah priradenia**~~ — **hotové**: `IU-C.obsahuje` je blok záznamov `{iu, rozsah}` (aspekty LOIN), `ER.obsahuje` nesie len kontajnery, migrácia `v1_4_to_v1_5.py` (vzor: protokol dostal `IU-O-space` s `rozsah: [dokumentacia]` z druhej strany väzby), jedno miesto čítania `engine/priradenie.py`, nové pravidlá C13, E8, E10 a prepísané C3, C4, C10, E2, E3, G1, H1.
3. ~~**V26 — MVD a dve triedy obmedzení**~~ — **hotové**: `IU-C.mvd {basis, name}` → `correspondingMvd` (a export sa odobral z `forma.format`, aby fakt nemal dvoch nositeľov), `x-assetin.trieda_obmedzenia` na 26 poliach, viditeľné v `docs/schema/*.json`, `docs/POLIA.md` aj `/api/schema`; pravidlo E9.
4. ~~**Prestavba reťazca**~~ — **hotové** (U17, U18): pásma 14 px, pásmo 2 bez výmeny a s úlohami v dvoch skupinách pod zvislou čiarou, pásmo 3 s výmenou ako kartou (kontajnery → objekty → rozsah aspektov), zrušená prerušovaná čiara 29481/7817, rozbalenie jednotky v ohnisku v prvom kontajneri, ktorý ju nesie.
5. **Drobnosti** — množné číslo už bolo (`mnozne` v stránke, `_mnozne` v inšpektore), doplnené aj do novej karty a skupín úloh; **`GOAL-A-01` a `GOAL-O-01` v `zadanie/GOAL/` nie sú** (QUESTIONS Q45) — text pásma „Prečo?" teraz chýbajúci cieľ aspoň menuje.

Otvorené po kole 4: Q45–Q50 v QUESTIONS (chýbajúce ciele, predvoľba rozsahu, MVD vzoru, obmedzenie hodnoty na priradení, prísnosť pri objekte vo výmene, klasifikácia medzi obmedzeniami prítomnosti).

### 4d. Kolo 5 (14. 9. 2026) — výmena ako predel v línii

Zadanie: Samuel, 14. 9. (nahrádza §3.2 a §3.3 zadania kola 4). Hotové:

1. **Predel** — výmena je riadok línie „Kto a kedy?" medzi úlohami dodania a použitia; podnadpisy skupín zrušené. Poradie a rozdelenie počíta engine: `Retazec.linia()` a `usek_ulohy()` (`assetin/engine/retazec.py`), stránka kreslí, čo dostane.
2. **Rozbalenie** — pásmo „Čo a ako podrobne?" sa kreslí pod predelom (nadpis, technický riadok, farba pásma ako pruh); samostatná karta a samostatné pásmo zrušené. Stránka nevie, ktoré pásmo to je — číta `r.pasma.jednotky` od enginu.
3. **Stav v adrese** — `?v=ER-0101` (prázdne = nič rozbalené); bez parametra platí predvoľba podľa ohniska.
4. **`používa aj UC-…`** — `Vymena.pouzivaju` z polí, ktoré knižnica má (`precondition`, `referencne_info`, `pre_task`); vo vzore prázdne, objaví sa s UC-0201.
5. **Tri úrovne hĺbky** (U20) zapísané do MODEL §9 a PROMPT-ui.

Otvorené po kole 5: Q51 (poradie výmen bez dátumov), Q52 (z čoho sa odvodzuje „používa aj").

### 4e. Zlúčenie dvoch relácií (19. 9. 2026) — čo z kola 6/7 ostalo v kóde

Vetva `claude/relaxed-darwin-wi1bgh` odbočila 13. 9., teda pred kolom 4, a postavila nad tým istým
reťazcom vlastné kolo (režim `Detail | Reťazce`, rozbaľovanie uzlov). Medzitým sa zlúčilo kolo 4 a 5.
Pri zlúčení dostala **stránka `app.html` stranu `main`** — jeho línia s predelom a tromi úrovňami
hĺbky (U19, U20) je novšia odpoveď na tú istú otázku. Zapísané ako kolo 7 v `PROMPT-ui`. Stav:

| zápis | v kóde | poznámka |
|---|---|---|
| **V28** — ER je hraničný typ | **áno** (`assetin/schema/typy/er.py`) | `hranicne` má na `main` ďalej spotrebiteľa (čip, `pasma.hranicne_pre`, `/api/schema`); zanikol iba vtedajší dôsledok pre obrazovku |
| zoznam všetkých reťazcov v payloade | **áno** (`app_json._retazce`, kľúč `retazce`) | zhrnutie prepočítané nad novým `Kontajner` (V27); stránka ho zatiaľ nekreslí |
| `.pasmo { min-width: 0 }` | **áno** | bez toho položka gridu narastie na šírku min-content a vytlačí pásma pod inšpektor |
| pod-záznam v `cip()` | **áno** | GEO profil a STD pravidlo žijú v `UZLY`, nie v `POZNAMKY` — nie je to visiaci odkaz |
| značka `loin=` na poli | **nie**, zahodená | duplicitný nositeľ: `IU_O.ASPEKTY` a `priradenie.rozsah` hovoria to isté (zásada 4) |
| **U21** — režim `Detail \| Reťazce` | **nie** | rozhodnutie zapísané, stránka ho nekreslí; sedí nad panelom, s vnútrom línie nekoliduje, takže sa dá nasadiť samostatne |
| **U22** — rozbaľovanie uzlov | **nie** | bije sa s U20; kde sa bijú, platí U20 (DECISIONS U22) |

Otvorené pre Samuela: nasadiť U21 na línii z kola 5, a či z U22 ostane niečo nad rámec U20.

### 5. Propagácia zmeny schémy

1. Zmena pydantic modelu → `assetin schema export` prepíše `docs/schema/*.json` a `docs/POLIA.md` (commit, diff v PR); CI kontroluje, že export sedí.
2. UI číta `/api/schema` pri štarte; nič v `app/` sa needituje.
3. MD nikdy ručne: `assetin/engine/migrations/vX_Y_to_vX_Z.py` pracuje nad Dokumentom (CommentedMap + bloky), nie nad typovaným modelom; `assetin migrate <dir> --to X.Z` na konci bumpne `KNIZNICA.md`; loader pri nezhode skončí chybou s pokynom.
4. Migrácia má fixture „pred → po“ + round-trip po migrácii.

### 6. Generátory — rozhrania

- `Generator`: `nazov`, `targets(kniznica) -> list[Target]`, `generate(kniznica, target, out_dir) -> list[Path]`.
- **IDS 1.0** (F4): target = (ER × poskytovateľ) v knižnici; v projekte (ER × udalosť × poskytovateľ) podľa §13. Applicability z IU-O: entity (`ifc_entita` veľkými + `predefined_type`), classification **iba zo záznamov `klasifikacia[]` bez `povinnost`** (+ vzor zo slovníka), `filter[]`. Requirements: záznamy `klasifikacia[]` **s `povinnost`** → classification facet s `cardinality` [V25]; položky s efektívnym `overenie: IDS` → attribute/property/material facet (`dataType` z `polozka.datovy_typ` [V24], zhoda so šablónou Pset/Qto sa overí cez ifcopenshell, `hodnoty`/`hodnoty_ref` → enumerácia, `vzor` → pattern, `rozsah` → bounds, cardinality z efektívnej `povinnost`); `clenenie::` prepisy → partOf; STD pravidlá `plati: vzdy` + `zapnute::` s `overenie: IDS` → vlastné špecifikácie (rozsah objekt aj kontajner; `federacia` nikdy); ```ids núdzové bloky s `vynimka: true` sa vložia surovo; abstraktná entita → enumerácia podtypov v entity facete. `ids.info` z ER (+ PROJ). Prednosť PROJ > ER > IU > STD v `graf.efektivna_polozka()`.
- Ostatné (7817-3 Specification, MIDP/TIDP, RACI, PDF, checklist, tabuľka objektov): trieda s rozhraním, `NotImplementedError`.

### 7. Testovací IFC 4.3

`scripts/build_fixture_ifc.py` (ifcopenshell.api): IfcProject, IfcSite, IfcBuilding, 3× IfcBuildingStorey (`1.PP`, `1.NP`, `2.NP`, Elevation), 8× IfcSpace (`01.001`…, PredefinedType INTERNAL, Qto_SpaceBaseQuantities; jeden bez NetFloorArea), 2× IfcZone (`NJ-001`, `SP-001`, ObjectType zo slovníka), IfcRelAggregates, IfcRelAssignsToGroup, 1× IfcBuildingElementProxy. Deterministické GUID a dátum → commitovaný `.ifc` regenerovateľný v CI.

### 8. Riziká (najväčšie)

1. Chirurgický writer nad ruamel `lc` je jediné miesto, kde bajtovú identitu pri štrukturálnych zmenách nezaručuje konštrukcia — golden testy a kanárik od prvého dňa F1.
2. Generický editor stojí a padá na mape JSON Schema → listy; každá výnimka pre IU-O alebo ACT, ktorá by sa do UI vkradla, poruší princíp 3, takže výnimky musia ostať v `PathScheme` a `x-assetin` metadátach.
3. Schéma v1.2 nie je zamrznutá (UC-0201, UC-0102 ju pohnú) a V17/V18 ju už teraz posúvajú na v1.3 — migračný mechanizmus musí fungovať skôr než editor, inak vzniknú ručné zásahy do MD.
