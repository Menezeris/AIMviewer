---
name: PROMPT-ui
description: Záväzné zadanie na UI editora (Samuel, 2026-09-10/11) — tri kolá; §3–§5 kola 1 sú vizuálny kontrakt, na ktorý sa odkazuje kód aj ďalšie zadania
status: v1.2 (2026-09-11) — po treťom kole (navigácia, záložky, zvislý reťazec)
origin: samuel
---

# Zadanie na UI editora

Zdroj pravdy pre vzhľad a správanie appky. Kód sa odkazuje na tieto paragrafy (najmä **§3 terminológia**,
**§4 rozloženie**, **§5 vizuálne tokeny**), preto sa text nemení bez rozhodnutia Samuela — rovnako ako
princípy v `CLAUDE.md`. Čo z toho už je v kóde, hovorí stĺpec *stav*.

---

## Kolo 1 (prestavba)

### §1 Čo bolo zle na prvom výstupe
- Osem očíslovaných sekcií v pevnom poradí nie je v schéme nikde; vyzeralo to ako osem rovnocenných krokov jednej kaskády.
- `Štandard` a `Aktéri` nie sú kroky — sú prierezové, dopadajú na každý krok.
- Bola to čítačka, nie editor: jeden účel užitia na obrazovku, žiadny tabuľkový pohľad, žiadne backlinky, žiadny dopad zmeny.
- IU-O sa rozbaľovala priamo v reťazci — nepatrí mu, `IU-O-space` bude aj v `ER-0201`.

### §2 Nové rozhodnutia
| Zadanie | V repe | Obsah | Stav |
|---|---|---|---|
| V17 | **V19** | vrstva je vlastnosť, nie priečinok navigácie; deliaca čiara je **definícia vs. dosadenie** | hotové |
| V18 | **V20** | pásma noriem ako pole na type poznámky (`ramec`, `prierezove`, `hranicne`) | hotové |
| V19 | **V21** | jedna poznámka žije na jednom mieste; inde je čip | hotové |
| V20 | **V22** | tri odvodené údaje pre inšpektor (pôvod hodnoty · dopadajúce pravidlá · dopad zmeny) | hotové |

Prečíslovanie: `V17`/`V18` už niesli úlohy UC a `aliases` (SCHEMA v1.3). Odkazy typu „V20.1" zo zadania = „V22.1" v repe (QUESTIONS Q17).

### §3 Terminológia v UI (záväzná, tri mená pre tú istú vec)
| V kóde a cestách | V UI (ľavý panel) | V exporte do zmluvy |
|---|---|---|
| `GOAL` | Ciele | Ciele |
| `UC` | Účely užitia | Účely užitia |
| `EV` | Spúšťacie udalosti | Udalosti |
| `ER` | Výmeny | Požiadavky na výmenu |
| `IU-O` | Objekty | LOIN — typy objektov |
| `IU-C` | Kontajnery | LOIN — kontajnery |
| `STD`, `GEO` | Pravidlá a konvencie | **Informačný štandard** (19650-2 5.1.4) |
| `DEF` | Definície | Definície a meracie pravidlá |
| `ACT` | Aktéri | Aktéri |

Popisky sú v jednom mieste v kóde (mapa typ → popisok), nie roztrúsené po komponentoch.
→ `POPISOK` / `POPISOK_EXPORT` na modeli typu, `assetin/schema/pasma.py`.

### §4 Rozloženie
Tri stĺpce: navigácia · obsah · inšpektor.

**§4.1 Ľavý panel** — plochý zoznam, žiadne sekcie podľa vrstiev. Hlavička `KNIŽNICA` (11 px, muted) + `zadanie/ · N poznámok` (10 px, mono, muted). *(Dodatok 17. 9., kolo 7: hlavička nesie aj prepínač režimu `Detail | Reťazce`; samotný zoznam pod ňou ostáva plochý s dvoma oddeľovačmi — U21 mení §4.1 na Samuelovu žiadosť, U8 ostáva.)* Položky s ikonou (Tabler outline, 14 px) a počtom vpravo:
`ti-target` Ciele · `ti-route` Účely užitia · `ti-bolt` Spúšťacie udalosti · `ti-arrows-exchange` Výmeny · `ti-box` Objekty · `ti-file` Kontajnery · `ti-ruler` Pravidlá a konvencie · `ti-ruler-measure` Definície · `ti-users` Aktéri.
Aktívna položka `background: var(--bg-accent)`, `color: var(--text-accent)`, `border-radius: var(--radius)`.
Pod deliacou čiarou (`0.5px solid var(--border)`): `ti-stethoscope` Diagnostika + počet varovaní vo `var(--text-warning)` · `ti-search` Hľadať + `⌘K`.

