# DATA-MODEL — loader, writer, round-trip, ID ↔ súbor

<!-- Vygenerované z plánovacieho kola 2026-09-10 (plan mode, Claude Code). Záväzný zdroj polí: docs/SCHEMA-v1.md. -->

### 1. Vrstvy

```
Sklad (priečinok | DB) ⇄ text .md ⇄ Dokument (bloky, bajtovo verný) ⇄ surové dáta + provenance ⇄ typovaná poznámka (pydantic) → Kniznica (graf)
```
**Sklad** (`assetin/engine/sklad.py`, DECISIONS V29) je jediné miesto, odkiaľ engine berie text súborov a kam ho zapisuje: `subory()`, `citaj(cesta)`, `zapis([ZapisSuboru], Podpis)`. Zápis je atómový (všetky súbory alebo žiadny) a každý súbor v ňom nesie **verziu**, z ktorej sa zmena počítala (sha256 textu, `verzia_textu`); ak sa súbor medzitým zmenil, celý zápis sa odmietne (`Konflikt`, v editore 409). `SkladPriecinok` je priečinok balíka (dnešné správanie, vzor, testy), `SkladDB` je schéma `library` v Supabase (QUESTIONS Q58). Zápis poznámky sa najprv celý natypuje v pamäti a až potom ide do skladu, takže nič sa nevracia späť.
Dokument je jediná zapisovaná vrstva; typovaná poznámka sa nikdy neserializuje priamo do súboru. Loader nikdy nepadne na jednej poznámke (zbiera diagnostiky, poznámka ostane „surová“).

### 2. Dokument (blokový model)

```
Dokument(path, vrstva: zadanie|aktiva|projekty, frontmatter: FrontmatterBlok | None, telo: list[Blok])
FrontmatterBlok(raw, data: CommentedMap)          # ruamel round-trip, preserve_quotes
Nadpis(uroven, text, raw)
InlinePole(kluc, raw_hodnota, v_polozke, raw)      # `kluc:: …` / `- kluc:: …`
YamlBlok(raw_open, data: CommentedMap, raw_close, raw)   # ```yaml
SurovyBlok(jazyk, raw)                             # ```ids (núdzový IDS), ```dataview, iné ```
HtmlKomentar(raw)
Proza(raw)
```
Segmentácia: frontmatter medzi prvým a druhým `---` (prázdne riadky vnútri sú YAML); ```yaml → YamlBlok; iné ``` → SurovyBlok; `^(- )?([a-z_][a-z0-9_]*)::\s*(.*)$` mimo kódu → InlinePole (inline v strede vety `[k:: v]` sa nepodporuje, info); `<!-- … -->` aj viacriadkový → HtmlKomentar; `^#{1,6} ` → Nadpis; zvyšok Proza. Invariant `serialize() == "".join(raw)`, testovaný.

### 3. Loader

1. `vrstva` a `typ` z cesty (§0.2, §15), `id` z `PathScheme`; kontrola voči frontmatter `typ`/`id`.
2. Frontmatter → surové dáta.
3. Inline polia (`x-assetin.zdroj: inline`): tokeny oddelené `, ` mimo `[[…]]`; `[[…]]` → WikiLink, `#slovo` → Tag, inak text; opakované `- kluc::` sa agregujú. Kľúč vo frontmatter aj v tele → chyba.
4. YAML bloky pod nadpismi:
   - **pod-záznam** (blok má `id`, nadpis `## <id> …`): STD pravidlo (`PravidloSTD`), GEO profil (`ProfilGEO`), slovník v STD-klasifikacia (`Slovnik`: `id`, `system`, `hodnoty`/`vzor`, `odvodene_z`); `poznamka` = rodič;
   - **blokové pole** (jediný top-level kľúč je pole typu s `x-assetin.zdroj: blok`): ER `prepisy`, UC `ulohy`;
   - iné → diagnostika W „neznámy blok“.
