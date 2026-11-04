# Prompt pre Claude Code — naplánuj assetin-library (engine + editor)

> Použi plan mode. **Nepíš kód.** Výstupom tohto kola je plán, otázky a rozhodnutia, nie implementácia.

## Kto som a čo staviam

Som Samuel, BIM konzultant (Assetin s.r.o., SK/CZ). Staviam **assetin-library** — knižnicu informačných požiadaviek pre stavebníctvo (IDM → LOIN → EIR → BEP/MIDP) ako priečinok prepojených Markdown poznámok. Normatívny základ: ISO 29481-1/-3 (IDM), ISO 7817-1/-3 (LOIN), ISO 19650-1…4, PAS 1958, IDS 1.0 (buildingSMART). Z knižnice sa **generujú** výstupy: IDS súbory, 7817-3 Specification XML, EIR/BIM protokol PDF, MIDP/TIDP, RACI, akceptačné checklisty.

Prečítaj si najprv, v tomto poradí:
1. `docs/SCHEMA-v1.md` — záväzná schéma polí 13 typov poznámok (GOAL, UC, ER, IU-O, IU-C, STD, GEO, PROP, DEF, EV, ACT, PROJ + registre) s validačnými pravidlami v §16 a priečinkovou štruktúrou v §15.
2. `docs/SCHEMA-v1.2 zmeny.md` — odôvodnenie zmien v1.1 → v1.2 (V1–V16). Už je zapracované; čítaj pre kontext „prečo je to tak".
3. `zadanie/` — vzorový reťazec UC-0101 (priestorová pasportizácia): UC → ER → 3× IU-O → 2× IU-C → STD-clenenie + STD-geo-profily → 2× EV → 2× DEF → ACT. 18 poznámok. Toto sú testovacie dáta.
4. `docs/vault/LOIN-00 Index.md` a séria LOIN-01…09 — pozadie rozhodnutí. Čítaj podľa potreby, najmä LOIN-05 (kontajnery), LOIN-08 (rozsah objekt/kontajner/federácia), LOIN-09 (rozhodnutia a terminológia).

## Neporušiteľné princípy

