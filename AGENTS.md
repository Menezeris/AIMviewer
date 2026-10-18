# AIM Platform — Agent & Developer Context

> **Toto je zdroj pravdy pre konvencie projektu.** Číta ho každý AI/coding nástroj.
> Nástrojovo-špecifické súbory (`CLAUDE.md`, `.github/copilot-instructions.md`,
> `.cursor/rules/*.mdc`, `GEMINI.md`) sú **len tenké pointery sem** — nekopíruj do nich
> obsah, aby sa nerozišli. Zmeny konvencií rob **tu**.

## Dokumentačná mapa (D-017)

**Zlaté pravidlo:** každý fakt žije na **jednom** mieste, ostatné naň linkujú. Keď píšeš,
najprv zisti, do ktorého dokumentu to patrí:

| Dokument | Odpovedá na | Kam píšeš |
|---|---|---|
| **AGENTS.md** (tento) | „Aké sú pravidlá, ako tu pracujem?" | Normatívny súhrn (musí/nikdy). Detail DDL → odkáž na SCHEMA. |
| **DECISIONS.md** | „Prečo je to tak?" | Append-only log `D-0xx` (rationale). Každá feature = záznam. |
| **SCHEMA.md** | „Ako presne vyzerá DB?" | Jediná pravda o DDL, pohľadoch a IFC mapovaní (§5). |
| **ROADMAP.md** | „Čo je hotové a čo ďalej?" | **Jediné** miesto pre živý stav a sprinty. |
| **README.md** | „Ako to spustím/nasadím?" | Ľudský onboarding. |
| **etl/README.md** | ETL pipeline | Detaily spustenia a mapovania ETL. |

### Ako tvoriť/upravovať dokumenty (platí pre KAŽDÝ nástroj)

Dokumenty **nezlučujeme** do jedného veľkého súboru. Držíme **dve vrstvy** — dôvod je
ekonomika kontextu: nástroje ťahajú vrstvu 1 do každého promptu, tak musí byť krátka
(rozhodnuté v D-017, dodatok 2026-07-07):

- **Vrstva 1 — vždy načítaná, krátka (cieľ `AGENTS.md` ≲ 180 riadkov):** `AGENTS.md` =
  pravidlá + tenké nástrojové pointery. Sem patria len pravidlá „musí/nikdy" a odkazy.
- **Vrstva 2 — on-demand, hlboká:** `DECISIONS.md`, `SCHEMA.md`, `ROADMAP.md`. Číta sa,
  keď treba; **nikdy sa nezlieva** do vrstvy 1 (zahltilo by každý prompt).

Pravidlá pri písaní (agent aj človek):
1. **Najprv urči cieľový dokument** podľa tabuľky vyššie; ak fakt patrí do vrstvy 2, do
   `AGENTS.md` daj max jednovetový odkaz, nie kópiu.
2. **Nová feature ⇒ najprv záznam `D-0xx` v `DECISIONS.md`** (rationale), až potom kód.
   Bez rozhodnutia sa feature nestavia.