5. Predvoľby (§14b, `zavaznost_predvolena`, `poskytovatel_predvoleny` z ER) sa **nedopĺňajú do dát**; graf ich počíta ako efektívne hodnoty (`x-assetin.odvodene`).
6. `Model.model_validate()`; chyby → diagnostiky s json pointerom a riadkom (provenance z `lc`).
7. `Kniznica.rozlis()`: index `id → poznámka|pod-záznam`; kotvy per poznámka (pod-záznamy, `ulohy[].id`, nadpisy text/slug); odkazy so stavom rozlíšenia. Bare `[[X]]` sa rozlišuje globálne (poznámky + pod-záznamy s globálne unikátnym ID: STD-*, GEO-*); `[[N#k]]` v rámci N (slovníky sú anchor-only).

Wikilink: `[[cieľ]]`, `[[cieľ|alias]]`, `[[cieľ#kotva]]`, `[[cieľ#kotva|alias]]`; `cieľ` = ID (nie cesta ani názov súboru). `WikiLink` serializuje presne pôvodný text.

### 4. Writer

| Úroveň | Kedy | Zápis |
|---|---|---|
| 0 | model nezmenený | nič |
| 1 | zmena skalára vo frontmatter / YAML bloku | nahradí sa len text hodnoty na riadku podľa `lc` (komentár za hodnotou ostáva) |
| 1b | pridaný / odobraný **celý riadok** blokového zoznamu (tabuľka v editore posiela celý zoznam) | vloží sa len text nových riadkov, resp. zmažú sa riadky odobraného záznamu; riadky, ktoré ostávajú, sa nedotknú (`{atribut: Name}`, úvodzovky aj `#` komentáre prežijú). Patch sa prijme, len keď spätné načítanie dá presne požadovanú hodnotu — inak sa text vráti a použije sa úroveň 2 |
| 2 | štrukturálna zmena | frontmatter/blok rozdelený na segmenty top-level kľúčov (`lc.key()`); prepíše sa len segment dotknutého kľúča dumpom pod-stromu (`indent(mapping=2, sequence=4, offset=2)`, veľký `width`, `preserve_quotes`, None → prázdna hodnota) |
| 3 | inline pole | prepíše sa len časť za `:: `; nové pole pod nadpis podľa `x-assetin.sekcia` (za posledné inline pole sekcie); chýbajúca sekcia sa doplní v poradí šablóny typu; odstránené pole = odstránený riadok |
| 4 | nový pod-záznam / blokové pole / poznámka | `## <ID> <názov>` + YAML blok na koniec rodiča; nový blok pod existujúci nadpis; nová poznámka zo šablóny sekcií typu (§2–§12 „Telo“), frontmatter v poradí polí schémy |
| 5 | `aliases` (V18) | writer pri každom zápise zabezpečí `aliases` obsahujúce `id` (pridá, nikdy neodstráni cudzie aliasy); migrácia ho doplní naraz |

Próza, poradie sekcií, HTML a `#` komentáre sa nikdy nemenia. Zmena `nazov` **v editore** = premenovanie súboru na `ID <nazov>.md` (`zapis.uloz`, iba keď je v uložení zmena `/nazov`; súbor s vedome kratším menom sa inak nedotkne — QUESTIONS Q33); odkazy sa nemenia (viažu ID); ACT a index `STD.md` sa nepremenúvajú. Nová poznámka: `zapis.vytvor` = šablóna typu (`writer.nova_poznamka`) na ceste z `cesty.cesta_pre`, zápis a spätné načítanie; poznámka, ktorá sa nenatypuje, sa zmaže. Zmena `id` editor nepodporuje.

Testy: round-trip identita nad každým `.md` (povinné per typ); golden edit testy (`before.md` + operácia → `after.md`, diff = presne očakávané riadky); kanárik `dump(load(fm)) vs. originál` reportovaný, nie assertovaný; voliteľne hypothesis (edit → undo = originál).

Riziká ruamel: posun stĺpca komentárov, prázdne riadky ako komentárové tokeny, flow mapy, `guid:` null. Úroveň 1 a 1b ich obchádzajú, úroveň 2 sa im vystavuje len v segmente — preto je 1b prvá voľba pri zoznamoch a 2 ostáva až pre zmenu vnútri riadka, ktorú stránka pošle ako celý zoznam (REVIEW-2026-09-11 §1.2).