**§4.2 Stredný stĺpec — štyri otázky.** Nad obsahom cesta v modeli (11 px, mono, muted). Každé pásmo: veľký nadpis = otázka (16 px/500), pod ním technický riadok (11 px, mono, muted). Vizuál: `border-left: 3px solid <farba>`, ostatné strany `0.5px solid var(--border)`, `border-radius: 0`, `background: var(--surface-2)`, padding `8px 12px`, medzera `6px`.

| # | Otázka | Technický riadok | Farba okraja |
|---|---|---|---|
| 1 | Prečo? | `19650-1 · cieľ` | `#7F77DD` |
| 2 | Kto a kedy? | `29481 · účel užitia, spúšťacia udalosť, výmena` | `#1D9E75` |
| 3 | Čo a ako podrobne? | `7817 · <IFC entita> · N položiek` | `#D85A30` |
| 4 | Pre koho a dokedy? | — | žiadny okraj, šev |

Pásmo 3 nesie tabuľku položiek: `table-layout: fixed`, 12 px, **Položka 38 % · Povinnosť 26 % · Odkiaľ 36 %** *(kolo 3 §4.2: 38 · 22 · 40)*, hlavička 11 px muted 400, riadky `border-top: 0.5px`, padding `6px 0`. Stĺpec **Odkiaľ** je pôvod hodnoty (V22.1). Prepísaný riadok má `background: var(--bg-accent)` a v stĺpci Odkiaľ pill.

Pásmo 4 nie je karta — je to šev: `border-top: 0.5px dashed var(--border-strong)`, `margin-top: 10px`, `padding-top: 8px`, vľavo „Pre koho a dokedy?" (13 px, muted), vpravo „knižnica tu končí — dopĺňa poverenie" (11 px, muted). V knižnici vždy prázdne; v projektovom pohľade sa **ten istý komponent naplní**.

Štandard v strednom stĺpci nie je — nie je odpoveďou na žiadnu zo štyroch otázok.

**§4.3 Inšpektor.** `background: var(--surface-2)`, `border: 0.5px solid var(--border)`, `border-radius: 12px`, padding 10 px. Štyri bloky oddelené `border-top: 0.5px`, nadpisy 11 px muted verzálky:
1. `PÔVOD HODNOTY` — názov položky (12 px) + veta o prepise (11 px), pôvodná hodnota preškrtnutá alebo „optional v knižnici → **required** pre túto výmenu";
2. `PRAVIDLÁ, KTORÉ NA TO DOPADAJÚ` — `STD-id` + dôvod, **len na čítanie**, klik naviguje;
3. `ODKAZUJE SEM` + počet;
4. `AK ZMENÍM` — jedna veta vo `var(--text-warning)`.

### §5 Vizuálne tokeny (dodrž presne)
- Farby len cez premenné `--surface-1/2`, `--text-primary/secondary/muted`, `--border`, `--border-strong`, `--bg-accent`, `--text-accent`, `--text-warning`. Žiadny hex okrem troch farieb pásiem. *(V repe sú tieto mená alias vrstva nad `--ds-*` tokenmi kitu — QUESTIONS Q20.)*
- Musí fungovať v tmavom režime.
- Typografia: nadpis otázky 16 px/500; obsah 12–13 px; technické riadky a popisky 11 px; cesty a ID mono. **Nikdy pod 11 px.** Iba váhy 400 a 500.
- Vety a popisky **sentence case** (okrem nadpisov blokov inšpektora).
- Okraje vždy `0.5px`; zaoblenie `var(--radius)` pre ovládacie prvky, `12px` pre karty, `0` pri jednostrannom okraji.
- Ikony: Tabler **outline**, nikdy `-filled`; dekoratívne `aria-hidden="true"`.
- Žiadne gradienty, tiene, emoji.

