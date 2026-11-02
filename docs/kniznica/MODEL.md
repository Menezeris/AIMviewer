# MODEL.md — konceptuálny model knižnice

Povinné čítanie pred každou zmenou schémy, enginu alebo UI. Toto je *prečo*; SCHEMA-v1.md je *čo*; DECISIONS.md je *kedy a kto rozhodol*. Ak kód a tento dokument nesúhlasia, má pravdu tento dokument a kód je chyba — alebo sa najprv zmení dokument, cez Samuela.

---

## 1. Čo knižnica je

Knižnica je **katalóg definícií** toho, aké informácie o stavbe kto komu odovzdáva, kedy, v akej podrobnosti a podľa akých pravidiel. Je organizačná: platí pre všetky budovy a všetky zákazky Assetinu. Nie je to zoznam úloh ani projektový plán — je to zásoba stavebných dielov, z ktorých sa pri konkrétnom poverení zostaví EIR.

Z knižnice sa **generuje**: IDS súbory (strojové overenie IFC), ISO 7817-3 Specification, EIR ako PDF do zmluvy, MIDP/TIDP, RACI, akceptačné checklisty. Nič z toho sa nepíše ručne. Ak niečo nejde vygenerovať, chýba to v knižnici, nie vo výstupe.

## 2. Jedna informácia, jeden nositeľ

Najdôležitejšie pravidlo celého systému. Každá informácia žije presne na jednom mieste:

| Kto nesie | Čo |
|---|---|
| **model (DiMS)** | objekty stavby a ich vlastnosti — miestnosti, plochy, podlažia, zóny, zariadenia |
| **CDE** | kontajnery (súbory) a ich metadáta — status, revízia, kto nahral |
| **AIM / CAFM** | prevádzka — nájomcovia, zmluvy, poruchy, osoby |
| **knižnica** | požiadavky a odkazy — čo sa má odovzdať a podľa čoho sa to overí |

Z toho plynú konkrétne zákazy, ktoré sa opakovane porušujú:
- Tabuľka miestností s plochami **nie je** samostatný kontajner — miestnosti sú v modeli, tabuľka je export z neho. Protokol zamerania je podpis geodeta *pod tým exportom*, nie druhá kópia dát.
- Názov nájomcu **nepatrí** do `IfcZone.LongName` — nájomca je v registri nájmov. Model nesie len stabilný kód jednotky.
- Zoznam podlaží s výškami **sa neudržiava** v štandarde ručne — master je architektonický model, ostatné DiMS sa overujú voči nemu.
- Slovník (typy zón, kódy CCI) **sa neopisuje** do pravidiel ani položiek — žije v `STD-klasifikacia`, ostatné naň odkazujú.
- Register skutočných kontajnerov a história udalostí aktíva **nie sú** poznámky v knižnici — sú to pohľady do CDE/AIM.

Ak sa niekde objaví pohodlný duplikát, je to chyba, aj keď je pohodlný.

## 3. Definícia vs. dosadenie

Knižnica obsahuje **definície**. Poverenie (projekt) obsahuje **dosadenia**.

- „Získať stavebné povolenie" je definícia projektového cieľa → knižnica.
- „Získať stavebné povolenie pre Budovu X do 30. 6. 2027" je dosadenie → poverenie.
- Udalosť „odovzdanie priestorového modelu" je definícia; jej dátum je dosadenie.
- Funkcia „koordinátor BIM poverujúcej strany" je definícia; meno osoby je dosadenie.

Preto sú v knižnici zakázané `termin`, `aktivum`, `osoby`, `zmluvne_oznacenie`, `EV.datum` a celý typ `PROJ` — nie preto, že sú „projektové", ale preto, že sú *konkrétne*. Úroveň cieľa (`uroven: projekt`) zakázaná nie je; je to druh cieľa.

Dôsledok pre UI: v knižnici je pásmo „Pre koho a dokedy?" vždy prázdne. Nie je to chyba ani nevyplnené pole — je to šev, kde knižnica končí. Ten istý komponent sa v pohľade poverenia naplní.

## 4. Kaskáda štyroch otázok

Celá knižnica sa dá čítať ako štyri otázky, kde každá odpoveď zužuje ďalšiu. Toto je jediná „línia" v modeli; všetko ostatné sú buď prierezové vrstvy, alebo susedstvá.

| Otázka | Norma | Typy | Čo odpovedá |
|---|---|---|---|
| **Prečo?** | ISO 19650-1 | GOAL | prečo organizácia/aktívum/projekt informáciu chce |
| **Kto a kedy?** | ISO 29481 (IDM) | UC, EV, ER | v akom scenári, pri akej udalosti, kto komu čo vymieňa |
| **Čo a ako podrobne?** | ISO 7817 (LOIN) | IU-C, IU-O | ktoré kontajnery sa odovzdajú a ktoré objekty nesú, s akými položkami, geometriou, dokumentáciou |
| **Pre koho a dokedy?** | ISO 19650-2 (EIR) | PROJ | konkrétne strany, dátumy, vybrané výmeny — *mimo knižnice* |

