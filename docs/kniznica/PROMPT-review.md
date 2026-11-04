# Prompt pre Claude Code — hodnotenie: dáva to zmysel používateľovi a sedí to s normami?

Plan mode. Nepíš kód okrem skriptov na overenie. Výstup: `docs/REVIEW-2026-09-11.md` + aktualizácia `docs/QUESTIONS.md` a `docs/DECISIONS.md`.

## 0. Zdroje (v tomto poradí, zo súborov, nie z pamäte)
1. `docs/MODEL.md`, `docs/DECISIONS.md` — konceptuálny model a rozhodnutia. Ak chýbajú v repe, zastav sa a napíš to.
2. `docs/vault/LOIN-00…09` — výpisky z noriem s klauzulami (PAS 1958 6.1.3, 6.2.1, tab. 2; ISO 29481-1 3.3.x, 5.5; ISO 7817-1 §5–6, 7817-3 Annex B/C).
3. `docs/normy/` — plné texty, ak sú. Ak PAS 1958 nie je, napíš to a nedomýšľaj.
4. Kód: `assetin/engine/retazec.py` (po V23 strom), `graf.py`, `inspektor.py`, `writer.py`, `server/`, náhľad.

## 1. Používateľský zmysel — prejdi päť scenárov klik po kliku

Pre každý zapíš: koľko klikov, kde bol slepý koniec, čo používateľ *nevidel a mal vidieť*, čo videl a nepotreboval. Hodnoť ako laik (správca budovy, ktorý nepozná normy), nie ako autor.

1. **Čítať:** otvor Účely užitia → UC-0101 → Reťazec. Rozumie laik bez vysvetlenia, prečo sa to robí, kto čo odovzdá a čo musí mať priestor? Kde by sa stratil?
2. **Doplniť požiadavku:** pridaj do IU-O-space položku `Pset_SpaceCommon.Reference`, povinnosť optional. Kde sa to robí, čo sa zobrazí v Odkiaľ, uloží sa to cez `assetin edit` a je súbor po uložení bajtovo rozumný (git diff len tam, kde má byť)?
3. **Zmeniť pravidlo:** zmeň v STD-CL-04 `plati: na_vyziadanie` → `vzdy`. Ukáže inšpektor pred uložením, koho sa to dotkne (ER-0101, IU-O-space, IU-O-zone)? Po uložení zmizne `zapnute:: [[STD-CL-04]]` z ER ako zbytočné, alebo ostane a validátor to nahlási?
4. **Hľadať použitie:** kde všade sa používa `DEF-plocha-cista`? Koľko klikov od registra Definície k zoznamu miest.
5. **Založiť nový účel:** vytvor UC-0102 (TZB) zo šablóny a priraď mu existujúcu `IU-O-storey` cez nové ER. Vznikne reťazec bez duplikátov? Zobrazí sa `IU-O-storey` v oboch reťazcoch s jednou poznámkou (V21 repo číslovanie)?

Ku každému scenáru navrhni najmenšiu zmenu UI, ktorá slepý koniec odstráni. Nenavrhuj nové obrazovky.

## 2. Zhoda s normami — tabuľka, nie próza

Ak `docs/NORMS-GAP.md` existuje, aktualizuj; ak nie, vytvor. Stĺpce: pojem normy · klauzula/LOIN poznámka · náš typ/pole · **sedí / medzera / rozpor** · miesto v kóde · čo s tým. Povinne tieto riadky:

- PAS 1958: trigger event → use case (6.1.3); delivery vs utilization task (6.2.1); impact events (tab. 2); information requirement; deliverable; hierarchia OIR → AIR → PIR a jej väzba na use case (over, či `podporuje_ciel` + `prispieva_k` stačia, alebo norma kreslí hranu IR → deliverable priamo)
- ISO 29481-1/-3: use case (3.3.2), exchange requirement = UC × udalosť × príjemca (3.3.10), precondition (5.5.1), task, informationUnit / subInformationUnit, actor, businessRule; `idm` ↔ sub-UC (1:1) — sedí náš export?
- ISO 7817-1: level of information need určený účelom, míľnikom a aktérom (§5) — je každá naša IU-O jednoznačne priradená k účelu, míľniku a poskytovateľovi cez ER? kde to nie je jednoznačné (jednotka v dvoch výmenách)?
- ISO 7817-3: `SpecificationPerObjectType`, geometrické aspekty (porovnaj enum §14 doslovne s Annex B), `AlphanumericalInformation/Property`, `Documentation/Document @type/@form/@content`, `InformationDeliveryMilestone`, `Actor @affiliation`
- IDS 1.0: applicability z `objekt + klasifikacia + filter`, requirements z položiek s `overenie: IDS`, partOf pre členenie, `minOccurs/maxOccurs` z `pritomnost_v_modeli` — vygeneruj **dry-run IDS pre ER-0101 × ARCH** (skript, `tests/fixtures/ids/`) a validuj proti `ids.xsd`. Ak generátor ešte nie je, urob minimálny prototyp len pre tento prípad a povedz, ktoré polia chýbali.

## 3. Technické kontroly (výsledok áno/nie + dôkaz)
- Round-trip test existuje pre **každý** typ poznámky vo vzore (GOAL, UC, ER, IU-O, IU-C, STD, DEF, EV, ACT)? Zachová writer `#` komentáre vo frontmatter a HTML komentáre v tele? Ukáž diff po jednej zmene.
- `Retazec` je strom per UC (V23)? `z_uloh` vracia všetky úlohy, nie prvú? Test `cesta_pre("IU-O-space")` bez úlohy, lebo ich je viac?
- `ramec`, `prierezove`, `hranicne` sú na type v schéme a UI z nich odvodzuje pásma a oddeľovače panela — grep, že v UI nie je zoznam typov natvrdo.
- Dopad zmeny (V22 repo) je tranzitívny a neprotirečí spätným odkazom (test na UC-0101, ACT-poverena/ARCH, GEO-G2).
- Terminológia v troch vrstvách (kód `STD` / UI „Pravidlá a konvencie" / export „Informačný štandard") je v jednej mape; nikde nie je „Štandard" ani „Informačný štandard" v UI.
- Výkon: syntetických 300 poznámok (skript) — načítanie, validácia, otvorenie reťazca pod 2 s?
- Mermaid export stromu reťazca z enginu (bez interaktívneho UI) — funguje pre UC-0101?

## 4. Odpovede na otvorené QUESTIONS (od Samuela — zapracuj, ak nie je napísané inak)
- **Q14** (alias so `/` v Obsidiane): Samuel overí vo vaulte; dovtedy platí, že engine na alias nespolieha. Nezdržuj.
- **Q15** (D2 výklad): **A** — varovanie, výklad správny.
- **Q16** (počty a vzťahy hlási validátor, schéma odmieta len neinterpretovateľné): **súhlas**, zapíš ako zásadu do DECISIONS.
- **Q17** (prečíslovanie V17–V20 → V19–V22): **prijaté.** `docs/DECISIONS.md` v repe je pravda; Samuelova kópia sa zosúladí. Reťazec ako strom je **V23**.
- **Q18** (PROP/PROT/PROJ v paneli): zobrazovať **až keď nesú poznámku**; PROJ v knižnici nikdy. Potvrdené.
- **Q22** (úloha v pruhu): **(b) všetky** — po V23 je to `z_uloh`; v pruhu „kde to sedí" sa úloha vynechá, ak ich je viac.
- **Q24** (počet pri Pravidlá a konvencie): **počítať pravidlá, nie poznámky**, a register ich ukazovať ako riadky (STD-CL-01… ako záznamy, indexová poznámka ako zoskupenie). Pravidlo je to, s čím autor pracuje; súbor je len obal.
- **Q21/Q25** (zápis len pod `assetin edit`): v poriadku; do `docs/editor.html` doplň viditeľný pruh „náhľad — zmeny sa neukladajú, spusti `assetin edit`", aby to nebolo v drobnom texte.

## 5. Výstup
`docs/REVIEW-2026-09-11.md`: tri časti (používateľ · normy · technika), každý nález s úrovňou **rozpor / medzera / drobnosť**, s dôkazom (klauzula, test, grep) a s najmenšou opravou. Na záver tri vety: najväčší rozpor s normou, najväčší slepý koniec pre laika, čo by si opravil ako prvé. Nové otázky do QUESTIONS zoradené podľa dopadu, max 6.