1. **MD je zdroj pravdy.** Žiadna databáza vo fáze 1. Súborový systém je databáza, git je história. Appka aj generátory čítajú a zapisujú tie isté súbory, ktoré otváram v Obsidiane. Nikdy dve pravdy.
2. **Schéma existuje na jednom mieste** — ako kód (pydantic). Z nej sa odvodzuje JSON Schema, validácia, UI formuláre, dokumentácia polí. Zmena schémy = zmena jedného modelu.
3. **Editor nemá ani jeden ručne napísaný formulár.** Generický tabuľkový editor („poskladaný Excel"): registre = ploché tabuľky (riadok = poznámka), vnorené zoznamy v IU-O (alfanumerika, dokumentácia, geometrické aspekty) = vnorené tabuľky, wikilinky = výber z iného listu, validácia = červené bunky. Nič viac.
4. **Každá informácia má práve jedného nositeľa.** Knižnica nesie požiadavky a odkazy; model (DiMS) nesie objekty; CDE/CAFM nesie kontajnery, osoby, zmluvy. Duplikát je vždy chyba.
5. **Licencie:** komerčne bezpečné len MIT / Apache-2.0 / BSD / MPL-2.0 / LGPL (dynamicky linkované, napr. IfcOpenShell). **Žiadne AGPL** závislosti. Pri každej navrhnutej knižnici uveď licenciu.
6. Kód a komentáre v angličtine; **názvy polí schémy ostávajú slovenské** presne podľa SCHEMA-v1 (`zavaznost`, `poskytovatel`, `viaze_sa_na`…), lebo sú zároveň API pre autorov poznámok.

## Čo chcem od plánu

### A. Rozhodnutia (s dôvodmi a alternatívou, ktorú si zavrhol)
- Stack: backend (predpokladám Python 3.12, pydantic v2, ruamel.yaml kvôli zachovaniu komentárov, IfcOpenShell pre IFC 4.3 schému a IfcTester pre overenie IDS), frontend generického editora (schema-driven; navrhni 2–3 možnosti a odporuč jednu), balenie (lokálna appka nad priečinkom — FastAPI + web UI vs. Tauri vs. čisto TUI/CLI; zváž, že v Obsidiane už mám git sync).
- Ako presne sa JSON Schema z pydantic modelov mení na tabuľkové UI vrátane vnorených zoznamov a wikilinkov s kotvou (`[[STD-klasifikacia#typy-zon]]`).

### B. Dátový model a MD round-trip — najťažšia časť, venuj jej najviac
- Loader: frontmatter YAML + inline polia v tele (`kluc:: [[cieľ]], [[cieľ2]]`, Dataview syntax) + YAML bloky pod nadpismi (pravidlá v STD, profily v GEO) + wikilinky s aliasmi a kotvami → typovaný graf poznámok.
- Writer: pri zápise z editora **zachovať prózu tela, poradie sekcií, komentáre `#` vo frontmatter a HTML komentáre** — meniť len to, čo sa zmenilo. Navrhni stratégiu (napr. AST-podobná reprezentácia bloku po bloku) a ako ju budeš testovať (round-trip test: load → save bez zmeny = bajtovo identický súbor).
- ID = názov súboru bez „Názov" časti (`UC-0101 Priestorová pasportizácia.md` → `UC-0101`); výnimka ACT, kde ID = cesta (`ACT-poverena/ARCH`) a strana/tím sú folder-notes. Navrhni, ako to reprezentovať bez špeciálnych prípadov v UI.
- `filter`, `requirements` a ER `prepisy` sú už čistý vnorený YAML (V16). ER `prepisy` sú v tele ako blok ```yaml pod nadpisom — loader musí čítať YAML bloky pod nadpismi, nielen frontmatter.

### C. Validátor
- Vymenuj všetky pravidlá zo SCHEMA-v1 §16 a z patchu V1–V15 ako očíslovaný zoznam testov. Rozlíš: chyba / varovanie / info. Ku každému uveď, či je overiteľné čisto z grafu, alebo potrebuje IFC 4.3 schému (napr. entita ∈ ApplicableEntity s dedičnosťou, rozvinutie abstraktnej entity na podtypy) alebo bSDD.
- Ako sa validácia zobrazí v editore bez špeciálneho UI (bunka + správa).

### D. Generátory (fáza po editore, ale plánuj rozhrania teraz)
- IDS 1.0: 1 súbor per (ER × poskytovateľ); applicability z IU-O `objekt` + `filter` + `klasifikacia`, requirements z alfanumeriky s `overenie: IDS` (predvoľba), STD pravidlá s `plati: vzdy` + `zapnute::` z ER, prepisy PROJ > ER > IU > STD. Validácia proti oficiálnej XSD, beh IfcTester nad testovacím IFC.
- Testovací IFC 4.3: malý súbor vygenerovaný IfcOpenShellom (site, budova, 3 podlažia, ~8 IfcSpace s Qto_SpaceBaseQuantities, 2 IfcZone s ObjectType, väzby IfcRelAggregates / IfcRelAssignsToGroup, 1 IfcBuildingElementProxy ako zámerná chyba). Sú súčasťou test suite.
- Ostatné výstupy (7817-3 XML, MIDP/TIDP, RACI, PDF, checklist) len ako rozhranie: vstup = graf, výstup = súbor; neplánuj implementáciu.

### E. Štruktúra repa a fázy
- Navrhni layout monorepa: `zadanie/` (obsah knižnice = MD), `schema/` (pydantic), `engine/` (loader, writer, validator, generators), `app/` (editor), `tests/` (vrátane fixtures IFC/IDS), `docs/`.
- Fázy s jasným „hotovo, keď": F1 schéma ako kód + loader + round-trip test nad vzorom; F2 validátor + CLI (`assetin validate zadanie/`); F3 generický editor nad F1–F2; F4 generátor IDS + IfcTester test. Odhad rozsahu každej fázy v dňoch práce s Claude Code.
- Ako sa propaguje zmena schémy: pydantic → JSON Schema → UI (automaticky) a **migrácia existujúcich MD** (skript, nie ručne). Navrhni verziovanie schémy v poznámkach (`schema_verzia:` vo frontmatter?) — rozhodni.

### F. Otázky na mňa
Zoznam otázok, na ktoré potrebuješ odpoveď pred F1, zoradených podľa toho, ako veľmi by zlá odpoveď zmenila plán. Neodpovedaj si na ne sám. Očakávam 5–10, nie 30.

## Formát výstupu
- `docs/PLAN.md` — fázy, štruktúra, rozhodnutia (tabuľka: rozhodnutie / dôvod / zavrhnutá alternatíva / licencia).
- `docs/DATA-MODEL.md` — loader/writer, round-trip stratégia, cieľový YAML tvar pre pseudo-YAML časti, mapovanie ID ↔ súbor.
- `docs/VALIDATION-RULES.md` — očíslovaný zoznam pravidiel s úrovňou a zdrojom.
- `docs/QUESTIONS.md` — otázky pre mňa.
- Slovensky, stručne, bez marketingu. Pri každom mieste, kde si si neistý mojím zámerom, to napíš do QUESTIONS, nie do plánu ako fakt.

Nepíš kód, nevytváraj `pyproject.toml`, neinštaluj závislosti. Keď skončíš, zhrni mi v troch vetách, čo v pláne považuješ za najrizikovejšie.