### §6 Poradie práce (kolo 1)
1. `ramec`, `prierezove`, `hranicne` do schémy + validátor → 2. odvodené výpočty → 3. ľavý panel + tabuľkové registre → 4. pohľad štyroch otázok → 5. inšpektor.
Tabuľka registra je to, kvôli čomu appka vzniká — nepodceň ju.

---

## Kolo 2 (opravy po prvom výstupe)

### §1 Zápis do MD (najvyššia priorita)
Bez zápisu je to prehliadač, nie editor. Writer podľa `CLAUDE.md` §7: zápis do toho istého MD, zachovaná próza, poradie sekcií, `#` komentáre aj HTML komentáre; round-trip test pre každý typ poznámky.
→ hotové: `assetin/engine/zapis.py` + `assetin/server/` + `assetin edit`; testy `tests/test_zapis.py`, `tests/test_server.py`.

### §2 Pásma nie sú zoskupenie susedov, ale kaskáda
`GOAL → UC → task → ER → IU-O/IU-C`, kde **každý krok zužuje ten predošlý**.
- `IU-C` sa nesmie objaviť dvakrát — `hranicne` znamená „sedí na deliacej čiare", kreslí sa **raz**, v spodnom pásme, s poznámkou o dvojitej príslušnosti.
- **Kotva kaskády je vždy účel užitia**; pri EV, IU-O alebo STD sa cesta dopočíta hore k UC a dole k IU. Viac ciest ⇒ prepínač, nie všetky naraz.
- Visiaci odkaz musí byť viditeľne iný: prerušovaný okraj, kurzíva, popisok „poznámka zatiaľ neexistuje".
→ hotové: `assetin/engine/retazec.py`, `tests/test_retazec.py`.

### §3 Dva pohľady
- **Pohľad poznámky** (klik na riadok): úzky pruh „kde to sedí" s cestou `GOAL-A-01 › UC-0101 › T3 › ER-0101 › táto poznámka`, pod ním generický formulár zo schémy, vpravo inšpektor. **Žiadne pásma.**
- **Pohľad reťazca** (z účelu užitia alebo z pruhu): štyri pásma ako kaskáda; v pásme „Čo a ako podrobne?" **tabuľka Položka · Povinnosť · Odkiaľ**, nie čipy.
→ hotové.

### §4 Tabuľka registra
- Predvolená zostava stĺpcov **na definícii typu v schéme**, zvyšok za prepínačom stĺpcov (`STLPCE`).
- Prvý stĺpec (id) prilepený pri vodorovnom posune.
- Slovenské množné číslo: `1 poznámka`, `2 poznámky`, `5 poznámok`.
- Klik na riadok otvorí pohľad poznámky; klik na bunku edituje.
- Hromadná zmena cez zaškrtávacie políčka.
→ hotové.

### §5 Inšpektor
- Prázdne stavy podľa typu (EV: ktoré UC a ER spúšťa; ACT: v akej role vystupuje).
- Dopad počítať tranzitívne cez `zapnute`, `pravidlo`, `hodnoty_ref`, `definicia_ref`, `obsahuje`, `spustacia_udalost` — panel si nesmie protirečiť s „odkazuje sem".
- Text v prázdnom paneli vľavo, nie na stred.
→ hotové; zoznam polí rozšírený o `uc`, `pre_task`, `profil` (QUESTIONS Q23).

### §6 Formulár „Celá poznámka"
Prázdne voliteľné polia zbaliť do „zobraziť ďalších N nevyplnených polí"; `id` a `typ` len na čítanie; popisky zo schémy ako drobný text **pod poľom**, nie ako blok vedľa názvu.
→ hotové.

### §7 Ľavý panel
Popisky sa nesmú orezávať — rozšíriť panel alebo zalomiť na dva riadky.
→ hotové (190 px + zalomenie).

---

## Kolo 3 (navigácia, záložky, zvislý reťazec — 2026-09-11)

Kaskáda, tabuľka položiek so stĺpcom Odkiaľ, inšpektor s dôvodmi, visiace odkazy kurzívou a tabuľka registra
ostávajú. Kolo mení **tok medzi obrazovkami** a **rozloženie pásiem 2–3**; §3–§5 kola 1 sa nemenia.
Vzory: master–detail ako Linear/Jira, záložky na detaile ako GitHub PR, inšpektor ako Figma/Linear,
kontextový pruh ako parent-issue v Lineari.