3. **Zmena DB ⇒ nová migrácia + update `SCHEMA.md`** (staré migrácie sa nemažú).
4. **Zmena stavu/priority ⇒ len `ROADMAP.md`** (sekcia „Stav"); nikde inde sa stav neduplikuje.
5. **Nezakladaj nový .md súbor**, kým nemá **odlišnú úlohu aj kadenciu** než existujúce.
   Preferuj rozšírenie existujúceho dokumentu.
6. **Nový nástroj (Cline, Aider, Windsurf, Zed…) ⇒ vytvor len tenký pointer** na `AGENTS.md`
   na ceste, ktorú nástroj číta (napr. `.clinerules`, `GEMINI.md`, `.aider.conf`);
   **žiadny duplikovaný obsah**. Existujúce pointery: `CLAUDE.md`,
   `.github/copilot-instructions.md`, `.cursor/rules/aim-platform.mdc`. Codex/Gemini čítajú
   `AGENTS.md` natívne.
7. **Konvencie sa menia iba tu v `AGENTS.md`**, nie v pointeroch.
8. **Re-check pred sprintom:** pred plánovaním/implementáciou každého sprintu skontroluj
   aktuálny stav (ROADMAP „Stav", git, DB) a čo sa zmenilo; podľa toho prehodnoť poradie/
   rozsah sprintov a kroky, až potom píš detail `D-0xx` a kód.
9. **Zosúladenie dokumentov po sprinte/commite (multi-tool):** po dokončení sprintu a po
   commite vždy zosúlaď podporné dokumenty — `ROADMAP.md` („Stav"/changelog), `DECISIONS.md`
   (`D-0xx`), `SCHEMA.md` (ak sa dotklo DB) a **tenké nástrojové pointery** (`CLAUDE.md`,
   `.github/copilot-instructions.md`, `.cursor/rules/aim-platform.mdc`, príp. `GEMINI.md`) —
   aby ľubovoľný iný nástroj spustený nad repom mal aktuálny, konzistentný kontext (zdroj
   pravdy ostáva `AGENTS.md`, pointery bez duplikovaného obsahu).

Nižšie je normatívny súhrn konvencií. **Presné DDL, stĺpce a pohľady sú v `SCHEMA.md`** —
tu sú len pravidlá, ktorých sa treba držať.

## Čo budujeme
Asset Information Model platforma pre správu informácií o stavbách
počas celého životného cyklu (návrh → výstavba → prevádzka).
Demo na administratívnej budove (upravená diplomka).
Primárny use case: AIM Viewer — ukážka správne previazaných dát.

## Stack
- **Supabase** — Postgres databáza, API, auth, storage
- **Next.js** (App Router) + TypeScript + Tailwind + shadcn/ui — frontend
- **Vercel** — hosting (vlastná doména cez Websupport)
- **Python + ifcopenshell** — IFC parser / ETL pipeline (`etl/`)
- **rdflib** — RDF/ICDD export
- **IFClite (WASM) + Three.js** — klient-side 3D render (geometria nikdy nie je v DB)

## Kľúčové dokumenty — vždy čítaj pred prácou
- `DECISIONS.md` — všetky architektonické rozhodnutia s kontextom (D-0xx)
- `SCHEMA.md` — aktuálna databázová schéma (§5 = IFC mapovanie/extenzie)
- `ROADMAP.md` — fázy, sprinty a priority
- `etl/README.md` — spustenie ETL pipeline

## Databázové konvencie

### Uzly — centrálna tabuľka `objects` (D-018)
- Všetky uzly sú riadky v `objects`, rozlíšené `object_type`:
  site, building, floor, space, asset, asset_type, document, person, organization,
  system (IfcDistributionSystem, D-047/D-049), capture, capture_media (Reality Capture,
  D-073), project, zone, spatial_zone, group (IfcProject/IfcZone/IfcSpatialZone/IfcGroup, D-088);
  ďalšie IFC entity (procesy/tasky…) sú **aditívne hodnoty** (D-051)
- **Zaniknutý objekt** (`objects.valid_until` nie je NULL, D-088) appka ani AI nevidia: každý
  nový zoznam, počet alebo vyhľadávanie nad `objects` filtruje `valid_until is null`
- `object_type` validuje ETL/app (NIE CHECK — pridanie typu je aditívne)
- **Cieľ: pokryť celú IFC ontológiu** (entity aj vzťahy) — entity už dnes generické cez
  otvorený `object_type`; vzťahy cez generický meta-model (D-051). Nie je to prestavba, ale
  aditívne dopĺňanie hodnôt/`rel_type`. IFC = sémantika/ontológia, nie STEP súbor (D-046).
- IFC atribúty sú **stĺpce** (`ifc_guid`, `ifc_type`, `predefined_type`, `name`,
  `object_ref UNIQUE`…), NIE do `properties`. `properties JSONB` = property sety +
  rezervované `_kľúče` (viď nižšie). Presné stĺpce → `SCHEMA.md §2.1`.
- Typovo-špecifické stĺpce → tenká 1:1 prípona (`floors`, `documents`, `persons`),
  `id` ako FK na `objects(id) ON DELETE CASCADE` (`SCHEMA.md §2.2`)
- `organization` = obyčajný `objects` riadok (name = názov firmy), bez prípony

### Property sety — tri vrstvy (D-022)
- **Atribúty** (pevné zo schémy) → stĺpce, NIE do `properties`
- **Štandardné psety** (buildingSMART) → `properties[<názov>]`, názov `Pset_`/`Qto_`
- **Custom psety** → `properties[<názov>]`, akýkoľvek iný názov (bez povinného prefixu)
- **Rezervované `_kľúče`** (`_contact`, `_org`…) = meta/zachytené dáta, NIE psety; psety nikdy nezačínajú `_`

### Hrany — generický meta-model `relationships` (D-051, implementované F1; revízia D-048)
> **Stav (D-051, F1):** vrstva hrán žije v **jednej generickej `relationships`** (diskriminátor
> `rel_type`, symetricky k `objects`) + **kanonické views** per typ (rovnaké názvy ako pôvodné
> `rel_*` = bezvýpadkový compat) + **manifest `relationship_types`** (generovaný z IFC schémy
> `ifcopenshell`, `etl/manifest.py`). Dôvod: IFC vlastný meta-model = `objects`
> (IfcObjectDefinition) + `relationships` (IfcRelationship, objektifikovaný) + `properties`
> (IfcPropertyDefinition); B škáluje na celé IFC bez migrácie za každý vzťah. **IFC-kanonická
> identita, smer `subjekt→objekt` aj `aim_` namespace ostávajú** — žijú v manifeste ako dáta
> (smer, povolené `object_type`, namespace, export cesta, unique-active-parent). **N-árnosť =
> binárne `from→to`** (N-árne = N riadkov; drží D-031 idempotenciu). **LLM/whitelist dotazuje
> LEN kanonické views** (nie base tabuľku) → text-to-SQL ergonómia zachovaná; **zápis (ETL/seed)
> ide na base `relationships`** (views nie sú insertovateľné). **Integrita** = validačný trigger
> z manifestu (nie polymorfný FK); `to_id` polymorfné (objects/`classification_references`).
> Partície odložené (kolízia „PK musí obsahovať partičný kľúč" × `ON CONFLICT (id)`).
> **Nasadené na Supabase prod** (2026-07-07, `acwoupricatirhlfkhvk`). Presné DDL → `SCHEMA.md §2.5/§2.6`; zoznam `rel_type` nižšie.
- Každý `rel_type` = konkrétny IFC `IfcRelationship` podtyp, **pomenovaný podľa neho**,
  s granularitou akú rozlišuje IFC:
  `rel_aggregates` (IfcRelAggregates), `rel_contained_in_spatial_structure`
  (IfcRelContainedInSpatialStructure), `rel_defines_by_type` (IfcRelDefinesByType),
  `rel_associates_document` (IfcRelAssociatesDocument), `rel_associates_classification`
  (IfcRelAssociatesClassification), `rel_assigns_to_actor` (IfcRelAssignsToActor),
  `rel_assigns_to_group` (IfcRelAssignsToGroup — systémy, D-047),
  `rel_referenced_in_spatial_structure` (IfcRelReferencedInSpatialStructure — prvok aj v ďalšom
  priestore, neexkluzívne; odvodené cez `python -m etl.derive`, D-080),
  `rel_member_of` (IfcPersonAndOrganization — **resource, nie IfcRel**; poctivo mimo taxonómie)
- **Fyzicky binárne `from→to` + naše meta stĺpce, NIE objektifikované N-árne IFC entity**
  (preberáme identitu/granularitu IFC, nie serializačnú štruktúru — index nad IFC
  sémantikou, nie STEP v Postgrese, D-046/D-048)
- Povinné stĺpce: `id`, `valid_from`, `valid_until`, `source`
- Smer: `from_id` → `to_id` (subjekt → objekt) — konvencia ostáva jednotná; ktorý koniec
  je IFC `Relating`, je v mapovaní v SCHEMA.md §5
- **Namespace (D-048):** hrana **bez prefixu = IFC-kanonická** (serializuje sa na `IfcRel*`);
  hrana, pre ktorú IFC **nemá koncept**, dostane prefix **`aim_`** (`aim_rel_*`, snake_case).
  Prefix kóduje aj export: `rel_*`→`IfcRel`, `aim_*`→ICDD linkset/IFCX. Rezervované pre
  skutočnú absenciu IFC konceptu (NIE koncept realizovaný inak — preto `rel_member_of`
  ostáva `rel_`). Dnes žiadna `aim_*` hrana neexistuje; je to dopredná konvencia.
- Výnimka: `rel_associates_classification.to_id` → `classification_references`
- Spatial: `rel_aggregates` = dekompozícia štruktúry (Site→Building→Floor→Space);
  `rel_contained_in_spatial_structure` = fyzický prvok (asset) v priestore/podlaží
- Úplný zoznam hrán, stĺpce a IFC `Relating`/`Related` mapovanie → `SCHEMA.md §2.5` a `§5`

### Type–occurrence (D-021)
- Type = `object_type='asset_type'`, NIKDY nie je v priestorovej štruktúre
  (`rel_aggregates` / `rel_contained_in_spatial_structure`)
- Väzba `rel_defines_by_type` (occurrence → type), 1:N
- Dedičnosť s prepisom: type zdieľané, occurrence prepíše; effective z `v_asset_effective`

### Aktori (D-020, D-024) — úroveň B
- `person` (prípona `persons`) a `organization` (objects riadok), väzba `rel_member_of`
- `rel_assigns_to_actor` ide z person aj z organization
- Dve roly: `rel_assigns_to_actor.role` (acting v zodpovednosti) vs `rel_member_of.role` (rola vo firme)
- C (org-hierarchia, štruktúrované adresy, intrinsic roly) = plánované aditívne rozšírenie

### Identita objektov (trojvrstvová, D-010)
- **Master UUID** (`objects.id`) = primárna identita, nikdy sa nemení
- **object_ref** = ľudsky čitateľný stabilný tag (QR), unikátny; NIE je to klasifikačný kód
- **IFC GUID** = len atribút; história v `ifc_guid_history`

### Klasifikácia (D-011, D-019, D-023)
- Nikdy hardcodovať konkrétny klasifikačný systém
- Dvojúrovňová, referenčné dáta: `classification_systems` + `classification_references`
- Väzba `rel_associates_classification`, povolená na type aj occurrence
- Efektívna klasifikácia occurrence = **union** vlastných + zdedených z type (nie override)

## Čo nerobiť
- Nikdy nemazať migrácie — vždy pridávať nové
- Nikdy pevne stanoviť klasifikačný systém v schéme
- Nikdy používať IFC GUID ako primárny kľúč
- Nevytvárať samostatnú tabuľku pre každý typ uzla — použiť `objects` + príponu
- Neukladať type property sety na occurrence — patria na type (dedia sa cez view)
- Nedávať IFC atribúty do `properties` — sú to stĺpce
- Nezahadzovať adresy/org-väzby zo zdroja — uložiť do `_contact`/`_org` v `properties` (kým nie je C)
- Nebudovať features bez zodpovedajúceho záznamu v DECISIONS.md
- Nezavádzať nový atribút/hranu/enum bez kontroly IFC4.3 ekvivalentu — ak existuje,
  prevziať IFC názov aj hodnoty doslovne; ak nie, zapísať ako deklarovanú extenziu
  do SCHEMA.md §5 (IFC-first naming, D-046)
- Nikdy neukladať geometriu/meshe do DB — 3D rendering je ephemerálna klient-side vrstva (IFClite, D-044)

## Priestorová hierarchia
```
Site → Building → Floor → Space → Asset
```
Každá úroveň je riadok v `objects` (líši sa `object_type`). Spatial väzby IFC-kanonicky
(D-048): `rel_aggregates` medzi štruktúrami (Site→Building→Floor→Space),
`rel_contained_in_spatial_structure` pre fyzický prvok (asset) v priestore/podlaží.

## Dátový prístup (D-026)
- Čítanie **výhradne server-side** cez Supabase `service_role` (Server Components /
  route handlers). DB ostáva nevystavená, **RLS sa nezapína** (línia D-025).
- Anon kľúč smie do prehliadača **len** kvôli Realtime živému kanálu (D-079) a **len** keď
  rolám `anon`/`authenticated` nepatria v `public` žiadne práva (migrácia `20261016120000`);
  nová tabuľka/RPC im práva nedáva. Dáta sa cez anon kľúč nikdy nečítajú.
- ISR cache (`unstable_cache`, tag `aim`, revalidate 60 s, D-030); po ETL loade
  `revalidateTag("aim")`.

## RDF / ICDD
RDF nie je interná databáza — len export formát.
Export generuje Python skript z Postgres dát do ICDD kontajnera (ISO 21597).

## 3D Viewer — IFClite (D-044)
Geometria = **ephemerálna v prehliadači** (IFClite WASM, klient-side, IFC súbor neopustí tab).
**Postgres sa geometrie nikdy nedotýka.** Spojka medzi 3D scénou a dátami = **IFC GUID**
(`ifc_guid_history`, D-010). Federácia disciplinárnych modelov (ARCH + VZT) do jednej scény —
identita naprieč modelmi drží IFC GUID (expressId sa medzi súbormi prekrýva), podlažie sa
normalizuje na spoločný label (`1NP_VZT`→`1NP`, D-049).

**Kde žije AIM funkcia (D-090):** predvolene v AIMvieweri; do forku len zobrazenie, ktoré musí
byť vnútri panelov viewera (odznak, záznam, lokálny prepínač). Akcie meniace dáta robí host,
tlačidlo vo forku ich len otvorí.

**Nová funkcia viewera (D-087):** najprv tool z `@ifc-lite/mcp` 1:1, pohľad len ako adaptér v
`apps/viewer/src/aim/` forku, vlastné len kde originál nič nemá. Fork PR rob podľa skillu
`.claude/skills/aim-feature/SKILL.md` vo forku (lokálne kontroly, meranie balíka, mutačné
dôkazy a štítok v prvom pushi), aby CI prešlo na prvý raz. Zvýšenie bundle stropu do 2 kB
vstupu je predschválené (`docs/FORK_MAINTENANCE.md` vo forku). Poradie zlúčenia: fork, potom AIMviewer.

## ETL — spustenie
Python 3.9+ (`py -3.9`), `PYTHONUTF8=1` na Windows (cp1250 konzola). Vždy z koreňa repa:
`python -m etl.main --file <ifc> [--dry-run|--reset|--federate] [--model ASR|VZT]`. Detaily v `etl/README.md`.
IFC modely federácie sa zverejňujú **len cez `python -m etl.model_publish`** (revízia + archív,
D-086), nikdy priamym uploadom do bucketu; re-ETL revízie vždy s `--model`, nikdy `--reset`.

## LLM rozhranie — eval kadencia (D-057)
Zmena LLM vrstvy (tools, system prompt, model/provider) ⇒ pred commitom spusti evaly
(`npm run eval` proti bežiacemu dev serveru) a porovnaj s baseline; výsledok patrí do
ROADMAP changelogu. Detail → `DECISIONS.md` D-057.

Nová RPC pre LLM = vždy read-only `stable` + `set search_path` + interné whitelisty
(relation/op/stĺpce), identifikátory `format('%I')`, literály `format('%L')` — vzor
`search_everything`/`aggregate_objects` (D-059/D-060).