Presne toto je pohľad „Reťazec" v editore. Kotva reťazca je vždy účel užitia.

**Čo do kaskády nepatrí, hoci to láka:**
- **Informačný štandard** (STD, DEF, GEO) nie je krok. Je to „podľa čoho", platí naprieč všetkými štyrmi otázkami. V UI je v inšpektore ako „pravidlá, ktoré na to dopadajú", s dôvodom pri každom (vždy / zapnuté v ER / z položky). Nikdy ako piate pásmo.
- **Aktéri** nie sú krok. Sú organizačná os (strana → tím → funkcia), na ktorú sa viažu transakčné roly (`poskytovatel`, `prijemca`, `overuje`) — a tie sedia na IU a ER, nie v registri aktérov.

## 5. Ako presne visí strom „Kto a kedy?"

Toto sa pokazilo dvakrát, preto explicitne:

```
EV-I-0007  (impact udalosť)          — spúšťa účel užitia; stojí NAD ním
  UC-0101  (účel užitia)
    T1…T6   (úlohy dodania)          — deti účelu, súrodenci medzi sebou
    D1, D2  (úlohy použitia a prevzatia)
    ER-0101  (výmena)                — dieťa ÚČELU, nie úlohy; pri nej: pri EV-D-0012 · príjemca · z úloh T2–T6
      IU-C-arch-model  (kontajner)   — dieťa výmeny cez `obsahuje`
        IU-O-space     (objekt)      — dieťa kontajnera cez priradenie, s rozsahom aspektov LOIN
```

- Impact udalosť **predchádza** účel (PAS 6.1.3: trigger event → use case).
- **Výmena je moment v procese**, nie len balík obsahu (PAS 6.1.3, 19650-4): stojí presne medzi úlohami, ktoré informáciu vyrábajú, a tými, ktoré ju používajú. Preto je v pohľade Reťazec **predelom v línii** a odpoveď „Čo a ako podrobne?" sa rozbalí pod ňou (U19) — na obrazovke je raz, nie dvakrát.
- Úlohy účelu sa delia na **dodanie** a **použitie a prevzatie** (PAS 6.2.1, `ulohy[].typ`); sumár za poskytovateľov nesie `typ_ulohy` (V6).
- Delivery udalosť **patrí k výmene** — nie je to krok; zobrazuje sa ako poznámka pri ER, nie ako riadok.
- Výmena je **UC × delivery udalosť × príjemca**. Úlohy do nej prispievajú cez `pre_task` na jednotkách. Výmena preto nikdy nevisí pod jednou úlohou.
- **[V27]** Výmena nesie **kontajnery** (`ER.obsahuje`); objekty visia pod kontajnerom, ktorý ich priraďuje (`IU-C.obsahuje[] = {iu, rozsah}`). Kontajner a objekt sú dve osi spojené priradením, nie strom „kontajner nad objektom" (PAS 6.3.2.1, 7.1.2/7.1.3; LOIN-05 §11.1). `rozsah` zužuje priradenie na zložky LOIN — tá istá miestnosť je v modeli (geometria + alfanumerika) aj v protokole zamerania (len dokumentácia).
- Jedna jednotka môže byť vo viacerých výmenách aj v dvoch kontajneroch jednej výmeny — preto sa nikdy nerozbaľuje „na mieste" dvakrát, len sa na ňu odkazuje (V21).

## 6. Čo každý typ je a nie je

**GOAL** — prečo. Metrika organizácie, nie modelu („rozdiel zmluvnej a zameranej plochy < 1 %", nie „model má 100 % IfcSpace"). Nižšia úroveň prispieva k vyššej. Nie je to BIM cieľ; BIM je prostriedok.

**UC** — scenár: sled úloh rolí za účelom. *Use* = použitie procesu, nie informácie. Obsahuje delivery aj utilization úlohy; `typ_ulohy` je sumár úloh poskytovateľov (preberacie úlohy príjemcu sa nepočítajú). Delí sa na sub-UC tam, kde sa líšia úlohy, aktéri alebo jednotky — nie kvôli poskytovateľovi.

**EV** — udalosť. Impact (niečo sa stalo s aktívom → spúšťa UC) alebo delivery (míľnik → spúšťa výmenu). Fázu nesie ona, nie ER.

**ER** — výmena = UC × delivery udalosť × príjemca. Poskytovateľov môže byť viac (rieši IU). ER = jeden IDS súbor per poskytovateľ. Prepisy sú *delta* voči jednotke: menia hodnoty (`povinnost`, `hodnoty`, `profil`), nikdy definície.

**IU-O** — typ objektu = šablóna IDS špecifikácie. Applicability (entita + klasifikácia + filter) a requirements (položky). `filter` iba zužuje, nič nevynucuje — ak filter závisí od atribútu, ktorý musí existovať vždy, existuje k nemu nefiltrované STD pravidlo.