### §1 Tok medzi obrazovkami
Štyri úrovne granularity a žiadna piata: bunka (tabuľka registra) · poznámka (záložka **Poznámka**) ·
reťazec (záložka **Reťazec**) · inšpektor (pravý panel). Klik na register → tabuľka; klik na riadok →
stránka poznámky na celú šírku stredu, späť cez drobčeky. Tlačidlo „štyri otázky →" z tabuľky zrušené.
Predvolená záložka je **vždy Poznámka**.
→ hotové. Každá obrazovka má adresu v hashi (`#/registre/UC`, `#/IU-O-space`, `#/IU-O-space/retazec`,
`#/STD-clenenie/pod/STD-CL-04`), tlačidlo späť prehliadača funguje (QUESTIONS Q25).

### §2 Stránka poznámky
Drobčeky · nadpis, pod ním ID + cesta k súboru (mono muted) · **pruh „kde to sedí"** (jeden riadok, 12 px,
`GOAL-A-01 › UC-0101 › T3 › ER-0101 › táto poznámka`; segmenty sú odkazy, visiaci kurzívou s prerušovaným
okrajom, ikona `ti-route` otvorí Reťazec, viac ciest ⇒ „+1 ďalšia" ako prepínač) · záložky `Poznámka | Reťazec` · obsah.
Záložka Poznámka = generický formulár zo schémy, pri IU-O tabuľka položiek ako editovateľná vnorená tabuľka,
telo poznámky pod tým. Záložka Reťazec = štyri pásma, kotvené na účel užitia, poznámka v ohnisku; pri UC sú jednotky zbalené.
→ hotové: pruh počíta `retazec.cesta_pre` (roly cieľ · účel · úloha · výmena, končí pri vlastnom kroku);
každý `zoznam-objektov` je vnorená tabuľka (QUESTIONS Q27); próza tela sa ukazuje len na čítanie (Q28).

### §3 Ľavý panel — dva oddeľovače, nič viac
`Ciele` | `Účely užitia · Spúšťacie udalosti · Výmeny · Objekty · Kontajnery` | `Pravidlá a konvencie · Definície · Aktéri` | `Diagnostika · Hľadať`.
Oddeľovače `border-top: 0.5px solid var(--border)`, odvodené z `ramec`; bez nadpisov skupín, bez obalov, bez farieb.
→ hotové: skupiny počíta `pasma.skupiny_panela()` (`19650-1` | `29481` + `7817` | prierezové | projektová vrstva),
stránka ich číta z `pasma.skupiny`; panel 200 px, popisky sa neorezávajú.

### §4 Pásma 2 a 3 — zvislý strom namiesto vodorovných čipov
**4.1 „Kto a kedy?"** — každý krok je riadok na plnú šírku (ID mono pevná šírka · celý názov · poznámka vpravo 11 px muted),
nadväznosť odsadením 16 px na úroveň: `EV-I-0007 spúšťa › UC-0101 účel užitia › T2 ARCH › ER-0101 pri EV-D-0012 · príjemca poverujuca`.
Delivery udalosť nie je vlastný riadok. Viac úloh alebo výmen = súrodenci. Technický riadok `29481 · spúšťacia udalosť → účel užitia → úloha → výmena`.
→ hotové; od 11. 9. je to **dátová štruktúra, nie vykreslenie** (DECISIONS V23): `Retazec` je strom per účel užitia, výmena je dieťa účelu (MODEL §5, U9) a stránka kreslí tvar, aký dostane — `z úloh T2, T3, T4, T5, T6 · pri EV-D-0012 · príjemca poverujuca` pri výmene, všetky úlohy UC ako súrodenci nad ňou.

