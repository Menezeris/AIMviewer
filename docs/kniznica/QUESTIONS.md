# QUESTIONS — otázky pre Samuela

<!-- Vygenerované z plánovacieho kola 2026-09-10 (plan mode, Claude Code). Záväzný zdroj polí: docs/SCHEMA-v1.md. -->

## Otvorené podľa dopadu (stav 12. 9. 2026 — max 9)

Zoradené od najväčšieho dopadu; každý bod odkazuje na podrobnosť nižšie v chronologickom logu. Zodpovedané otázky sa sem nevracajú (11. 9. večer vypadli: číslovanie Q17/Q29 → Z1, PROP/PROT Q18 → U14, počet pravidiel Q24 → U13, D2 Q15 → Z3, úloha v pruhu Q22 → V23; **12. 9. vypadli Q35 → V24 a Q36 → V25**).

| # | Otázka | Prečo je hore | Kde |
|---|---|---|---|
| 1 | **Normy z druhej ruky:** `docs/NORMS-GAP.md` je len z LOIN série, plné texty v `docs/normy/` nie sú — kto a kedy ich doplní lokálne | bez nich sa nedá overiť ani jeden riadok kontroly voči normám a O7 ostáva visieť | Q31 |
| 2 | **Hrana IR → deliverable** (`IU-C.dokladuje_ciel`) — pridať, alebo ostať pri tranzitívnej väzbe cez UC a ER | zmena modelu (nové pole na type), dotýka sa generátorov EIR | DECISIONS O7, NORMS-GAP §5 |
| 3 | **Akceptačné kritériá** (19650-4) — pole `akceptacia` na IU, ktoré vault označil vysokou prioritou, model stále nemá | jediná medzera „vysoká priorita“ zo vzoru bez odpovede | NORMS-GAP §4, LOIN-02 gap 3 |
| 4 | **STD pravidlo × poskytovateľ** — do ktorého IDS ide pravidlo bez `poskytovatel` | generátor F4 to musí vedieť; dnes hádame podľa entity | Q39 |
| 5 | **`PredefinedType` má dvoch nositeľov** (`objekt.predefined_type` a položka s výčtom) | MODEL §2 (jeden nositeľ); IDS má dve miesta | Q40 |
| 6 | **Dialekt regexu vo `vzor`** — XSD regex bez kotiev, alebo PCRE a generátor prekladá | `^…$` sa v IDS číta doslovne, takže dnešné vzory vo vzore by v IDS nesedeli | Q38 |
| 7 | **Skratka aktéra** v strome je posledný segment ID (`poverujuca` bez diakritiky) — stačí, alebo ACT dostane krátky názov | nové pole schémy vs. kozmetika | Q24 (kolo 2) |
| 8 | **Pravidlo `plati: vzdy` nemá na strome nositeľa** — prázdny pruh je správny, alebo sa má vešať na každý strom | tá istá otázka ako Q39 („komu pravidlo patrí"), odpoveď má byť jedna | Q42 |
| 9 | **Loader je 8 ms na poznámku** — nechať round-trip parser, alebo vymeniť rýchlosť za čísla riadkov v diagnostikách | pri 300 poznámkach 2,5 s na každý request servera; (c) by menilo princíp 1 | Q41 |

**Kolo 8 (2. 11. 2026) - knižnica v databáze (V29):** pred všetkým vyššie stoja otázky Q64 (a)-(h); bez nich nezačne PR-1. Bezpečnostný nález Q59 (RLS vypnuté na 43 tabuľkách AIM) patrí AIMviewer.

Mimo osmičky, s nižším dopadom: Q37 (kontakt aktéra pre `ids:info/author`), Q14 (alias so `/` v Obsidiane — Samuel overí vo vaulte, engine na to nečaká), Q27 (každý zoznam objektov je vnorená tabuľka), Q28 (próza len na čítanie), Q32 (`guid` pri založení), Q34 (odkaz na graf z ľavého panela).

**Nálezy revízie, ktoré nie sú otázky, ale chyby na opravu** (podrobne `docs/REVIEW-2026-09-11.md`, poradie a stav v PLAN §4b): opravené sú writer (riadkový patch namiesto re-dumpu bloku), kvadratický `dokument()`, prepínač variantu únie, skrývanie poľa s diagnostikou, menovanie dotknutých poznámok v inšpektore, pruh náhľadu a nositeľ cez vnorené pole. Otvorené ostávajú: diagnostiky sa v stránke po zmene neprepočítajú do uloženia (bod 5), register pravidiel počíta poznámky namiesto pravidiel (bod 6), pásmo „Prečo?" bez cieľa (bod 9), pruh pod-záznamu (druhá polovica bodu 10) a dialóg novej poznámky nepýta polia s pravidlom C (druhá polovica bodu 4).

## Zodpovedané v plánovacom kole (2026-09-10) — zapracované do PLAN / DATA-MODEL / VALIDATION-RULES

| # | Otázka | Rozhodnutie |
|---|---|---|
| 1 | Obsidian nerozlíši `[[UC-0101]]` podľa `id` | writer udržiava `aliases: [<id>]` (V18); ak alias so `/` pri ACT nefunguje, ACT odkazy ostanú v Obsidiane mŕtve, tvar ID sa nemení |
| 2 | Úlohy UC (T1…D2) ako dáta | áno, V17: YAML blok `ulohy:` pod `## Business context`, migrácia skriptom |
| 3 | Tvar slovníkov v STD-klasifikacia | YAML blok pod nadpisom (`id`, `hodnoty` / `vzor`, `odvodene_z`) |
| 4 | Frontend | Svelte 5 + Vite + Tabulator 6, Node build prijateľný, `app/dist` commitovaný |
| 5 | Neznáme pole vo frontmatter | chyba (`extra=forbid`) |
| 6 | Typy bez vzoru (GOAL, PROP, PROT, PROJ) | modelovať už v F1 so syntetickými fixtures |
| 7 | Umiestnenie `KNIZNICA.md` (schema_verzia) | koreň repa, jedna verzia pre všetky vrstvy |
| 8 | Design-kit | npm z `github:AssetinSpace/design-kit`, prvotné návrhy inšpirované kitom, 2–3 skice odsúhlasiť pred kódom F3 |
| 9 | Sieť | `ids.xsd` + testcases sťahuje skript na pinnutý tag (nekomituje sa); bSDD online cez API s cache, `--offline` vypne |
| 10 | Rozsah editora F3 | vytváranie nových poznámok zo šablóny + premenovanie pri zmene `nazov`; mazanie a zmena `id` nie |
| 11 | LOIN-00…09 | skopírované do `docs/vault/` (2026-09-10, `ObsidianPKM@284123f`); ObsidianPKM je zdroj len na čítanie, nič sa tam nezapisuje |
| 12 | DSS `Configurations.ids` | uložený v `tests/fixtures/ids/dss/` (2026-09-10) |
| 13 | Vetva pre F1 | odporúčanie: zlúčiť plánovaciu vetvu do `main`, F1 na novej vetve z `main` (jedna fáza = jeden PR) |

## Otvorené

### Q14 · Alias s `/` pri ACT v Obsidiane (prvý krok F1, 2026-09-10)

**Stav 11. 9. (Samuel):** overí vo vaulte; dovtedy platí, že engine na alias nespolieha. Nezdržuje.

**Stav: neoverené v Obsidiane.** Prostredie Claude Code na webe nemá Obsidian ani sieťový prístup na `help.obsidian.md` / fórum, preto je nižšie len záver zo známeho správania Obsidianu (do verzie 1.8), nie výsledok skúšky vo vaulte. **Samuel, prosím, over podľa postupu a doplň výsledok sem** (stačí jedno slovo v stĺpci „Skutočnosť").

Známe správanie Obsidianu (na potvrdenie):
1. Obsidian rozlišuje `[[cieľ]]` výhradne podľa **názvu súboru alebo cesty** (`metadataCache.getFirstLinkpathDest`). `aliases` vo frontmatter slúžia **iba pre návrhár odkazov** (autocomplete) a vyhľadávanie; pri výbere aliasu z návrhov Obsidian vloží `[[Názov súboru|alias]]`, nie `[[alias]]`. Ručne napísaný `[[UC-0101]]` teda ostáva **nevyriešený** (graf ho ukáže ako prázdny uzol, klik vytvorí novú poznámku), hoci `aliases: [UC-0101]` existuje.
2. `/` v texte odkazu Obsidian číta ako **oddeľovač cesty**: `[[ACT-poverena/ARCH]]` hľadá priečinok `ACT-poverena` a súbor `ARCH.md`. Skutočná cesta je `registre/ACT/poverena/ARCH/ARCH.md`, takže odkaz je mŕtvy bez ohľadu na alias. Alias `ACT-poverena/ARCH` je v YAML platný, Obsidian ho zobrazí v návrhoch, ale bare odkaz ním nevyrieši.

Dôsledok, ak sa to potvrdí: V18 (`aliases: [<id>]`) pomáha pri **písaní** odkazov v Obsidiane (návrhár ponúkne poznámku podľa ID) a Dataview/vyhľadávaniu, ale **nevyrieši bare `[[ID]]`** — ani pre ACT, ani pre ostatné typy. Rozhodnutie z otázky 1 (tvar ID sa nemení, ACT odkazy môžu ostať v Obsidiane mŕtve) platí; engine rozlišuje odkazy podľa ID sám (DATA-MODEL §3), Obsidian je len editor textu.

Postup ručného overenia (5 min):
1. Otvoriť repo ako vault (po migrácii v1.3, keď `aliases` existujú).
2. V ľubovoľnej poznámke napísať `[[UC-0101]]` a `[[ACT-poverena/ARCH]]` ručne (bez výberu z návrhov), prepnúť do čítacieho režimu: je odkaz fialový/aktívny, alebo „nevyriešený" (klik ponúka novú poznámku)?
3. Napísať `[[ACT-pov` a počkať na návrhy: ponúkne Obsidian alias `ACT-poverena/ARCH`? Po výbere vloží `[[registre/ACT/poverena/ARCH/ARCH|ACT-poverena/ARCH]]` alebo `[[ARCH|ACT-poverena/ARCH]]`?
4. Graf: má `UC-0101 Priestorová pasportizácia` hranu na `ACT-poverena/ARCH`?

| Test | Očakávanie (teória) | Skutočnosť |
|---|---|---|
| ručný `[[UC-0101]]` rozlíšený | nie | |
| ručný `[[ACT-poverena/ARCH]]` rozlíšený | nie | |
| návrhár ponúkne alias so `/` | áno | |
| po výbere vložený tvar | `[[ARCH\|ACT-poverena/ARCH]]` (kratšia cesta) | |

Ak by bare `[[ID]]` cez alias predsa fungoval (novšia verzia Obsidianu), nič v engine sa nemení — iba by odpadol dôvod pre `[[súbor|ID]]` tvar pri písaní v Obsidiane.

Žiadne blokujúce pred F1 (Q14 neblokuje: engine na Obsidian alias nespolieha).

Na vedomie (nie otázka): vault `ObsidianPKM/30_Projects/Assetin Library/SCHEMA-v1.md` je stále **v1.1**; repo má v1.2 a je jediná pravda. Vault sa z repa neaktualizuje (len na čítanie) — ak chceš, nahraď ju vo vaulte odkazom na repo.

### Q15 · Výklad pravidla D2 „požiadavka bez overenia" (F2a, 2026-09-10)

**Odpoveď 11. 9. (Samuel): A** — varovanie, výklad správny. Zapísané ako DECISIONS **Z3**.

`docs/VALIDATION-RULES.md` D2 (zo SCHEMA §16.3) hovorí: *požiadavka bez `overenie` ⇒ `zavaznost ∈ {zmluvne, informativne}`*. Doslova sa to nedá kontrolovať: §14b dáva každej zložke predvolené `overenie` (alfanumerika → IDS, geometria → manual, dokumentácia → manual), takže položka bez overenia v knižnici nevznikne.

**Implementovaný výklad (varovanie, nie chyba):** položka so `zavaznost: musi | ma`, ktorá nemá **žiadne obmedzenie** (`povinnost`, `vzor`, `hodnoty`, `hodnoty_ref`, `rozsah`), nič nevynucuje — IDS z nej vygeneruje prázdnu požiadavku. Validátor navrhne doplniť obmedzenie alebo dať `zavaznost: informativne`.

Samuel, potvrď alebo oprav:
- **A** výklad je správny, nechať ako `W`;
- **B** má to byť chyba `E`;
- **C** D2 znamená niečo iné — napíš čo, prepíšem pravidlo aj text v SCHEMA §16.3.

### Q16 · `uc::` s dvoma cieľmi prestalo byť chybou schémy (F2a)

**Odpoveď 11. 9. (Samuel): súhlas** — zásada je v DECISIONS ako **Z2**.

Model ER mal `max_length=1` na `uc`, takže druhý `uc::` zhodil celú poznámku (pydantic) a prišli sme o všetky ostatné diagnostiky na nej. Presunul som to do pravidla C3 (`E`, „ER má práve jeden `uc::`"). Poznámka sa načíta, chyba sa nahlási presne. Rovnaký princíp navrhujem držať aj ďalej: **schéma odmieta len to, bez čoho sa poznámka nedá interpretovať; počty a vzťahy hlási validátor.**

Na vedomie z F1 (nie otázky, rozhodnuté v kóde; ozvi sa, ak nesúhlasíš):
- **Python 3.11**, nie 3.12 (PLAN R1): prostredie Claude Code na webe má 3.11; `requires-python >= 3.11`, kód nič z 3.12 nepotrebuje.
- **Oprava YAML vo vzore migráciou:** `postup` v STD-CL-02 a STD-CL-04 mal `"„…" …"` (dvojité úvodzovky vnútri dvojito citovanej hodnoty) — neplatný YAML, ktorý Obsidian nehlási. Migrácia v1.3 ho prepísala na jednoduché úvodzovky (SCHEMA §16.21); ručný zásah do `zadanie/` nebol.
- **`[[STD]]` v ER `standard::`** ostáva visiaci, kým nevznikne indexová poznámka `zadanie/STD/STD.md` (SCHEMA §6).
- **Šablóna novej poznámky** (`writer.nova_poznamka`) vypíše všetky polia hlavičky v poradí schémy (aj prázdne, ako vzor `guid:`); `verzia: '0.1'` je citovaná, lebo ruamel inak zapíše číslo.

---

## Z prestavby UI (2026-09-10)

### Q17 · Čísla V17–V20 zo zadania už boli obsadené — posunul som ich na V19–V22

**Odpoveď 11. 9. (Samuel): prijaté.** `docs/DECISIONS.md` v repe je pravda (Z1); Samuelov register je zosúladený (V17/V18 = F1, V19–V22 = štyri rozhodnutia prestavby). Reťazec ako strom je **V23** (v repe bol dočasne V21; prečíslované 11. 9. v kóde, testoch aj dokumentoch).

Zadanie prestavby označuje nové rozhodnutia `V17` (vrstva je vlastnosť), `V18` (pásma noriem), `V19` (jedna poznámka jedno miesto) a `V20` (tri odvodené údaje). Tie čísla ale v repe už niesli iné veci od F1: **V17 = úlohy UC ako blok `ulohy:`**, **V18 = `aliases` udržiava writer** (SCHEMA v1.3, migrácia `v1_2_to_v1_3.py`, pravidlá §16.19–20). Prečíslovať staré by znamenalo prepísať migráciu, testy aj commit history.

Zapracoval som ich preto ako **V19–V22**:

| V zadaní | V repe | Obsah |
|---|---|---|
| V17 | **V19** | vrstva je vlastnosť, nie priečinok navigácie; definícia vs. dosadenie |
| V18 | **V20** | pásma noriem ako deklarácia na type poznámky |
| V19 | **V21** | jedna poznámka žije na jednom mieste |
| V20 | **V22** | tri odvodené údaje pre inšpektor |

**Samuel, potvrď** (alebo povedz, ako to chceš inak) — v SCHEMA §17–§20 a v texte je použité nové číslovanie, odkazy typu „V20.1" zo zadania zodpovedajú „V22.1".

Verziu schémy som **nebumpol**: V19–V22 nemenia ani jedno pole poznámky (V19 je validačné pravidlo, V20 deklarácia na *type*, V21/V22 dôsledky pre appku), takže migrácia MD nie je čo robiť a `KNIZNICA.md` ostáva na `1.3`.

### Q18 · Ľavý panel má deväť položiek, schéma dvanásť typov

**Odpoveď 11. 9. (Samuel):** zobrazovať **až keď nesú poznámku**; `PROJ` v knižnici nikdy. Potvrdené, DECISIONS **U14** — kód to už robí.

§4.1 zadania vymenúva deväť registrov (Ciele … Aktéri). Schéma má okrem nich ešte `PROP` (vlastné vlastnosti mimo IFC, §7), `PROT` (BIM protokol, §11) a `PROJ` (projektová inštancia, §12). Aby sa k nim dalo dostať a zároveň panel neopuchol, sú **za deviatkou a zobrazia sa len vtedy, keď nesú aspoň jednu poznámku** (`PORADIE_UI` 10–12 na modeli typu). Vo vzore `zadanie/` teda vidno presne deväť položiek zo zadania.

**Samuel, potvrď** — alebo povedz, či `PROP` a `PROT` majú byť v paneli vždy (aj prázdne), prípadne skryté úplne a dostupné len cez `⌘K`.

`PROJ` je zvláštny prípad: je to typ vrstvy `projekty/`, v knižnici sa nikdy neobjaví (pravidlo A8). V paneli knižnice bude preto vždy neviditeľný.

### Q19 · Tri veci z §7 zadania — overené

**„Hlavička hlásila `v1.3 SCHÉMA`, hoci v repe je v1.2."** Číslo je z `KNIZNICA.md` (`schema_verzia`), kde ho zapísala migrácia `assetin migrate --to 1.3` (commit `e2ad006`, F1). **Repo je naozaj v1.3**, nie v1.2: `docs/SCHEMA-v1.md` má v hlavičke `status: v1.3` a `assetin/__init__.py` `SCHEMA_VERZIA = "1.3"`. v1.2 bola verzia v pôvodnom zipe pred F1. Appka ju len zobrazuje, nikde ju nepočíta.

**„V ľavom paneli bol `UC-0106`, ktorý vo vzore neexistuje."** Taký odkaz v repe nie je (`grep -rn "UC-010[0-9]" zadanie/`). Vzor obsahuje `UC-0101` (poznámka), `[[UC-0100]]` (`nadradeny_uc::`, zámerne visiaci) a `[[UC-0102]]` v próze vymedzenia. Starý panel kreslil visiace ciele odkazov ako *ghost* položky, takže `UC-0100` v ňom stál medzi účelmi užitia bez poznámky — takmer isto to bolo ono. Nový panel visiace poznámky do registrov nemieša; ostávajú v diagnostike ako varovanie B1.

**„`IU-O-zone` mala 13 varovaní pri 2 položkách, `IU-O-space` 8 pri 7."** Ani chyba validátora, ani visiace `hodnoty_ref` — **odznak zlučoval úrovne**. Skutočnosť: `IU-O-zone` = 2 × `W B1` + 4 × `I D19` + 7 × `I D15`, `IU-O-space` = 2 × `W B1` + 1 × `W D12` + 5 × `I D15`. `assetin validate` má predvolenú úroveň `warning`, takže vypisuje 2 a 3; appka zobrazuje aj `I`, ale písmeno brala z najhoršej úrovne a počet zo všetkých. Opravené dvakrát: odznak počíta po úrovniach (`W 2` `I 11`) a diagnostika sa hlási na svojom riadku, nie znova na každom nadradenom poli — jeden nález predtým vyzeral ako päť.

### Q20 · Mená CSS premenných zo zadania sú alias vrstva nad `--ds-*`

§5 zadania predpisuje `--surface-1`, `--text-primary`, `--border`, `--bg-accent`… ; CLAUDE.md (design-kit) hovorí, že v appke sa nesmie hardcodovať nič mimo `--ds-*`. Splnené oboje: mená zo zadania sú definované **raz, v `:root`, výhradne ako odkazy na tokeny kitu** (`--surface-2: var(--ds-surface)`), takže v appke nie je ani jedna literálna farba okrem troch okrajov pásiem, ktoré zadanie výslovne pripúšťa. Ak by kit dostal vlastné sémantické tokeny, prepíše sa desať riadkov na jednom mieste.

Ikony sú vendorované (Tabler outline, MIT) ako `<symbol>` sprite priamo v stránke — appka je jeden súbor bez siete, takže webfont ani CDN neprichádzali do úvahy. Pôvod a postup aktualizácie: `assetin/engine/nahlad/IKONY-PÔVOD.md`.

### Q21 · Hromadná zmena `povinnost` má dve miesta

**Odpoveď 11. 9. (Samuel, k Q21/Q25):** zápis len pod `assetin edit` je v poriadku; do `docs/editor.html` doplniť **viditeľný pruh** „náhľad — zmeny sa neukladajú, spusti `assetin edit`" (DECISIONS **U15**; implementácia v PLAN §4b, nie v revíznom kole).

§6 zadania žiada „všetky IU-O naraz, hromadná zmena `povinnost`". `povinnost` ale nie je pole poznámky — je na *položke* (`alfanumerika[].povinnost`); na poznámke je `pritomnost_v_modeli`. Register má preto dve záložky: **Poznámky** (hromadná zmena enumov poznámky) a **Alfanumerika** (plochý zoznam všetkých položiek všetkých IU-O so stĺpcom Odkiaľ a hromadnou zmenou `povinnost`, `zavaznost`, `overenie`, `rola`). Ktoré pole je „položkové", hovorí schéma (`polozky=True` na `IU_O.alfanumerika`), nie stránka.

**Na vedomie:** hromadná zmena zapisuje do pracovnej kópie a objaví sa v zozname Zmeny. Stránka stále nič neukladá (zásada 1) — zápis cez writer je ďalší krok F3.

---

## Z druhého kola opráv UI (2026-09-10)

**Tri veci „stále nezodpovedané" sú zodpovedané v Q19 vyššie** (`v1.3`, `UC-0106`, 13 varovaní pri dvoch
položkách). Skrátene: `v1.3` je správne číslo z `KNIZNICA.md` (repo je na v1.3 od F1, v1.2 bola verzia
v zipe); `UC-0106` v repe nie je — visiaci `UC-0100` z `nadradeny_uc::` kreslil starý panel ako ghost
položku medzi účelmi užitia; a „13 varovaní" bolo 2 × `W B1` + 11 × `I` (D15, D19) zlúčených do jedného
odznaku. Odznak už počíta po úrovniach.

### Q22 · Úloha v pruhu je `T2`, v skici bola `T3`

**Odpoveď 11. 9. (Samuel): (b) všetky** — po V23 je to `z_uloh` na výmene; v pruhu „kde to sedí" sa úloha vynechá, ak ich je viac. Kód to už robí (`cesty_pre`).

Pruh „kde to sedí" ukazuje pri `IU-O-space` krok **T2**, nie T3. Obe úlohy majú `IU-O-space` vo `vystup`:
`T2` ho vytvára (IfcSpace, identifikácia, klasifikácia), `T3` doňho zapisuje plochy. Engine berie **prvú**
úlohu, ktorá jednotku vyrába. Alternatívy: (a) nechať prvú, (b) ukázať všetky (`T2, T3`), (c) doplniť na
úlohu príznak „hlavná". **Samuel, povedz ktorú** — dovtedy platí (a).

### Q23 · Dopad zmeny: doplnil som tri polia navyše

Zadanie (§5, kolo 2) vymenúva `zapnute`, `pravidlo`, `hodnoty_ref`, `definicia_ref`, `obsahuje`,
`spustacia_udalost`. Pridal som **`uc`**, **`pre_task`** a **`profil`** z toho istého dôvodu, pre ktorý si
pridal `spustacia_udalost`: bez nich panel pri `UC-0101` hlásil „odkazuje sem 4" a zároveň „nedotkne sa
inej poznámky", a zmena `GEO-G2` sa nedotkla ani jednej geometrie, ktorá ho dedí.

Zvyšný rozdiel medzi oboma blokmi je **zámerný a nie je protirečenie**: na `ACT-poverena/ARCH` ukazuje
šesť polí, ale jeho obsah nikto nededí — rola je odkaz, nie dedenie. Panel to preto píše ako
„obsah tejto poznámky sa ďalej nededí", nie „nedotkne sa inej poznámky".

### Q24 · Register „Pravidlá a konvencie" počíta poznámky, nie pravidlá

**Odpoveď 11. 9. (Samuel): počítať pravidlá, nie poznámky**, a register ich ukazovať ako riadky (STD-CL-01… ako záznamy, indexová poznámka ako zoskupenie). DECISIONS **U13**; implementácia v PLAN §4b (register STD dostane riadky pod-záznamov, panel počíta `k.pod_zaznamy`).

V paneli je pri „Pravidlá a konvencie" číslo **2** (indexové poznámky `STD-clenenie`, `STD-geo-profily`),
hoci autor hľadá **6 pravidiel** a 2 profily, ktoré v nich žijú ako pod-záznamy. Tvoja skica z prvého kola
mala 6. Zatiaľ som nechal počet poznámok, lebo register je register poznámok. **Samuel, potvrď**, či má
panel pri tomto type počítať pod-záznamy (a register ich ukazovať ako riadky).

### Q25 · Zápis funguje len pod `assetin edit`, nie v exportovanom súbore

**Odpoveď 11. 9. (Samuel):** v poriadku; viditeľný pruh v náhľade — viď Q21 / U15.

`docs/editor.html` je jeden súbor bez servera — nemá kam zapisovať, takže je to náhľad (a taký ostane; je
to vec, ktorú vieš poslať e-mailom). Zápis do MD beží pod lokálnym serverom:

```
pip install -e ".[server]"
assetin edit .            # http://127.0.0.1:8765
```

Stránka si sama zistí, či server je (`GET api/stav`), a podľa toho ukáže alebo skryje tlačidlo
**Uložiť do MD**. Po uložení sa prekreslí z dokumentu, ktorý server znova načítal zo súborov — nikdy
z pracovnej kópie v prehliadači. Zmena, po ktorej sa poznámka nedá natypovať, sa **vráti späť** a nahlási
sa diagnostikou (test `test_zmena_ktora_rozbije_poznamku_sa_vrati_spat`).

**Na vedomie:** server je bez stavu a beží len na `127.0.0.1`. História je git — appka nič neverzuje.

---

## Z kola 3 UI (2026-09-11)

### Q24 · Strom „Kto a kedy?": úlohy ako súrodenci, výmeny pod poslednou úlohou — **zodpovedané 11. 9.**

**Odpoveď je v `docs/MODEL.md` §5 a v `DECISIONS.md` U9: výmena je dieťa účelu užitia, nie úlohy** — stojí na tej istej úrovni ako úlohy a to, ktoré úlohy ju živia, sa hovorí slovami na jej riadku (`z úloh T2, T3 · pri EV-D-0012 · príjemca poverujuca`). Kód to už robí takto; pôvodná úvaha nižšie zostáva ako záznam, prečo sa najprv kreslila o úroveň nižšie.

~~Zadanie §4.1 hovorí „viac úloh alebo výmen = súrodenci na rovnakej úrovni". `IU-O-space` vyrábajú **dve** úlohy (T2 aj T3 majú `vystup: [[IU-O-space]]`), obidve ústia do tej istej ER-0101. Keby bola výmena vnorená pod každú úlohu, bola by v strome dvakrát (porušenie V21). Preto `retazec.strom_pre` kreslí úlohy ako súrodencov a **výmeny ako súrodencov o úroveň nižšie, pod poslednou úlohou**:~~

```
EV-I-0007   …   spúšťa
  UC-0101   …   účel užitia
    T2      …   ARCH
    T3      …   ARCH
      ER-0101  …  pri EV-D-0012 · príjemca poverujuca
```

Pri jednotke v ohnisku sú to len úlohy, ktoré ju vyrábajú; pri UC / ER / EV / prierezovej poznámke všetky úlohy, ktorých výstup nesie niektorá výmena kaskády. Väzbu úloha → výmena číta engine z oboch strán: `pre_task` na jednotke (MODEL §5) aj `vystup` na úlohe, lebo `pre_task` nesie iba IU-O, nie IU-C.

**Otvorené zostáva:** krátky popisok aktéra vpravo je posledný segment ID (`ACT-poverena/ARCH` → `ARCH`, `ACT-poverujuca` → `poverujuca`), preto je bez diakritiky — ak má byť „poverujúca", treba na ACT krátky názov (nové pole schémy). **Samuel, potvrď** alebo povedz, že to takto stačí.

### Q25 · Adresy sú v hashi

Každá obrazovka má URL (`#/registre/UC`, `#/IU-O-space`, `#/IU-O-space/retazec`, `#/IU-O-space/retazec?r=1` pre druhú kaskádu, `#/STD-clenenie/pod/STD-CL-04`); ID so `/` (ACT) sú v adrese percentovo kódované. Hash namiesto cesty preto, že ten istý súbor musí fungovať dvojklikom bez servera (R11b); pod `assetin edit` je to to isté. Späť ide tlačidlom prehliadača, drobčeky ostávajú.

### Q26 · „Tooltip Krok späť nesmie prekrývať panel"

V kóde ani v design-kite nič s názvom „Krok späť" nie je (ani tooltip primitív). Nový prepínač inšpektora zámerne nemá `title`, aby natívny tooltip panel neprekrýval. Ak išlo o niečo iné (napr. tlačidlo späť prehliadača nad panelom), upresni.

### Q27 · Každý zoznam objektov je vnorená tabuľka

§2 žiada tabuľku položiek pri IU-O (`alfanumerika`, `dokumentacia`). Zásada 3 nedovoľuje výnimku pre jeden typ, preto je **každý** `zoznam-objektov` v schéme editovateľná vnorená tabuľka (stĺpce = skalárne polia položky, riadok sa rozbalí na celý záznam s vnorenými úniami ako `ifc`): `klasifikacia`, `prepisy` v ER, `ulohy` v UC, `kpi` … Únie bez spoločných stĺpcov (`filter`) ostávajú zoznamom so zhrnutím. **Potvrď**, alebo povedz, ktoré zoznamy majú ostať zoznamom.

### Q28 · Próza tela len na čítanie

Záložka Poznámka ukazuje pod poľami prózu tela po sekciách (z `Dokument.sekcie()`), ale needituje ju — writer prózu nemení (zásada 7) a zadanie editáciu prózy nežiada. Ak má byť próza editovateľná, je to nové rozhodnutie pre writer (chirurgický patch odseku), nie pre stránku.

Na vedomie: `Forma.format` (ER aj IU-C) dostal `technicky=True`, aby riadok kontajnera v pásme 3 niesol formát (`IFC`, `PDF/A-2`) tak, ako objekt nesie IFC entitu — mení sa len `docs/schema/{ER,IU-C}.json`, nie MD.

### Q29 · Číslovanie v `DECISIONS.md` sa rozchádza s repom (11. 9.)

**Uzavreté 11. 9. večer:** Samuel prijal variant A (Z1). Register v repe je zosúladený, strom = V23, hrana IR → deliverable = O7 (nie „V22 otvorené").

`docs/MODEL.md` a `docs/DECISIONS.md` sú uložené **doslova tak, ako prišli** — register je Samuelov dokument a pravidlo „staré sa neprepisujú" platí aj pre mňa. Kolízia je ale reálna a treba ju rozhodnúť:

| V registri | V repe (kód, migrácia, testy) | Obsah |
|---|---|---|
| — | **V17** | úlohy UC ako YAML blok `ulohy:` |
| — | **V18** | `aliases` udržiava writer |
| **V17** | V19 | knižnica obsahuje definície, zakázané sú dosadenia |
| **V18** | V20 | pásma noriem ako pole na type poznámky |
| **V19** | V21 | jedna poznámka žije na jednom mieste |
| **V20** | V22 | tri odvodené výpočty inšpektora |

Repo číslovanie je zapojené do `SCHEMA-v1.md`, migrácie `v1_2_to_v1_3.py`, pravidiel validátora aj testov; register zapojený nikde nie je. **Samuel, vyber:**
- **A** — register prečíslovať na V19–V22 a doplniť doň chýbajúce V17 (`ulohy`) a V18 (`aliases`); jedno číslovanie pre všetko (odporúčam);
- **B** — nechať dve číslovania a žiť s mapou vyššie (je aj v `CLAUDE.md`).

Ďalšie k obsahu registra:
- **O3** („`v1.3` v hlavičke editora vs. v1.2 v repe") je už **vyriešené** — repo je na v1.3, `KNIZNICA.md` aj `assetin schema check` sedia.
- **U9** a **MODEL §5** zodpovedali Q24 (výmena je dieťa účelu) — kód opravený, testy `test_vymena_je_dieta_ucelu_nie_ulohy` a `test_pre_task_doplni_ulohy_kontajnera` to strážia.

### Q30 · Zo zipu som dve veci **nepoužil** (11. 9.)

Balík `docsmodeldecisions.zip` niesol okrem dvoch nových dokumentov aj dva súbory, ktoré sú v repe **novšie**; prepísať ich by bol krok späť, tak som ich nechal tak:

- **`CLAUDE.md`** — verzia zo stavu 10. 9. (schéma v1.2, pred F1/F2a/F3 a pred kolom 3 UI). Do repa som z nej vzal **iba novú sekciu „Povinné čítanie pred zmenou štruktúry"**; zvyšok súboru v repe je novší.
- **`zadanie/UC/UC-0101 Priestorová pasportizácia.md`** — verzia **pred migráciou na v1.3**: nemá `aliases: [UC-0101]` a úlohy sú prózové odrážky namiesto YAML bloku `ulohy:`. Nasadiť ju by zrušilo V17 aj V18 a zhodilo by to migračné a round-trip testy. Vzor v repe je zmigrovaný a platný; zásada „`zadanie/` sa needituje inak než migračným skriptom" tiež hovorí proti ručnému prepisu. **Ak v tej kópii bola aj vecná zmena, ktorú som prehliadol, pošli ju samostatne** — v diffe boli len tieto dva rozdiely (plus veľké písmená na začiatku názvov úloh).

### Q31 · NORMS-GAP je z vaultu, nie z noriem (11. 9.)

`docs/NORMS-GAP.md` je zostavený **výhradne** z LOIN-00…09 v `docs/vault/`. `docs/normy/` obsahuje iba `README.md` so zoznamom, čo tam má byť, a zákazom commitovať texty pod copyrightom; priečinky `7817-3/` a `29481/` neexistujú a **PAS 1958, ISO 29481-1/-3, ISO 7817-1/-3 ani ISO 19650-1 v repe nie sú** v žiadnej podobe. Každá klauzula v tabuľke je preto tak, ako ju cituje vault, a v tomto prostredí sa nedá overiť.

Dôsledky: (a) O7 (hrana IR → deliverable) sa nedá rozhodnúť bez plného textu 19650-1 5.x / PAS 6.3; (b) kardinality 29481-3 a 7817-3 (uc 1:1, er 0:1, Purpose 1:1, ProvidingActor 1:1) sú z LOIN-03/LOIN-04, nie z XSD v repe — generátor F4 ich musí overiť proti skutočnému XSD.

**Samuel:** doplň plné texty (aspoň 7817-3 Annex B/C, 29481-3 idmXSD, PAS 1958 kap. 6) lokálne do `docs/normy/` podľa jeho README — necommitované, `.gitignore` to nekryje, takže ich pred commitom treba držať mimo `git add -A`, alebo README doplniť o `docs/normy/*/` do ignorovania (odporúčam druhé). Kým to nie je, každé nové tvrdenie o norme v kóde alebo dokumentoch nesie odkaz na LOIN poznámku, nie na normu.

Na vedomie: sieť v prostredí Claude Code funguje cez proxy (`pip install` z PyPI prešiel), takže wheely v koreni neboli obchádzka chýbajúcej siete — boli len zabudnuté; odstránené, `*.whl` ignorované.

### Q32 · `guid` sa pri založení negeneruje (11. 9.)

§0.4 hovorí „`guid` generuje nástroj", ale vzor ho nemá ani v jednej poznámke a A13 ho žiada až pri `stav ∈ {PUB, WDRL}`. `zapis.vytvor` preto `guid` necháva prázdny (`guid:`), rovnako ako vzor. **Samuel:** má editor generovať `uuid4` už pri založení, alebo až pri prechode do PUB (ako A13 naznačuje)? Zmena je jeden riadok v `vytvor`.

### Q33 · Premenovanie súboru iba pri zmene `nazov` v editore — **rozhodnuté 11. 9.**

Vo vzore majú štyri súbory vedome kratší názov než `nazov` (`IU-O-space Priestor.md` vs. „Priestor (miestnosť)", `STD-clenenie.md` bez názvu). Rozhodnutie: `zapis.uloz` premenuje súbor na `ID <nazov>.md` **len keď je v uložení zmena `/nazov`**; iné uloženia sa súboru nedotknú, rozdiel hlási A14 ako **info**. ACT (názov v súbore zakázaný, V7) a index `STD.md` sa nepremenúvajú nikdy. Kolízia s existujúcim súborom celé uloženie odmietne a vráti pôvodné bajty. Odkazy `[[ID]]` premenovanie neprežíva ináč než bezo zmeny — viažu ID.

Na vedomie z F3 (nie otázky, rozhodnuté v kóde):
- **ID zadáva autor**; engine len navrhne ďalšie voľné číslo pri číselných prefixoch (`dalsie_id`: `UC-0101` → `UC-0102`, `EV-D-0012` → `EV-D-0013`; pri EV s dvoma radmi prvý v abecede), slugové typy (IU-O, IU-C, STD, DEF, ACT) návrh nedostanú.
- **ACT s dvoma segmentmi**: na poverenej strane tím (folder-note), na poverujúcej funkcia — presne zrkadlo A9 (§16.17); autor to v dialógu vidí ako povinné pole `uroven` a môže zmeniť.
- **Dialóg novej poznámky je generický**: typ, ID, názov a potom povinné polia hlavičky typu zo schémy (`povinne`, `frontmatter`, vnorený objekt rozbalený) — preto UC pýta `typ_ulohy` a `faza_iso22263` (schéma žiada ≥ 1 fázu, 29481-3 1:*), EV `typ_udalosti`, IU-O `objekt/ifc_entita`, `pritomnost_v_modeli`, `uroven`. Predvoľby (`stav: WD`, `verzia: 0.1`, `jazyk: sk`) sú v engine (`zapis.PREDVOLBY_NOVEJ`), stránka ich číta z dokumentu.
- **Šablóna píše nevyplnený zoznam ako `[]`**, nie `null` — inak sa nová poznámka nenatypuje (Q16); povinný zoznam s `min_length` schéma ďalej odmietne a dialóg ho pýta.
- **Názov v súbore** prechádza `cesty.nazov_do_suboru`: znaky, ktoré Obsidian a Windows nedovolia (`* " \ / < > : | ?`), sa nahradia medzerou; `nazov` v YAML ostáva presný.

### Q34 · Grafový pohľad zo stromu — ako mu rozumiem (11. 9.)

Päť viet pred kódom (CLAUDE.md, povinné čítanie): (1) Graf je **samostatná stránka mimo editora** (`docs/graf.html`, `assetin graf export --format html`, pod serverom `/graf`), nie piata úroveň granularity — MODEL §9 ostáva pri štyroch. (2) Kreslí **ten istý strom ako záložka Reťazec** (`retazec.retazce`, V23): jeden pás per účel užitia, stĺpce zľava sú roly stromu (cieľ · spúšťacia udalosť · účel · úloha · výmena · objekt · kontajner) a za nimi prierezové typy (pravidlá a konvencie · definície · aktéri), ktoré vlastný uzol na strome nemajú, tak stoja bokom a na strom sa vešajú hranami cez nositeľa. (3) Každá poznámka je na mape **práve raz** (jednotka v dvoch výmenách má dve hrany, nie dva uzly), `dodanie` je text pri výmene, nie uzol, presne ako v pásme 2 a v `mermaid_pre`; poznámky, ktoré na žiadnom strome nesedia (`UC-0100`, `IU-C-vzt-model`), sú v páse „mimo stromu" — to je nález, nie chyba stránky. (4) Chrbtica (hrany stromu) je z `retazec`, ostatné väzby sú `graf_json.hrany` po rodinách (roly · štandard · doklad · ukotvenie · poradie · výstup), zapínateľné, takže nič sa nepočíta tretíkrát; ktorý uzol patrí do ktorého stĺpca, hovorí engine (`stlpec` na uzle), stránka len kreslí. (5) `mermaid_pre` ostáva textovým exportom toho istého stromu (`--format mermaid` → `docs/graf.md`, Obsidian ho vykreslí sám); stránka Mermaid nevendoruje (3 MB do každého exportu bez prínosu), rozloženie je deterministické v stránke.

**Otázka pre Samuela:** má sa graf odkazovať z ľavého panela editora (napr. `ti-sitemap` „Graf" pod deliacou čiarou pri Diagnostike)? Ľavý panel je kontrakt §4.1 zadania UI, preto ho nemením sám; zatiaľ vedie odkaz iba **z grafu do editora** (`editor.html#/ID`, pod serverom `/#/ID`).

## Z revízie 11. 9. 2026 (`docs/REVIEW-2026-09-11.md`)

### Q35 · `datovy_typ` na položke IU-O (IDS `@dataType`) — **uzavreté 12. 9., odpoveď (a)**, viď nižšie

Suchý beh IDS pre ER-0101 × ARCH prešiel XSD, ale pri šiestich položkách (`GrossFloorArea`, `NetFloorArea`, `Height`, `IsExternal`, `AboveGround`, storey `GrossFloorArea`) sa `dataType` musel **hádať** zo šablón Pset/Qto IFC 4.3 — `Polozka` pole `datovy_typ` nemá (enum v §14 platí len pre `PROP`). Bez dátového typu IDS číselné hodnoty a `rozsah` neoverí. **Samuel:** (a) pole `datovy_typ` na položke (schéma v1.4, migrácia doplní z IFC šablón), alebo (b) odvodzovať v generátore z IFC schémy cez ifcopenshell (F4) a v knižnici nič nedržať (jeden nositeľ = IFC schéma). Odporúčam **(b)** pre Pset/Qto štandardu a (a) len pre `PROP`.

### Q36 · Klasifikácia s `povinnost` patrí do requirements, nie do applicability — **uzavreté 12. 9. (V25)**, viď nižšie

SCHEMA §4 aj PLAN F4 dávajú `klasifikacia[]` do IDS applicability, ale položka nesie `povinnost: required`. V applicability to znamená „kontrolujú sa iba priestory, ktoré CCI už majú" — priestor bez CCI unikne. **Samuel:** klasifikácia s `povinnost` → requirement (classification facet ako pri STD-CL-06), bez `povinnost` → applicability? Mení SCHEMA §4 a generátor, nie dáta.

### Q37 · Kontakt aktéra pre `ids:info/author`

IDS `author` má XSD vzor e-mailu; `ACT` kontakt nenesie (a podľa V19 ani nemá — osoby sú dosadenie). Prototyp `author` vynechal a poskytovateľa dal do `description`. **Samuel:** `author` až z `PROJ` (poverenie), v knižnici nikdy? Odporúčam áno.

### Q38 · Dialekt regexu vo `vzor`

`vzor` vo vzore používa kotvy `^…$` (Name priestorov, podlaží, zón). XSD pattern (IDS) je implicitne ukotvený a `^`/`$` číta doslovne, takže generátor kotvy odstraňuje. **Samuel:** SCHEMA §7 povie, že `vzor` je **XSD regex bez kotiev** (a validátor kotvy nahlási), alebo ostane Python/PCRE a generátor prekladá? Odporúčam prvé — jedna pravda, IDS je cieľ.

### Q39 · STD pravidlo bez `poskytovatel` — do ktorého IDS patrí

Cieľ IDS je (ER × poskytovateľ), ale `STD-CL-0x` poskytovateľa nemajú. Prototyp zaradil pravidlo do IDS ARCH, ak jeho entita sedí s niektorou IU-O toho poskytovateľa (CL-01/03/04/06) a CL-05 (zákaz) nepodmienene. **Samuel:** stačí toto pravidlo odvodenia, alebo STD pravidlo dostane `poskytovatel`? Odporúčam odvodenie (pravidlo je prierezové, poskytovateľ je vlastnosť výmeny).

### Q40 · `PredefinedType` má dvoch nositeľov

`IU-O-space.objekt.predefined_type` je prázdne a zároveň položka `alfanumerika[PredefinedType]` nesie výčet `INTERNAL | EXTERNAL | PARKING`. IDS má `predefinedType` v entity facete aj ako atribút. **Samuel:** nositeľ je `objekt.predefined_type` **iba keď je práve jeden** (ide do entity facetu), výčet ostáva položkou (attribute facet)? Odporúčam áno a validátor nech hlási, keď sú vyplnené obe.

### Q41 · Loader je 8 ms na poznámku — round-trip parser vs. čísla riadkov (12. 9.)

Po oprave kvadratického `dokument()` (PLAN §4b bod 2) je najpomalší krok `nacitaj_kniznicu`: **2,5 s pri 297 poznámkach, 5,0 s pri 603** (`scripts/vykon_syntetika.py`), a celé to sedí v `ruamel.yaml` round-trip skeneri (`_gather_comments`, `need_more_tokens`). Round-trip parser držíme kvôli princípu 7 (komentáre a štýl prežijú zápis) — lenže **pri načítaní knižnice ho potrebujeme len na dve veci**: hodnoty a čísla riadkov pre diagnostiky. Writer si súbor pri ukladaní parsuje znova sám (`zapis.uloz_poznamku` → `dokument.nacitaj`), takže round-trip pri čítaní neslúži zápisu.

Možnosti: **(a)** nechať tak — 2,5 s na 300 poznámok je pri dnešnom vzore (18) neviditeľné a pri stovkách znesiteľné, keďže server načítava priečinok pri každom requeste; **(b)** čítať knižnicu rýchlym (C) parserom a round-trip nechať len writeru — stratíme čísla riadkov v diagnostikách (`…md:80` v stránke aj v CLI), prípadne ich dopočítať hrubo z textu; **(c)** cache načítaných poznámok podľa `mtime` v serveri — server je zámerne bez stavu (princíp 1, CLAUDE.md), takže to je zmena princípu.

**Samuel:** odporúčam **(a)**, kým nebude knižnica nad ~500 poznámok; (b) je výmena „rýchlosť za presnosť diagnostiky" a (c) mení princíp, preto ani jedno nerobím sám.


## Odpovede Samuela 12. 9. 2026 (Q35, Q36) a päť viet pred kódom

### Q35 · uzavreté — `datovy_typ` je pole položky (odpoveď a)

**Samuel 12. 9.:** „Dátový [typ] bude v položke, rovnako ako IDS to vyžaduje — doplniť." Teda variant (a): knižnica dátový typ **nesie**, neodvodzuje ho generátor z IFC schémy.

Päť viet, ako tomu rozumiem (CLAUDE.md, povinné pred zmenou štruktúry): (1) `Polozka.datovy_typ` je nové voliteľné pole schémy v1.4 a nesie presne to, čo IDS 1.0 píše do `@dataType` na property facete — meno IFC jednoduchého typu **veľkými písmenami** (`IFCAREAMEASURE`, `IFCLENGTHMEASURE`, `IFCBOOLEAN`), nie náš vlastný slovník typov (`DatovyTyp` v §14 ostáva pre `PROP`, kde opisuje vlastnosť mimo IFC). (2) Pole má zmysel len tam, kde IDS `@dataType` existuje — pri `ifc: {pset, nazov}` a pri `prop:` — a nikdy pri `ifc: {atribut}` ani `ifc: {material}`, lebo attribute a material facet atribút `dataType` nemajú; toto stráži validátor (D20), nie schéma (Z2). (3) Že to duplikuje IFC šablónu, je vedomá výnimka z princípu 4 rovnakého druhu ako `uri`: nositeľom pravdy ostáva IFC 4.3 ADD2, knižnica nesie **kópiu, ktorú si generátor nemusí domýšľať**, a zhodu s IFC overí až F4 (rozšírené D4 cez ifcopenshell), lebo balík dnes ifcopenshell ani offline šablóny nemá. (4) Hodnoty do vzoru dopĺňa **migrácia v1.3 → v1.4** (nie ruka, CLAUDE.md), z tabuľky štandardných Pset/Qto šablón IFC 4.3 ADD2 zapísanej v migračnom skripte; čo v tabuľke nie je, ostane prázdne a migrácia to vypíše, aby sa nič nevymýšľalo (C2). (5) Bez dátového typu IDS neoverí ani `rozsah`, ani číselný výčet — preto je položka s `overenie: IDS` a číselným obmedzením bez `datovy_typ` **varovanie**, nie chyba, a suchý beh (`tests/fixtures/ids/dry_run_er0101_arch.py`) prestáva hádať a číta pole.

Dôsledok, ktorý nebol v otázke: suchý beh mal pri `Qto_SpaceBaseQuantities.Height` `IFCPOSITIVELENGTHMEASURE`. Šablóna Qto v IFC 4.3 nesie výšku ako `IfcQuantityLength`, ktorej hodnota je `IfcLengthMeasure` — vo vzore je preto `IFCLENGTHMEASURE` a `ER-0101_ARCH.ids` sa prepísal. Overiť proti ifcopenshell v F4 (C2: nevymýšľať hodnoty, ktoré vyzerajú autoritatívne).

### Q36 · uzavreté — rozhodol som podľa noriem: `povinnost` rozhoduje, či je klasifikácia applicability alebo requirement

**Samuel 12. 9.:** „q36 vyrieš ty vhodne podľa noriem." Rozhodnutie je **V25**: záznam `klasifikacia[]` **s** `povinnost` ide do IDS `requirements` (classification facet s `cardinality`), záznam **bez** `povinnost` ostáva v `applicability`.

Päť viet: (1) IDS 1.0 má applicability ako *výber množiny objektov* („o ktorých objektoch táto špecifikácia hovorí") a requirements ako *tvrdenie o nich* („čo na nich musí platiť"), takže ten istý classification facet znamená v každej polovici niečo iné. (2) Keď je klasifikácia v applicability, objekt **bez** kódu CCI jednoducho nespadne do výberu a kontrolou prejde mlčky — presne ten priestor, ktorý chceme chytiť; to je vecná chyba, nie štýl. (3) Keď je v requirements, je z nej `cardinality="required"` a chýbajúci kód je nález — čo `povinnost: required` v knižnici aj znamená (rovnaké čítanie ako pri položke `alfanumerika`, §4). (4) Záznam **bez** `povinnost` je naopak to, čo applicability potrebuje: „táto špecifikácia platí pre priestory, ktoré už v CCI klasifikované sú" — teda zúženie, nie požiadavka, presne ako `filter[]` (V9). (5) Dáta sa nemenia (`povinnost` je pole už dnes), mení sa **výklad v SCHEMA §4 a generátor F4**, plus validátor hlási (D21), keď je `pritomnost_v_modeli: required` a klasifikácia bez `povinnost` — vtedy sa výber zužuje na objekty, ktoré už kód majú, a IU-O si kontrolu nechtiac vypne.

7817-1 to nerozporuje: klasifikácia je tam informácia *o* objekte (DictionaryRef pri ObjectType), nie kritérium výberu, takže jej „povinnosť" patrí k požiadavke. 29481-1 nerozhoduje (hovorí o výmene, nie o tvare kontroly). Klauzulu z plného textu IDS 1.0 dokladujeme z `ids.xsd` a z referenčného `tests/fixtures/ids/dss/Configurations.ids`, kde applicability nesie výber a requirements nesie `cardinality` — plné texty noriem v repe naďalej nie sú (Q31).


### Q42 · Pravidlo `plati: vzdy` nemá na strome nositeľa (12. 9.)

Pruh „kde to sedí" pre pod-záznamy (PLAN §4b bod 10) ukázal, že `STD-CL-04` cestu má (`GOAL-A-01 › UC-0101`, lebo ho `ER-0101` zapína cez `zapnute::`), ale `STD-CL-01` nemá žiadnu — je `plati: vzdy`, takže ho **nikto nezapína** a na strom ho nevešia ani `zapnute::`, ani `clenenie::`. Pritom platí pre každý model každej výmeny, čiže v skutočnosti dopadá **na všetky** stromy, nie na žiadny.

Možnosti: **(a)** nechať tak a v prázdnom stave to pomenovať („pravidlo platí vždy, preto ho žiadna výmena nezapína") — vtedy je prázdny pruh správne; **(b)** `cesty_pre` nech pravidlo `plati: vzdy` zavesí na každý strom, ktorého výmena má jednotku s pasujúcou entitou (to už raz robí suchý beh IDS pri zaraďovaní pravidiel do IDS ARCH, viď Q39); **(c)** pravidlo dostane vlastné pole nositeľa. **Samuel:** odporúčam (a) do rozhodnutia o Q39 — je to tá istá otázka („komu pravidlo patrí"), položená dvakrát, a odpoveď má byť jedna.


### Q43 · Dialóg novej poznámky a polia, ktoré žiada validátor — päť viet pred kódom (12. 9.)

Druhá polovica PLAN §4b bodu 4 znela „dialóg novej poznámky nech pýta aj polia s pravidlom C; schéma nech nesie `povinne_validatorom` odvodené z registra pravidiel". Robím to **inak a bez nového poľa schémy**, lebo odvodenie by bolo ručná tabuľka vedľa pravidiel, ktorá sa rozíde s nimi hneď pri prvom novom pravidle.

Päť viet: (1) Register pravidiel je Python kód, nie deklarácia, takže „ktoré pole žiada pravidlo C3" sa z neho nedá prečítať — ale **dá sa to spýtať**: postaviť kandidáta na novú poznámku zo šablóny typu, vložiť ho do knižnice **iba v pamäti** a spustiť validátor, presne ako to od včera robí `/api/kontrola` pre pracovnú kópiu. (2) Diagnostiky, ktoré na kandidáta padnú, nesú JSON pointer, takže dialóg z nich vie, **ktoré polia doplniť do formulára** — je to tá istá mechanika ako prvá polovica bodu 4 („pole s diagnostikou sa neskrýva"), len o jednu obrazovku skôr. (3) Nič sa nezapisuje: kandidát existuje ako text v pamäti, cesta sa počíta z `cesty.cesta_pre` a na disk ide až `zapis.vytvor`, ktorý ostáva bezo zmeny. (4) Register pravidiel tak ostáva **jediným nositeľom** toho, čo validátor žiada (princíp 4) — schéma nedostane pole, ktoré by tvrdilo to isté druhýkrát a mohlo klamať. (5) Cena je jeden request na zmenu v dialógu (debounce 350 ms) a to, že bez servera (náhľad `docs/editor.html`) dialóg neexistuje tak či tak, takže sa nič nestráca.

**Samuel:** ak chceš namiesto toho deklaráciu v schéme (pole `povinne_validatorom` na type, plnené ručne pri každom C pravidle), povedz — vrátiť sa to dá, ale považujem to za duplikát registra pravidiel.


### Q44 · Hustota stránky poznámky — päť viet pred kódom (13. 9.)

Samuel na formulári ER-0101: „moc je to rozbité a neprehľadné". Nález sedí a má štyri príčiny, ktoré viem odstrániť bez zásahu do kontraktu §4 a §5 zadania UI (rozloženie ani tokeny sa nemenia, mení sa hustota).

Päť viet: (1) Pole je mriežka `150px | 1fr` bez stropu, takže na širokej obrazovke stojí čip s dvoma slovami sám v stĺpci širokom 1500 px a oko musí prejsť cez prázdno — hodnota dostane strop a skupina tiež, aby menovka a hodnota ostali pri sebe. (2) Popis poľa sa dnes tlačí **pod každú hodnotu celý**, takže takmer každý riadok je trojriadkový; keď je pole vyplnené a bez diagnostiky, autor návod už nepotrebuje, preto sa skráti na jeden riadok a celý ostane v `title` (a rozbalí sa, len keď je pole prázdne alebo naň padá nález). (3) Nadpis skupiny je dnes doslova `## Popis inline` — `##` a nositeľ sú technický údaj, patria do sivého chvosta vedľa nadpisu, nie do nadpisu. (4) Vo vnorenej tabuľke (`prepisy`) stĺpec „položka" opakuje to, čo už stoja vedľa neho stĺpce `IU` a `Položka`, lebo zhrnutie sa počíta zo **všetkých** polí záznamu — má sa počítať len z tých, ktoré vlastný stĺpec nemajú, a keď nezostane nič, stĺpec vôbec nevzniká. (5) Nič z toho nie je nové pravidlo pre stránku: stĺpce, menovky aj popisy naďalej pochádzajú zo schémy, mení sa iba to, koľko miesta na obrazovke dostanú.

**Druhé kolo (po Samuelovom „nič sa nezmenilo, stále tam sú aj `##`"):** prvý pokus bol kozmetika a `##` som nechal v sivom chvoste — zmizlo úplne (aj s nositeľom poľa; oboje je v `title`). Navyše: sekcia je **karta** s pruhom nadpisu a počtom polí, **krátke polia stoja dve vedľa seba** (pod 1180 px sa zloží do jedného stĺpca), **ľudský názov je nadpisom riadka** a technický kľúč je pod ním drobný, a **návod sa ukáže len pri prázdnom poli alebo poli s nálezom**. Dvojstĺpcový formulár je rozloženie, teda §4 kontrakt — robím ho preto, že si oň Samuel dvakrát požiadal; zapísané v `docs/PROMPT-ui.md` ako kolo 4. Poradie polí (zo schémy) a register na celú šírku ostávajú.


## Kolo 4 (14. 9. 2026) — V26, V27 a prestavba reťazca

### Päť viet pred kódom (CLAUDE.md), ako rozumiem priradeniu a reťazcu

(1) **Výmena je kolekcia informačných jednotiek** (PAS 6.3.2.1 a, 29481-1), takže `ER.obsahuje` nesie to, čo sa fyzicky odovzdá — kontajnery — a objekt sa do výmeny dostane tým, že ho **niektorý kontajner priraďuje**; preto po V27 v `ER.obsahuje` objekty nie sú a objekt, ktorý tam predsa zostane a žiadny kontajner výmeny ho nenesie, je varovanie C13, nie ticho. (2) **Kontajner a objekt sú dve osi spojené priradením**, nie strom „kontajner nad objektom" (7.1.2/7.1.3, LOIN-05 §11.1): ten istý `IU-O-space` je pod modelom aj pod protokolom zamerania a to nie je duplikát — je to podstata priradenia, len sa kreslí raz rozbalený (V21, U12). (3) **`rozsah` je zúženie rámca LOIN, nie nové pole požiadavky** (6.3.2.1 b): hovorí, ktoré z troch zložiek (geometria · alfanumerika · dokumentácia) daný kontajner z objektu nesie, takže dokumentačný kontajner negeneruje žiadnu IDS požiadavku na geometriu ani na vlastnosti. (4) **Predvoľba nemôže protirečiť tomu, čo už objekt povedal**: bez `rozsah` platia aspekty, ktoré IU-O definuje, ale dokumentačný aspekt patrí tomu kontajneru, ktorý objekt menuje v `dokumentacia[].dok` — inak by architektonický model „niesol" protokol geodeta a knižnica by mala dvoch nositeľov jedného faktu (§0.9). (5) **Pásma sa delia podľa toho, na akú otázku odpovedajú, nie podľa toho, čo je zhodou okolností vedľa seba**: výmena patrí do „Čo a ako podrobne?", lebo definuje obsah odovzdania, kým „Kto a kedy?" je postupnosť udalosť → účel → úlohy (a tie sa delia na dodanie a na použitie a prevzatie, 6.2.1) — preto v pásme 2 výmena nie je a hranica 29481/7817 sa v pásme 3 nekreslí (jednotka je jednotka).

### Q45 · `GOAL-A-01` a `GOAL-O-01` v `zadanie/GOAL/` **nie sú** (nález, nie otázka o vkuse)

Zadanie kola 4 §4 hovorí, že ciele boli doplnené. **V repe nie sú:** priečinok `zadanie/GOAL/` neexistuje, `assetin load .` číta 18 poznámok a `GOAL-A-01` je visiaci odkaz z `UC-0101.podporuje_ciel` (varovanie B1). Jediný `GOAL-O-01` v repe je testovací fixture (`tests/fixtures/md/kniznica/zadanie/GOAL/`), ktorý do vzoru nepatrí. Pásmo „Prečo?" preto ostáva na prózovom citáte z `UC-0101 · Cieľ a rozsah` — správne sa správa, len nemá čo ukázať; text som upravil tak, aby chýbajúci cieľ **menoval** („cieľ GOAL-A-01 v knižnici zatiaľ nie je"). **Samuel:** pošli obe poznámky (alebo ich obsah) — cieľ si nevymyslím, metrika cieľa je tvrdenie o organizácii (MODEL §6) a C2 hovorí nevymýšľať autoritatívne vyzerajúce hodnoty.

### Q46 · Predvoľba rozsahu — dokumentačný aspekt patrí kontajneru z `dokumentacia[].dok`

Zadanie hovorí „predvoľba pri chýbajúcom `rozsah`: všetky aspekty, ktoré daná IU-O vôbec definuje". Doslovne vzaté by `IU-C-arch-model` niesol aj `dokumentacia` (IU-O-space ju definuje) — a tým by v UI aj v generátore tvrdil, že model dodáva protokol zamerania. Implementoval som preto predvoľbu **bez dokumentačného aspektu, ak ho objekt priradil inému kontajneru** (`predvoleny_rozsah` v `assetin/engine/priradenie.py`); rozchod oboch strán hlási nové pravidlo E10. **Samuel:** potvrdiť, alebo (b) predvoľbu nechať doslovnú a `rozsah` písať vždy ručne, alebo (c) `rozsah` spraviť povinným poľom priradenia (schéma by odmietla priradenie bez neho — proti Z2).

### Q47 · MVD vzorového modelu — akú hodnotu má niesť

`IU-C.mvd` je v schéme (V26) a exportuje sa do `correspondingMvd`, ale vo vzore ostal **prázdny**: „IFC4X3_ADD2 / Reference View" znie autoritatívne a C2 hovorí takéto hodnoty nevymýšľať. **Samuel:** platí pre `IU-C-arch-model` Reference View (a s akým `basis` — `IFC4X3_ADD2`?), alebo odovzdávame plný Design Transfer View? Odpoveď doplním migráciou, nie ručne.

### Q48 · Môže priradenie obmedziť aj hodnotu, nielen aspekt?

PAS 6.3.3 viaže **obe** triedy obmedzení na konkrétnu jednotku. Dnes priradenie zužuje len zložky LOIN (`rozsah`), zatiaľ čo hodnoty a povinnosti sa prepisujú výhradne cez `ER.prepisy` (prednosť ER > IU, §0.7). Prakticky to znamená, že „v protokole stačí plocha na 0,1 m², v modeli na 0,01 m²" sa dnes povedať nedá. **Samuel:** ostáva to tak (odporúčam áno — inak vzniká tretie miesto prepisu a prednosť medzi `prepisy` a priradením by bola nová pravidlo), alebo to má byť prípad pre ER prepis s kontextom kontajnera?

### Q49 · Má `ER.obsahuje` odmietnuť IU-O, alebo ho len ohlásiť?

Nechal som `cielove_typy: [IU-O, IU-C]` a objekt bez kontajnera hlásim ako **varovanie** (C13) — schéma odmieta len to, bez čoho sa poznámka nedá interpretovať (Z2), a tichá strata pri migrácii by bola horšia. **Samuel:** stačí varovanie, alebo má byť objekt vo výmene chyba (E), keďže po V27 je to vždy neúplný zápis?

### Q50 · `klasifikacia[].povinnost` som zaradil medzi obmedzenia prítomnosti

Zadanie §1 b menuje pri triede „prítomnosť jednotky" `pritomnost_v_modeli`, `povinnost` a `dokumentacia[].povinnost`. Pridal som k nim aj `klasifikacia[].povinnost` a `facet.cardinality`, lebo po V25 je to presne tá istá vec — `cardinality` v IDS requirements. **Samuel:** potvrdiť; ak nie, vypadne značka z dvoch polí (dáta sa nemenia).



## Kolo 5 (14. 9. 2026) — výmena ako predel

### Päť viet pred kódom (CLAUDE.md), ako rozumiem predelu

(1) Výmena je **moment v procese**, nie balík obsahu: PAS 6.1.3 a 19650-4 ju kladú medzi úlohu, ktorá informáciu vyrobí, a úlohu, ktorá ju použije, takže v línii „Kto a kedy?" nie je ďalším krokom, ale **predelom medzi dvoma druhmi krokov**. (2) Preto sa ruší samostatné pásmo „Čo a ako podrobne?": tá istá výmena by inak stála na obrazovke dvakrát — raz ako moment, raz ako špecifikácia — a to je presne to, čo V21 zakazuje. (3) Rozbalenie pod predelom **nie je nové pásmo**, je to tá istá odpoveď na tretiu otázku, len nakreslená tam, kde vzniká; preto si drží nadpis pásma, technický riadok aj jeho farbu (kaskáda štyroch otázok ostáva čitateľná). (4) Stranu úlohy určuje `ulohy[].typ` (PAS 6.2.1) a jej väzba na výmenu (`z_uloh`): delivery nad predelom svojej výmeny, utilization pod ním; úloha, ktorá do žiadnej výmeny neprispieva, si stranu drží podľa typu, takže sa nikdy nestratí. (5) Hĺbka je tri úrovne a nič viac (U20): línia hovorí *kedy*, rozbalenie *čo*, stránka *všetko ostatné* — kto chce editovať, klikne na ID a je na stránke, v línii sú poznámky vždy len čipy.

### Q51 · Poradie výmen bez dátumov

Zadanie hovorí „v poradí podľa míľnika". Knižnica ale dátumy nemá (V19: `EV.datum` je dosadenie, patrí do poverenia), takže „podľa míľnika" sa dá čítať len ako poradie **ID udalosti** — tak som to implementoval (`sorted` podľa `spustacia_udalost`, potom ID výmeny). Pri jednej výmene je to jedno; pri UC s tromi výmenami to určí, ktorý predel je prvý. **Samuel:** stačí ID udalosti (odporúčam — v knižnici je to jediné stabilné poradie a v poverení sa prepne na dátum), alebo má `EV` dostať pole relatívneho poradia (`relativny_termin` dnes existuje ako voľný text)?

### Q52 · Z čoho sa odvodzuje „používa aj UC-…"

Zadanie §4 hovorí „iný UC má túto ER v `referencne_info`". Také pole na `UC` neexistuje — `referencne_info` je na **ER** a mieri na **IU-C**. Odvodzujem preto z troch väzieb, ktoré schéma má: (a) iná ER menuje túto ER v `precondition`, (b) iná ER menuje niektorý **kontajner** tejto výmeny v `referencne_info`, (c) jednotka tejto výmeny mieri cez `pre_task` na úlohu iného účelu. Vo vzore to dáva prázdny zoznam (UC-0201 neexistuje), takže riadok sa neukáže. **Samuel:** sedí to, alebo má „účel, ktorý si výmenu berie ako vstup" dostať vlastné pole na UC (napr. `vstup:: [[ER-0101]]`)? Odporúčam odvodenie — nové pole by tvrdilo to isté druhýkrát (princíp 4).

> Pozn. 19. 9.: tieto štyri otázky vznikli na vetve pred kolom 4 a niesli čísla Q45–Q48; tie medzitým obsadilo kolo 4/5, preto sú prečíslované na Q53–Q56 (DECISIONS Z6).
### Q53 · ER na švíku „Kto a kedy?" / „Čo a ako podrobne?" — päť viet pred kódom (13. 9.)

Samuel na zábere reťazca UC-0101: ER-0101 stojí ako posledný riadok zeleného pásma 2 a pásmo 3 ho len cituje textom v hlavičke („7817 · 5 jednotiek v ER-0101") — pýta sa, či to voči PAS 1958 a IDM (29481) dáva zmysel, nie či je to bug.

Päť viet: (1) Zaradenie ER do pásma 2 je zámerné a trikrát zapísané — `MODEL.md` §4 („Kto a kedy? = 29481, typy UC/EV/ER, odpoveď *kto komu čo vymieňa*"), `DECISIONS.md` V23 a `retazec.py` (`PASMO_ROLY["vymena"] = "29481"`) — a `NORMS-GAP.md` §7.7 potvrdzuje zhodu s **29481-1 3.3.10** (`ER = UC × udalosť × príjemca`) ako „sedí", takže to nie je medzera oproti norme. (2) Samuelov pocit má ale oporu v tom istom vaulte: `LOIN-02` §5 píše normatívny reťazec ako `IDM = UC + business context + ER{IU + LOIN + constraints}` — zátvorka hovorí, že ER je **obálka**, ktorej obsahom je práve to, čo sa pýta pásmo 3, a `LOIN-03` §8.7 to potvrdzuje na úrovni schémy (`er.informationUnit` je `1:*`, teda dieťa). (3) Rozdiel medzi pásmami 2 a 3 preto nie je „ER je proces, IU je obsah", ale **hĺbka normy nad tým istým vzťahom**: 29481-3 nesie o jednotke len pahýľ (`id, name, dataType, isMandatory, definition`), zatiaľ čo 7817-3 nesie jej plný LOIN (geometria, alfanumerika, dokumentácia) — presne to, prečo `IU-C` má vo `assetin/schema/typy/iu_c.py` `HRANICNE = ["29481", "7817"]` a ER nemá nič also. (4) Terajší mechanizmus `hranicne` ale dnes nerobí to, čo by na vyriešenie tohto pocitu bolo treba — `retazec._vymena()` ho číta iba na to, aby kontajner vyradil z `jednotky[]` do `kontajnery[]` v rámci pásma 3, nie na to, aby čokoľvek vizuálne premostilo pásma 2 a 3, takže pridať `ER.HRANICNE` samo o sebe nič nezmení, kým nepribudne aj spotrebiteľ toho príznaku v stránke. (5) Riešenie je preto vizuálne, nie štrukturálne: strom (V23) aj `PASMO_ROLY` ostávajú, mení sa iba to, ako pásmo 3 kreslí svoju hlavičku — namiesto holého textu „v ER-0101" dostane ER-čip v tej istej zelenej `--pasmo-kto` farbe, akou stojí jeho riadok v pásme 2, aby oko čítalo obsahovanie, nie dva oddelené útvary.

**Samuel:** dve možnosti na výber, obe bez zásahu do `retazec.py` dát alebo do V23: **(a)** len farebný/vizuálny ER-čip v hlavičke pásma 3 (najmenší zásah, žiadne nové pole schémy), alebo **(b)** naozaj označiť `ER.HRANICNE = ["29481", "7817"]` (rovnaká deklarácia ako pri IU-C) a nechať stránku podľa neho vykresliť ER-riadok raz, ale na švíku medzi pásmami (vizuálne v oboch, dátovo v jednom) — čo je bližšie k tomu, čo hovorí `ER{IU + LOIN + constraints}`, ale je to nový spotrebiteľ existujúceho príznaku, ktorý treba overiť aj v `graf_stranka.py`. Poviem, ktorú z nich mám spraviť, keď potvrdíš smer.

**Uzavreté 13. 9. — (b)** (DECISIONS V28). `ER.HRANICNE = ["29481", "7817"]` v `assetin/schema/typy/er.py`, bezpodmienečne. `_krok()` (`retazec.py`) čítal `pasma.hranicne_pre()` už predtým pre každú poznámku, takže `v.er.hranicne` sa naplnil bez zmeny dát — zmenil sa iba spotrebiteľ v `assetin/engine/nahlad/app.html`: `riadokStromu()` teraz pridáva triedu `hranicne` (dvojitý ľavý okraj, rovnaká rodina ako `.cip.hranicne`) a `zoznamJednotiek()` kreslí hlavičku výmeny vždy, nie iba pri viac než jednej výmene na účel (dôvod prestal byť počet, je to hraničný typ). `graf_stranka.py` som overil — stĺpce grafu sú dané rolou (`vymena` má vlastný stĺpec), nie `hranicne`, takže tam nič nekolíduje a graf sa nemení. Pridané testy `test_vymena_je_hranicna_ale_ostava_v_pasme_29481` (`tests/test_retazec.py`) a rozšírený `test_typ_nesie_pasmo_popisok_a_ikonu` (`tests/test_app_json.py`); `docs/editor.html` a `docs/graf.html` prehenerované (`assetin app export`, `assetin graf export`); overené v prehliadači cez `assetin edit .` na UC-0101.


### Q54 · LOIN je popis jednotky, nie vrstva vedľa nej — päť viet pred kódom (13. 9.)

Samuel po V26: „možno by LOIN mal byť súčasťou ER — každá informačná jednotka bude mať pod sebou otázku, ako podrobne". Normy mu dávajú za pravdu doslovne a odkrývajú pritom medzeru, ktorá v pásme 3 je už dnes.

Päť viet: (1) Atóm oboch vrstiev je **informačná jednotka** (29481-1:2025 3.3.11, PAS 1958 3.1.4.13 — *„anything from entire information containers … to specific properties of objects"*), a **LOIN je spôsob, ako sa tá jednotka opisuje** (PAS 1958 6.3.2 c; úvod 29481-1: *„a more comprehensive way of defining information units that form part of an exchange requirement"*) — čiže „ako podrobne" nie je úroveň vedľa „čo", je to **opis každého „čo"**, presne ako hovorí zátvorka `ER{IU + LOIN + constraints}` (LOIN-02 §5). (2) Z toho plynie, že sa **nič nerozdeľuje na piate pásmo** a štyri otázky (U3, MODEL §4) ostávajú — mení sa iba to, že vnútri pásma 3 LOIN visí **pod jednotkou**, ktorej sa týka, a nie nad všetkými naraz. (3) Medzera, ktorú to odkrylo: 7817-1 má LOIN v troch aspektoch a schéma ich na `IU-O` už nesie všetky tri (`geometria` = D2, `alfanumerika` = D1, `dokumentacia` = D3, odvodené do `typ_poziadavky`), ale pásmo 3 kreslí **iba pole s `polozky=True`**, takže pásmo menom „Čo a ako podrobne?" ukazuje jednu tretinu LOIN — a rozdiel medzi `IU-O-space` (profil **G2**, presnosť ±2 cm, protokol ako *required* dokumentácia) a `IU-O-storey` (**G0**, bez tvaru) v ňom nevidno vôbec, hoci to je presne tá odpoveď na „ako podrobne". (4) Oprava drží princíp 3: na pole pribudne značka `loin=<poradie>`, ktorá hovorí **že** je to aspekt a v akom poradí sa číta, stránka sa na aspekty pýta schémy a sama ich nemenuje; `polozky=True` ďalej hovorí, ktorý aspekt sa kreslí ako tabuľka Položka · Povinnosť · Odkiaľ, a `Geometria.profil` dostane `technicky=True`, aby mal aspekt vlastný technický údaj (G0…G3) tak, ako ho má jednotka (IFC entita). (5) Prázdny aspekt sa **neskrýva** — „nepožaduje sa" je v 7817-1 (`NotRequired`) plnohodnotná odpoveď a na mape je to informácia, nie prázdno; `IU-C` žiadne `loin` polia nedostáva, takže kontajnery ostávajú ako dnes (forma, CDE, TIDP), čo je správne, lebo 7817-3 kontajnerovú úroveň nemá vôbec (LOIN-05 §11) a ich „ako podrobne" je iná množina faktov.

**Stav:** prototyp beží a je odskúšaný v prehliadači na `IU-O-space` (tri aspekty) aj `IU-O-storey` (dva + „dokumentácia — nepožaduje sa"). Riadok jednotky nesie podpis `GEO-G2 · 7 položiek · dokumentácia` / `GEO-G0 · 5 položiek`, rozbalená jednotka tri skupiny; existujúca tabuľka položiek sa nemení. Pri tom sa opravila chyba v `cip()`, ktorá **pod-záznam** (GEO profil, STD pravidlo) hlásila ako „nenapísaná" — pod-záznam žije v `UZLY`, nie v `POZNAMKY`; dovtedy nebola vidno, lebo čipu sa ID pod-záznamu neposielalo.

**Samuel — tri veci na rozhodnutie pred commitom:** **(a)** Ktoré podpolia geometrie sú ľudské zhrnutie? Teraz stránka kreslí najprv to, čo autor napísal vlastnými slovami (`pokyn`, `postup`, `presnosť`), potom enumy 7817-3, a nad šesť polí dá „+N v záložke Poznámka" — je to pravidlo stránky; čistejšie by bolo vyhlásiť to v schéme (značka typu `sumar`), ale to je ďalšie pole navyše. **(b)** Majú `loin` značky dostať aj polia `IU-C` (`forma` · `identifikacia` · `metadata_cde` · `tidp`), aby aj kontajner odpovedal „ako podrobne" v skupinách? Mechanizmus je ten istý, ale je to tvrdenie o tom, že kontajner má LOIN — a podľa LOIN-05 §11 ho v 7817-3 nemá, má vlastné požiadavky. **(c)** `dokumentacia` na `IU-O` ukazuje na `IU-C`, ktorý je zvyčajne aj kontajnerom tej istej výmeny (`IU-C-protokol-zamerania`) — v preview je to čip (V21: jedna poznámka, jedno miesto), takže sa nekreslí dvakrát; potvrď, že to takto chceš, lebo práve táto väzba („protokol je požadovaná dokumentácia priestoru") dovtedy v reťazci nebola vidno vôbec.


### Q55 · Režim `Detail | Reťazce` nad panelom — päť viet pred kódom (17. 9.)

Samuel: „to rozdelenie reťazec a poznámka by sme mali rozdeliť už niekde rovno nad menu… ide mi o to jasne rozlíšiť, koľko máme reťazcov (ale asi nevytvárať novú kategóriu, iba náhľad)". Rozhodol sa pre prepínač nad panelom; toto je päť viet, ako tej časti modelu rozumiem, a čo tým padá.

Päť viet: (1) **Reťazec nie je nová entita a nesmie ňou byť** — `retazce()` vyrába práve jeden strom na každý UC a `Retazec.id` je vždy `uc.id` (V23), takže „koľko máme reťazcov" je to isté číslo ako počet účelov užitia, ktoré už stojí v paneli; nová kategória by bola druhý nositeľ tej istej veci (princíp 4, V21), a preto je to **režim pohľadu, nie register**. (2) To znamená, že sa **nemení model, iba kadiaľ sa k reťazcu ide**: štyri úrovne granularity (bunka · poznámka · reťazec · inšpektor) prežívajú nedotknuté, mení sa vstupný bod — perspektíva nie je piata úroveň, ale `MODEL.md` §9 menuje reťazec ako záložku, takže sa musí upraviť spolu s kódom, inak si kód a MODEL protirečia a podľa preambuly vyhráva MODEL. (3) **Ruší to U10** („Reťazec je záložka na stránke poznámky… — *reťazec ako hlavná obrazovka*" bolo zapísané ako zavrhnuté) a mení **§4.1**, ktorý je kontrakt — obe zmeny idú do `DECISIONS.md` (U21) a `PROMPT-ui.md` (kolo 5), nie ticho do kódu; U8 sa neruší, lebo zoznam registrov ostáva plochý a prepínač stojí v hlavičke panela, ktorá tam už dnes je. (4) **Režim nesmie byť skrytý stav** — NN/g naň varuje, že práve skrytý režim plodí chyby, preto ide do adresy (`#/retazce/<UC>?u=<ID>`, štvrtý vyhradený segment vedľa `registre`, `diagnostika`, `zmeny`) a je označený troma redundantnými indikátormi (stav segmentu, obsah panela, adresa); staré adresy `#/<ID>/retazec[?r=N]` zo Q25 sa presmerujú, nezaniknú. (5) Zoznam reťazcov musí prísť **z enginu, nie z odvodenia v stránke** — inak by stránka držala pravidlo „reťazce sú z UC" natvrdo, čo zakazuje zásada 3 (`test_stranka_nedrzi_zoznam_typov_ani_poradie_pasiem`); použije sa ten istý memoizovaný `retazce(k)`, aký už berie `graf_stranka`, takže tretia štruktúra nevzniká (V23).

**Vedľajší nález:** guard test zakazuje stránke literály `"IU-O"`, `"EV"`, `"ACT"`… ale **nie `"UC"`** — klientske odvodenie zoznamu reťazcov by dnes prešlo. Nie je to povolenie, je to diera; dopĺňam `'"UC"'` a `'"GOAL"'`.

**Samuel:** jedna vec ostáva na tebe — **každé zaostrenie uzla v reťazci je krok v histórii** (`?u=` v adrese), takže tlačidlo späť prechádza aj klikaním po uzloch. Robím to cez `history.replaceState`, aby späť skákalo medzi obrazovkami a nie medzi klikmi; ak to chceš opačne, povedz.


### Q56 · Rozbaľovanie uzlov v reťazci — päť viet pred kódom (19. 9.)

Samuel: „keď na niečo kliknem, nemalo by ma to hneď prekliknúť na detail, ale skôr rozrolovať to najprv ešte v tom reťazcovom zobrazení." Pozrel som sa na reťazec aj ako laik a nález sedí — problém nie je v tom, kam klik vedie, ale v tom, že **klik nie je vidno**.

Päť viet: (1) Reťazec po U21 nemá **žiadnu afordanciu**: riadky nemajú šípku ani stav, takže nič nehovorí, že sa dá klikať — a keď klikneš, jediné, čo sa zmení, je pravý panel, teda miesto, kam sa človek v tej chvíli nepozerá; preto to pôsobí, že sa „nič nestalo". (2) Rozbaľovanie **nie je nový mechanizmus, ale zovšeobecnenie existujúceho**: dnes sa rozbaľuje presne jedna vec — jednotka v ohnisku v pásme 3 (Q46 aspekty LOIN) — a to isté teraz dostane každý uzol v pásme 2 aj 3, pričom aspekty ostávajú ako typovo bohatší začiatok karty, nie ako konkurenčné zobrazenie. (3) **Ruší to U12** („pásmo 3 rozbaľuje iba jednotku v ohnisku — porovnanie naprieč je úloha tabuľky registra"), lebo Samuel chce viacero otvorených naraz; stav rozbalenia preto ide do existujúcej množiny `OTVORENE` (ten istý vzor, aký už má vnorená tabuľka), kým `STAV.ohnisko` a `?u=` v adrese ostávajú a znamenajú „uzol, na ktorý ukazuje odkaz" — cena je, že odkazom sa prenesie jeden rozbalený uzol, nie všetky. (4) Obsahom karty je **ten istý generický formulár zo schémy**, aký kreslí obrazovka Detail (`skupinyPoli`), takže nevzniká druhý renderer ani druhá pravda o tom, čo sa o type ukazuje — dôsledok, ktorý treba vedieť, je, že sa tým **dá v reťazci aj písať**, lebo ten komponent režim len na čítanie nemá. (5) Úloha (`T2`, `D2`) nie je poznámka, ale záznam v bloku `ulohy:` účelu, takže jej karta sa poskladá z deskriptorov toho poľa (`TYPY["UC"].polia` → `ulohy`, `zoznam-objektov`) — a práve tým sa konečne dozvieš, že `D2` má `typ: utilization`, čo dnes nie je vidno nikde.

**Laický pohľad — päť nálezov, všetky idú do tejto zmeny:** (1) nič nenaznačuje klikateľnosť; (2) číslo pri reťazci v paneli je dvojznačné — v režime Detail je na tom mieste počet poznámok, v režime Reťazce počet visiacich odkazov; (3) `T1…T6` a `D1, D2` nie sú nikde vysvetlené a dnes sa na ne nedá ani kliknúť; (4) orezané hodnoty s „…" vyzerajú ako chyba, nie ako zámer; (5) panel aj podnadpis hlásia to isté (`8 úloh · 1 výmena · 3 jednotky`).

**Samuel povedal:** viacero rozbalených naraz · zatiaľ celý formulár („potom doladíme, ktoré polia nie sú potrebné") · úlohy rozbaľovať tiež · všetkých päť nálezov naraz.


## Kolo 8 (2. 11. 2026) - knižnica v databáze (V29), plán pred kódom

Samuel 2. 11. (cez orchestrátora): repo `assetin-library` je **aplikácia, ktorá tvorí knižnice**, nie knižnica. Obsah (dnes `zadanie/`) sa presunie do databázy (Supabase), upravuje sa v editore a **kedykoľvek sa dá exportovať do MD v dnešnom tvare** (round-trip). Hotové IDS sa majú dostať do AIMviewer (D-182 "Requirements library") bez tokenu na čítanie repa. Zapísané ako **V29** (ruší princíp 1 CLAUDE.md). Toto je **len plán**, nič z neho ešte nie je v kóde.

### Q57 · Knižnica v databáze - päť viet pred kódom (2. 11.)

Päť viet: (1) Dnes je jediná zapisovaná vrstva **Dokument** (blokový model súboru, `dokument.py`, `serialize() == original`); typovaná poznámka (pydantic), graf, reťazec, inšpektor aj validátor sú **odvodené** z textu pri každom načítaní a nič z nich sa neukladá - preto je round-trip bajtovo verný konštrukciou, nie snahou. (2) Z toho plynie, že databáza má niesť **presne to, čo dnes nesie disk: text poznámky a jej cestu**, a k tomu to, čo disk nevie - revíziu (kto, kedy, prečo), vydania a prístupové práva; všetko ostatné (frontmatter ako JSON, odkazy, diagnostiky) je **projekcia**, ktorú engine prepočíta pri zápise a ktorú nikto needituje (princíp 4: jeden nositeľ, odvodené údaje sú označené ako odvodené - V22). (3) Rozložiť poznámku na tabuľky polí, sekcií a komentárov by vytvorilo **druhú pravdu o tvare súboru** a writer (chirurgický patch, úrovne 0 až 5, DATA-MODEL §4) by sa musel napísať znova nad iným modelom - presne tá cesta, ktorá round-trip láme (próza, poradie sekcií, `#` komentáre, `{atribut: Name}`); preto ju zavrhujem. (4) Engine sa preto nemení v tom, **čo** robí, iba **odkiaľ** číta a **kam** píše: pribudne rozhranie `Sklad` (zoznam súborov s textom a revíziou, zápis s očakávanou revíziou, premenovanie, vytvorenie) s dvoma implementáciami - `SkladPriecinok` (dnešné správanie, testy, CI, Obsidian) a `SkladDB` (Supabase) - a loader, writer, validátor, migrácie aj generátory pracujú nad `Kniznica` v pamäti ako dnes. (5) Katalóg IDS pre AIM **už existuje** v databáze AIM (`public.ids_documents` / `ids_document_versions`, D-162, s `origin = 'library'` a stĺpcami `library_repo/path/commit/code`), takže knižnica nemá vymýšľať vlastný katalóg, ale **vydanie** (nemenná snímka revízií poznámok) zapíše vygenerované IDS do týchto tabuliek a AIM ich ponúkne bez GitHubu - "commit" v pôvode IDS sa nahradí odtlačkom vydania.

### Q58 · Dátový model v Postgres (návrh, schéma `library`)

Princíp: **riadok = súbor, revízia = celý text**. Diff medzi revíziami sa počíta pri čítaní (`difflib`), neukladá sa.

| Tabuľka | Stĺpce (hlavné) | Poznámka |
|---|---|---|
| `library.kniznica` | `id uuid`, `kod text unique` (napr. `assetin`), `nazov`, `vytvorena` | jedna inštancia knižnice; pripravené na viac (napr. cvičná kópia) |
| `library.subor` | `id uuid`, `kniznica_id`, `cesta text` (relatívna, napr. `zadanie/ER/ER-0101 Priestorový model ... .md`, NFC), `note_id text null` (ID z `PathScheme`, napr. `ER-0101`, `ACT-poverena/ARCH`; null pre `KNIZNICA.md`), `typ text null`, `head_rev int`, `zmazany_v timestamptz null` | unikát `(kniznica_id, cesta)` a `(kniznica_id, note_id)` pre živé riadky; `KNIZNICA.md` je tiež súbor (nesie `schema_verzia`, R6) |
| `library.revizia` | `subor_id`, `rev int`, `cesta text` (cesta v tej revízii - história premenovaní, Q33), `text text not null`, `sha256 bytea generated always as (sha256(convert_to(text,'UTF8'))) stored`, `autor text not null` (meno zadané v editore, Q61), `vytvorena timestamptz default now()`, `sprava text`, `zdroj text check in ('migracia_md','editor','nova','premenovanie','migracia_schemy','import_md')`, `schema_verzia text` | PK `(subor_id, rev)`; **append-only**: bez UPDATE/DELETE (RLS + trigger); sha256 počíta databáza, nie klient |
| `library.projekcia` | `subor_id`, `rev`, `frontmatter jsonb`, `data jsonb` (typovaná poznámka `model_dump`), `odkazy jsonb` (`[{pointer, ciel, kotva, alias}]`), `diagnostiky jsonb` | **odvodené**, prepisuje ich iba engine pri zápise; dá sa kedykoľvek zahodiť a prepočítať (`assetin db reindex`); slúži na SQL dopyty (spätné odkazy, vyhľadávanie) a na rýchly štart servera (Q41) |
| `library.vydanie` | `id uuid`, `kniznica_id`, `kod text` (napr. `2026.11.1`), `manifest_sha256 bytea` (sha256 zoradeného zoznamu `cesta + sha256` všetkých súborov), `schema_verzia`, `autor`, `vytvorene`, `sprava`, `diagnostiky_suhrn jsonb` | nemenná snímka = náhrada git commitu pre pôvod IDS |
| `library.vydanie_subor` | `vydanie_id`, `subor_id`, `rev` | ktorá revízia ktorého súboru je vo vydaní |

Prečo to dá bajtovo zhodný export: `text` je presne to, čo `Dokument.serialize()` vráti a čo dnes `ulozit()` píše s `newline=""`; Postgres `text` uchová UTF-8 bajty vrátane `\r\n` a koncového riadku (jediné, čo nevie, je bajt NUL, ktorý v MD nie je). Overil som vzor: 18 súborov, žiadne `\r`, žiadny BOM, všetky cesty v NFC. Cesty sa ukladajú v NFC (macOS dáva NFD - import normalizuje, export píše NFC). Test: `import zadanie/ -> export do tmp/ -> diff -r zadanie tmp` = 0 a `sha256` každého súboru sa rovná `revizia.sha256` (povinný v CI, princíp 7).

Súbežnosť: zápis nesie `ocakavana_rev`; ak sa `head_rev` medzitým pohol, zápis sa odmietne (HTTP 409 v editore: "poznámku medzitým zmenil X, načítaj znova"). Zápis viacerých súborov naraz (premenovanie, nová poznámka) ide v jednej transakcii cez funkciu `library.zapis_revizie(jsonb)`.

**Zavrhnuté:** (a) normalizované tabuľky polí / sekcií / blokov - druhá pravda o tvare súboru, nový writer, round-trip len "snahou"; (b) `jsonb` ako nositeľ a MD ako generovaný výstup - stratí prózu, komentáre a poradie (princíp 7); (c) git ako úložisko za API (napr. GitHub Contents API) - to je presne token, ktorý chceme odstrániť, a história bez auth používateľov AIM.

### Q59 · Kde: rovnaký Supabase projekt ako AIM (odporúčané) alebo samostatný

Organizácia má dnes jeden projekt `AIMviewer` (`acwoupricatirhlfkhvk`, eu-north-1, Postgres 17).

| | **Rovnaký projekt, schéma `library`** | **Samostatný projekt** |
|---|---|---|
| Katalóg pre AIM | vydanie zapíše do `public.ids_documents` v **jednej transakcii** s vydaním; žiadny kľúč medzi projektmi | treba prenos medzi projektmi: Edge Function alebo AIM s kľúčom druhého projektu - zas "token" |
| Používatelia | jedni (Supabase Auth AIM); Samuel sa prihlási tým istým účtom | dva zoznamy používateľov |
| Izolácia | spoločný "blast radius": chyba v migrácii alebo RLS AIM sa dotkne aj knižnice | čistá |
| Migrácie | dve repá do jedného `supabase_migrations` - riziko kolízie; riešenie nižšie | každé repo svoje |
| Cena / správa | nič navyše | ďalší projekt, zálohy, monitoring |

**Odporúčanie: rovnaký projekt, vlastná schéma `library`.** Hlavný cieľ (IDS v AIM bez tokenu) dáva len tento variant zadarmo. Podmienky: (1) DDL knižnice žije v tomto repe (`db/migrations/*.sql`) aplikuje ho **Samuel** (Supabase SQL editor alebo `psql`), evidencia je vlastná tabuľka `library.migracie` - **nepoužíva** `supabase db push`, aby sa nebilo s migráciami AIMviewer; jediný zásah do `public` je funkcia na zápis do katalógu (Q60), dohodnutá s AIM; (2) RLS na všetkých `library.*` od prvého dňa; (3) zálohy (PITR) sú spoločné - export do MD pri každom vydaní je druhá, nezávislá záloha.

**Bezpečnostný nález (nie otázka o vkuse):** v projekte AIM má **všetkých 43 tabuliek v `public` vypnuté RLS** (Supabase advisor `rls_disabled`, critical) - kto má anon kľúč, môže čítať aj meniť každý riadok, vrátane `ids_documents` a `ids_document_versions`. Kým to tak je, katalóg IDS z knižnice nie je chránený lepšie než zvyšok AIM. Nič som nezapínal (zapnutie RLS bez politík by AIM odstavilo). Odporúčam to vyriešiť v AIMviewer ešte pred PR-4 nižšie, aspoň pre `ids_*`.

### Q60 · Katalóg hotových IDS pre AIM (D-182)

**Stav v AIM (prečítané z databázy 2. 11., len čítanie):** `ids_documents(code unique ~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$, title, origin in ('library','chat'), library_source povinné práve pri origin = library, status in ('draft','active','archived'))`, `ids_document_versions(document_id, version >= 1, xml, sha256, ids_version, audit jsonb, author, source in ('chat','viewer','import'), library_repo, library_path, library_commit, library_code; pri source = 'import' sú repo/path/commit povinné - NOT VALID)`, `ids_document_models` (D-182: väzba IDS na model federácie, ruší sa `valid_until`). Dnes sú tam tri `chat` IDS, žiadne z knižnice. Repo `Menezeris/AIMviewer` som **čítať nemohol** (prístup v tejto relácii zamietnutý), takže to, ako karta D-182 dnes plní `library_*` (predpokladám z GitHubu), nie je overené - Q63.

**Kto plní:** **vydanie z editora**, nie samostatný beh generátora. Tlačidlo "Vydať" (za env bránou vydania, Q61) alebo `assetin vydaj --kod 2026.11.1`:
1. zamkne snímku `head_rev` všetkých súborov -> `library.vydanie` + `vydanie_subor`;
2. načíta `Kniznica` z tejto snímky, spustí validátor - **vydanie s chybou (úroveň E) neprejde**;
3. generátor F4 (`assetin generate ids`, ER × poskytovateľ, PLAN §IDS) vyrobí XML, každé prejde `ids.xsd` (xmlschema);
4. jedna transakcia: `library.publikuj_ids(vydanie_id, polozky jsonb)` (volá ju iba server za bránou vydania) zapíše do `public.ids_documents` / `ids_document_versions`.

**Tvar záznamu:**

| Pole AIM | Hodnota z knižnice |
|---|---|
| `ids_documents.code` | `<ER>.<poskytovateľ>` - posledný segment ID aktéra, napr. `ER-0101.ARCH` (lomka z `ACT-poverena/ARCH` regex nepustí) |
| `title` | `nazov` ER + " - " + poskytovateľ |
| `origin` / `library_source` | `library` / `db:library/<kniznica.kod>` |
| `status` | `active`; cieľ, ktorý z knižnice zmizol, dostane `archived` (nič sa nemaže) |
| `versions.version` | +1 **iba keď sa zmenil `sha256` XML** (vydanie bez zmeny IDS novú verziu nerobí - idempotentné) |
| `xml`, `sha256`, `ids_version` | XML, sha256 hex, `1.0` |
| `source` | `import` (existujúca hodnota; obmedzenie splníme takto:) |
| `library_repo` | `db:library/<kniznica.kod>` |
| `library_path` | cesta ER poznámky v tom vydaní |
| `library_commit` | `vydanie.kod` + `@` + `manifest_sha256` hex (napr. `2026.11.1@3fa9...`) - jednoznačný a overiteľný odtlačok |
| `library_code` | `ER-0101.ARCH` |
| `author` | e-mail vydavateľa |
| `audit` | `{kniznica, vydanie, schema_verzia, generator: assetin <verzia>, xsd: ok, poznamky: [{id, rev, sha256}], diagnostiky: {E:0, W:n}}` - presný pôvod: ktoré revízie ktorých poznámok vyrobili toto IDS |

**Ako to AIM číta:** karta D-182 vypíše `ids_documents where origin = 'library' and status = 'active'` s poslednou verziou, "Priradiť k projektu" založí riadok `ids_document_models` (už existuje). Žiadny GitHub, žiadny token: knižnica aj AIM sú v tej istej databáze. Voliteľný druhý krok (zmena v AIMviewer, nie tu): stĺpec `library_release_id uuid references library.vydanie` namiesto textu v `library_commit`, a do budúcna `source = 'library'` namiesto `import` - **rozhodne AIM**, plán funguje aj bez toho.

**Závislosť:** generátor F4 v repe ešte nie je (je len dôkaz `tests/fixtures/ids/dry_run_er0101_arch.py`, ktorý prešiel XSD). F4 nezávisí od databázy (pracuje nad `Kniznica` v pamäti), takže môže bežať súbežne s PR-1 až PR-3.

### Q61 · Bezpečnosť, autentifikácia, licencie

**Prihlásenie: zatiaľ žiadne (Samuel 2. 11., Q64 h), rovnako ako AIMviewer.** Do databázy píše **iba server aplikácie** (`assetin edit --db`) jedným spojením s rolou, ktorá obchádza RLS (service role / vlastník schémy); kľúč alebo heslo je **len v prostredí servera** (`ASSETIN_DB_URL`), nikdy v stránke ani v prehliadači. Server chráni:
- **env brána na zápis**: bez `ASSETIN_ZAPIS=1` je server len na čítanie (`/api/stav` vráti `zapis: false`, POST vráti 403);
- **env brána na vydanie** (rola `vydavatel` zatiaľ = Samuel): `ASSETIN_VYDANIE=1`, inak `/api/vydaj` vráti 403;
- **origin guard**: POST s hlavičkou `Origin` (alebo `Referer`) mimo povolených (`ASSETIN_ORIGINS`, predvolene vlastná adresa servera) sa odmietne 403;
- **rate limit**: pevné okno na IP pre zapisovacie endpointy (predvolene 60 za minútu), pri prekročení 429;
- **autor** = meno zadané v editore (zapamätá sa v prehliadači, `localStorage`), ide s každým zápisom do `library.revizia.autor` ako text; bez mena server zápis odmietne. Je to podpis, nie overená identita - kým nie je prihlásenie, nič silnejšie nemáme.

**RLS (Samuel: `library.*` bez prístupu anon/authenticated, zapisuje len server):** na všetkých tabuľkách `library.*` je RLS **zapnuté a bez jedinej politiky**, a `anon`, `authenticated` aj `public` majú na schéme `library` odobraté všetky práva (`revoke all`, aj `alter default privileges`). Cez PostgREST sa teda do knižnice nedostane nikto, ani keby sa schéma omylom pridala medzi exposed. Integritu stráži databáza sama, bez ohľadu na to, kto píše: `revizia`, `vydanie` a `vydanie_subor` majú trigger, ktorý odmietne `UPDATE` aj `DELETE` (append-only); `subor.head_rev` sa posúva len funkciou `library.zapis_revizie`, ktorá v tej istej transakcii skontroluje očakávanú revíziu. Zápis do katalógu AIM (`public.ids_*`) robí funkcia `library.publikuj_ids` (pevný `search_path`), volaná zo servera za bránou vydania. Validácia sa v SQL **neopakuje** (register pravidiel je Python, U16): zápis, ktorý by poznámku nenatypoval, odmietne engine skôr, než sa dotkne databázy. RLS na tabuľkách AIM zapne Samuel samostatnou migráciou (overil, že `anon` / `authenticated` tam granty nemajú, takže je to obrana do hĺbky, nie diera).

**Nové závislosti a licencie (princíp 5):**

| Závislosť | Licencia | Na čo | Poznámka |
|---|---|---|---|
| `xmlschema` | MIT | XSD kontrola IDS pri vydaní | už plánovaná v R8 |
| `ifcopenshell` / `ifctester` | LGPL-3.0 (dynamicky) | generátor F4 | už plánované v R7 |
| `psycopg[binary]` 3 | LGPL-3.0 (dynamicky) | `SkladDB`: server sa pripája priamo na Postgres (`ASSETIN_DB_URL`), transakcie a kontrola revízie v jednej transakcii; testy bežia proti lokálnemu Postgres bez PostgREST | extra `db`; PostgREST by vyžadoval pridať `library` medzi exposed schémy, čo Samuel nechce |
| Supabase CLI | MIT | lokálny Postgres pre testy (`supabase start`) | nástroj, nie závislosť balíka |
| `testcontainers` | Apache-2.0 | alternatíva k Supabase CLI v CI | vybrať jedno |

`supabase-py` (MIT) **neodporúčam** - ťahá realtime, storage a ďalšie klienty, ktoré nepotrebujeme. Nič s AGPL.

### Q62 · Migrácia `zadanie/` do DB, spätný export a čo sa stane s engine a editorom

**Engine (jedno nové rozhranie, nič sa neprepisuje):**

| Časť | Dnes | Po zmene |
|---|---|---|
| `loader.najdi_subory` / `nacitaj_kniznicu(koren)` | `rglob("*.md")` | `nacitaj_kniznicu(sklad)`; `nacitaj_subor(path, koren, text)` už text prijíma, mení sa len zdroj |
| `dokument.ulozit` | `write_text(newline="")` | `sklad.zapis(cesta, text, ocakavana_rev, sprava)` |
| `zapis.uloz` / `vytvor` | zapíš, načítaj späť, pri chybe vráť text / premenuj späť / zmaž | patch v pamäti -> natypovať v pamäti -> až potom jedna transakcia; "vrátenie" odpadá, lebo sa nič nezapíše predčasne |
| `writer.py` | chirurgický patch textu | **bez zmeny** |
| validátor, reťazec, graf, inšpektor | nad `Kniznica` | **bez zmeny** |
| migrácie schémy (`assetin migrate`) | prepíšu súbory | prepíšu cez `Sklad` -> nové revízie so `zdroj = migracia_schemy`, jedna transakcia na celú migráciu |
| server (`assetin edit`) | číta priečinok pri každom requeste | `assetin edit .` (priečinok, ako dnes) alebo `assetin edit --db <kod>`; bez stavu, ale `Kniznica` sa memoizuje podľa `(subor_id, head_rev)` - jeden malý dopyt namiesto 300 parsov (pomáha aj Q41) |
| stránka (`app.html`) | - | takmer bez zmeny; pribudne autor a čas poslednej revízie v inšpektore a záložka "História" (zoznam revízií, diff) - dôsledok pre UI, rozhodne Samuel (Q64 c) |
| `docs/editor.html` (jeden súbor) | náhľad zo `zadanie/` | ostáva; v CI sa generuje zo vzoru |

**Nové príkazy:** `assetin db sql` (vypíše SQL migrácie pre Samuela), `assetin db import <priečinok> --kniznica <kod>` (prvé naplnenie: každý súbor = revízia 1, `zdroj = migracia_md`; kontrola, že `sha256` v DB = sha256 súboru), `assetin db export <priečinok> [--vydanie <kod>]` (zapíše strom súborov presne ako dnes + skrytý `.assetin-export.json` s revíziami), `assetin vydaj`, `assetin db reindex`.

**Čo sa stane so `zadanie/` v repe:** ostáva ako **testovací vzor** (CLAUDE.md "testovacie dáta = zadanie/"): CI ho importuje do lokálneho Postgres, exportuje späť a porovná `diff -r` (round-trip na úrovni celého stromu). Živý obsah knižnice je v DB; repo ho už nenesie (Q64 a).

**Spätný import z Obsidianu** (ak ho Samuel chce, Q64 b): `assetin db import` nad priečinkom s `.assetin-export.json` - zapíše len súbory, ktorých sha256 sa zmenil, a odmietne tie, ktorých `head_rev` sa od exportu pohol (konflikt sa nerieši automaticky, nahlási sa).

### Q63 · Kroky (PR) a riziká

| PR | Obsah | Hotové, keď |
|---|---|---|
| **PR-0** (tento) | plán: Q57-Q65, DECISIONS V29 | Samuel odpovie na Q64 |
| **PR-1** `Sklad` | rozhranie `Sklad` + `SkladPriecinok`; loader, `zapis` a server idú cez neho (migrácie schémy ostávajú nad priečinkom, nad DB pôjdu cez export a import revízií v PR-3); žiadna DB; CLAUDE.md princíp 1 a MODEL.md §9 ("databáza - MD je pravda") prepísané podľa V29; DATA-MODEL §1 doplnený | všetky dnešné testy zelené bez zmeny správania; round-trip ako dnes |
| **PR-2** schéma `library` | `db/migrations/0001_library.sql` (tabuľky Q58, RLS Q61, trigger append-only, `zapis_revizie`), `assetin db sql`; testy nad lokálnym Postgres: anon a authenticated nevidia nič, revízia sa nedá zmeniť ani zmazať, súbeh revízií sa odmietne | SQL dostane Samuel; na produkciu ho aplikuje on |
| **PR-3** `SkladDB` + import/export | `SkladDB` (psycopg), `db import/export`, projekcie, 409 pri súbehu, `assetin edit --db` s bránami, autor v editore, úprava prózy | CI: `import zadanie -> export -> diff -r` = 0; súbežný zápis dvoch klientov -> druhý dostane 409 |
| **PR-4** vydanie + katalóg | `library.vydanie*`, `publikuj_ids`, `assetin vydaj`, tlačidlo "Vydať"; závisí od F4 | ER-0101 × ARCH je v `public.ids_documents` s `origin = library`, AIM ho ukáže na karte D-182 a priradí k projektu |
| **PR-5** (AIMviewer, mimo tohto repa) | karta D-182 číta z DB namiesto GitHubu; RLS na `ids_*`; voliteľne `library_release_id` | rozhodne a urobí AIM |
| **F4** (súbežne) | generátor IDS podľa PLAN | XSD + ifctester ako v PLAN |

**Riziká:**
1. **Spoločný projekt s AIM bez RLS** (Q59) - najväčšie riziko; knižnica ho nezhorší (vlastná schéma s RLS), ale katalóg je v `public`.
2. **Dve repá, jedna databáza** - kolízia migrácií; mitigácia: vlastná evidencia `library.migracie`, žiadne `supabase db push` odtiaľto, test migrácie najprv na Supabase branch.
3. **Obsidian prestane byť editor** - kto bol zvyknutý písať v Obsidiane, píše v editore; editor dnes nevie upravovať prózu (Q28, próza len na čítanie). **Ak sa ruší Obsidian ako miesto písania, editor musí vedieť prózu** - inak sa časť knižnice stane needitovateľnou. Toto je najväčšia funkčná diera plánu (Q64 d).
4. **Výkon** - loader 8 ms na poznámku (Q41); memo podľa `head_rev` to rieši pre server, projekcia `data jsonb` by to mohla riešiť úplne, ale len ak sa jej dá veriť (je odvodená - pri zmene schémy `reindex`).
5. **Offline** - bez siete sa v DB nedá písať; `SkladPriecinok` ostáva (export -> práca -> import), ale nie je to plnohodnotný režim.
6. **Princíp 4 vs. projekcie** - `projekcia` je kópia odvodených údajov; je to povolené len preto, že je označená ako odvodená, nikto ju nepíše ručne a `reindex` ju vie zahodiť. Ak by ju niekto začal editovať (napr. SQL v AIM), vznikne druhá pravda - preto `projekcia` nemá žiadnu zapisovaciu politiku pre používateľov.
7. **Číslovanie IDS verzií v AIM** - ak AIM upraví IDS z knižnice "rukou" (`source = viewer`), vznikne verzia, ktorú ďalšie vydanie prepíše novšou; pravidlo navrhujem: knižničné IDS sa v AIM needitujú, úprava = `chat` kópia s `derived_from` (to už D-162 tak má).

### Q64 · Otázky pre Samuela (na rozhodnutie pred PR-1)

- **(a) Repo a obsah:** po migrácii ostane `zadanie/` v repe **iba ako testovací vzor** a živá knižnica bude len v DB (+ export pri vydaní)? Alebo chceš, aby každé vydanie exportovalo MD aj do gitu (napr. samostatné repo `assetin-library-content`) ako čitateľnú zálohu? Odporúčam: vzor ostáva, export pri vydaní ide do Supabase Storage ako zip (žiadny token pre AIM, žiadne druhé repo).
- **(b) Obsidian:** export je **jednosmerný** (Obsidian len na čítanie), alebo chceš aj spätný import úprav z Obsidianu s kontrolou konfliktov? Odporúčam jednosmerný na začiatok.
- **(c) História v UI:** stačí autor a čas poslednej zmeny v inšpektore, alebo chceš záložku "História" s diffom revízií (nová obrazovka - PROMPT-ui kontrakt)?
- **(d) Próza:** ak sa v Obsidiane už nepíše, editor musí vedieť upravovať prózu tela (dnes len na čítanie, Q28). Súhlasíš, že to je súčasť PR-3, a nie neskôr?
- **(e) Projekt:** súhlasíš so spoločným projektom AIM a schémou `library` (Q59)? A zapne AIM RLS aspoň na `ids_*` pred PR-4?
- **(f) Katalóg:** kód IDS v AIM `ER-0101.ARCH`, `source = import` a `library_commit = <vydanie>@<manifest_sha256>` (Q60) - stačí, alebo chce AIM vlastnú hodnotu `source = 'library'` a FK na vydanie (zmena v AIMviewer)?
- **(g) Kto vydáva:** rola `vydavatel` iba ty, alebo aj ďalší? Má vydanie vyžadovať 0 varovaní, alebo len 0 chýb?
- **(h) Prihlásenie:** Supabase Auth projektu AIM (ten istý účet ako v AIM) - aký spôsob prihlásenia (Google / Microsoft / e-mail magic link)?

**Odpovede Samuela 2. 11. (cez orchestrátora):** plán áno. (a) áno, živá knižnica v DB, `zadanie/` ostáva ako testovací vzor, pri vydaní sa exportuje zip; (b) Obsidian len na čítanie exportu, spätný import nie; (c) v UI stačí autor a čas poslednej zmeny; (d) áno, úprava prózy v editore patrí do PR-3; (e) spoločný projekt AIM áno, RLS na tabuľkách AIM zapne Samuel sám; (f) katalóg tak, ako je navrhnutý; (g) vydáva Samuel, stačí 0 chýb (varovania vydanie nezastavia); (h) **žiadne prihlásenie** - server s env bránou, origin guardom a rate limitom, autor = meno z editora (prepísané v Q61). Migrácie schémy `library` idú do PR a **neaplikujú sa na produkciu** - SQL dostane Samuel a aplikuje ho sám.

### Q65 · Čo sa týmto nemení

Schéma poznámok (`schema/`, v1.5), tvar súborov, PathScheme, writer, validátor, pravidlá a celý model (MODEL §1-§9 okrem vety o databáze v §9) ostávajú. Mení sa nositeľ súborov (disk -> DB s revíziami) a pribúda vydanie. Princíp 7 (round-trip) platí ďalej a pribúda mu druhá polovica: **import -> export = bajtovo identický strom**.

### Q66 · Stav implementácie V29 a čo ostáva (2. 11.)

**Hotové v draft PR (nič nie je na `main`, nič nie je aplikované na produkčnú DB):** #8 rozhranie `Sklad` (PR-1), #9 schéma `library` (PR-2, `0001_library.sql`), #10 `SkladDB`, import a export, editor nad DB, autor, 409, próza v editore (PR-3), #11 vydanie a zápis IDS do katalógu AIM (PR-4, `0002_vydanie_ids.sql`). PR sú na sebe postavené (#8 -> #7, #9 -> #8, ...). Overené testami proti Postgres 16 a ručne v prehliadači nad lokálnou DB: `assetin db import . && assetin db export` dá `diff -r zadanie` bez rozdielu.

**Na nasadenie treba (Samuel):**
1. Aplikovať SQL: `assetin db sql` (obe migrácie, každá je jedna transakcia a druhé spustenie odmietne). `library` netreba pridávať medzi exposed schémy PostgREST - server sa pripája priamo na Postgres.
2. Prostredie servera: `ASSETIN_DB_URL` (connection string Supabase, napr. session pooler, rola `postgres`; len na serveri), `ASSETIN_ZAPIS=1`, `ASSETIN_VYDANIE=1` (len tam, kde vydáva Samuel), `ASSETIN_ORIGINS` (verejná adresa editora, ak beží za proxy), voliteľne `ASSETIN_LIMIT`. Pre zip exportu `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` a súkromný bucket `library-exports` (alebo `ASSETIN_EXPORT_BUCKET`); bez nich vydanie prebehne, len zip sa nenahrá.
3. Prvé naplnenie: `assetin db import <balík> --kniznica assetin --nazov "Knižnica Assetin" --autor Samuel`.

**Otvorené:**
- **(a) Generátor F4 v repe nie je**, a preto vydanie dnes zapíše snímku a zip, ale **žiadne IDS** (správa to povie). Vydanie berie generátor ako parameter (`assetin.generate.ids.generuj(k) -> [IDSVystup]`); keď F4 pribudne pod týmto menom, vydanie ho použije samo. Dôkazový skript `tests/fixtures/ids/dry_run_er0101_arch.py` som zámerne nepovýšil na generátor (sám o sebe hovorí, že ním nie je). Testy katalógu idú s jeho výstupom `ER-0101_ARCH.ids`. Toto je teraz jediná prekážka, aby sa IDS z knižnice dostalo na kartu D-182.
- **(b) Kde beží server** s bránami (Vercel / Fly / VM pri AIM) - rozhodne Samuel. Kód nič nepredpokladá okrem premenných prostredia.
- **(c) Karta D-182 v AIMviewer** má čítať `ids_documents where origin = 'library' and status = 'active'`. Repo AIMviewer som v tejto relácii čítať nemohol, preto som to neoveril. `library_commit` je `<vydanie>@<manifest sha256>`, nie git SHA - ak karta z neho skladá odkaz na GitHub, treba ju upraviť (PR-5 v AIMviewer).

### Q67 · Editor knižnice ako súčasť AIMviewer - päť viet a tri možnosti (2. 11.)

Samuel: nechce lokálny server, editor knižnice má byť súčasťou AIMviewer (jedna webová aplikácia). Toto je len návrh, nič z neho nie je v kóde.

Päť viet: (1) Editor je dnes **jedna HTML stránka generovaná zo schémy** (`assetin app export`, R11b) a ukladá cez relatívne `api/...`, takže sa dá servírovať pod ľubovoľnou cestou (napr. `/library/`) bez zmeny stránky. (2) Všetko, čo stránka nevie sama - typovanie, validátor (61 pravidiel), writer s round-tripom, reťazec, generátor IDS - je **Python nad pydantic schémou** (princíp 2: schéma existuje raz), takže otázka nie je "kde je stránka", ale "kde beží Python". (3) Server je bez stavu (každý request číta sklad), s bránami cez env a s pripojením len zo servera (Q61), čo je presne tvar serverless funkcie; jediný stav je rate limit v pamäti, ktorý na serverless nefunguje (každá inštancia má vlastný) a musí ísť do DB alebo do firewallu platformy. (4) Prepísať editor do TypeScriptu by znamenalo mať validátor, writer a typovanie dvakrát (Python pre generátory a CLI, TS pre AIM), čo porušuje princípy 2 a 4 a ohrozuje princíp 7 (round-trip by mal dve implementácie). (5) Preto odporúčam ponechať jeden engine v Pythone a zmeniť len to, kde beží: ako Python funkcie v projekte AIMviewer pod `/library`, s tou istou databázou a tými istými bránami.

| | (a) Vercel Python funkcie v projekte AIMviewer pod `/library` | (b) samostatná služba (Render / Fly) s odkazom z AIM | (c) prepis editora do TS v AIMviewer |
|---|---|---|---|
| Čo to je | `api/library/[...].py` = ASGI app `assetin.server.vytvor_app(SkladDB)`; balík `assetin-library` z gitu pripnutý na tag v `requirements.txt`; stránka na `/library/` | ten istý server v kontajneri, AIM naň odkazuje (alebo ho vloží cez iframe) | editor, validátor, writer a typovanie v TS nad JSON Schema |
| Jedna aplikácia pre používateľa | áno, jedna doména a deploy | nie, dve adresy (iframe to zakryje len čiastočne) | áno |
| Princípy repa | zachované (jeden engine) | zachované | porušené 2, 4; 7 len s dvojitou implementáciou |
| Riziká | limit veľkosti Python funkcie (treba overiť aktuálny limit Vercelu; pydantic + ruamel + psycopg sú malé, ale **ifcopenshell pre F4 má desiatky MB** a môže limit prekročiť - generovanie IDS by potom išlo inam, napr. do GitHub Action alebo (b)); cold start Pythonu na každý prvý request (sekundy); pripojenie cez Supabase transaction pooler (psycopg bez prepared statements); rate limit presunúť do DB alebo Vercel Firewall | ďalšia služba na správu a platbu; CORS / origin guard medzi doménami | týždne práce, dve pravdy o schéme |
| Práca | 2-4 dni: entry point a `vercel.json` v AIMviewer, base path, pooler, rate limit v DB, CI test, ktorý balík importuje; F4 podľa veľkosti ifcopenshell | 1-2 dni: Dockerfile, deploy, odkaz v AIM | 3-6 týždňov a trvalé udržiavanie dvoch enginov |

**Odporúčanie: (a)**, so záložným plánom pre generátor IDS: ak sa ifcopenshell do Vercel funkcie nezmestí, vydanie (F4) pobeží mimo requestu editora (GitHub Action alebo malá služba podľa (b)) a editor v AIM ostane na (a). Zmeny sú hlavne v repe AIMviewer. V tomto repe treba len: konfigurovateľnú base path v `vytvor_app`, rate limit nad DB a návod. Rozhoduje Samuel; F4 na tom nezávisí, generátor je Python modul v tomto repe v každom variante.

### Q68 · F4: generátor IDS je v repe (2. 11.)

`assetin/generate/ids.py` vznikol z dôkazového skriptu `tests/fixtures/ids/dry_run_er0101_arch.py` mechanickým refaktorom: napevno zadaná dvojica ER-0101 × ARCH sa zmenila na `Ciel(er, poskytovatel)` a ciele sa hľadajú v knižnici (`ciele(k)`: poskytovatelia IU-O, ktoré výmena nesie v alfanumerickom aspekte, V27). Mapovanie sa nemenilo, takže **zlatý súbor `ER-0101_ARCH.ids` vychádza bajtovo rovnako** (test). Skript ostal ako tenký obal, ktorý vypíše správu o nezmapovaných poliach. Vo vzore je jeden cieľ (ER-0101 × ARCH, 8 špecifikácií); geodet IDS nemá, lebo protokol nesie len dokumentáciu. Vydanie si generátor nájde samo (`predvoleny_generator`), IDS overí proti `ids.xsd` (xmlschema, MIT; XSD sa necommituje, stiahne sa do `~/.cache/assetin/` alebo `ASSETIN_IDS_XSD`). IDS, ktoré neprejde, vydanie zastaví. Ak sa XSD nedá získať, audit povie `xsd: neoverené` a správa vydania to zopakuje. Ručne: `assetin generate ids [--db K] [--out D]`.

Dve voľby, ktoré som urobil a treba ich potvrdiť:
- **(a) Bez dátumu v `ids:info`.** Dátum by zmenil sha256 pri každom vydaní a AIM by dostal novú verziu IDS, hoci sa požiadavky nezmenili (Q60). Pôvod a čas nesie vydanie (`library_commit`, `audit`).
- **(b) STD pravidlo bez poskytovateľa** (`plati: vzdy`) ide do IDS **každého** poskytovateľa výmeny - tak to robil dôkaz. Q39 tým nie je uzavreté; pri dvoch poskytovateľoch s modelom by sa pravidlo overovalo dvakrát.

Pre Q67: generátor **nepotrebuje ifcopenshell** (len štandardnú knižnicu a xmlschema), takže riziko veľkosti Vercel funkcie z Q67 (a) sa F4 netýka. ifcopenshell príde až s overovaním nad IFC (F2b).

### Q69 · Plán variantu (a) z Q67 na schválenie - editor ako Vercel Python funkcie v AIMviewer pod `/library` (2. 11.)

Nič z toho nie je v kóde. Kroky:
1. **Toto repo (1 PR, približne 1 deň):** `vytvor_app(..., zaklad="/library")` (base path pre stránku a `/graf`); rate limit nad DB namiesto pamäte (serverless inštancie nezdieľajú pamäť) alebo jeho vypnutie v prospech Vercel Firewall; `SkladDB` s `prepare_threshold=None` pre Supabase transaction pooler; tag vydania balíka (`v0.2.0`), na ktorý sa AIMviewer pripne.
2. **AIMviewer (1 PR, 1-2 dni, robí session s prístupom do repa):** `api/library/index.py` = `app = vytvor_app(SkladDB(url=os.environ["ASSETIN_DB_URL"], kniznica="assetin"))`, `requirements.txt` s `assetin-library[server,db,ids] @ git+https://github.com/Menezeris/assetin-library@v0.2.0`, prepisy v `vercel.json` (`/library/(.*)` -> funkcia), odkaz v navigácii AIM. Env premenné len vo Vercel projekte. Brány ostávajú: `ASSETIN_ZAPIS`, `ASSETIN_VYDANIE` (ten v produkcii zapne len Samuel), `ASSETIN_ORIGINS` = doména AIM.
3. **Overenie:** cold start a čas `/api/dokument` nad produkčnou knižnicou (loader 8 ms na poznámku, Q41); ak by boli neprijateľné, memo podľa `head_rev` (Q62) alebo variant (b).

Riziká: inštalácia balíka z privátneho repa počas Vercel buildu potrebuje prístup ku GitHubu (deploy key alebo verejný tag balíka). Ak ho nechceme, balík sa dá vydať ako wheel do Vercel projektu. Toto rozhodne Samuel spolu s odpoveďou na Q69.

### Q70 · Port enginu a editora do TypeScriptu v AIMviewer - plán (2. 11.)

Samuel zamietol Q69 (Python funkcie vo Verceli): *"máme postavený aimviewer, tak obdobným štýlom spraviť aj library req, netreba aby to bol python."* Editor knižnice bude Next.js/TypeScript v AIMviewer nad `library.*` cez API routy hosta (service_role). Toto je plán bez kódu; implementáciu pridelí orchestrátor session s prístupom do AIMviewer.

Päť viet: (1) Port nie je "prepísať editor", lebo stránka je len 1/4 kódu. Editor potrebuje **celý engine**: schému (z nej formulár), parser a writer s round-tripom (DB nesie text súboru, V29, takže každé uloženie je chirurgický patch textu), graf a priradenie, reťazec a inšpektor, validátor (61 pravidiel; bez neho sa nedá vydať, Q64 g) a generátor IDS. Spolu je to približne 10 400 riadkov Pythonu a 3 300 riadkov stránky. (2) Princíp 2 ("schéma existuje raz") ostáva, mení sa len jazyk: jediným zdrojom bude **zod v TS**, z ktorého sa odvodí JSON Schema aj UI. Počas prechodu však existujú dva enginy a jediná ochrana proti ich rozchodu je **korpus zhody**: Python vyrobí očakávané výstupy a TS ich musí dať bajtovo rovnako. (3) Najväčšie riziko je princíp 7: writer stojí na ruamel.yaml (komentáre, štýl `{atribut: Name}`, úvodzovky, riadkové patche úrovne 1b) a v TS je najbližší `yaml` (eemeli, ISC) s CST. Zhoda sa nedá predpokladať, treba ju dokázať na korpuse golden úprav. (4) Databáza sa nemení: `library.zapis_revizie`, `vytvor_vydanie` a `publikuj_ids` sú v SQL a TS ich volá rovnako ako Python. Toto je výhoda V29: úložisko nezávisí od jazyka. (5) Po porte je Python engine buď archív a špecifikácia, alebo ostáva pre CLI a CI. To rozhodne Samuel (otázka (a) nižšie). Kým nerozhodne, ostáva ako **orákulum** v CI.

**Čo preniesť (a odhad pre jedného vývojára so session):**

| Časť | Dnes (Python) | V TS | Odhad |
|---|---|---|---|
| Schéma 13 typov + pod-záznamy + `x-assetin` metadáta, cesty (PathScheme), pásma | `assetin/schema/*` (pydantic) | zod + metadáta; JSON Schema zo zod (`zod` v4 `toJSONSchema` alebo `zod-to-json-schema`, MIT/ISC); `docs/schema/*.json` musia vyjsť rovnako | 1-2 týždne |
| Dokument (blokový parser), loader, writer úrovne 0-5, nová poznámka zo šablóny, próza | `dokument.py`, `loader.py`, `writer.py`, `zapis.py` | `yaml` (ISC) CST + vlastný blokový parser; **golden edit testy z Pythonu** | 2-3 týždne |
| Graf, priradenie (V27), reťazec (V23, línia U19), inšpektor (V22), payload editora | `graf.py`, `priradenie.py`, `retazec.py`, `inspektor.py`, `app_json.py` | čisté funkcie nad načítanou knižnicou; zhoda payloadu `dokument()` ako JSON | 1-2 týždne |
| Validátor 61 pravidiel | `validator/*` | jedno pravidlo = jedna funkcia, rovnaké kódy a pointre; zhoda diagnostík na vzore aj na `tests/fixtures/md/chybne/` | 1-2 týždne |
| Generátor IDS (F4) | `generate/ids.py` | XML builder; zlatý `ER-0101_ARCH.ids` bajtovo; XSD kontrola cez `xmllint-wasm` (MIT, libxml2 MIT) alebo v CI | 3-5 dní |
| Editor (registre, Detail, Reťazce, inšpektor, dialóg novej poznámky, Vydať) | `nahlad/app.html` (vanilla) | React komponenty v štýle AIMviewer, generované zo zod | 2-3 týždne |
| API routy | FastAPI `assetin/server` | Next.js route handlers so service_role: čítanie `library.hlava`, uloženie (`zapis_revizie` + projekcia), kontrola, nová poznámka, vydanie; brány ako dnes (env, origin, rate limit) | 2-4 dni |

Spolu **približne 6-10 týždňov**. V Q67 (c) som odhadol 3-6 týždňov; nerátal som tam port stránky ani korpus zhody, teraz áno.

**Čo môže ostať v Pythone počas prechodu:** export MD a zip vydania (`assetin db export`, nemení sa), migrácie schémy (`assetin migrate --db`), generovanie seed SQL (Q71) a hlavne **korpus zhody v CI**. Nový príkaz `assetin korpus export` zapíše pre každý súbor vzoru a fixtures: výstup parsera (bloky), typované dáta, diagnostiky, payload `dokument()`, golden úpravy (vstup, zmeny, očakávaný text) a IDS. AIMviewer CI ich porovná s TS výstupom. Python server a `app.html` sa po kroku 7 nižšie zmažú.

**Poradie PR:**
0. *(toto repo)* rozhodnutie V30 (ak ho Samuel potvrdí) a `assetin korpus export` + korpus ako verzovaný artefakt.
1. *(AIMviewer)* read-only prehliadač knižnice: API route nad `library.hlava`, TS parser Dokumentu s round-trip testom nad korpusom (parse -> serialize = bajty).
2. zod schéma + loader (typovanie) + JSON Schema + UI deskriptory; zhoda typovaných dát a `docs/schema/*.json`.
3. writer (úrovne 0-5, próza, nová poznámka) so zhodou golden úprav; od tohto PR sa v AIM dá **písať** (`zapis_revizie`, 409 pri súbehu, autor z editora).
4. graf, priradenie, reťazec, inšpektor; obrazovka Reťazce.
5. validátor so zhodou diagnostík; `/kontrola` pred uložením.
6. generátor IDS + XSD; tlačidlo Vydať (`vytvor_vydanie` + `publikuj_ids` v jednej transakcii).
7. *(toto repo)* vypnúť Python server a editor, CLAUDE.md a PLAN podľa V30.

**Riziká:** (1) rozchod dvoch enginov počas prechodu; mitigácia je povinný korpus zhody v CI a žiadna zmena schémy, kým port nedobehne (alebo zmena naraz v oboch); (2) round-trip YAML v TS (ruamel vs. `yaml`), najväčšie riziko pre princíp 7; ak sa niektorý štýl nedá zachovať, writer musí radšej odmietnuť zápis než text zmeniť (dnes to tak robí úroveň 1b); (3) dialekt regexu (Python `re` vs. JS) vo `vzor` (Q38); (4) výkon prvého načítania (dnes 8 ms na poznámku v Pythone, Q41), pri port sa dá cachovať projekcia `data`; (5) kým nie je krok 3, editovať knižnicu nebude kde. Python server Samuel nechce, takže do kroku 3 je knižnica len na čítanie alebo sa edituje lokálne cez `assetin edit --db`.

**Otázky pre Samuela:** (a) Po porte Python engine archivovať, alebo nechať pre CLI a CI (migrácie, korpus, seed)? (b) Kde budú žiť `docs/MODEL.md`, `DECISIONS.md` a `SCHEMA-v1.md`: tu ako špecifikácia, alebo sa presunú do AIMviewer? (c) Do kroku 3 knižnica len na čítanie, alebo dočasne `assetin edit --db` lokálne? (d) XSD kontrola IDS vo vydaní cez wasm v serverless funkcii, alebo len v CI?

**Uzavreté 2. 11.: Samuel schválil, zapísané ako DECISIONS V30** s odpoveďami (a) Python engine archivovať, (b) všetko vrátane MODEL/DECISIONS/SCHEMA odteraz v repe AIMviewer, (c) do kroku 3 len na čítanie, (d) XSD sa rozhodne pri kroku 6. **Krok 0 je hotový:** `assetin korpus export` zapíše `korpus/` (schémy, 3 stromy: bloky, loader, validátor, payload editora; 25 úprav; IDS), CI kontroluje, že je aktuálny, a `korpus/README.md` hovorí, čo s čím porovnať. Pôvodný návrh znenia: *Engine a editor knižnice sa prenášajú do TypeScriptu v AIMviewer; jediným zdrojom schémy bude zod (princíp 2 platí, mení sa jazyk). Počas prechodu je Python engine orákulom: TS musí dávať bajtovo rovnaké výstupy na korpuse zhody. Ruší R1, R10, R11b a Q67/Q69 (a).* Zavrhnuté: *Python funkcie vo Verceli (Q69); samostatná Python služba (Q67 b).*

### Q71 · Naplnenie knižnice `assetin` a prvé vydanie bez connection stringu (2. 11.)

Produkčný connection string nikto nemá v chate, preto sa naplnenie a prvé vydanie robia **jedným SQL skriptom** cez Supabase Management API (aplikuje orchestrátor alebo Samuel). Skript `db/seed/2026-11-02_assetin_naplnenie_a_vydanie.sql` generuje `scripts/sql_naplnenie_a_vydanie.py`. Je deterministický (ten istý balík dá tie isté bajty) a beží v jednej transakcii. Robí tri kroky: 19 súborov cez `library.zapis_revizie` (autor Samuel Augustin, zdroj `migracia_md`), odvodené projekcie a vydanie `2026.11.1` cez `library.vytvor_vydanie` (databáza overí sha256 každého súboru aj manifest) s `library.publikuj_ids` (IDS `ER-0101.ARCH` z generátora F4, XSD ok). Stráž odmietne beh, ak knižnica už má súbory. Overené na čistom Postgres s ICU en-US a kópiou katalógu AIM: export vydania je bajtovo zhodný so `zadanie/`, druhý beh je odmietnutý a následné vydanie z Pythonu dalo `bez_zmeny`. Zip exportu do Storage skript nerobí (ide mimo SQL); `export_cesta` ostane prázdna.

**Nález 2. 11. (prvý beh seedu na produkcii):** zlyhal a celý sa vrátil (`library.subor = 0`, `vydanie = 0`) s chybou `42P01 relation "ids_documents" does not exist` v `public.ids_document_versions_guard()`. Triggerové funkcie AIM (`ids_documents_origin_guard`, `ids_document_versions_guard`, `ids_document_models_guard`) majú nekvalifikované mená tabuliek a nemajú vlastný `search_path`, kým `library.publikuj_ids` beží so `search_path = ''` (to je správne a ostáva). Moja kópia katalógu na testy mala stĺpce, obmedzenia a indexy, ale **nie triggery**, preto to testy nechytili. Oprava: `tests/fixtures/db/aim_ids_katalog.sql` má triggery doslova z produkcie (`pg_get_functiondef`, `pg_get_triggerdef`). Navrhovaná oprava AIM (`alter function ... set search_path = public` pre všetky tri) je v `aim_ids_oprava.sql` a pripraví ju orchestrátor v AIMviewer. `tests/test_aim_katalog.py` ukazuje oba stavy: bez opravy seed padne s 42P01 a nič neostane, s opravou prejde a druhý beh je odmietnutý. Seed sa nemení.