**IU-C** — kontajner: model, dokument, alebo dataset. Dataset **iba pre dáta bez nositeľa v modeli** (senzorika, harmonogramy). Nesie priradenia objektov (`obsahuje[] = {iu, rozsah}`) a MVD (`mvd` → 29481-3 `correspondingMvd`). Sedí na hranici IDM/LOIN (`hranicne`) — **v reťazci sa tá hranica už nekreslí** (PAS 6.3.2: jednotka je jednotka, LOIN je spôsob jej vyjadrenia); `hranicne` ostáva ako vlastnosť typu pre čipy a pre výpočet pásiem (U18).

**STD** — pravidlá a slovníky. `plati: vzdy` platí všade automaticky; `na_vyziadanie` zapína ER. `rozsah: federacia` len pre vzťahy medzi súbormi; fixná hodnota je vždy `kontajner`. Slovníky majú master (DiMS) alebo `hodnoty`, nikdy oboje.

**DEF** — meracie pravidlo pre jednu *meranú* hodnotu (hranica, jednotka, tolerancia, metóda, kto meria). Odvodené a zmluvné hodnoty (prenajímateľná plocha) sú PROP, nie DEF.

**ACT** — organizačná os: strana → tím → funkcia. Tím povinný len pre poverenú stranu (kvôli TIDP). Transakčné roly tu nie sú.

## 7. Overenie — čo IDS vie a čo nie

- IDS overí **prítomnosť, typ, vzor, výčet, rozsah** hodnoty a štruktúru (partOf). Nič iné.
- IDS **neoverí** zhodu s externým zdrojom (zameranie, zmluva), „práve jeden" (počet inštancií), ani typ zóny cez partOf. Tieto idú do `postup` a do checklistu.
- Zhoda hodnoty so zameraním sa **nepíše na položku**, ale na dokumentačnú položku, ktorá ju dokladuje (`dokumentacia[].postup`). Položka nesie iba `tolerancia` ako metadáta.
- IDS 1.0 nepozná dedičnosť entít — abstraktnú entitu v applicability generátor rozvinie na podtypy.

## 8. Smer väzieb

Pole stojí na subjekte, cieľ odkazu je objekt:
- `X nadradene_pri_rozpore:: Y` — **Y** má prednosť pred X.
- `X dokladuje:: Y` — X je dokladom pre Y.
- `X dolozene_v:: Y` — Y dokladuje X (inverzia, na položkách).
- prednosť prepisov: PROJ > ER > IU > STD.

## 9. Editor — čo má a čo nemá byť

Editor je „poskladaný Excel" nad MD súbormi. Štyri úrovne granularity a žiadna piata:
1. **bunka** v tabuľke registra — skenovanie, hromadná zmena
2. **poznámka** — plná editácia (obrazovka Detail)
3. **reťazec** — kam patrí (vlastná obrazovka, štyri otázky)
4. **inšpektor** — odvodené fakty o výbere: pôvod hodnoty, dopadajúce pravidlá s dôvodom, dopad zmeny

K úrovniam 2 a 3 sa chodí cez **režim** — perspektívu `Detail | Reťazce` nad ľavým panelom (U21).
Režim **nie je piata úroveň**: nepridáva žiadny objekt ani pohľad navyše, iba hovorí, po čom sa
práve chodí — po registroch, alebo po reťazcoch. Reťazcov je toľko, koľko účelov užitia (V23),
preto to nie je ani nový register: ten istý obsah, druhý vstupný bod.

Vnútri reťazca sú **tri úrovne hĺbky** (U20): *línia* (proces: udalosť → účel → úlohy → predel výmeny) · *rozbalenie* pod predelom (kontajnery, objekty, rozsah aspektov, položky jednotky v ohnisku) · *stránka* (plný formulár, klik na ID). Nič sa nezobrazuje dvakrát.

Čo nemá byť: ručne písaný formulár (všetko zo schémy), poznámka rozložená do polí v databáze (nositeľ je celý text súboru v sklade, V29), rozbaľovanie inej poznámky na mieste (iba čip), pásmo pre štandard alebo aktérov, natvrdo napísané poradie pásiem (z `ramec`), duplicitné zobrazenie hraničných typov. **Tri druhy väzby sa nemiešajú** (U17): postupnosť = zvislá čiara s odsadením (udalosť → účel → úlohy), čas = míľnik v riadku výmeny, vecná príslušnosť = vnorenie kontajner → objekt.

Terminológia má tri vrstvy a všetky sú správne: v kóde `STD`, v UI „Pravidlá a konvencie", v zmluve „Informačný štandard". Nikdy ich nemiešať.

## 10. Ako s týmto dokumentom pracovať

Pred zmenou, ktorá sa dotýka štruktúry (nový typ, nové pole, nový pohľad), prerozprávaj v `docs/QUESTIONS.md` piatimi vetami, ako danej časti modelu rozumieš — a až potom kóduj. Ak sa prerozprávanie nezhoduje s týmto dokumentom, je lacnejšie zistiť to pred kódom než po ňom.