**4.2 „Čo a ako podrobne?"** — čipy zrušené; jednotky pod sebou v tom istom riadkovom vzore (vpravo počet položiek alebo formát).
Rozbalená je iba jednotka v ohnisku (`--bg-accent`, ID `--text-accent`, tabuľka Položka · Povinnosť · Odkiaľ 38 · 22 · 40 % odsadená 16 px);
klik na inú jednotku prepne ohnisko a URL. Prepísaná hodnota: pôvodná preškrtnutá muted, nová vedľa; v Odkiaľ pill `prepis ER-0101`.
Kontajnery za `border-top: 0.5px dashed var(--border-strong)` s popiskom `kontajnery · na hranici 29481 / 7817` — `hranicne` znamená toto, nie dvakrát.
Technický riadok `7817 · N jednotiek v ER-0101`.
→ hotové; formát kontajnera je `technicky` pole (`Forma.format`).
→ **prerušovaná čiara zrušená 14. 9. (U18)**: po PAS 6.3.2 je jednotka jednotka a LOIN je spôsob jej vyjadrenia, šev do obrázka nepatrí. Pásmo 3 kreslí výmenu ako kartu, v nej kontajnery a pod nimi objekty — viď „Kolo 5" nižšie.

**Kolo 4 (13. 9., Q45/V26):** ER je teraz hraničný typ ako kontajner — `HRANICNE = ["29481", "7817"]`,
bezpodmienečne, lebo LOIN-02 §5 píše `ER{IU + LOIN + constraints}` a 29481-3 robí z `informationUnit`
dieťa `er`. Dôsledok pre §4.2: hlavička výmeny (ER-riadok s počtom jednotiek) sa teraz kreslí **vždy**
na vrchu pásma 3, nielen keď má účel viac než jednu výmenu — dôvod nie je počet, ale to, že ER je
hraničný typ. Oba výskyty ER-riadka (koniec pásma 2, vrch pásma 3) aj oba kontajnerové riadky nesú
rovnaký vizuálny príznak: `border-left: 2px double var(--border-strong)` (`.riadok-kroku.hranicne`),
tá istá rodina ako `.cip.hranicne`. Strom (V23), `PASMO_ROLY` a domovské pásmo ER (`29481`) sa nemenia.

**4.3 „Prečo?" a šev** — bez zmeny. → nezmenené.

### §5 Inšpektor
Zbaliteľný (`ti-layout-sidebar-right-collapse`), stav si pamätá; pri tabuľke registra predvolene zbalený, pri poznámke rozbalený.
Prázdne stavy hovoria: UC → pravidlá agregované cez jeho výmeny s dôvodom; EV → čo spúšťa; ACT → v akej roli; GOAL → ktoré UC ho podporujú.
Text zarovnaný vľavo. Tooltip „Krok späť" nesmie prekrývať panel.
→ hotové: `inspektor.prazdny_stav` + `inspektor.pravidla_uc`; stránka prázdne stavy nerozhoduje podľa typu.
Prepínač inšpektora nemá `title` (natívny tooltip by panel prekryl); nič s názvom „Krok späť" v kóde nebolo (Q26).

### §6 Drobnosti
Množné číslo `1 poznámka · 2–4 poznámky · 0 a 5+ poznámok` (rovnako položka, jednotka, výmena, stĺpec) v stránke aj v engine.
Writer a round-trip testy boli hotové pred týmto kolom.
→ hotové.


## Kolo 4 — hustota a prehľadnosť stránky poznámky (13. 9. 2026, QUESTIONS Q44)

Samuelov nález nad ER-0101: „moc je to rozbité a neprehľadné", po prvom (príliš opatrnom) pokuse: „nič sa nezmenilo, stále tam sú aj `##`". Druhé kolo úprav je preto skutočná zmena hustoty, nie kozmetika. Tokeny §5 sa nemenia; mení sa rozloženie formulára, a to so Samuelovým vedomím:

1. **Sekcia je karta.** Nadpis v pruhu (`surface-2`) s menom sekcie vľavo a počtom polí vpravo; obsah v ráme. Nositeľ poľa (`inline` / `blok` / `frontmatter`) a značka `## <sekcia>` sú v `title` nadpisu — **na obrazovke nie sú**, lebo pre čitateľa nič neznamenajú.
2. **Krátke polia stoja dve vedľa seba** (grid `repeat(2, 1fr)`, pod 1180 px sa zloží do jedného stĺpca). Celý riadok si berie len to, čo ho potrebuje: vnorená tabuľka, vnorený objekt, únia, dlhý text a zoznam odkazov s viac než tromi čipmi. Stránka ER-0101 je tým o tretinu kratšia.
3. **Meno poľa je ľudské.** Nadpisom riadka je titulok zo schémy, technický kľúč je pod ním drobným bledým mono. Doteraz to bolo naopak a každý riadok začínal `poskytovatel_predvoleny`.
4. **Návod pod hodnotou je len tam, kde treba** — pri prázdnom poli alebo poli s nálezom. Pri vyplnenom poli je celý text v `title` menovky, takže riadok je jeden, nie tri.
5. **Vo vnorenej tabuľke sa zhrnutie počíta len z polí bez vlastného stĺpca**; keď nezostane nič, stĺpec „položka" nevznikne (v `prepisy` opakoval `IU` a `Položka`).