### 5. ID ↔ súbor (`PathScheme`)

| Typ | ID | Cesta |
|---|---|---|
| GOAL, UC, ER, IU-O, IU-C, STD, PROP, DEF, EV, PROT, PROJ | prvý token názvu súboru | `<vrstva>/<priečinok §15>/<ID> <nazov>.md`; STD a index `STD.md` bez názvu; PROJ/GOAL(projekt) v `projekty/<zakazka>/`, GOAL(aktivum) v `aktiva/<budova>/` |
| ACT | `ACT-<strana>[/<tim>][/<funkcia>]` | `registre/ACT/<strana>/…`; folder-note pre `uroven: strana|tim` = `<seg>/<seg>.md`; funkcia = `<seg>.md`; `uroven`, `strana` sa odvodia z cesty a kontrolujú |
| pod-záznamy (STD-*, GEO-*, slovníky) | `id` v bloku = prvý token nadpisu | v rodičovskej poznámke |

`PathScheme` = `assetin/schema/cesty.py` (`rozober` cesta → ID, `cesta_pre` ID → cesta, dve vetvy: plochá a hierarchická ACT), volaný loaderom, zápisom (`zapis.vytvor`, premenovanie) a validátorom (A3, A9, A14); názov v súbore prechádza `nazov_do_suboru` (zakázané znaky Obsidianu a Windows → medzera). UI pracuje len s `id`, `typ`, `nazov`.

### 6. Blokové polia a pod-záznamy (tvar, V16/V17)

ER `prepisy` (už vo vzore, blok pod `## Prepisy pre túto výmenu`):
```yaml
prepisy:
  - iu: "[[IU-O-space]]"
    polozka: GrossFloorArea          # kľúč položky: `atribut` alebo `nazov`; pri nejednoznačnosti `Pset.nazov`
    povinnost: required
  - iu: "[[IU-O-space]]"
    geometria.profil: "[[GEO-G1]]"   # bodková cesta na prepis mimo položky (§3)
```
Prepísateľné len `povinnost | hodnoty | rozsah | profil | zavaznost` (§16.9).

UC `ulohy` (V17, blok pod `## Business context`):
```yaml
ulohy:
  - id: T2
    nazov: vytvorenie IfcBuildingStorey a IfcSpace, identifikácia a klasifikácia
    typ: delivery                    # delivery | utilization
    aktor: "[[ACT-poverena/ARCH]]"
    vystup: ["[[IU-O-storey]]", "[[IU-O-space]]"]
```
Kotva `#T2` → `ulohy[].id`; V6 sa overuje; export 29481-3 `businessContextMap` a RACI z dát.

Slovník (STD-klasifikacia, pod `## typy-zon`):
```yaml
id: typy-zon
hodnoty: [NajomnaJednotka, SpolocnyPriestor, TechnickyPriestor]
```
```yaml
id: typy-zon-priestorove
odvodene_z: "[[STD-klasifikacia#typy-zon]]"
hodnoty: [NajomnaJednotka, SpolocnyPriestor]
```
```yaml
id: CCI-priestory
system: CCI
vzor: "^[A-Z]{2}[0-9]{2}$"
```

Migrácia v1.2 → v1.3 (`migrations/v1_2_to_v1_3.py`, skript): (a) `## Business context` próza → `ulohy:` blok (regex `- (T|D)\d+ (.*) \((delivery|utilization), \[\[(.*)\]\]\)( → (.*))?`), pôvodné riadky ostanú ako HTML komentár; (b) doplniť `aliases: [<id>]` do každého frontmatter; (c) vytvoriť `KNIZNICA.md`; (d) round-trip po migrácii.

### 7. Kotvy

Poradie rozlíšenia `[[X#k]]`: pod-záznam `id == k` v X → úloha `ulohy[].id == k` → nadpis s textom/slugom `k` → chyba. `hodnoty_ref` a `klasifikacia[].pravidlo` musia skončiť na slovníku (§16.15).