Čo sa **nezmenilo a bez Samuela nezmení**: poradie polí (je zo schémy), to, že stĺpce, menovky aj popisy pochádzajú zo schémy, a register — ten ostáva na celú šírku.


## Kolo 5 — prestavba reťazca (zadanie „kolo 4" zo 14. 9. 2026, DECISIONS U17, U18)

Číslo kola: zadanie ho volá „kolo 4", ale to číslo už niesla hustota stránky poznámky (13. 9.) — tu je preto **kolo 5**, rovnako ako V24/V25 zo zadania sú v repe V26/V27 (DECISIONS Z5). Kontrakt §3 (terminológia), §4 (rozloženie) a §5 (tokeny) z kola 1 sa nemení; mení sa vnútro záložky Reťazec, a to na Samuelovo zadanie.

**Prečo:** výmena vyzerala ako deviata úloha, úlohy dodania a prevzatia boli premiešané a pásmo 3 bol plochý zoznam mien bez toho, čo výmenu definuje, a bez priradenia.

1. **Pásma sa oddelili** — medzera 14 px (bolo 6). Farebný pruh sám nestačil; štyri otázky pôsobili ako jeden súvislý zoznam.
2. **Pásmo „Kto a kedy?"** — udalosť, pod ňou účel, pod ním úlohy v dvoch skupinách: `DODANIE — 6 úloh` a `POUŽITIE A PREVZATIE — 2 úlohy` (11 px muted, veľké písmená; delenie podľa `ulohy[].typ`, PAS 6.2.1). Popisok skupiny je na type poznámky (`POPISKY_TYPU_ULOHY`), nie v stránke. Vnorenie nesie **zvislá čiara** `0.5px solid var(--border-strong)` s odsadením 18 px. **Výmena tu už nie je.** Technický riadok `29481 · PAS 6.1.3 — …`.
3. **Pásmo „Čo a ako podrobne?"** — *(kolo 6 zrušilo kartu aj samostatné pásmo — viď nižšie; ostáva obsah rozbalenia)* výmena je **rámovaná karta** (`0.5px solid var(--border-strong)`, `var(--radius)`): prvý riadok ID + názov, druhý `pri EV-D-0012 · príjemca poverujuca · z úloh T2–T6 · IFC4X3_ADD2` (a MVD, keď ho kontajnery nesú). Vnútri kontajnery ako uzly (vpravo formát · poskytovateľ), pod každým objekty, ktoré priraďuje, s **rozsahom aspektov** vpravo (`GEO-G2 · 7 položiek · geometria+alfanumerika`). Ten istý objekt pod dvoma kontajnermi je správne — rozbalí sa raz, v prvom, ktorý ho nesie. Technický riadok `7817 · PAS 6.3.2 — výmena je kolekcia jednotiek · N jednotiek v ER-0101`.
4. **Tri prostriedky pre tri väzby sa nemiešajú:** postupnosť = zvislá čiara s odsadením · čas = míľnik v riadku výmeny · vecná príslušnosť = vnorenie kontajner → objekt.
5. **Viac výmen** = súrodenecké karty pod sebou, každá s vlastným míľnikom a príjemcom. Žiadne záložky.
6. **Drobnosť:** pásmo „Prečo?" bez cieľa chýbajúci cieľ **menuje** („cieľ GOAL-A-01 v knižnici zatiaľ nie je"), lebo `zadanie/GOAL/` v repe nie je (QUESTIONS Q45).


## Kolo 6 — výmena ako predel v línii (zadanie „kolo 5" zo 14. 9. 2026, DECISIONS U19, U20)

Číslovanie ako vždy: zadanie ho volá „kolo 5" a rozhodnutia U15/U16, v repe je to **kolo 6** a **U19/U20** (Z5). Kontrakt §3–§5 kola 1 sa nemení. Toto **nahrádza §3.2 a §3.3 kola 5**; všetko ostatné z neho (14 px medzery, tri prostriedky pre tri druhy väzby, rozsah aspektov) platí.

**Prečo:** výmena je *moment v procese* (PAS 6.1.3, 19650-4) — stojí medzi úlohami, ktoré informáciu vyrábajú, a tými, ktoré ju používajú. Ako karta vo vlastnom pásme vystupovala na obrazovke dvakrát: raz ako moment, raz ako špecifikácia.

1. **Predel.** Riadok výmeny je vodorovný predel cez celú šírku pásma „Kto a kedy?" (`border-top` + `border-bottom` `0.5px solid var(--border-strong)`, výplň `var(--surface-1)`, 13 px): `míľnik · ID výmeny · → príjemca · N kontajnerov · šípka`. Nad ním úlohy dodania, pod ním úlohy použitia a prevzatia — **podnadpisy skupín sa rušia**, predel ich nahrádza.
2. **Rozbalenie.** Pod predelom je odpoveď „Čo a ako podrobne?": nadpis pásma (16 px / 500), technický riadok `7817 · PAS 6.3.2 — výmena je kolekcia jednotiek · N jednotiek`, farba pásma ako 3 px pruh vľavo (`var(--pasmo-co)` — koralová, token, nie literál), kontajnery a pod nimi objekty s rozsahom aspektov, jednotka v ohnisku rozbalená do tabuľky Položka · Povinnosť · Odkiaľ.
3. **Predvoľba a adresa.** Ohnisko na jednotke, kontajneri alebo výmene → rozbalené; ohnisko na účele alebo udalosti → zbalené. Stav je v adrese: `#/IU-O-space/retazec?v=ER-0101` (prázdne `?v=` = nič rozbalené), takže poslaný odkaz sa otvorí rovnako.
4. **Viac výmen** = viac predelov v poradí míľnika; úlohy sa priradia k predelu cez `z_uloh`, úloha bez výmeny si drží stranu podľa `typ_ulohy`.
5. **Tri úrovne hĺbky** (U20): línia → rozbalenie → stránka. Klik na ID vždy otvorí stránku, nikdy needituje v línii.
6. **`používa aj UC-…`** — tenký odkazový riadok pod poslednými úlohami, keď si výmenu berie ako vstup iný účel užitia (`precondition`, `referencne_info`, `pre_task`). Vo vzore je zatiaľ prázdny; objaví sa sám, keď UC-0201 pribudne.
---

## Kolo 7 — perspektíva `Detail | Reťazce` a rozbaľovanie uzlov (2026-09-17/19)

Samuel: „to rozdelenie reťazec a poznámka by sme mali rozdeliť už niekde rovno nad menu… ide mi
o to jasne rozlíšiť, koľko máme reťazcov (ale asi nevytvárať novú kategóriu, iba náhľad)".
Rozhodnutie je **U21**, ktoré v tejto časti **ruší U10**; odôvodnenie a päť viet sú v QUESTIONS Q55.
Graf sa toho kola netýka — **Q34 ostáva otvorená**.

### §1 Prepínač
V hlavičke ľavého panela (nad zoznamom) segment `Detail | Reťazce`, `role="tablist"`,
`aria-selected` na aktívnom. Pri `Reťazce` stojí **počet reťazcov** — to je odpoveď na „koľko ich
máme"; je to ten istý počet ako účelov užitia (V23), preto nevzniká register ani nový typ poznámky.
Režim je vidno **troma spôsobmi naraz** (NN/g: skrytý režim plodí chyby): stav segmentu, obsah
panela a adresa.

### §2 Čo robí ktorý režim
- **Detail** — panel ako doteraz (registre, pod čiarou Diagnostika · Hľadať); klik na riadok
  registra otvorí **len** detail. Stránka poznámky **nemá záložky** a volá sa *Detail*; do reťazca
  vedie ikona `ti-route` v pruhu „kde to sedí".
- **Reťazce** — panel vymení registre za zoznam reťazcov: riadok = jeden strom, nadpis je názov
  účelu užitia, pod ním mono `UC-0101 · 8 úloh · 1 výmena · 3 jednotky · 2 kontajnery`, vpravo
  počet visiacich odkazov vo `var(--text-warning)`. Diagnostika a Hľadať ostávajú v oboch režimoch.

### §3 Adresy
```
#/registre/<TYP>   #/<ID>[?c=<n>]   #/<ID>/pod/<PODID>   #/diagnostika   #/zmeny
#/retazce          #/retazce/<UC>   #/retazce/<UC>?u=<ID v ohnisku>
staré: #/<ID>/retazec[?r=N] → #/retazce/<UC>?u=<ID>   (replaceState, Q25 odkazy nezanikajú)
```
Uzol je v dotaze, nie v ceste: ID aktérov nesú `/` a kotvy úloh `#`. `?c=` je cesta zvolená
v pruhu „kde to sedí" — dovtedy to bol ten istý index ako výber reťazca, čo boli dve veci naraz.

### §4 Klik v reťazci
Klik na uzol (pásmo 2 aj 3) iba **zaostrí** — obrazovka ostáva, adresa dostane `?u=` cez
`replaceState`, takže späť chodí po obrazovkách, nie po kliknutiach. Detail zaostreného uzla
povie **inšpektor**; žiadna nová obrazovka nevzniká.

### §5 Čo sa nemení
Štyri otázky a ich poradie (U3), kotva reťazca = účel užitia (V23), štyri úrovne granularity
(MODEL §9 — režim je vstupný bod, nie piata úroveň), tokeny §5, terminológia §3 (premenúva sa
**obrazovka** na *Detail*, modelové slovo **poznámka** ostáva), plochý zoznam registrov (U8).

---

### Rozbaľovanie uzlov (19. 9.)

Samuel: „keď na niečo kliknem, nemalo by ma to hneď prekliknúť na detail, ale skôr rozrolovať to
najprv ešte v tom reťazcovom zobrazení." Rozhodnutie je **U22**, ktoré **ruší U12**; päť viet a
laický rozbor sú v QUESTIONS Q56.

### §1 Šípka je afordancia
Každý rozbaliteľný uzol (pásmo 2 aj 3, vrátane úloh) má vľavo `ti-chevron-right`, ktorá sa pri
otvorení otočí (`.sipka.otvorena`), `aria-expanded` a hover na celom riadku. Bez nej riadok
vyzeral ako text — klik menil iba pravý panel, teda miesto, kam sa človek nepozerá.

### §2 Karta uzla
Pod riadkom `div.uzol-telo`, odsadené o úroveň:
- hlavička: odznak nálezov + `otvoriť detail →` (jediná cesta na obrazovku Detail),
- **poznámka** → celý generický formulár zo schémy (`skupinyPoli`), ten istý ako na Detaile;
- **jednotka s LOIN** → najprv aspekty (Q54), potom zvyšok formulára **bez** tých polí;
- **úloha** → záznam zo zoznamu objektov svojho účelu; pole sa hľadá **podľa dát** (záznam s tým
  `id`), nie podľa mena — stránka nesmie vedieť, že úlohy bývajú v `ulohy` (zásada 3).

### §3 Viacero naraz
Stav drží `OTVORENE` (ten istý vzor ako vnorená tabuľka). `STAV.ohnisko` a `?u=` ostávajú a
znamenajú „uzol, na ktorý ukazuje odkaz" — ten sa pri príchode rozbalí sám. Odkazom sa prenesie
jeden rozbalený uzol, nie všetky; to je prijatá cena za viacero naraz.

### §4 Laické nálezy vybavené pri tom
Šípka (§1) · počet visiacich odkazov ide v paneli **slovom** do podriadku, nie ako holé číslo
(v režime Detail to isté miesto znamená počet poznámok) · `T`/`D` kódy vysvetľuje karta úlohy
(`typ: delivery | utilization`) · orezané „…" ostáva len na zbalenom riadku, karta ukazuje celé
hodnoty · podnadpis obrazovky reťazca prestal opakovať počty z panela (`UC-0101 · súbor`).

### §5 Čo sa nemení
Štyri otázky, kotva reťazca, štyri úrovne granularity, tokeny §5, terminológia §3, plochý panel.
**Dôsledok, ktorý treba vedieť:** karta je ten istý *editovateľný* formulár, takže v reťazci sa dá
aj písať — `skupinyPoli` režim len na čítanie nemá.
