# DECISIONS.md — Architektonické rozhodnutia AIM Platform

> Tento dokument je živý log rozhodnutí prijatých počas brainstormu.
> Každé rozhodnutie má kontext a dôvod — nie len výsledok.
> Pred akýmkoľvek návrhom schémy alebo feature — prečítaj celý dokument.

---

## 1. Produkt a stratégia

### D-001 — Biznis model
**Rozhodnutie:** Primárna aktivita je BIM konzultácia. Nástroj vzniká paralelne ako vedľajší produkt konzultačnej práce.
**Dôvod:** Konzultácia je distribučný kanál — zákazníci vidia reálne výsledky nástroja v praxi bez cold outreach.
**Dôsledok:** Nástroj musí byť použiteľný v reálnych projektoch od začiatku, nie len demo.

### D-002 — Demo projekt
**Rozhodnutie:** Administratívna budova z diplomovej práce ako verejný sandbox.
**Dôvod:** Reálna budova, žiadne autorské obmedzenia, dobre ohraničený rozsah.
**Dôsledok:** IFC model bude upravený tak aby bol ideálny pre tento účel.

### D-003 — Prvý use case: AIM Viewer
**Rozhodnutie:** Prvý cieľ je ukážka konečného stavu — správne previazané dáta a možnosti práce s nimi. Nie ukážka procesov.
**Dôvod:** Zákazník musí vidieť KAM to smeruje, nie AKO sa tam dostane.
**Dôsledok:** Viewer zobrazuje priestorovú hierarchiu, asset karty, dokumenty, zodpovednosti a LLM interface.

### D-004 — Vibecoding prístup
**Rozhodnutie:** Claude Code (primárne) + Cursor ako hlavné vývojové nástroje.
**Dôvod:** Minimálne skúsenosti s kódom — spolieháme sa na kvalitne nastavené AI nástroje.
**Dôsledok:** Kvalita CLAUDE.md a dokumentácie je kritická. Každý kontext musí byť jasný.

---

## 2. Technický stack

### D-005 — Databáza: Supabase / Postgres
**Rozhodnutie:** Supabase ako primárne úložisko (Postgres pod kapotou).
**Dôvod:** Backend as a Service — databáza, API, auth, storage out of the box. Vibecoding friendly. LLM text-to-SQL funguje. Migrovateľné na Azure Postgres ak treba.
**Alternatívy zvažované:** Azure, AWS (príliš veľa DevOps overhead pre túto fázu), Neo4j (slabší LLM tooling).
**Dôsledok:** Nie sme locked-in. Postgres je štandard.

### D-006 — Frontend: Next.js + Vercel
**Rozhodnutie:** Next.js na Vercel, vlastná doména cez Websupport DNS.
**Dôvod:** Štandardný stack, dobrá dokumentácia, Vercel má priameho sprievodcu pre Websupport DNS.
**Dôsledok:** Doména nasmerovaná na Vercel cez A record alebo CNAME.

### D-007 — IFC Parser: ifcopenshell (Python)
**Rozhodnutie:** ifcopenshell ako ETL nástroj pre import z IFC do Supabase.
**Dôvod:** De facto štandard pre IFC parsing v Pythone. Open source, aktívna komunita.
**Dôsledok:** Python ETL pipeline: IFC → transformácia → Supabase.

### D-008 — RDF / ICDD ako export formát
**Rozhodnutie:** RDF nie je interná databáza — je to výstupný formát pre handover a archiváciu.
**Dôvod:** LLM text-to-SQL je vyriešený, text-to-SPARQL nie. Interná práca zostáva v Postgres.
**Nástroj:** Python rdflib pre generovanie RDF súborov z Postgres dát.
**Dôsledok:** Export do ICDD kontajnera (ISO 21597) pre interoperabilitu so štandardmi.

---

## 3. Databázová architektúra

### D-009 — Schéma navrhnutá ako graph v relačnej DB
**Rozhodnutie:** Tabuľky sú uzly, rel_ tabuľky sú hrany s atribútmi. Myslíme v trojiciach.
**Dôvod:** IFC je prirodzene graph. Relačná DB to simuluje ale zachováva LLM kompatibilitu. Migrácia na graph DB neskôr je mechanická transformácia — nie rewriting.
**Dôsledok:** Každá rel_ tabuľka má typ hrany, atribúty vzťahu a históriu.

### D-010 — Trojvrstvová identita objektu
**Rozhodnutie:** Každý objekt má tri vrstvy identity:
1. **Master UUID** — generovaný tvojou DB, nikdy sa nemení, kotva pre všetko
2. **Classification ID / object_ref** — ľudsky čitateľný, fyzicky použiteľný (QR kód), stabilný
3. **IFC GUID** — len atribút s históriou zmien, nie primárna identita
**Dôvod:** IFC GUID sa mení pri reexporte, prepísaní objektu alebo zmene softvéru. Tvoja DB musí vlastniť identitu.
**Dôsledok:** Tabuľka `ifc_guid_history` pre sledovanie zmien GUIDov v čase.

### D-011 — Klasifikačný systém: flexibilný
**Rozhodnutie:** Žiadny pevne daný klasifikačný systém. IFC entity `IfcClassification` a `IfcClassificationReference` — môže ich byť viac naraz.
**Dôvod:** Každý projekt môže mať iný systém (Uniclass, OmniClass, CCI, vlastný).
**Dôsledok:** Schéma podporuje viacero klasifikácií na jeden objekt bez zmeny štruktúry.

### D-012 — IFC-aligned schéma, nie priama IFC implementácia
**Rozhodnutie:** Schéma je inšpirovaná IFC 4.3 ale nie je priama implementácia. Vlastné tabuľky s ifc_guid stĺpcom a JSONB pre property sety.
**Dôvod:** Priama IFC implementácia je príliš komplexná pre vibecoding fázu. IFC-aligned schéma umožňuje prirodzený import/export bez lock-in.
**Dôsledok:** Každá tabuľka ktorá má IFC ekvivalent má `ifc_guid` stĺpec a `ifc_type` stĺpec.

---

## 4. Ontológia a štandardy

### D-013 — Priestorová hierarchia podľa IFC
**Rozhodnutie:** Site → Building → Floor → Space → Asset. Priamo z IFC priestorovej hierarchie.
**Dôvod:** Štandardizovaná, dobre zdokumentovaná, prirodzená pre import z IFC modelu.

### D-014 — Dokumenty podľa IfcDocumentInformation logiky
**Rozhodnutie:** Dokumenty majú: Identification, Name, Location (URL), Purpose, Revision, DocumentOwner, ValidFrom, ValidUntil, Status.
**Dôvod:** IfcDocumentInformation pokrýva všetky potrebné atribúty. Prepojenie na ľubovoľný objekt cez rel_ tabuľku.

### D-015 — ICDD (ISO 21597) ako export štandard
**Rozhodnutie:** Keď zákazník chce dáta odniesť — generujeme ICDD kontajner s RDF prepojeniami.
**Dôvod:** ISO štandard, vendor-neutral, podporovaný buildingSMART ekosystémom.
**Štruktúra:** ZIP s index.rdf, payload_documents/, payload_triples/.

---

## 5. Vývojový proces

### D-016 — Typy chatov
**Rozhodnutie:** Striktné oddelenie typov konverzácií:
- **Brainstorm chat** — strategické rozhodnutia, nový chat pre každú tému
- **Planning chat** — návrh konkrétnej časti, výstup je MD dokument
- **Execution chat** — Claude Code implementácia podľa plánu, nový chat pre každý feature
**Dôvod:** Zmiešanie plánovania a exekúcie degraduje kontext a kvalitu výstupu.

### D-017 — Dokumentačná štruktúra projektu
```
projekt/
├── CLAUDE.md          ← max 100 riadkov, core kontext
├── docs/
│   ├── DECISIONS.md   ← tento dokument
│   ├── SCHEMA.md      ← databázová schéma (živý dokument)
│   ├── STACK.md       ← technologické rozhodnutia
│   └── ROADMAP.md     ← fázy a priority
└── .claude/
    └── commands/      ← slash commandy pre opakované workflow
```

**Dodatok (2026-07-07) — multi-tool konsolidácia.** Realita sa od pôvodného náčrtu líši
(dokumenty sú v roote, nie v `docs/`; `STACK.md` neexistuje — stack je v ROADMAP §„Stack
rozhodnutia" + D-026). Aby z podporných dokumentov mohlo čerpať **viacero programovacích
nástrojov** bez rozídených kópií, zavedený **jediný zdroj pravdy konvencií = `AGENTS.md`**
(rastúci multi-tool štandard). Nástrojové súbory sú **tenké pointery** naň, bez
duplikovaného obsahu: `CLAUDE.md` (Claude Code), `.github/copilot-instructions.md`
(Copilot), `.cursor/rules/aim-platform.mdc` (Cursor); Codex/Gemini čítajú `AGENTS.md`
natívne. Deľba: **AGENTS.md** = pravidlá (musí/nikdy) · **DECISIONS.md** = prečo (D-0xx) ·
**SCHEMA.md** = presné DDL · **ROADMAP.md** = jediný živý stav + sprinty · **README.md** =
ľudský onboarding. Zlaté pravidlo: každý fakt na jednom mieste, ostatné linkujú. Dokumentačná
mapa je na začiatku `AGENTS.md`.

---

## 6. Schéma AIM Viewer (návrh dátového modelu)

### D-018 — Objektový model: centrálna `objects` + typové prípony
**Rozhodnutie:** Všetky uzly (site, building, floor, space, asset, asset_type, document, person, organization) sú riadky v jednej tabuľke `objects` (Master UUID, `object_type`, `object_ref`, `ifc_guid`, `ifc_type`, `properties`). Typovo-špecifické stĺpce žijú v tenkých 1:1 príponách (`floors`, `documents`, `persons`) s `id` ako FK na `objects(id) ON DELETE CASCADE`. Hrany `rel_` majú čisté FK na `objects(id)`.
**Dôvod:** Master UUID vlastní jedna tabuľka — skutočná „kotva pre všetko" (D-010). Čisté FK dávajú referenčnú integritu a cascade (žiadne osirelé hrany). Pridanie nového typu uzla aj vzťahu je čisto aditívne. Viewer aj LLM čítajú ľubovoľný uzol jedným dotazom na `objects`. Migrácia do graph DB ostáva mechanická: `objects` = uzly, `rel_*` = hrany, `object_type` = label.
**Alternatívy zvažované:** Polymorfné hrany (`from_table`/`from_id`) — graph-faithful, ale bez integrity na strane subjektu a s kostrbatými JOINmi; samostatná tabuľka pre každý typ — fragmentuje identitu.
**Dôsledok:** `object_type` validuje ETL/app (nie CHECK), aby pridanie typu zostalo aditívne.

### D-019 — Klasifikácia: dvojúrovňová, referenčné dáta
**Rozhodnutie:** `classification_systems` (IfcClassification) a `classification_references` (IfcClassificationReference). Nie sú to objekty. Väzba objektu na kód cez `rel_has_classification`.
**Dôvod:** Jeden kód (napr. `Ss_25_30_20`) zdieľa veľa objektov a systém má vlastné metadáta (edícia, vydavateľ) — jedna tabuľka by ich opakovala a sťažila viac systémov naraz (D-011). V IFC tiež nie sú `IfcRoot` (nemajú GUID), patria medzi referenčné dáta.
**Dôsledok:** Spresňuje pôvodnú jednu `classifications` tabuľku na dve.

### D-020 — Zodpovednosti od v1
**Rozhodnutie:** Aktori sú typ objektu; zodpovednosť cez hranu `rel_responsible_for` s `role` (IfcActorRole) a platnosťou `valid_from`/`valid_until`.
**Dôvod:** Prenos zodpovednosti pri handovere (zhotoviteľ → prevádzkovateľ) je jadro BIM→FM prechodu, ktorý AIM demonštruje (D-003). Mapuje sa na `IfcRelAssignsToActor`.
**Dôsledok:** `documents.document_owner` (text) je dočasné a neskôr ho nahradí `rel_responsible_for(role='owner')`. Granularitu aktorov spresňuje D-024.

### D-021 — Type–Occurrence vzor
**Rozhodnutie:** Type aj occurrence sú uzly v `objects`. Occurrence (`object_type='asset'`) má polohu (`rel_located_in`); type (`object_type='asset_type'`) **nikdy** nie je v priestorovej štruktúre. Väzba `rel_defined_by_type` (occurrence → type), 1:N. Dedičnosť **s prepisom**: type nesie zdieľané, occurrence prepíše. Effective hodnoty počíta `v_asset_effective` (merge properties + PredefinedType).
**Dôvod:** IFC stojí na Generic–Specific–Occurrence paradigme cez `IfcRelDefinesByType`. Type nesie spoločné property sety a parametre, occurrence polohu/sériové číslo/dátum. Pri kolízii type vyhráva, pokiaľ occurrence neprepíše; rovnako PredefinedType (occurrence ho použije len ak je type `NOTDEFINED`). Ukladať type hodnoty na occurrence (Revit workaround) zahadzuje zdieľanú vrstvu.
**Dôsledok:** `ObjectType`/`ElementType` (USERDEFINED) je IFC **atribút**, nie entita → stĺpec `user_defined_type`. Vzor je generický (process/resource types) — neskôr použijú tú istú hranu.

### D-022 — Properties: tri vrstvy, rozlíšené názvom
**Rozhodnutie:** (1) IFC **atribúty** → stĺpce na `objects`; (2) **štandardné psety** (buildingSMART, názov `Pset_`/`Qto_`) a (3) **custom psety** (akýkoľvek iný názov) → spolu v jednom `properties` JSONB, vnorené podľa názvu psetu. Štandard vs custom sa rozlišuje prefixom názvu.
**Dôvod:** IFC nemá pre štandard/custom samostatný príznak — diskriminátorom je názov psetu; `Pset_`/`Qto_` sú rezervované pre buildingSMART. Jeden JSONB priestor drží round-trip do IFC triviálny a merge type→occurrence beží nad jedným priestorom.
**Dôsledok:** ETL: čo nezačína `Pset_`/`Qto_`, je custom. Kľúče začínajúce `_` nie sú psety, ale meta/zachytené dáta. Voliteľná `property_set_templates` (bSDD validácia) odložená.

### D-023 — Klasifikácia na type aj occurrence (union faset)
**Rozhodnutie:** `rel_has_classification` povolená na type aj occurrence. Efektívna klasifikácia occurrence = **zjednotenie** vlastných + zdedených z type (`v_asset_classifications`), nie override.
**Dôvod:** `IfcRelAssociatesClassification` priraďuje klasifikáciu k `IfcObjectDefinition` (typy aj occurrence). V praxi nesú rôzne fasety: produktový kód (Uniclass Pr) na type, systémový/lokačný (Ss, SL) na occurrence — nekonkurujú si, hromadia sa.
**Dôsledok:** Schéma sa nemení. Líši sa logika oproti properties: properties = merge s prepisom, klasifikácia = union.

### D-024 — Actor model: B teraz, C plánované
**Rozhodnutie:** Aktori na úrovni **B**: `person` (prípona `persons`: given_name, family_name, email, phone) a `organization` (`objects` riadok, name = názov firmy), väzba `rel_member_of` (person → organization) ≙ `IfcPersonAndOrganization`. `rel_responsible_for` ide z osoby aj z organizácie. Úroveň **C** (org↔org hierarchia, štruktúrované adresy, intrinsic roly ako entita) **budeme implementovať v budúcnosti** ako aditívne rozšírenie.
**Dôvod:** Objektový model (D-018) robí prechod B→C čisto aditívnym — nič v B sa neprerába. Demo ukazuje previazanosť, nie úplnosť (D-003); reálny náklad C nie je schéma, ale ETL + Viewer + testovacie dáta + bloat kontextu, ktoré by sme nevyužili. Jediné riziko odloženia je strata adries/org-väzieb pri importe.
**Dôsledok:** Spresňuje D-020 (`object_type='actor'` → `person`/`organization`). Dve miesta rolí: `rel_responsible_for.role` (acting rola) vs `rel_member_of.role` (rola vo firme). **Capture-don't-structure**: kým nie je C, ETL uloží surové adresy/org-väzby do `_contact`/`_org` v `properties`.

### D-025 — Iniciálna migrácia: rozsah a implementačné rozhodnutia
**Rozhodnutie:** SCHEMA.md §2 je implementovaná ako jediná aditívna migrácia
`supabase/migrations/20260616120000_init_aim_schema.sql`. Pri implementácii:
(1) **RLS sa nezapína** — doplní sa aditívne s auth/frontendom; (2) implementované
sú **len 4 explicitne menované views**, „analogické" (`v_documents`/`v_assets`/
`v_spaces`) prídu neskôr; (3) `updated_at` triggery len na tabuľkách s tým stĺpcom
(`objects`, `classification_systems`, `classification_references`).
**Dôvod:** Držať scope iniciálnej migrácie presne na §2; RLS aj doplnkové views sú
čisto aditívne (D-018) a viažu sa na komponenty, ktoré ešte neexistujú — pridať ich
teraz by znamenalo hádať politiky/tvary bez konzumenta.
**Verifikácia:** Docker nebol dostupný → namiesto `supabase db reset` overené na
čistej lokálnej PostgreSQL 17 cez `psql` (aplikácia migrácie, dedičnosť
`v_asset_effective`, partial-unique `uniq_active_location`, `updated_at` trigger).
**Dôsledok:** Detail odchýlok je v SCHEMA.md §8. Ďalšie zmeny schémy = nové migrácie,
táto sa nikdy needituje ani nemaže.

### D-026 — AIM Viewer: stack a dátový prístup
**Rozhodnutie:** Viewer je **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**
na **Verceli** (D-006). Dáta sa čítajú **server-side** (Server Components / route
handlers) cez Supabase `service_role` kľúč; anon kľúč sa do prehliadača nedáva.
Sprintový plán je v `ROADMAP.md` (S0–S4; LLM interface a ETL sú parkované/paralelné).
**Dôvod:** Server-only `service_role` necháva DB nevystavenú a umožňuje **odložiť RLS**
presne v línii D-025 (RLS sa doplní aditívne s auth). shadcn/ui + Tailwind je
vibecoding-friendly a bez runtime lock-inu. Sprinty idú podľa narastajúcej
previazanosti dát (hierarchia → asset karta s dedičnosťou → dokumenty/zodpovednosti),
aby každý mal demovateľný výstup (D-003) a jadro (dedičnosť/union) prišlo skoro.
**Dôsledok:** Kým nie je auth, žiadny verejný endpoint nečíta DB s anon kľúčom.
LLM interface (text-to-SQL, D-005) a vlastná doména sa riešia až po S3. Reálne dáta
z ETL nahradia seed v S4 — dovtedy Viewer stavia na `supabase/seed.sql`.

### D-027 — Viewer navigácia: route per uzol
**Rozhodnutie:** Priestorová hierarchia (S1) je **route-first**: perzistentný sidebar
so stromom (`app/(viewer)/layout.tsx`) + detail uzla na samostatnej URL
`app/(viewer)/node/[id]`. Výber uzla žije v URL, nie v React state. Connection-test
z S0 presunutý na `/health`. Data-access vrstva `lib/data/spatial.ts` (server-only)
načíta `objects` + aktívne `rel_located_in` + `floors` jedným setom dotazov a poskladá
strom v pamäti (~15 uzlov, žiadna rekurzia v DB).
**Dôvod:** S2/S3 sú celé o detaile assetu (dedičnosť, klasifikácie, dokumenty,
zodpovednosti) — prirodzene server-rendered stránky s vlastnou URL. Voľbou route-first
sa strom píše raz a detail v S2 sa nemení na „presun výberu do URL"; navyše dostávame
zdieľateľné odkazy a deep-linking zadarmo. Alternatíva (výber v React state) by si
v S2 vyžiadala prepis dátového toku detailu.
**Dôsledok:** Klik na asset v S1 vedie na placeholder („detail príde v S2"). Strom je
jediný client komponent (expand/collapse, zvýraznenie aktívneho cez `usePathname`);
zvyšok je server-side.

### D-028 — AIM Viewer S2: asset karta (dedičnosť, provenance, type route)
**Rozhodnutie:** Asset karta žije vo vetve existujúcej route `/node/[id]`
(`object_type='asset'`), type detail na novej route `/type/[id]` — obe v `(viewer)`
skupine so sidebarom. Data-access `lib/data/asset.ts` (server-only).
Dedičnosť type→occurrence (D-021) sa číta z `v_asset_effective` (efektívny
`predefined_type`/`user_defined_type`, väzba na type), klasifikácie z
`v_asset_classifications` (union faset, D-023). **Provenance** properties
(vlastné / zdedené / prepísané) sa z view NEodvodzuje — view vracia už zmergované
`properties`. Načítajú sa raw `properties` typu aj occurrence a diff sa robí v TS:
kľúč len v occ = *vlastné*, len v type = *zdedené*, v oboch a rôzny = *prepísané*
(zobrazí pôvodnú hodnotu z typu), v oboch a rovnaký = *zdedené*. `ifc_guid`
(vo `v_asset_effective` chýba) sa dobral z `objects`. Properties zoskupené podľa
psetu, `Pset_`/`Qto_` = štandard vs custom (D-022), `_kľúče` skryté; klasifikácie
s badge `occurrence`/`type`.
**Dôvod:** ROADMAP S2 explicitne „tu sa ukáže dedičnosť" — samotné effective
hodnoty z view by pôvod stratili, preto provenance dopočítavame z raw vrstiev.
Merge/union RULE ostáva v DB (views = jediný zdroj pravdy); Viewer pridáva len
anotáciu pôvodu. Type route doplnená, lebo `fetchNode` (S1) filtruje len
`SPATIAL_TYPES` → `asset_type` route nemal a „link na type" by spadol na
`notFound()`. Route-first (D-027) sa drží: každý uzol má vlastnú URL.
**Dôsledok:** S3 (dokumenty, zodpovednosti, GUID história) sa pridá ako ďalšie
sekcie karty — schéma sa nemení. Generický „object route" sa zatiaľ nezavádza
(asset = provenance, type = zdieľané psety + occurrences sa líšia obsahom);
zjednotenie sa zváži, ak v S3 pribudnú detaily document/person/organization.
**Verifikácia:** lokálny dev proti Supabase Cloud seedu. AHU-01: `AirFlowRate=4800`
(prepísané, z typu 5000), HeatRecovery/Manufacturer/Pset_… zdedené, SerialNumber
vlastné, AIRHANDLER zdedený, klasifikácie `Pr_70_65_04` (type) + `Ss_55_70_70`
(occurrence). AHU-02: čistá dedičnosť (žiadny override, len `Pr_` zdedená). CERP-01:
bez typu, všetko vlastné, žiadne klasifikácie. `tsc --noEmit` + `eslint` čisté.

### D-029 — AIM Viewer S3: dokumenty, zodpovednosti, GUID história + generický object route
**Rozhodnutie:** S3 pridáva tri **generické** sekcie nad ľubovoľný `objects` uzol:
dokumenty (`rel_has_document` → `documents`), zodpovednosti (`rel_responsible_for`,
pri osobe doplnené firmou cez `rel_member_of`) a história IFC GUID (`ifc_guid_history`).
Data-access `lib/data/relations.ts` (server-only); sekcie sa zobrazia na asset karte
**aj** na priestorových uzloch (site/building/floor/space). Zároveň sa otvára
**generický „object route"**: `/node/[id]` obslúži všetky objekty okrem `asset_type`
— spatial cez `fetchNode` (S1), a `person`/`organization`/`document` cez nové detail
views (`lib/data/object.ts`). `asset_type` **redirectuje** na `/type/[id]` (S2 sémantika
ostáva oddelená). Dispatch je lacný: skús `fetchNode` (spatial graf); ak `null`,
`fetchObjectMeta` rozhodne typ. Aktori aj dokumenty sú **klikateľné na vlastný detail**
— z osoby vidno firmu (`rel_member_of`) aj všetky jej zodpovednosti (reverz
`rel_responsible_for`), z dokumentu „pripojené k" (reverz `rel_has_document`) — tým sa
graf uzatvára obojsmerne. Zobrazujú sa len **aktívne** väzby (`valid_until IS NULL`),
konzistentne s S1/S2. Surové `_contact` (capture-don't-structure, D-024) sa na org
detaile ukáže ako „zachytené" raw údaje.
**Dôvod:** ROADMAP S3 = „dokumenty + zodpovednosti + GUID história" — jadro BIM→FM
previazanosti (D-003, D-020). Generické sekcie + obojsmerné prelinkovanie ukazujú
*previazanosť*, nie izolovanú kartu. D-028 odložilo generický object route „kým
nepribudnú detaily document/person/organization" — S3 ich pridáva, takže route sa
zavádza teraz. `/type` ostáva oddelený, lebo type nie je occurrence (zdieľané psety +
zoznam occurrences vs. provenance/sekcie).
**Dôsledok:** Schéma sa **nemení** (potvrdené SCHEMA.md §8) — S3 je čisto aplikačná
vrstva. `OBJECT_TYPE_LABEL` rozšírený o `asset_type`/`person`/`organization`/`document`
(dnes len spatial). Handover (ukončené zodpovednosti cez `valid_until`) sa ukáže až s
reálnymi ETL dátami (S4); seed má len aktívne väzby. Voliteľné views
`v_documents`/`v_actors` zostávajú neimplementované — priame dotazy stačia (línia S2).
**Verifikácia:** lokálny dev proti Supabase Cloud seedu. AHU-01: manuál (link na
`/node/{doc}`), Ján Novák (operator, člen TZB Servis s.r.o.), 2 GUID záznamy (aktívny
`6ahu01…` + archív `6ahuOLD…` so zdrojom). AHU-02: maintainer Ján Novák, bez dokumentu,
bez GUID histórie (empty states). `/node/{person}`: členstvo + 2 zodpovednosti
(operator AHU-01, maintainer AHU-02). `/node/{org}`: člen Ján + `_contact`. `/node/{doc}`:
metadáta + „pripojené k AHU-01". Priestorové uzly: prázdne sekcie. `next build` +
`tsc --noEmit` + `eslint` čisté.

### D-030 — Viewer výkon (ISR cache) + navigácia ne-priestorových uzlov
**Rozhodnutie:** (1) **Sidebar navigácia**: pod priestorovým stromom (D-027) pribudli
ploché zoznamy ne-priestorových uzlov — typy assetov, osoby, organizácie, dokumenty
(`lib/data/nav.ts` + `components/sidebar-nav.tsx`). Typy vedú na `/type/[id]`, ostatné
na `/node/[id]`. Strom ostáva jediný zdroj priestorovej hierarchie; tieto uzly polohu
nemajú, preto ploché zoznamy. (2) **Výkon**: page-level čítania v `lib/data/*` sú obalené
do `unstable_cache` (revalidate 60 s, tag `"aim"`): `fetchSpatialTree`, `fetchNode`,
`fetchSidebarNav`, `fetchAsset`, `fetchAssetType`, `fetchNodeSections`, `fetchObjectMeta`,
`fetchPerson`, `fetchOrganization`, `fetchDocument`. Doplnkovo: React `cache()` na
`loadGraph` (per-request dedupe layout↔page), `loading.tsx` skeleton, paralelizácia
nezávislých dotazov (`Promise.all`). Stránky `(viewer)` majú `revalidate = 60`;
`/health` ostáva `force-dynamic` (živý connection test).
**Dôvod:** Pôvodné `force-dynamic` + sekvenčné Supabase dotazy dávali na Verceli TTFB
~1.9 s na klik. Kľúčové zistenie: samotný `revalidate` necachuje — Supabase fetche sú
v Next 16 *uncached*, takže routy ostávajú dynamické (`X-Vercel-Cache: MISS`). Cachovať
treba **dáta** (`unstable_cache`) → pri opakovanom prístupe sa Supabase netrafí. Viewer
je verejný read-only (žiadne auth/cookies/per-user dáta), takže cache je bezpečná.
Výsledok: TTFB ~1.9 s → ~0.3 s (≈6×), `loading.tsx` dáva okamžitú odozvu na klik.
**Dôsledok:** Daň je staleness — zmena seedu sa v prevádzke prejaví po ≤60 s (v `next dev`
sa cache neuplatní, build je čerstvý). Sub-50 ms (edge `X-Vercel-Cache HIT`) by si vyžiadalo
`generateStaticParams` — **neurobené zámerne**, lebo S4 vymení seed za ETL dáta a prerender
konkrétnych ID by sa zahodil. Pri zmene dát mimo revalidačného okna existuje `revalidateTag("aim")`.
Schéma sa nemení (čisto aplikačná vrstva).

**Dodatok (klientsky výkon prehliadačky výkresov):** D-030 riešilo *server* TTFB; po D-042
sa ťažisko presunulo na *klienta* (PDF prehliadačka). Tri opravy:
(1) **pdf.js worker self-hostovaný** — `drawing-viewer.tsx` ho už neťahá z `unpkg.com`,
ale cez `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`; bundler ho
vyemituje ako hashovaný same-origin asset (verzia automaticky zhodná s API → žiadny
version mismatch). Pôvodný unpkg pridával pri *každom* otvorení výkresu externé
DNS+TLS+stiahnutie ~1 MB pred parsovaním PDF (a vedel visieť / byť rate-limitovaný) —
to bola hlavná príčina „pomalého načítavania dokumentov". (2) **Preconnect** na origin
Supabase Storage (`/drawing/[id]`) — TCP/TLS handshake na PDF beží paralelne s načítaním
react-pdf bundlu, nie až po ňom (React 19 hoistne `<link rel=preconnect>`). (3) **Cache-Control**
na `/api/element/[id]` (`public, max-age=60, s-maxage=60, stale-while-revalidate=300`) —
opakovaný klik na ten istý kód vo výkrese je okamžitý, bez HTTP round-tripu (server-side
už cachované cez `unstable_cache`, toto pridáva browser/CDN vrstvu).
**Dôvod:** dáta sú malé a server-render rýchly (logy: 60–470 ms); reálna latencia bola
v klientskom PDF pipeline, dominantne externý worker z unpkg.
**Dôsledok:** žiadna zmena schémy ani dát; worker sa verzovo viaže na nainštalovaný
`pdfjs-dist` automaticky (pri upgrade netreba ručne kopírovať súbor).
**Verifikácia:** `tsc --noEmit` čisté; dev preview — worker sa načíta z
`/_next/static/media/pdf.worker.min.*.mjs` (žiadny unpkg request), výkres „Rez A" sa
vyrenderuje s 102 klikateľnými regiónmi, `/api/element/[id]` vracia očakávanú
`Cache-Control` hlavičku.

**Dodatok (streaming navigácie + orezanie DB waterfallov, 2026-07-09):** D-030 cachovalo
dáta; ostala latencia *studeného* renderu (prvá návšteva uzla / po revalidácii), kde stránka
čakala na najpomalšiu reťaz sekvenčných Supabase round-tripov. Tri opravy:
(1) **Streaming sekcií `/node/[id]`** — breadcrumb, hlavička a jadro (deti uzla z cachovaného
grafu, resp. atribúty assetu) sa flushnú okamžite; S3 sekcie (dokumenty/zodpovednosti/GUID,
„prvky vo výkrese", „súčasť systému") streamujú v samostatných `<Suspense>` hraniciach so
skeleton fallbackom. Async sekcie sú súrodenci → fetche bežia paralelne a neblokujú prvý
obsah. (2) **Paralelný dispatch** — `fetchNode` + `fetchObjectMeta` cez `Promise.all`:
ne-priestorové uzly (osoba/organizácia/systém/dokument) už nečakajú na dva sekvenčné kroky;
priestorové stojí navyše jeden lacný cachovaný single-row dotaz. (3) **Menej round-tripov
v dátovej vrstve** — `fetchResponsibilities` 4→3 (aktori + `rel_member_of` paralelne, filter
cez všetky actorIds je ekvivalentný filtru cez persons), `fetchAssetType` ~5→2 paralelné vlny
(hlavný riadok + cls väzby + occurrence väzby naraz; potom refy + occurrence objekty naraz).
**Dôvod:** klik na prvok má byť okamžitý aj pri studenej ceste; teplá cesta (ISR + prefetch
viditeľných liniek vo viewporte) bola už po D-030 rýchla.
**Dôsledok:** žiadna zmena schémy, dát ani API kontraktov; poradie kariet na stránke sa
nemení. `notFound()` v streamovanej sekcii Next korektne prepne na not-found UI.
**Verifikácia:** `tsc --noEmit` čisté, `next build` kompilácia OK (prerender v remote
prostredí bez Supabase env padá by-design, na Verceli s env prechádza).

**Dodatok 2 (spinner na kliku + zdieľaný graf + klientská cache, 2026-07-09):** klik na uzol
v strome trval aj sekundy bez akejkoľvek odozvy. Tri opravy:
(1) **`LinkPendingSpinner`** (`components/link-pending-spinner.tsx`) — `useLinkStatus`
(Next 15.3+) točiace koliesko priamo na kliknutom odkaze počas prebiehajúcej navigácie;
nasadené v strome (ikona uzla sa vymení za spinner), v sidebar zoznamoch a v zozname
potomkov na `/node/[id]`. Klientský ostrov — funguje aj vnútri server-komponentových liniek.
(2) **Graf ako jeden zdieľaný cache záznam** — `fetchNode`/`fetchSpatialTree` boli
`unstable_cache` per-id/per-výstup, takže **každý prvý klik na nový uzol znovu načítal celý
priestorový graf** (stránkované `objects` + hrany + prípony, 3–6 round-tripov) — hlavná
príčina multisekundového studeného kliku. Teraz je cachovaný samotný graf
(`loadGraphData`, kľúč `spatial-graph`, serializovateľné polia namiesto Máp) a
`fetchNode`/`fetchSpatialTree` sú in-memory deriváty (React `cache()` na request); graf sa
z DB ťahá najviac raz za revalidačné okno pre všetky uzly aj strom.
(3) **Explicitný `prefetch={true}`** na navigačných linkách (strom, sidebar, deti uzla) +
`experimental.staleTimes { dynamic: 30, static: 300 }` — viditeľné linky sa prefetchnú
celé a opakovaná navigácia ide z klientskej router cache bez server round-tripu.
**Dôsledok:** staleness línia nezmenená (ISR 60 s, tag `aim`); klientská cache pridáva
≤30 s staleness pri opakovanej návšteve — pre verejný read-only viewer prijateľné.
**Verifikácia:** Playwright (devtest bez DB, umelo pomalá cieľová routa): spinner sa zobrazí
počas pending navigácie, po dokončení zmizne; `tsc` + eslint čisté, `next build` kompilácia OK.

### D-031 — ETL pipeline: architektúra a idempotencia
**Rozhodnutie:** ETL žije v podadresári **`etl/`** tohto repa (zdieľa SCHEMA/DECISIONS
kontext). Stack **Python + ifcopenshell**; zápis **priamo do Supabase Postgresu cez
`psycopg`** (nový server-only secret `DATABASE_URL`, nie REST — bulk upsert). Moduly:
`extract.py` (IFC → medziľahlé dicty), `transform.py` (→ riadky `objects`/`rel_*` podľa
SCHEMA + CLAUDE konvencií), `load.py` (upsert v poradí FK závislostí), `main.py`
(`--file`, `--dry-run`), `ids.py`/`db.py`/`config.py`.
**Idempotencia (re-run je stabilný):**
- `objects` → `ON CONFLICT (object_ref) DO UPDATE`; `id` ostáva **DB-generované**
  (`gen_random_uuid()`) a stabilné — verné D-010 (Master UUID vlastní DB, nie odvodené
  z volatilného IFC GUID). Po loade sa drží mapa `object_ref → id`.
- Prípony (`floors`/`documents`/`persons`) upsert podľa `id` (z mapy).
- Hrany `rel_*` nemajú prirodzený unique → **deterministické `id = UUIDv5(from_ref|to_ref|edge_type)`**,
  `ON CONFLICT (id) DO UPDATE`. `classification_systems` `id = UUIDv5(name)`,
  `classification_references` `ON CONFLICT (system_id, identification)`. `ifc_guid_history`
  `id = UUIDv5(object_ref|ifc_guid)`.
**Mapovanie** (1:1 podľa SCHEMA/§4 + CLAUDE): IFC atribúty → stĺpce; psety
(`util.element.get_psets`) → `properties`, `Pset_`/`Qto_` = štandard, ostatné custom,
`_`-kľúče sa negenerujú z psetov; type↔occurrence cez `IfcRelDefinesByType`; klasifikácie
dvojúrovňovo (`IfcRelAssociatesClassification` na type aj occurrence); GUID história
(aktívny záznam = `objects.ifc_guid`); aktori B (`IfcActor`/`IfcRelAssignsToActor`,
`_contact` capture-don't-structure, D-024).
**Dôvod:** Priamy psycopg upsert dáva rýchlu iteráciu, plnú SQL kontrolu a idempotenciu
bez SQL-artefaktu navyše (`--dry-run` SQL vypíše). `object_ref` ako konflikt-kľúč drží
`objects.id` DB-owned (D-010) namiesto odvodzovania z GUID, ktorý sa pri reexporte mení.
**Dôsledok:** ETL nahradí `supabase/seed.sql` v S4; dovtedy seed ostáva pre dev/Viewer.
**Prerekvizita (blocker):** reálny IFC z diplomky musí mať (a) stabilný zdroj pre
`object_ref` (Tag/Name; fallback GlobalId), (b) aspoň jednu klasifikáciu, (c) čistú
priestorovú hierarchiu — doladenie modelu je otvorená otázka §7.
**Verifikácia:** scaffold syntakticky overený (`py_compile`); end-to-end (IFC → DB →
Viewer ukazuje reálne dáta) až po dodaní IFC súboru.

### D-032 — PDF dokumenty: úložisko, model, prepojenie, export
**Kontext:** `documents.location` je zatiaľ len textová URL. Treba uchopiť reálne PDF
end-to-end: kam ich uložiť, ako ich zapísať do dátového modelu a ako ich exportovať.
Validované o ICDD prax (ISO 21597) aj o Daluxov produktový prístup (file naming +
metadata + hyperlinks).

**Rozhodnutie (úložisko — hybrid s explicitnou typológiou):**
- **Supabase Storage** pre nami nahrané súbory; `location` = hostovaná URL (signed).
- **Externé URL** (SharePoint/web/BIM server) — držíme len odkaz as-is.
- **Neresolvnuté** — dokument existuje (napr. z IFC), ale súbor nie je dostupný.
- Nový stĺpec **`documents.storage_type`** (`supabase | external | unresolved`), aby
  Viewer/Export vedel s `location` narábať bez parsovania URL schémy. Pridá sa **novou
  migráciou** (aditívne, nikdy needitujeme existujúcu — viď SCHEMA §7/§8).

**Rozhodnutie (model — ideme ďalej než Dalux):** dokument je **prvotriedny uzol grafu**,
nie len vizuálny hyperlink nad PDF. Využíva existujúci D-014 model:
`objects(object_type='document')` + prípona `documents` (IfcDocumentInformation polia) +
typovaná hrana `rel_has_document(from=asset/floor/building, to=document, role)`. Výhoda
oproti Daluxu: vzťah je **dotazovateľný, verziovaný a exportovateľný** (nie nakreslený na
papieri). Schéma sa nemení (okrem `storage_type`).

**Rozhodnutie (revízie/platnosť):** každá revízia = samostatný `objects` riadok
(`documents.revision`, `valid_from/until` = platnosť obsahu; `rel_has_document.valid_*`
= platnosť väzby). Supersession **implicitne** teraz (verzie s rovnakým name/identification
zoradené podľa `valid_from`); explicitná hrana `rel_supersedes` je odložená (otvorené §7).

**Rozhodnutie (export):** nový skript `etl/icdd_export.py` (rdflib) generuje ICDD
kontajner (D-015): `linkset.ttl` z `rel_has_document` (IRI z `object_ref`),
`payload_documents/` podľa prepínača **`--embed-payloads`** (embed = self-contained
handover; reference = malý balík závislý na online dostupnosti).
- `storage_type=supabase` → stiahnuť z Storage do payloadu (alebo IRI pri reference).
- `storage_type=external` → IRI na externú URL (embed voliteľný).
- `storage_type=unresolved` → len link záznam s poznámkou, mimo payloadu.

**Dôsledok:** nový Storage bucket `documents/`; nový ETL `etl/doc_upload.py` (viď D-033
pre matching); `storage_type` migrácia; ICDD export skript. Implementácia až po D-033
identity spine (object_ref musí byť zdieľaný kľúč).

### D-033 — Coding scheme: field-source resolver, object_ref a prepojenie dokumentov
**Kontext:** dokument a prvok sa musia stretnúť na rovnakom kľúči = `object_ref`. ETL ho
teraz skladá z IFC `Tag` (Revit interné číslo, napr. `959314`) — nepoužiteľné na
párovanie s výkresmi. Reálny model diplomky používa **SNIM** (6-pozičný kód
TSP·PSP·UOT·INST), kde dáta sú v psete (dvere: `IFC_Dvere.Assembly Code` = `DD01`,
`Type Mark`=6→`06`, `Mark`=3→`03` ⇒ `DD01.06.03`, presne ako na výkrese). V inom projekte
môže byť kód v `Name`, klasifikácii či inom psete. Diplomka už má aj **IDS** na validáciu.

**Rozhodnutie (field-source resolver, projektovo-nezávislý):** kódovacia schéma sa
definuje **pred projektom** (z informačných požiadaviek / EIR) ako **usporiadané typované
polia + delimitery**, nie jeden hardcoded regex (poučené z Daluxových file naming
templates). Každé pole má **deskriptor zdroja** — ETL má sadu resolverov, config ich
zapojí:
- `from: property` (pomenovaný pset alebo naprieč všetkými), `attribute` (`Name`/`Tag`/
  `ObjectType`/`Description`), `classification` (system+identification), `type_property`
  (z `IfcTypeObject`).
- voliteľné `extract:` (regex capture — pre kódy zapečené v texte, napr. `Name` = `…CC:DD02.05…`)
  a `format:` (number→text, **zero-pad** šírkou podľa výkresu, case, trim).
- `applies_to` (applicability per IFC trieda) — rovnaká štruktúra ako IDS.

**Rozhodnutie (object_ref):** `object_ref` sa **skladá zo schémy**, nie z `Tag`. Type-level
(`DD01.06` → `asset_type`) aj instance-level (`DD01.06.03` → `asset`) — inštančné
kódovanie v diplomke je kompletné (skorší blocker padol; išlo o zámenu IFC `Tag` atribútu
s property `Mark`). Fallback na `ifc_guid` len keď kód v zdroji chýba. **Nahrádza
provizórne určenie `object_ref` z D-031** (Tag/Name fallback GUID).

**Rozhodnutie (jeden zdroj pravdy):** tá istá definícia (applicability + polia) poháňa
**extrakciu** (ETL: odkiaľ čítať) aj **validáciu** (IDS: či to tam je) — obe z požiadaviek
projektu. ETL sa dodáva generické; per-projekt dostane config (časom odvoditeľný z IDS).
Žiadny nový štandard nevyžaduje zmenu kódu, len inú definíciu schémy.

**Rozhodnutie (prepojenie dokument↔prvok — bez ručného IFC):** explicitný
`IfcRelAssociatesDocument` sa v praxi nepoužíva → **zavrhnuté ako primárna cesta**.
Primárne dve cesty:
1. **Naming convention súborov** — pozičné polia + delimiter (Dalux štýl); pri uploade sa
   názov rozseká → `object_ref` + `role`. Pre legacy archívy fallback **`links.csv`** manifest.
2. **PDF text scan** (výkresy) — `pdfplumber` vyťahuje text + bounding boxy; regex je
   **odvodený zo schémy**. Bublina na výkrese nie je jeden reťazec (`DD01` a `06.03`
   zvlášť) → **proximity match** (tokeny v okruhu poskladané do kódu) + viacúrovňovo
   (`DD01` = type/podlažie stačí; `.06.03` upresní inštanciu). Match na string zložený
   z DB voči tomu, čo je v PDF (Daluxov caveat: fonty/medzery/bold ovplyvňujú detekciu).
- AI content matching (LLM nad obsahom PDF) = budúce rozšírenie, nie teraz.

**Dôsledok:** nový `etl/scheme.py` (field-source model + SNIM definícia z
`SNIM - Hierarchia.pdf`); prepis `_RefAllocator` v `etl/transform.py` (object_ref zo
schémy + padding + validačný report = náš mini-IDS); až potom dáva zmysel D-032 pipeline.
**Poradie implementácie: identity spine (object_ref) → document pipeline → ICDD export.**

### D-034 — Rozsah importu = informačné požiadavky (čo je „asset")
**Kontext:** ETL dnes berie ako `asset` **každý `IfcElement`** (mínus otvory) a ako
`asset_type` **každý `IfcTypeObject`**. Na reálnom modeli diplomky (`ASR.ifc`) to dáva
2643 „assetov" a 437 „typov" — z toho väčšina je šum: **1378× `IfcMember` (stĺpiky
fasády), 126× `IfcPlate` (výplne), 398× vnorený `IfcCurtainWall` (panely)**, a medzi
typmi **89× `IfcSpaceType` / 159× `IfcMemberType`**. Každý model je pritom iný — pevný
zoznam tried v kóde by sa pri ďalšom projekte rozsypal.

**Zistené (sken ASR IFC):** prirodzená hranica je **dekompozícia `IfcRelAggregates`**:
- **Top-level** (645) = prvok visí priamo v priestore (`ue.get_aggregate` = priestor/None)
  → reálne spravovateľné prvky (steny, dvere, strechy, dosky, VZT terminály, stĺpy,
  podhľady, fasáda ako 19 celkov, schody).
- **Nested** (1998) = prvok je *časť* iného elementu → build-up rodiča (stĺpiky, výplne,
  panely fasády, vrstvy strechy). **NIE samostatný asset.**
- **Výnimka:** `IfcWindow` (26) a `IfcDoor` (10) majú v tomto modeli rodiča
  `IfcCurtainWall` (osadené vo fasáde), ale **funkčne sú samostatné** (tých 10 dverí má
  SNIM kód) → patria medzi assety napriek vnoreniu.

**Rozhodnutie (princíp):** *„asset = to, na čo máme vypísanú informačnú požiadavku."*
Rozsah importu **nie je hardcoded v kóde**, ale vychádza z **požiadaviek projektu**
(EIR → kódovacia schéma `applies_to` / IDS applicability). Tá istá definícia tak poháňa
**tri** veci z jedného zdroja pravdy (rozširuje D-033): **(1) čo importovať** (scope),
**(2) čo dostane kódovaný `object_ref`** (extrakcia), **(3) čo sa validuje** (IDS, E6).
Priestorová kostra (site/building/floor/space) sa importuje **vždy** (aj keď nie je
„požadovaný asset" — je to skelet hierarchie). Princíp **„mimo scope ≠ zahodiť"**: prvok
sa buď neimportne, alebo importne s príznakom out-of-scope + `_`-capture (analógia
capture-don't-structure, D-024), aby sa dal neskôr promovať.

**Dôvod:** každý model je špecifický; jediný udržateľný filter je *čo projekt požaduje*,
nie zoznam tried v kóde. Zjednotenie scope+extrakcia+validácia pod jednu definíciu drží
konzistenciu a robí pridanie štandardu/triedy otázkou **inej definície, nie zmeny kódu**
(línia D-033). Štruktúrne kritérium (top-level vs sub-komponent) je IFC-natívne a nezávisí
od kvality kódovania (okná v tomto modeli **nemajú** `Assembly Code`, no stále ich chceme).

**Dôsledok (fázovanie, prevažne aditívne):**
- **Teraz (E2):** `_is_asset`/`asset_type` rozsah **číta z policy v `scheme.py`** (nie
  hardcoded): default = applicability schémy **∪** štruktúrne pravidlo (top-level +
  blacklist `IfcMember`/`IfcPlate`/vnorené panely + výnimka `IfcDoor`/`IfcWindow`).
  `IfcSpaceType` sa **nikdy** nestáva `asset_type` (priestor nie je asset).
- **Neskôr (platforma):** zdroj scope = **parsovaný IDS** projektu; viaže sa na
  *multi-projekt scoping* (§7) — každý projekt = vlastná schéma + IDS config. Výmena
  zdroja scope je aditívna, kód `_is_asset` sa nemení.
- Schéma DB sa **nemení** (čisto ETL/aplikačná vrstva).

**Dodatok (D-042/D-043 ladenie linkovania): `IfcRailing` → `nested_keep`.** Pri overovaní
nezhôd vo výkresoch sa ukázalo, že `ZV01.02` (madlo) **je v IFC**, no chýbal v DB: všetky
madlá/zábradlia (`IfcRailing`, ZV + TV) sú modelované **vnorené v `IfcStair`**, takže
ich `_is_asset` zahadzoval ako sub-komponenty (prežil len 1 top-level kus → `ZV01.01`).
Riešenie: `IfcRailing` doplnené do `nested_keep` (vedľa `IfcDoor`/`IfcWindow`) — funkčne
samostatný prvok s vlastným SNIM kódom a informačnou požiadavkou, rovnaký dôvod ako dvere.
Zámerne **nepridané** `IfcSlab` (vrstvy strechy ST — reálne sub-komponenty; typy `ST01.*`
sú už z top-level `IfcRoof`) ani `IfcStairFlight` (ramená SH). Efekt: +11 railing assetov
(IfcRailing 1→12), nový typ `ZV01.02`; re-load ETL bez `--reset` (idempotentný upsert cez
`object_ref`) + re-run `pdf_link` → element-väzby 193→197, regióny 404→414. Pozn.: kódy
`KV*`, `ZV03/04/05`, `OV05` z výkresov **nie sú v IFC vôbec** (reálna medzera modelu, nie
import) a `OV01.00.00` je placeholder generickej legendy „POPISKA" — tieto ostávajú nelinknuté.

### D-035 — Konsolidácia podlaží: pomocné Revit úrovne → reálne podlažie
**Kontext:** `ASR.ifc` má **18 `IfcBuildingStorey`**, ale len 5 sú reálne podlažia
(`1NP`–`5NP`). Zvyšok sú pomocné Revit referenčné/konštrukčné úrovne
(`1NP_SH_ZD`, `1NP_HH_ZD`, `2NP_SH_STROP`, `2NP_HH_STROP`, …, `Dojazd_výťahov`,
`0_Prahy_základová_špára`, `Spadova vrstva`). Tieto úrovne **nesú reálne assety**
(napr. `1NP_HH_ZD` 45 prvkov, `Spadova vrstva` 73), takže ich nemožno len zahodiť —
ale ako samostatné „floor" uzly by Viewer (strom triedený podľa elevácie, D-027)
zobrazil 18 kryptických podlaží = **šum** (cieľ E2 je „bez šumových uzlov").

**Rozhodnutie:** ETL **konsoliduje** podlažia (`etl/transform.py:_resolve_floors`):
- **Reálne podlažie** = názov `^\d+NP$` **alebo** aggreguje aspoň jeden `IfcSpace`.
- Pomocné úrovne sa **nepublikujú** ako `floor` uzly; ich assety/priestory sa
  premapujú na reálne podlažie podľa **NP-prefixu názvu** (`2NP_HH_STROP` → `2NP`),
  inak (názov bez NP: `Dojazd_výťahov`, `Spadova vrstva`) podľa **najbližšej elevácie**.
- `located_in` pre asset/priestor ide vždy na premapované reálne podlažie.
- Fallback: ak model nemá rozpoznateľné reálne podlažia (iný projekt), ETL ponechá
  všetky storeys (neriskuje stratu skeletu).

**Dôvod:** princíp **„mimo scope ≠ zahodiť"** (D-034) — assety z pomocných úrovní sa
zachovajú, len sa zavesia na zmysluplné podlažie. Štruktúrne kritérium (reálne =
má priestory / `NP` názov) je IFC/projektovo robustné a deterministické; demo dostane
čistú 5-podlažnú hierarchiu namiesto 18 Revit-artefaktov. Pravidlo je ETL-lokálne
(žiadna zmena DB schémy ani Viewera).

**Dôsledok:** ASR → **5 podlaží** (`1NP`–`5NP`), 89 priestorov, 681 assetov; jediný
koreň `site`. Väčšina assetov je `located_in` priamo podlažie (model ich kontajneruje
v storey, nie v space) — priestory tak môžu byť poloprázdne, čo zodpovedá modelu.
Mapovanie pomocných úrovní podľa **názvu** je závislé na Revit konvencii projektu;
iný projekt s inou konvenciou pomenovania levelov dostane vlastnú heuristiku (aditívne).

---

## 7. Otvorené otázky (ešte neriešené)

- **IFC model diplomky** — doladiť property sety, klasifikácie, priestorovú hierarchiu (prerekvizita ETL)
- **LLM interface** — konkrétne queries ktoré demo ukáže (schéma to zvládne); parkované do S-LLM (D-026)
- **Verejné spustenie** — termín a forma (LinkedIn, standalone URL)
- **Ďalší rozvoj po AIM Vieweri** — procesy, MIDP/TIDP generovanie
- **property_set_templates** — voliteľná referenčná tabuľka pre bSDD validáciu psetov (až pri validácii handoveru)
- **Actor model C** — org-hierarchia, štruktúrované adresy, intrinsic roly (plánované aditívne, viď D-024)
- **Multi-projekt scoping** — dnes 1 Supabase = 1 budova; pre platformu pridať `project`
  entitu + coding-scheme config per projekt (D-033/D-034). Aditívne, rieši sa pri 2. projekte.
- **IDS-driven import scope** — strojové odvodenie rozsahu importu z IDS applicability
  (D-034); teraz config-driven default v `scheme.py`, plné parsovanie IDS až s platformou.
- **`rel_supersedes`** — explicitná väzba revízií dokumentov (D-032); zatiaľ implicitne
  cez name + `valid_from`.
- **Instance-level INST padding** — šírka číselných polí (`Mark` `03` vs generický `001`)
  potvrdiť per pole podľa toho, čo je vytlačené na výkrese (D-033 `format.pad`).
- **AI/LLM matching dokumentov** — content-based párovanie PDF↔prvok keď naming/scan
  nestačí (D-033); až s reálnymi dátami z viacerých projektov.

**Vyriešené počas návrhu schémy:** dátový model AIM Viewer (D-018–D-024), type vs occurrence (D-021), actor granularita (D-024).
**Vyriešené v dokumentovom brainstorme:** úložisko + model + export PDF (D-032), coding scheme + object_ref + linking (D-033). Z otvorených odstránené „dokument-element linking" a spresnený zdroj `object_ref`.

---

## 7b. Dokumentová identita (E3)

### D-036 — Dokumentová naming convention = CDE štandard (ISO 19650)
**Kontext:** D-032/D-033 odložili „naming convention finálny tvar" ako otvorený bod.
Pri prvkoch je identity spine `object_ref` (coding scheme, E1); pri dokumentoch je ním
**naming convention** — názov súboru sám nesie metadáta a `doc_upload.py` ho rozseká
(rovnaký princíp ako `scheme.py` pri `object_ref`). Namiesto generického ISO 19650
preberáme **konkrétny reálny CDE štandard** (Jihočeský kraj, „Standard CDE — Společné
datové prostředí", v ISO 19650 línii) — je autoritatívny, používaný v praxi a slovník
kódov je hotový.

**Rozhodnutie (konvencia — 7 pozícií, oddeľovač `_`):**
```
Projekt _ StupeňPD _ ČástDíla _ Profese _ TypSouboru _ Číslo _ Popis
 OCB    _  DPS     _  SO01    _  ARS    _  VD        _ 101   _ Pudorys-1NP
```
- **Projekt** — jeden spoločný identifikátor (`OCB` = Office centrum Brno).
- **Stupeň PD** — fáza dokumentácie: `ADS` štúdia · `DPZ` pre povolenie · `DPS` pre
  prevedenie · `DSPS` skutočné prevedenie · `PAS` pasport · `XX` obecný. *(Priamo náš
  use-case „návrh → výstavba → prevádzka".)*
- **Část Díla** — členenie diela: `SO01` stavebný objekt / `PS01` prevádzkový súbor.
  *(Najhrubšia štruktúrovaná väzba na uzol — u nás 1 budova → `SO01` → building.)*
- **Profese** — odbor (zo zvoleného dátového štandardu, potvrdí BEP): `ARS` archi ·
  `STA` statika · `TZB`/`VZT` technika prostredia · `ZTI` zdravotech · `ELT` elektro ·
  `POZ` požiar · `STF` stavebná fyzika.
- **Typ souboru** — forma: `VD` výkres · `RP` report/správa · `SP` špecifikácia ·
  `TL` technický list · `VV` výkaz výmer · `KAL` výpočty · `SC` schéma · `DiMS` model ·
  `TP` technologický predpis · `ST` štúdia · `XX` neurčené.
- **Číslo** — poradové (`101`); môže odrážať kapitolu vyhlášky (`D-1-2-3-b-01`).
- **Popis** — ľudský, max 20 znakov, medzery/bodky → `-`.

**Pravidlá zápisu (z CDE):** oddeľovač `_` (U+005F); premenlivá dĺžka pozícií; **bez
diakritiky**; všetko VEĽKÝMI okrem Popisu; chýbajúci údaj → zástupný `X`; celá cesta
≤ 256 znakov; Popis ≤ 20 znakov.

**Status / revízia (mimo názvu):** ISO 19650 stavy `WIP → S1–S4 (zdieľané) → A1/B1
(publikované) → AB (as-built)` sa **nekódujú do názvu** — držia sa v `documents.status`
+ `documents.revision` + `valid_from` (D-032), aby názov ostal stabilný (jeden zdroj
pravdy). Mapuje sa do `documents.status`.

**Rozhodnutie (väzba dokument↔uzol):** CDE konvencia **nemá pole pre podlažie** — údaj
„1NP" žije vo voľnom Popise, nie v štruktúrovanej pozícii. Preto sa väzba **nederivuje
z názvu**, ale ide **explicitným stĺpcom `target_ref` v manifeste** (`docs.csv`):
object_ref cieľového uzla (`SO.01 - Office centrum Brno` = building, `1NP`–`5NP` = floor,
neskôr SNIM `DD01.06.03` = asset). Názov nesie metadáta, manifest nesie väzbu — čisté
oddelenie. Element-level väzba z obsahu výkresu ostáva E4 (PDF scan).

**Dôsledok:** nový `etl/doc_scheme.py` (mirror `scheme.py`: typované pozičné polia +
CDE slovníky + parser názvu → `DocumentMeta` + odvodenie `role` z Typ souboru) a
manifest `podklady/docs.csv`. Iný projekt = iný slovník v `doc_scheme.py`, kód sa nemení
(línia D-033). Konvencia rieši otvorený bod „naming convention finálny tvar" z §7.
**Referencia:** `Standard_CDE_Společné_datové_prostředí.docx` (Jihočeský kraj, v1.12.2025).

### D-040 — Priestory: zachytenie `IfcSpace.LongName` (prípona `spaces`)
**Kontext:** Vo Vieweri sa priestory (miestnosti) zobrazovali len ako číslo (`2.04`)
bez názvu. `IfcSpace` má dva textové atribúty: `Name` = číslo miestnosti a **`LongName`
= popis funkcie** (`Serverovňa`, `WC Muži`, `Openspace - Západ`). ETL ukladal len `Name`
(→ `objects.name`), `LongName` sa nikde nezachytával (v ASR má LongName všetkých 89/89
priestorov; `IfcZone` v modeli nie sú).

**Rozhodnutie:** `LongName` ide do **tenkej prípony `spaces`** (`id` FK na `objects(id)`,
`long_name text`) — verné konvencii (CLAUDE.md: IFC atribúty = stĺpce, typovo-špecifické
→ 1:1 prípona ako `floors`/`documents`/`persons`). `objects.name` ostáva číslo miestnosti
(IFC `Name`), `object_ref` tiež číslo (generický ref ho už takto rozlišuje). Pridaný
`v_spaces` (analogicky k `v_floors`). Migrácia aditívna.

**Zobrazenie (Viewer):** priestor sa renderuje ako **„číslo — popis"** (`2.04 — Serverovňa`);
label sa skladá v data-vrstve (`lib/data/spatial.ts`, join `spaces.long_name`), takže
strom, breadcrumb, deti aj hlavička uzla ho zdieľajú.

### D-041 — PDF výkres auto-linking: dôverové vrstvy matchu + element-väzby (E4)
**Kontext:** dokončenie D-032/D-033 pipeline (`etl/pdf_link.py`): PyMuPDF vytiahne slová +
bboxy z výkresov, regex **odvodený zo schémy** deteguje SNIM kódy, match na `object_ref` →
`rel_has_document(prvok → výkres)`. Bublina prvku nie je vždy jeden reťazec (`SN11` a `01`
zvlášť) → **proximity match** spojí holý Assembly Code s blízkym číselným fragmentom. Prvý
beh mal false-positives: `OV01.00.00` (výšková kóta ±0.000), `ZV01.02` (číslo osi/iného
Marku) — proximity bral aj kóty a čísla osí. Zdvihnúť `PROXIMITY_PT` nešlo: **všetkých 83
inštancií dverí** (`DD01.06.03`…) vzniká práve proximity matchom (Mark je vedľa kódu).

**Rozhodnutie (tri dôverové vrstvy podľa pôvodu detekcie, nie ladenie prahu):**
- **`full`** — celý kód s **vytlačenou bodkou** (`PD02.31`, `DD01.06.03`): dôveryhodný
  dôkaz zámeru → **exact match** na `object_ref`; bez zhody = **reálna medzera** (reportuj).
- **`proximity`** — poskladaný z dvoch blízkych tokenov (heuristika): **exact match**; bez
  zhody v DB = **šum → zahoď** (dva nesúvisiace tokeny náhodou blízko netrafia reálny ref).
  Týmto padli `OV01.00.00` aj `ZV01.02` bez straty jediného reálneho dverového matchu.
- **`bare`** — holý Assembly Code bez Marku (`SN11`, `FS01`): **prefix-match** na **typy**
  `SN11.*` (výkres ukazuje typ prvku, nie konkrétnu inštanciu — Mark na bubline chýba).

Princíp: *kód s vytlačenou bodkou je dôkaz; proximity je dohad — dohad bez cieľa v DB je
šum z kót/osí.* Žiadny SNIM hardcode mimo `scheme.py` — len logika dôvery nad detekciou.
Dôsledok: párovanie prvkov sa správa podľa toho, ako je model kódovaný — **dvere** (majú
`Mark`) linkujú na úrovni **inštancie** (`asset`), **steny/fasáda** (len typové kódovanie)
na úrovni **typu** (`asset_type`). Oboje je vecne správne.

**Rozhodnutie (zápis a idempotencia):** hrany nesú `source='pdf_link (E4)'` a `role='drawing'`,
smer **prvok → výkres** (D-014). Deterministické `edge_id(from,to,'has_document')` (`ids.py`)
→ re-run je idempotentný a **nepoškodí E3** väzby (`source='doc_upload (D-036)'`, iný `from_id`
→ iné `id`). ASR: **193 element-väzieb** (1NP 57, 2NP 39, 3NP 37, strecha 24, Rez-A 36).

**Rozhodnutie (Viewer):** E4 väzby majú **vlastnú sekciu**, oddelenú od bežných dokumentov
(diskriminátor = `source`, nie `role` — E3 aj E4 používajú `role='drawing'`):
- **asset / asset_type** → „**Zobrazený vo výkrese**" (PDF link); vyňaté z generickej
  „Dokumenty", nech sa nezdvojuje (`fetchElementDrawings`).
- **podlažie / budova** → „**Prvky vo výkrese**" — výkresy uzla + prvky auto-detegované
  v každom (`fetchFloorDrawings`); výkres bez prvkov sa skryje (PBR pôdorys 1NP = 0 prvkov).

**Dôsledok:** `etl/pdf_link.py` (tiering v `detect_codes`/`process_drawing` + prefix-index
typov `_types_by_assembly`); `lib/data/relations.ts` (+`DrawingLink`/`ElementInDrawing`/
`FloorDrawing`, `fetchElementDrawings`/`fetchFloorDrawings`); komponenty `drawing-list.tsx`,
`drawing-elements.tsx`. Schéma DB sa **nemení** (čisto ETL/aplikačná vrstva). Reportovacie
vrstvy (medzera vs. ignorovaný proximity) sú v `--show-unmatched` oddelené.

### D-042 — Interaktívna prehliadačka výkresov (klikateľné SNIM kódy) — *plánované*
**Status:** návrh na **odprezentovanie previazanosti dát** (D-003) — kostra rozhodnutá,
implementačné detaily sa **doladia počas sprintu** (pracovne sprint „DV", ROADMAP).
Nadväzuje priamo na E4 (D-041).

**Kontext:** E4 (`etl/pdf_link.py`) deteguje SNIM kódy vo výkresoch (PyMuPDF) **aj
s bounding boxmi** a rozparuje ich na `object_ref` → objekt, no dnes z toho zapíše len
hranu `rel_has_document` a **bbox zahodí**. Tým je drahá časť (detekcia + rozparovanie)
hotová; chýba len uchovať súradnice a vykresliť klikateľnú vrstvu.

**Rozhodnutie (cieľ):** výkres v appke, kde sú detegované kódy **klikateľné** → vedú na
detail prvku (`/node/[id]` / `/type/[id]`), a **opačne** z karty prvku („Zobrazený vo
výkrese") sa otvorí výkres **so zvýrazneným prvkom**. Vizuálne ukazuje práve previazanosť,
ktorá je jadro dema.

**Rozhodnutie (dáta — bez zmeny schémy):** link regióny sa uchovajú v
`documents.properties._drawing_links` (JSONB, `_`-kľúč = meta/zachytené dáta, NIE pset —
konvencia D-022). Per región: `{page, bbox, page_size, target_id, target_route, layer,
label}`. Súradnice sa ukladajú v **PDF bottom-left** + rozmer strany — y-flip a rotácia
sa riešia raz, na zdroji. **Detekcia ostáva jeden pipeline**: `pdf_link.py` plní hrany
(E4) **aj** regióny (D-042), žiadna druhá detekčná logika v JS.

**Rozhodnutie (fázovanie — MVP najprv):**
- **A — dátový základ (ETL):** `pdf_link.py` zapíše `_drawing_links` (prerekvizita B aj C).
- **B — MVP (ETL):** `etl/pdf_annotate.py` zapečie URI-link anotácie do PDF
  (`page.insert_link` → `${SITE_URL}/node/{id}`) → kódy klikateľné v **akomkoľvek**
  prehliadači, nula frontendu. URL z configu (env-špecifické).
- **C — plná in-app prehliadačka (Viewer):** route `app/(viewer)/drawing/[id]`, render
  **react-pdf** (pdf.js), overlay priehľadných `<Link>` boxov z `_drawing_links`
  (`viewport.convertToViewportRectangle`), hover highlight + zoom + stránkovanie.
- **D — obojsmernosť (Viewer):** `/drawing/[id]?focus={ref}&page={n}` z karty prvku →
  odscrolluje/zoomne na box a zvýrazní ho.

**Dôsledok / vzťah k D-038:** toto je **užšia podmnožina** parkovaného D-038 (PDF
split-screen) — **bez 3D geometrie a georeferencingu**; D-038/D-039 ostávajú kandidáti.
Schéma DB sa **nemení** (čisto ETL/aplikačná vrstva). Holý typový kód = N inštancií →
región mieri na stránku **typu** (1 cieľ). Otvorené (nie blokujúce): hĺbka zoom/pan
(mobil/touch odložiť), či zobrazovať aj `proximity`/nezhodné kódy slabšie (zatiaľ nie).

**Implementačné rozhodnutia počas sprintu DV:**
- *Fáza A (hotová):* `pdf_link.py` plní `_drawing_links` v **tom istom** pipeline ako E4
  hrany — bbox sa nesie cez `Hit`, y-flip raz cez `_to_bottom_left` (PyMuPDF top-left →
  PDF bottom-left). **Jeden región na previazaný prvok** (dedupe per `target_id`, poradie
  dôvery `full > proximity > bare`) → súčet regiónov = počet E4 zhôd (193). `jsonb_set`
  s `create_missing` = idempotentný prepis blobu, ostatné `properties`/hrany netknuté.
  0-regiónový výkres (PBR pôdorys) dostane `_drawing_links: []` (kľúč prítomný).
- *Fáza B (hotová):* `etl/pdf_annotate.py` číta `_drawing_links` (žiadna druhá detekcia)
  a cez `page.insert_link` zapečie URI-linky `${SITE_URL}/{target_route}/{target_id}`.
  **Úložisko (vyriešená otvorená otázka):** *samostatná cesta*, nie prepis — anotované
  PDF idú do `podklady/ANNOTATED/` (zrkadlí `source_path`, zdroj v `FINAL/` netknutý;
  `podklady/` je gitignored). `SITE_URL` z `etl/config.py` (env-špecifické, default =
  produkčná Vercel URL). 0-regiónový výkres sa preskočí (nevytvára prázdnu kópiu).
  Overené: 193 URI-linkov, round-trip box ↔ text kódu 23/23 (rotácia 0, offset mediaboxu
  rieši PyMuPDF interne).
- *Fáza C (hotová):* in-app prehliadačka. Route `app/(viewer)/drawing/[id]` (server) →
  `lib/data/drawing.ts` (`fetchDrawing`: `documents.location` = zdrojové PDF zo Supabase
  Storage + `_drawing_links`). Render `react-pdf` (pdf.js) v client komponente
  `drawing-viewer.tsx`, načítanej cez `drawing-viewer-loader.tsx` (`next/dynamic`,
  `ssr:false` — pdf.js potrebuje DOM/Worker). pdf.js **worker z CDN** (unpkg, viazaný na
  `pdfjs.version`) — robustné pod Turbopackom, bez bundler-špecifického riešenia.
  Klikateľné boxy = absolútny overlay nad `<Page>`; bbox (PDF bottom-left) sa škáluje na
  renderované px (`onRenderSuccess` dims, `pageSize` báza), y-flip v UI. Box = `<Link>` na
  `/{target_route}/{target_id}` + hover highlight. Toolbar: stránkovanie + zoom (0,5–3×;
  pan = scroll, touch/pinch **odložené** ako v D-042). Vstup do prehliadačky: odkaz
  „Prehliadačka" na karte prvku (`drawing-list.tsx`) aj podlažia (`drawing-elements.tsx`).
  Nová závislosť: `react-pdf@10` (+`pdfjs-dist@5`). Overené v dev/preview: 1NP render,
  57 boxov presne na kódoch, klik → detail typu, build zelený.
- *Fáza D (hotová):* obojsmernosť. Route prijíma `?focus=<id>&page=<n>`; karty prvku
  („Zobrazený vo výkrese", `drawing-list.tsx`) podávajú odkaz „Prehliadačka" s
  `?focus=<objects.id>` (id uzla dotiahnuté cez `NodeSectionsCards`/type page). Viewer
  zacieli región podľa `targetId === focus`, skočí na jeho stranu, priblíži (250 %),
  odscrolluje na box (`scrollIntoView` center) a krátko ho rozpulzuje + trvalý `ring-2`
  highlight. Soft-navigácia s iným `?focus=` znovu zacieli (`useEffect([focus])`).
  **Odchýlka od D-042 (`focus={ref}`):** focus je `objects.id`, nie `object_ref` —
  presná zhoda na `target_id` regiónu (dedupe per prvok), bez encodovania bodiek/medzier
  v object_ref. Overené end-to-end v preview: klik „Prehliadačka" → výkres so zoomom,
  zvýraznený a vycentrovaný box; opačný smer (klik kódu → detail) z fázy C.
- *Doladenie (po spätnej väzbe):*
  - **Ostrosť zoomu:** strana sa renderuje pri `devicePixelRatio` až 2× (strop
    `MAX_RENDER_PX` chráni pred obrími canvasmi), `ZOOM_MAX` zdvihnutý na 5×. Tenké
    čiary/drobný text ostávajú čitateľné (predtým raster pri ~1.25× = zubaté). Plne
    vektorový render by chcel iný engine (pdf.js SVG backend je odstránený) — zámerne nie.
  - **Bočný info-panel namiesto novej stránky:** klik na kód prvok **vyberie** (nevyskočí
    na celú stránku) a vpravo sa zobrazí kompaktný panel (`element-info-panel.tsx`):
    identita, IFC typ, PredefinedType, typ (pri asset), klasifikácie/výskyty, **zoznam
    všetkých priradených dokumentov** (klikateľné na `/node/[id]`, badge „výkres" pre E4)
    + „Otvoriť celý detail". Dáta z `GET /api/element/[id]` (`fetchNodeSummary`, cachované,
    `documents` = dedupe `rel_has_document`). Plochu drží
    `drawing-workspace.tsx` (riadený `selectedId`, `onSelect`); `?focus=` predvyberie
    prvok. Ctrl/⌘-klik na box stále otvorí celý detail v novej karte. `drawing-viewer-
    loader.tsx` nahradený `drawing-workspace.tsx`. Overené v preview (1440px): klik →
    panel vpravo, žiadna navigácia, render pri ratio 2×.
  - **Prehliadačka = kanonické zobrazenie každého dokumentu:** `/drawing/[id]` slúži pre
    **ľubovoľný PDF dokument** (všetkých 13 v seede je PDF), nielen výkresy. PDF vľavo
    (overlay boxov len ak má `_drawing_links`), vpravo panel: **predvolene info o
    dokumente** (`document-info-panel.tsx` — Metadáta + „Pripojené k", mirror pôvodnej
    detail-stránky), po kliku na kód **detail prvku** so „← Späť na dokument"
    (`ElementInfoPanel onBack`). Staré `/node/[docId]` (object_type=document) **presmeruje**
    na `/drawing/[id]`; `DocumentView` odstránený. Odkazy na dokumenty (sidebar „Dokumenty",
    `document-list`, `drawing-list`/`drawing-elements` názvy) vedú na `/drawing/[id]`. Dáta:
    `fetchDocument` (panel) + `fetchDrawing` (PDF+regióny) paralelne v route. Badge hlavičky
    „Výkres"/„Dokument" podľa prítomnosti kódov. Overené: výkres (panel dokumentu →
    klik kódu → prvok → späť), bežné PDF bez kódov (badge Dokument, 0 boxov, panel),
    redirect `/node/[doc]`→`/drawing`.
  - **Filter „Pripojené k" podľa typu objektu:** panel dokumentu zoskupuje naviazané
    objekty podľa `object_type` (D-018) a ponúka filter-chipy (Podlažie / Asset / Typ
    assetu / Dokument…) s počtami + „Všetko"; zoznam má max-výšku so scrollom. Pri 1NP:
    58 = 1 podlažie + 33 asset + 24 typ assetu. Overené v preview.
  - **Región = fyzický výskyt, nie prvok (oprava dedupe):** pôvodný `pdf_link.py` robil
    dedupe regiónov per `target_id` → ten istý kód opakovaný vo výkrese (napr. `ST01.21`
    4×, `FS01.10` 3×) mal **len jeden** klikateľný hotspot, ostatné výskyty boli „mŕtve".
    Dedupe sa presunul na úroveň **(strana, bbox, target_id)** → každý fyzický výskyt =
    vlastný región; hrana `rel_has_document` ostáva 1 na prvok (sémantická väzba cez
    `matched_ids`). Frontend to už zvládal (`pageLinks` renderuje všetky, `key` s indexom).
    Efekt (`--dry-run`): regiónov **193 → 378** (Rez-A 36 → 82), väzieb stále 193.

---

### D-043 — Skladby (kompozičné značky `S1`–`S9`) ako vlastný systém značenia
**Status:** **rozhodnuté — možnosť C (link na Výpis skladieb)**, implementované. Vyvolané
diagnostikou pokrytia odkazov vo výkresoch (Rez-A). Možnosť A (skladba ako uzol) ostáva
ako budúce bohatšie rozšírenie.

**Kontext:** Vo výkresoch (najmä rezoch/detailoch) existujú **dva paralelné systémy
značenia**, ktoré sme doteraz nerozlišovali:
1. **SNIM element-kódy** (`FS01.10`, `ST01.21`, `PD02.50`…) — Assembly Code + Type Mark
   + Mark, párujú sa na `object_ref` (D-010). E4/D-041 ich deteguje a linkuje.
2. **Skladbové značky** `S1`–`S9` (hexagónové bubliny s odkazovými čiarami) — odkazujú na
   **skladby konštrukcií** (build-up vrstiev), definované vo „Výpise skladieb"
   (`D.1.1.09`, dokument `OCB_DPS_SO01_ARS_VV_109`). Sú to **kompozície vrstiev**, nie
   konkrétne prvky.

**Problém:** Skladbové značky sa **nikdy nedetegujú ani nelinkujú**, lebo (a) nesedia na
regex SNIM kódu (`^[A-Z]{2}\d{2}…` vs. `S` + 1 číslica), (b) `S` nie je TSP prefix v
schéme, a hlavne (c) **v DB neexistuje uzol skladby** — nie je sa na čo naviazať. Vizuálne
to pôsobí ako „veľa odkazov chýba", hoci ide o iný dátový druh, ktorý sme nikdy nemodelovali.

**Zvažované možnosti:**
- **A — skladba ako uzol (`object_type='assembly'`, aditívne k D-018).** Každá skladba =
  riadok v `objects`, vrstvy do `properties`, väzba prvok↔skladba. Najbohatšie, ale nový
  uzol + seed + detail UI. **Odložené ako budúce rozšírenie.**
- **B — mimo rozsah (status quo).** `S#` sa neriešia. Zamietnuté (demo nevie ukázať skladby).
- **C — link na Výpis skladieb (PDF strana). ✅ zvolené.** Bublina `S#` sa nelinkuje na
  objekt, ale **na dokument Výpis skladieb otvorený na strane danej skladby**. Reuse
  existujúcej prehliadačky (D-042) — žiadny nový `object_type`, žiadna migrácia.

**Rozhodnutie (C — implementované):**
- **Žiadny uzol skladby, žiadna hrana.** Skladba je čistý **navigačný región** v
  `_drawing_links` výkresu: `target_route='drawing'`, `target_id` = `objects.id` dokumentu
  Výpis skladieb, **`target_page`** = strana skladby, `layer='skladba'`, `label='S#'`.
  `rel_has_document` sa pre skladby **netvorí** (smer D-014 je objekt→dokument; skladba
  nemá objekt). Cena: jeden navigačný hop, nulová zmena schémy/grafu.
- **Detekcia mimo SNIM matchera (D-033 čistota).** `S#` značky riešené samostatne
  (`detect_skladby`, whitelist značiek z Výpisu) — **nie** hackom do SNIM regexu.
- **Mapa `S#` → strana z Výpisu (`read_skladby`).** Každá skladba = jedna strana; značka sa
  identifikuje kotvou: token `S#`, ktorý má vo svojej hlavičke „Skladba …" (vertikálny pás
  < 18 pt) — odfiltruje textové „S4" v špecifikácii materiálu (napr. pás „PV 200 S4 N").
  Zistené: `S1→3 … S9→10` (bez S7). Overené end-to-end v preview: klik `S1` v Reze →
  Výpis na strane 3 (vegetačná strecha, ST01.20).
- **Frontend (`drawing-viewer.tsx`):** skladbový región = `<a href="/drawing/{id}?page={n}">`
  (bežná navigácia, **bez** bočného panela/`onSelect`), vizuálne **jantárová** farba odlišuje
  skladby od prvkových kódov (primárna). `DrawingRegion` rozšírený o `targetPage` a route `drawing`.
- **Efekt (`--dry-run`/zápis):** +26 skladbových regiónov (Rez-A +20, Pôdorys strechy +6);
  spolu **378 → 404** regiónov. Element-väzby (193) nedotknuté.

**Budúce (možnosť A) — otvorené:** ak bude treba štruktúrované dáta skladby (vrstvy,
materiály, hrúbky ako uzol + väzba prvok↔skladba „z čoho je strecha zložená"), spraviť
aditívne nad C: `object_type='assembly'`, vrstvy parsované z tabuľky Výpisu, región `S#`
prepnúť z dokumentu na uzol skladby. C ostáva fallback.

---

### D-044 — IFC 3D viewer (IFClite): geometria ako ephemerálny kontajner viazaný cez GUID

**Rozhodnutie:** Do AIM Viewer sa integruje **IFC 3D prehliadačka cez IFClite**
(LTplus AG / Louis Trümpler, MPL-2.0). Kľúčový architektonický princíp:
> **Postgres drží perzistentnú pravdu o dátach. Prehliadač drží ephemerálnu geometriu**
> (parsovanú klient-side — IFC súbor neopustí browser tab). Spája ich **IFC GUID**.
> **Postgres sa geometrie NIKDY nedotkne** — žiadne meshe, žiadny geometrický cache v DB.

Toto NEporušuje D-007 (sme dátový viewer, nie geometrický): geometria sa neukladá ani
nerozoberá ako dáta — len sa renderuje klient-side a **orchestruje ako informačný
kontajner** (referencovaný, prepojený cez GUID, zabaliteľný do ICDD pri handoveri, D-015).
Orchestrovať kontajner ≠ spracovať geometriu ako dáta.

**Technológia (IFClite):**
- Rust+WASM core, `@ifc-lite/wasm` npm/CDN (**pre-built WASM — nevyžaduje Rust
  toolchain**, vibecoding-friendly, D-004); WebGL/Three.js rendering template (WebGPU
  voliteľne neskôr); ~260 KB gzip.
- Podporuje IFC2X3/IFC4/IFC4X3/IFC5 (IFCX); MPL-2.0 (použitie/úprava/redistribúcia OK).
- Modulárne (30+ TS balíkov, 5 Rust crates) — berie sa len potrebné.
- Parsing a rendering oddelené: IFClite vie len podať meshe do existujúceho scene graphu.
- Relevantné neskôr: `drawing-2d` (rezy/pôdorysy → kryje S5/S6 split-screen zámer
  D-038), `IfcQuery`+DuckDB-WASM, IDS validátor.

**Tri úrovne ambície (fázovanie S5):**
1. **Embedded 3D panel** — zobrazí IFC, žiadna väzba na dáta (najslabší príbeh;
   postačí pre vizuálny trust signal).
2. **Obojsmerná selekcia** *(cieľový demo moment)* — klik na element v 3D → asset
   karta (`/node/[id]`, D-027); klik v strome (D-027) alebo na karte (D-028) →
   zvýraznenie prvku v 3D. Spojka = IFC GUID cez `ifc_guid_history` (D-010). Mapovacia
   vrstva `Master UUID ↔ GUID` sa stavia ako **znovupoužiteľná funkcia** (volá ju aj
   úroveň 3 aj prípadný LLM interface, D-005).
3. **Query bridging** — geometrický/priestorový výber v IFClite → dotaz na DB; opačne
   dátový filter → zvýraznenie v 3D. Autorita dotazu zostáva v DB (`v_asset_effective`/
   `v_asset_classifications` = jediný zdroj pravdy, D-028); IFClite query len na to, čo
   DB nevie (geometria, priestorová proximita). Prepojiteľné s LLM interface neskôr.

**Dôvod (strategický rámec — dve publiká, jeden zážitok):**
Demo číta dve roviny toho istého toku:
- **Vyšší manažment:** farebný 3D model = trust signal, dôkaz schopnosti pokrytia
  všetkých typov informácií vrátane geometrickej. Jednoduchý vstup do dát.
- **Praktici s reálnymi dátami:** za každým prvkom — dedičnosť, GUID história,
  zodpovednosti, klasifikačné fasety (D-028/D-029/D-041). Druhá rovina rovnakého kliku.
Posolstvo nie je „vieme renderovať IFC" (komodita), ale „vieme každý typ informácie —
geometrickú, dokumentovú, vlastnostnú, klasifikačnú, zodpovednostnú — držať prepojený
okolo jednej stabilnej identity a odovzdať ako štandardný kontajner" (CDE/ISO 19650,
D-003). **3D je brána do dát a dôkaz pokrytia, nie jadro.** Dramaturgia: pekný model
upúta → klik na element → odhalí informačnú hĺbku. Obe roviny v jednom plynulom toku,
nie ako oddelené záložky.

**Riziká a mitigácie:**
- **Rozmazanie identity produktu:** 3D nesmie byť landing page — demo začína dátami,
  3D vedie späť do dát; sémantika Viewera sa nemení.
- **Scope creep:** tvrdé pravidlo — Postgres sa geometrie nedotkne (žiadny mesh/cache
  v DB). 3D je izolovaný modul; jeho pád nesmie zhodiť dátový viewer.
- **GUID bridging krehký:** IFC GUIDs nestabilné pri reexporte (D-010). Pre prvé demo:
  použiť **ten istý IFC súbor** (ASR.ifc) na render aj ako zdroj GUIDov v DB (E2 ETL)
  → GUIDs sedí triviálne; triviálnosť je zámer, nie náhoda. GUID história ako „wow" ukázať
  až s dvoma verziami IFC a otestovaným párovaním cez `ifc_guid_history`.
- **Maturita závislosti:** IFClite je mladý projekt (1.x, jeden hlavný autor); pin verziu
  (nie `latest`), preferovať `threejs` (WebGL) template pred WebGPU pre naprieč-
  prehliadačovú kompatibilitu.

**Dôsledok:**
- Logicky **S5 — paralelná vetva**, nezačína kým nie je S4 polish uzavretý, ale
  **neblokuje S4 ani DV sprint** (D-042). Schéma DB sa **nemení** (geometria nie je v DB
  — čisto aplikačná vrstva).
- Predpoklad úrovne 2: GUIDs v DB zodpovedajú renderovanému IFC. E2 ETL naloadoval
  ASR.ifc → triviálne splnené pre prvé demo (D-031); žiadny ďalší ETL nie je potrebný.
- Konkretizuje a superceduje kandidáta **D-037** (§8). Budúce D-038/D-039 (split-screen,
  georeferencing) závisia od S5 úrovne 2+.

**Rozšírenie (D-055):** ďalšie preberateľné IFClite moduly (2D výkresy, meranie, rezy, IDS
validátor, IfcQuery) sú rozpísané v D-055.

### D-046 — IFC alignment stratégia: IFC4.3 slovník teraz, pripravenosť na IFC5/IFCX

**Rozhodnutie:** Platforma sa **sémanticky aj terminologicky zarovnáva na IFC4.3**
(dnešný súborový openBIM svet: IFC súbory, ICDD, COBie), a zároveň sa stavia tak,
aby **prechod na IFC5/IFCX bol relatívne bezbolestný**. Kľúčový posun v chápaní:
> Postgres je **engine/index nad IFC sémantikou**, nie vlastný konceptuálny model.
> Fyzický zápis (tabuľky, snake_case) je implementačný detail; pojmový model je IFC.
> „Vlastné" ostáva len to, čo IFC4.3 vyjadriť nevie — a to deklarovane a úzko.

**1. IFC-first naming (tvrdé pravidlo):**
Nový atribút/hrana/enum sa **nesmie pridať bez kontroly, či IFC4.3 pojem už má**.
Ak má → prevziať názov (snake_case per D-012) aj hodnoty enumu doslovne. Ak nemá →
deklarovaná extenzia so zápisom, kam patrí pri exporte (ICDD linkset dnes, IFCX
komponent zajtra). Zoznam extenzií žije v SCHEMA.md §5. Zabraňuje driftu synoným —
falošná „skoro-zhoda" so štandardom je horšia než priznaná extenzia.

**2. Audit proti IFC4.3 — stav a dlh:**
`documents` už je zarovnaná na `IfcDocumentInformation` (D-014): `identification`,
`description`, `location`, `purpose`, `revision`, `document_owner`, `status`,
`valid_from`, `valid_until` = priamo jej atribúty. Overené proti IFC4.3 docs
(2026-07-02): `IfcDocumentInformation` má 17 atribútov — chýbajúce (`intended_use`,
`scope`, `editors`, `creation_time`, `last_revision_time`, `electronic_format`,
`confidentiality`) sa pridajú **aditívne až keď budú treba**; `status` hodnoty
zarovnať na `IfcDocumentStatusEnum` (DRAFT/FINAL/REVISION/NOTDEFINED) — pokrýva aj
ISO 19650 stavové ambície. Hierarchia/verzie dokumentov: IFC má `IsPointer`/
`IsPointedTo` (dokument→dokument) a `HasDocumentReferences` (odkaz na časť dokumentu)
— keď príde verziovanie dokumentov, modelovať podľa toho, nie vymýšľať.

**3. Deklarované extenzie (úplný zoznam toho, čo IFC4.3 nevie):**
- **Metadáta na hrane** — `valid_from`/`valid_until`/`source`/dôverové vrstvy (D-041)
  na `rel_*`; `IfcRelAssociatesDocument` a spol. nenesú platnosť ani provenance väzby
  (pozor: `IfcDocumentInformation.ValidFrom` = platnosť *dokumentu*, nie *väzby*).
- **Identita naprieč verziami súborov** — `ifc_guid_history`, Master UUID (D-010).
- **Väzby naprieč IFC súbormi** (ARCH↔TZB federácia) — jeden IFC súbor je uzavretý
  svet; toto dnes rieši naša DB + ICDD linksety, natívne to prinesie až IFC5.

**4. Pripravenosť na IFC5/IFCX:**
IFC5 (alfa 2025/2026) = ECS model, JSON, **kompozícia vrstiev** — účastník pridáva
vlastnú vrstvu nad cudzí model bez jeho modifikácie. Naša DB je **konceptuálne presne
takáto vrstva** (procesná vrstva nad dizajnovými modelmi, ktorá ich nemení) — čiže
architektúra už dnes zodpovedá IFC5 patternu; prechod = nová serializácia, nie
prestavba. Konkrétne: sledovať alfu, **nestavať produkčné úložisko na alfe**, po
stabilizácii prototyp exportu procesnej vrstvy ako IFCX layer („naše dáta si zložíte
ako vrstvu na svoj model" — silný interop príbeh). ICDD (D-015) ostáva handover
formát dneška; obe cesty vychádzajú z tej istej sémantickej izomorfie.

**5. Build vs. borrow — update k IFClite (rozširuje D-044):**
IFClite medzičasom narástol: 2D výkresy (`drawing-2d` — pôdorysy/rezy/pohľady),
IfcQuery + DuckDB-WASM (SQL nad modelom), **IDS validácia**, BCF, federácia modelov,
editácia properties, exporty (glTF/CSV/JSON-LD/Parquet), server/desktop/Python.
Deliaca čiara: **všetko „čítanie/zobrazovanie/validácia IFC" = prebrať z IFClite;
vyrábame len identitu + procesnú vrstvu + provenance + verziovanie + cross-model
linkset** (= moat, nedá sa stiahnuť — je to dátová governance, nie softvér). Konkrétne
dôsledky: (a) **IDS = kandidátny formát pre LOIN validáciu úplnosti** (D-045) namiesto
custom pravidiel — štandardné, prenositeľné; (b) `drawing-2d` môže výrazne zlacniť
D-038/D-039 (pracovný 2D pohľad z modelu zadarmo; autorizované PDF s pečiatkou ostáva);
(c) vlastný STEP containment parsing (S5 fáza 3) časom nahradiť IFClite query API.
Riziko maturity trvá (jeden hlavný autor): pin verzií, izolovaný modul, tenká vlastná
interface vrstva.

**6. GUID stratégia pri zmene zdrojového IFC (konkretizuje D-010/D-044):**
- **Na zdroji:** v Revit export zapnúť „Store IFC GUID in element parameter" —
  povinný krok cleanup workflow (doplniť do postupu z `asr-ifc-cleanup`).
- **Primárny párovací kľúč = `object_ref`** zapísaný v modeli (IFC Name, commit
  7e87625) — naša identita, round-tripuje autoring nástrojom, prežije aj jeho výmenu.
  GUID = fallback, nie základ.
- **Matching pipeline pri reloade novej verzie** (budúci E-sprint): (a) `object_ref`
  match → (b) GUID match, pri zmene zápis do `ifc_guid_history` → (c) heuristika
  (ifc_type + name + priestorové zaradenie) → (d) manual review queue. Nespárované
  **nikdy nemazať** — označiť `valid_until` (vzor lifecycle events, D-045).

**Dôvod:** Pôvodná úvaha „vlastný slovník + mapovanie na hranici" podcenila, koľko
z našich potrieb IFC4.3 už pokrýva (viď audit §2) a kam smeruje IFC5 (vrstvy = náš
pattern). Zdieľaný štandardný slovník šetrí prácu všetkým účastníkom a robí export
serializáciou namiesto prekladu. Zároveň prax aj literatúra potvrdzujú, že IFC ako
*fyzické úložisko* je slepá ulička (riedke tabuľky, výkon) — hybrid relačné properties
+ grafové hrany, čo `objects`+`rel_*` presne je. Sémantika štandardná, engine náš.

**Dôsledok:** Schéma sa **nemení** (žiadna migrácia teraz) — `documents` už je IFC-shaped,
zvyšok je pravidlo do budúcna + aditívne doplnky. SCHEMA.md §5 rozšírená o atribútové
zarovnanie a zoznam extenzií; CLAUDE.md doplnené o IFC-first pravidlo. Follow-up
kandidáti (nie záväzky): E-sprint GUID matching pipeline (odomkne „wow" GUID histórie
z D-044 s dvoma verziami IFC), IDS/LOIN validácia cez IFClite (viaže sa na D-045),
`status` enum zarovnanie pri najbližšej práci s dokumentmi.

**Nadväznosť (D-051):** IFC-first naming a IFC-kanonická identita vzťahov sa v D-051
presúvajú do generického meta-modelu `relationships` + manifest (porty cez `IfcRelNests`
— pozn.: `IfcRelConnectsPortToElement` je deprecated, len fallback pre staré súbory).

### D-047 — Demo north-star: LLM nad grafom + trust loop; ETL na distribučné systémy

**Rozhodnutie:** Ťažiskom dema (wow efekt) je **prirodzený jazyk nad naším grafom** —
nie hotové CDE workflow, nie GUID verziovanie (to je **podporné**, ukáže sa mimochodom).
Naratív dema predáva **disciplínu, nie nástroj**: *„keď sú vaše dáta správne previazané
(konvencia D-036 + identifikátory D-010 + IFC vzťahy), toto zvládnu aj vaše dáta."*

**Headline dotaz (must):** *„na tomto `IfcDistributionSystem` nájdi uzatvárací `IfcValve`
a v ktorej je miestnosti."* Kľúčové zistenie (over. proti IFC4.3 docs 2026-07-02): **je to
grafový dotaz, nie geometria.** Rozklad na IFC vzťahy — všetky relačné, ETL-ovateľné do
`objects`+`rel_*` bez geometrie:

| Časť dotazu | IFC4.3 mechanizmus | U nás |
|---|---|---|
| „uzatvárací" | `IfcValve`/`IfcValveType`, `PredefinedType = ISOLATING` (+ `Pset_ValveTypeIsolating.IsNormallyOpen`) | `predefined_type` stĺpec (už je) + pset do `properties` |
| „na tomto systéme" | `IfcRelAssignsToGroup` → `IfcDistributionSystem` (inverz `IsGroupedBy`) | nová hrana (IFC-kanonický názov) + uzol `object_type='system'` |
| „v ktorej miestnosti" | `IfcRelContainedInSpatialStructure` → `IfcSpace` | `rel_contained_in_spatial_structure` → `spaces.long_name` |

Fyzická konektivita „na presne tomto potrubí" existuje v IFC4.3 relačne (`IfcDistributionPort`
vnorené cez `IfcRelNests`, spojené cez `IfcRelConnectsPorts` SOURCE→SINK) — **odložené ako
rozšírenie**; must-have stojí na členstve v systéme, nie na portoch.

**LLM = vlastné rozhranie (Claude, D-005), NIE IFClite LLM.** IFClite LLM medzičasom existuje
(scripting agent, model selector Claude/GPT/Devstral), ale beží **sandboxovaný nad jedným IFC
súborom** — nevidí našu DB, PDF-ká, názvy miestností, zodpovednosti, provenance, klasifikačné
únie. Wow-odpoveď je náš graf → mozog musí byť náš. **IFClite = oči a ruky** (render, highlight,
volaný nástroj na čisto geometrický fallback), nie mozog. Autorita dotazu v DB (D-028),
guardraily D-005 (read-only, whitelist views, row limit).

**Trust loop (najväčšia hodnota):** každá odpoveď je **dohľadateľná** — deep-link do 3D
(highlight prvku cez IFClite) + do zdrojového dokumentu (región/riadok, na to už máme
`_drawing_links`, D-042). Nie „ver mi", ale „ventil V-03, systém ÚK, miestnosť 2.14 — tu je
v 3D, tu v pôdoryse, tu zdroj". Bez väzieb nie je čo citovať — a to je práve pointa pitchu.

**Dôsledok:**
- **S-LLM z parkoviska → kritická cesta.** GUID verziovanie demoté na podporné.
- **ETL rozšírenie (aditívne, D-018/D-046):** `IfcDistributionSystem` (→ `system` uzol,
  `IfcDistributionSystemEnum` → `predefined_type`), `IfcRelAssignsToGroup` (→ nová hrana),
  `IfcValve`/`IfcValveType` predefined type + psety. Containment cez existujúci `rel_contained_in_spatial_structure`.
  Názvy nových hrán = **IFC-kanonické** (viď D-046 IFC-first + pripravované sprísnenie na
  IFC-kanonickú identitu vzťahov). Schéma sa **nemení** — len nové `object_type`/hrana.
- **Upload/parse UI** = samostatná vetva (počítané, potrebné pre onboarding-naratív).

**Dôvod:** Ťažiskom hodnoty nie je render (komodita — vie ho IFClite) ani samotný LLM
(vie ho každý), ale **graf, nad ktorým sa dá pýtať a ktorého odpovede sú dohľadateľné až
k zdroju** — a ten graf existuje len ak sú zdrojové dáta poriadne štruktúrované. Demo je
dôkaz tejto tézy naživo.

**Konkretizácia (D-056):** LLM rozhranie (API-pluggable model, tool-calling nad whitelist
views, trust-loop deep-links) je rozpísané v D-056; ventilový use-case má dátovú prerekvizitu
(import vodného modelu). Viď D-056.

### D-048 — IFC-kanonická vrstva vzťahov (rozseknutie `rel_located_in`, plné zarovnanie)

**Rozhodnutie:** Vrstva hrán sa **prestaví na IFC-kanonickú identitu** — každá hrana =
konkrétny IFC `IfcRelationship` podtyp, pomenovaná podľa neho, s **granularitou akú
rozlišuje IFC** (ISO 16739). Konkrétne `rel_located_in` sa **rozsekne** na dva vzťahy,
ktoré IFC zámerne oddeľuje. Prijímame vyššiu cenu (refaktor ETL/app/views/seed, dlhšie
trvanie) za správny fundament od začiatku. Sprísňuje D-046 (IFC-first naming) na plnú
IFC-kanonickú identitu.

**KRITICKÁ DELIACA ČIARA (aby sme si to „poriadnym" neposkazili):**
Preberáme z IFC **identitu, pomenovanie a granularitu** vzťahov. **NEpreberáme fyzickú
serializačnú štruktúru IFC.** IFC modeluje vzťahy ako *objektifikované N-árne entity*
(jeden `IfcRel` s vlastným GlobalId spája 1 subjekt s N objektmi). My držíme **binárne
hrany `from_id→to_id` + vlastné stĺpce** (`valid_from`/`valid_until`/`source`/`role`).
Toto je zámerná odchýlka a je **lepšia pre nás**: per-hrana platnosť a provenance je náš
moat (D-046 deklarovaná extenzia), binárne hrany sa lepšie dopytujú (aj pre LLM
text-to-query, D-047). „IFC ako fyzické úložisko" = doložená slepá ulička (riedke tabuľky,
zlý výkon, LLM-nepriateľské). Sme **index nad IFC sémantikou** (D-046), nie STEP v Postgrese.

**Cieľová tabuľka hrán (from = subjekt, to = objekt — naša konvencia ostáva):**

| Hrana | IFC relationship | IFC rodina | from_id | to_id | Pozn. (IFC Relating = to_id ak nie inak) |
|---|---|---|---|---|---|
| `rel_aggregates` | `IfcRelAggregates` | `IfcRelDecomposes` | časť (spatial child) | celok (spatial parent) | Site→Building→Floor→Space dekompozícia |
| `rel_contained_in_spatial_structure` | `IfcRelContainedInSpatialStructure` | `IfcRelConnects` | prvok (asset) | priestor/podlažie | element umiestnený v štruktúre |
| `rel_defines_by_type` | `IfcRelDefinesByType` | `IfcRelDefines` | occurrence | type | dedičnosť (D-021) |
| `rel_associates_document` | `IfcRelAssociatesDocument` | `IfcRelAssociates` | objekt | document | + `role` |
| `rel_associates_classification` | `IfcRelAssociatesClassification` | `IfcRelAssociates` | objekt | classification_reference | `to_id`→`classification_references` |
| `rel_assigns_to_actor` | `IfcRelAssignsToActor` | `IfcRelAssigns` | actor (person/org) | objekt | + `role`; smer = IFC (Relating=from_id) |
| `rel_assigns_to_group` | `IfcRelAssignsToGroup` | `IfcRelAssigns` | člen (element) | system (group) | **nová** (D-047, distribučné systémy) |
| `rel_member_of` | `IfcPersonAndOrganization` | — (**resource, NIE IfcRel**) | person | organization | poctivo mimo IfcRel taxonómie — nenasilu IFC názov |

**Namespace `aim_` pre naše rozšírenia (rozširuje D-022 na vrstvu vzťahov):** Hrany
**bez prefixu = IFC-kanonické** (serializujú sa na `IfcRel*`). Hrany, pre ktoré IFC
**nemá žiadny koncept**, dostanú prefix **`aim_`** (`aim_rel_*`) — snake_case kvôli D-012
(nie CamelCase `AimRel`). Prefix zároveň kóduje **export cestu**: `rel_*` → `IfcRel`;
`aim_*` → nie je IFC-serializovateľné, ide do ICDD linksetu / IFCX vrstvy. **Rezervované
pre skutočnú absenciu IFC konceptu**, nie pre IFC koncept realizovaný inak: `rel_member_of`
ostáva `rel_` (IFC ho pozná ako resource `IfcPersonAndOrganization`, len nie ako `IfcRel`).
**Dnes to nepremenováva nič** — celá súčasná sada hrán má IFC domov (validácia, že
zarovnanie je zdravé). `aim_` je **dopredná konvencia** pre budúce hrany bez IFC ekvivalentu
(napr. `aim_rel_supersedes` — verziovanie dokumentov; cross-model federačné väzby ARCH↔TZB).

**Smerová konvencia — rozhodnuté ponechať `subjekt→objekt`:** IFC používa per-vzťah
orientáciu `Relating/Related` (napr. `IfcRelContainedInSpatialStructure.RelatingStructure`
= kontajner). My držíme jednotné `from=subjekt→to=objekt` naprieč všetkými hranami
(konzistentné, query- a LLM-friendly); ktorý koniec je IFC `Relating`, je zachytené
v mapovaní vyššie. Neprevraciame smer per-vzťah — bola by to obrovská churn v ETL/app
bez zisku.

**Rozdeľovacie pravidlo (`rel_located_in` → dve tabuľky):**
`from_id.object_type ∈ {building, floor, space}` → `rel_aggregates` (spatial dekompozícia);
`from_id.object_type = asset` → `rel_contained_in_spatial_structure` (fyzický prvok v štruktúre).
Unikátny aktívny rodič (`where valid_until is null`) sa zachová na oboch (`from_id`).
Neskôr aditívne: `IfcRelReferencedInSpatialStructure` (sekundárna príslušnosť), `IfcRelNests`
+ `IfcRelConnectsPorts` (porty, D-047 konektivita) — obe majú miesto v tejto taxonómii.

**Migračná stratégia:** nová forward migrácia (`nikdy nemazať migrácie` — D nesmieme
prepisovať init): `ALTER TABLE RENAME` pre čisté 1:1 premeny; `CREATE` + `INSERT…SELECT`
(rozdeľovacie pravidlo) + `DROP` pre split `rel_located_in`; nová `rel_assigns_to_group`;
recreate views (`v_asset_effective`, `v_asset_classifications`). Dáta sú **regenerovateľné**
(ETL z IFC, D-031 + seed) → žiadne riziko straty. Pre-prod, žiadne RLS/externí konzumenti.

**Postupnosť implementácie (vetva `ifc-canonical-relations`):**
1. Migrácia (DDL + backfill split + views + indexy/uniq). 2. ETL (`etl/transform.py`,
`model.py`, `db.py`) — split spatial hrán, premenované hrany, `system`+`assigns_to_group`.
3. App (`lib/data/*.ts`, komponenty) — repoint názvov, split spatial dotazov. 4. Seed
(`supabase/seed.sql`) — alebo spoľahnúť sa na ETL. 5. Docs (SCHEMA §2.5/§5). 6. Verify
(viewer: strom, karty, 3D). Až na čistej báze staviame D-047 ETL (ventily/systémy) a S-LLM.

**Dôsledok:** Model z D-018 (`objects` + tenké prípony + typované hrany) sa **koncepčne
nemení** — mení sa počet a názvy hrán (aditívne v duchu, breaking v implementácii).
`object_type='system'` = ďalšia hodnota (validuje app/ETL, nie CHECK — D-018). CLAUDE.md
a SCHEMA.md aktualizované na cieľový stav.

**Revízia (D-051):** per-vzťah `rel_*` tabuľky sú **supersedované** generickým meta-modelom
`relationships` (jedna tabuľka + kanonické views + manifest). IFC-kanonická identita,
smerová konvencia (`subjekt→objekt`) aj `aim_` namespace **ostávajú** — presúvajú sa do
manifestu ako dáta. Viď D-051.

### D-049 — Federácia disciplinárnych modelov (VZT) + reframe D-047 north-star

**Kontext:** D-047 určil headline dotaz „uzatvárací `IfcValve` na `IfcDistributionSystem`
+ miestnosť". Používateľ dodal `podklady/VZT.ifc` (IFC4X3_ADD2, čistý Revit re-export).
Sken modelu (2026-07-03) ukázal, že je to **čisto vzduchotechnika**: 9× `IfcDistributionSystem`
(`Prívod/Odvod-1..3NP`, `Nasávanie`, `Výfuk`, `Odpadné hospodárstvo`; `VENTILATION`/`EXHAUST`)
+ 9× `IfcRelAssignsToGroup` (členstvo hotové); ~1000 prvkov (495 `IfcDuctSegment`,
383 `IfcDuctFitting`, 139 `IfcAirTerminal`, 3 `IfcUnitaryEquipment`); 2053 portov +
1020 `IfcRelConnectsPorts`. **0 `IfcValve`, 0 `IfcSpace`.** Vlastný site/building/storey
s **inými GlobalId** než naložený ARCH model (0 zhoda GUID).

**Rozhodnutie 1 — reframe north-star:** VZT teraz pokryje **členstvo v systéme** (dotaz
„systém → prvky/jednotka", „ktorý systém obsluhuje tento prvok a na akom podlaží").
**Ventil + miestnosť ostáva cieľom**, splní sa po dodaní vodného modelu (ÚK/ZTI), ktorý
ventily aj priestorové väzby nesie. Must-have dotaz sa dočasne zužuje, cieľ sa nemení.

**Rozhodnutie 2 — federačný princíp:** Disciplinárny model sa **nefederuje cez zdieľané
GUID** (Revit exportuje disciplíny nezávisle — overené 0 zhoda), ale **napojením na
existujúcu priestorovú štruktúru cez normalizovaný názov podlažia**. Spatial korene druhého
modelu (site/building/storey/space) sa **neemitujú**; jeho prvky sa zavesia na **už
existujúce floor uzly** (VZT `1NP_VZT` → `np_key` → existujúci floor `object_ref='1NP'`;
fallback najbližšia elevácia). Cross-file väzba je **hrana, ktorej endpoint už je v DB** —
`load` ju rozrieši dotazom, neemituje duplicitný uzol. Ostávame na IFC-kanonických hranách
(containment aj membership majú IFC domov); `aim_rel_*` federačné hrany (D-048) sa zavedú
až pri väzbe bez IFC konceptu.

**Rozhodnutie 3 — MEP scope (rozšírenie D-034):** `IfcDistributionElement` sa importuje
**celý** (faithful), ale **priestorové containment (floor) dostanú len inštančne-relevantné
prvky** (`IfcAirTerminal`, `IfcUnitaryEquipment`/`IfcFlowTerminal`); potrubie a tvarovky
(`IfcDuctSegment`/`IfcDuctFitting`/`IfcPipeSegment`) sú **len členmi systému**
(`rel_assigns_to_group`), nie v priestorovom strome — „grouping" (nezáleží na inštancii).
Realizované ako **policy v `scheme.py`** (`ScopePolicy`, nie hardcode). MEP prvky nemajú
SNIM kód v `Name` → `object_ref` = GUID fallback (správne).

**Dôsledok:** Schéma sa **nemení** (`rel_assigns_to_group` existuje z D-048;
`object_type='system'` je aditívny). ETL dostane federačný režim (`--federate`, bez
`--reset`, aditívny upsert). `IfcDistributionSystemEnum` → `predefined_type`.

**Dôvod:** Jeden koherentný AIM graf (nie dve budovy v strome) je predpoklad dôveryhodného
dema (D-003) aj text-to-query (D-047). Name+elevačný match je pre tento pár modelov
(rovnaký Revit projekt) deterministický; ako všeobecný princíp ho drží konfigurovateľná
policy. Port-konektivita (`IfcRelConnectsPorts`) je odložené rozšírenie (D-047).

### D-050 — 3D vrstva federácie: multi-model render s identitou cez IFC GUID

**Kontext:** D-049 federoval VZT do **grafu** (DB); 3D viewer (D-044) však stále rendroval
jediný model (`getIfcUrl()` → ASR). Aby demo ukázalo federáciu aj vizuálne (systém → prvky
v 3D), treba rendrovať ASR + VZT v **jednej scéne**. Problém: `expressId` je lokálny per
IFC súbor — medzi modelmi sa **prekrýva**, takže identita postavená na expressId (D-044
fázy 1–3) sa pri multi-modeli rozpadá.

**Rozhodnutie 1 — identita = IFC GUID, nie expressId:** Viewer pri načítaní každého modelu
stampne každý mesh jeho `ifc_guid` (`node.userData.guid`, cez lokálnu `expressId → guid`
mapu z STEP textu) a plní **globálne, GUID-centrické mapy** (`guidToMeshes`, `meshToGuid`,
`meshToFloor`) naprieč modelmi. Picking, highlight, focus aj filter bar pracujú výhradne
s GUID — expressId ostáva len lokálnym medzikrokom pri loade. To je konzistentné s D-044
(„spojka na dáta = IFC GUID cez `guidMap`") — teraz to platí aj vnútri scény.

**Rozhodnutie 2 — floor filter cez normalizovaný label podlažia:** Storey filter z D-044
(per-expressId) sa nahrádza filtrom cez **normalizovaný názov podlažia** (`1NP_VZT` → `1NP`,
regex `\d+NP`) — rovnaký princíp ako federačný match v ETL (D-049 R2). Podlažia oboch
modelov sa tak zlúčia do jednej sady tlačidiel (1NP–5NP); prvky bez podlažia (strecha,
rozvody bez containment) ostávajú viditeľné vždy.

**Rozhodnutie 3 — konfigurácia modelov:** `getIfcModels(): IfcModel[]` (id, label, url).
Default = ASR + VZT zo Supabase Storage (`ifc/ASR.ifc`, `ifc/VZT.ifc`). Override
`NEXT_PUBLIC_IFC_URLS="Label|url,Label|url"`; legacy `NEXT_PUBLIC_IFC_URL` = jeden model.
`etl/ifc_upload.py` dostal `--key` (upload ďalších modelov do bucketu `ifc/`).

**Obmedzenie (vedomé):** `getIfcBuffer()` pre query bridging (D-044 fáza 4) vracia zatiaľ
**len prvý model** (ASR) — `@ifc-lite/query` API berie jeden buffer. Multi-model query
bridging sa rieši, až keď bude reálne treba (VZT dotazy idú cez graf, D-049).

**Dôvod:** Geometria ostáva klient-side ephemerálna (D-044 — Postgres sa jej nedotýka),
federácia v 3D je čisto view-side záležitosť. GUID-centrická identita je jediná, ktorá
prežije ľubovoľný počet modelov, a zároveň zjednodušila kód (picking/highlight bez
scene-traverse per selection).

**Dodatok (2026-07-11) — georeferencovanie federácie:** `exportGlb` recentruje každý
súbor podľa vlastného RTC/bbox, čím sa strácal vzájomný georeferencovaný posun disciplín
(ASR vs VZT ~2,5 m E / ~31 m N; v iných prehliadačoch modely sedeli). Viewer preto
prešiel na IFClite low-level pipeline (`buildPrePassOnce` → `processGeometryBatch`
so **zdieľaným RTC offsetom prvého modelu** → `exportGlbFromMeshes`) — rovnaký princíp
ako federácia v IFClite viewri — a navyše aplikuje **deltu `IfcMapConversion`**
(EPSG:5514) ako transformáciu skupiny modelu (translácia + rotácia grid north + mierka
voči frame-u prvého modelu). Dôvod dvoch vrstiev: staršie exporty nesú georeferenciu
vo veľkých súradniciach site placementu (rieši zdieľané RTC), aktuálne Storage IFC
v `IfcMapConversion` s lokálnymi súradnicami na nule (RTC=0, rieši map delta).

---

## 7c. Meta-model vzťahov a program dema (D-051+)

> Rozhodnutia z plánovacieho kola 2026-07-07 (nové inputy k demu). D-051 je architektonický
> základ (revízia D-048); D-052–D-056 sú **záznamy so zvoleným smerom** — detail sa dopĺňa
> pri štarte príslušného sprintu (kadencia re-checku, viď `AGENTS.md`).

### D-051 — Meta-model vzťahov = generická `relationships` (B): jedna tabuľka + kanonické views + manifest
**Kontext:** Cieľom je **naplno využiť IFC ako sémantiku/ontológiu** (nie ako STEP súbor) —
vrátane vzťahov na dokumenty, tasky, ľudí a celý lifecycle. Dnešná vrstva hrán (D-048) je
**per-vzťah tabuľka** na každý `IfcRel*`. Pri ambícii pokryť celé IFC by to znamenalo ~40
ručných tabuliek postupne (každý nový vzťah = migrácia + indexy + app kód).

**Zistené z IFC meta-modelu (overené proti `ifc43-docs`, 2026-07-07):** `IfcRoot` má práve
tri vetvy — `IfcObjectDefinition`, `IfcRelationship`, `IfcPropertyDefinition`. Vzťahy sú
v IFC **objektifikované** (prvotriedne entity s vlastným `GlobalId`, `Name`, `Description`
a vlastnými atribútmi — spec: *„keeping relationship-specific properties directly at the
relationship"*). Vzťahov je **konečná malá množina** — 6 rodín (`IfcRelAssigns`,
`IfcRelAssociates`, `IfcRelConnects`, `IfcRelDecomposes`, `IfcRelDefines`, `IfcRelDeclares`),
spolu ~46 podtypov, každý `1→1` alebo `1→N` (`Relating`→`Related[1..n]`). Vlastný IFC
meta-model je teda **trojtabuľkový tvar**: `objects` (IfcObjectDefinition) + `relationships`
(IfcRelationship) + `properties` (IfcPropertyDefinition).

**Rozhodnutie:** Vrstva vzťahov sa prestaví z per-vzťah tabuliek na **jednu generickú
tabuľku `relationships`** s diskriminátorom `rel_type` (symetricky k `objects.object_type`),
nad ktorou žijú **kanonické views** per `rel_type`. **Toto je explicitná revízia D-048**
(per-vzťah tabuľky sa označujú za supersedované). Kľúčové: námietka D-048 „nie STEP
v Postgrese" platí proti **tabuľka-na-entitu** (verný EXPRESS→SQL, ~800 tabuliek), **nie**
proti generickej relationships tabuľke — tá je naopak **vernejšia IFC meta-modelu** (vzťah
= prvotriedny objekt).

- **Úložisko:** jedna `relationships` tabuľka + index na `rel_type` (náš objem = tisíce
  hrán → triviálne). **`LIST` partícia podľa `rel_type` je odložená optimalizácia**, nie
  day-one; nesie navyše constraint „PK musí obsahovať partičný kľúč" (kolízia s `ON CONFLICT
  (id)` idempotenciou D-031), takže sa zavedie len ak to objem vyžiada.
- **Otvorená vidlica (rieši sa pri návrhu F1):** N-árnosť — ostať pri **binárnych hranách
  `from→to`** (N-árne = N riadkov; konzistentné s D-048, LLM-friendly) **vs** objektifikovaná
  member-tabuľka (`relating_id` + členovia, verná IFC identite vzťahu). **Leaning: binárne.**
- **Manifest** (generovaný z IFC schémy cez `ifcopenshell`, uložený aj ako referenčná
  tabuľka) nesie na každý `rel_type`: smer (ktorá strana je IFC `Relating`), povolené
  `object_type` na oboch stranách, **namespace flag** (IFC-kanonické `rel_*` vs `aim_*`),
  **export cestu** (`rel_*`→`IfcRel`, `aim_*`→ICDD linkset/IFCX) a **per-`rel_type`
  constraints** (unique-active-parent pre aggregates/contained/defines_by_type). Jeden
  zdroj pravdy → poháňa schému (generátor views), ETL routing aj export.
- **Integrita** cez manifest (validačný trigger/view namiesto polymorfného FK na konkrétnu
  cieľovú tabuľku — cena za otvorenosť, centralizovaná na jednom mieste).
- **LLM len cez kanonické views** (D-005/D-047 whitelist) — base tabuľku nevidí, takže
  text-to-SQL ergonómia ostáva ako pri pomenovaných tabuľkách; polymorfné join-y nevzniknú.
- **Schéma-schopnosť (nie naplnenie):** `object_type='zone'` (IfcZone zoskupuje spaces cez
  `rel_assigns_to_group`) a porty cez `IfcRelNests` (port→element, D-046; `IfcRelConnectsPortToElement`
  je deprecated, fallback pre staré súbory) — reálna ETL extrakcia + viewer je samostatný krok.

**Dôvod:** Škáluje na „celé IFC" bez migračnej dane za každý vzťah (tvoja ambícia: tasky,
porty, space boundary, covers/fills, assigns-to-process/product/control/resource). Je
najvernejšie IFC ontológii pri zachovaní Postgres/Supabase stacku (RDF ostáva **export** —
ICDD, D-008/D-015, nie interné úložisko) aj LLM text-to-SQL moatu (views). Alternatívy: A
(per-vzťah tabuľky) = viac ručnej práce, „napuchnutá" schéma; C (tabuľka-na-entitu) =
odmietnuté (riedke tabuľky, výkon, LLM-nepriateľské); D (RDF/ifcOWL triple store) =
text-to-SPARQL slabšie odladené, ďalší stack; E (property graph) = ďalší stack mimo Supabase.

**Dôsledok:** Model D-018 (`objects` + prípony) sa **koncepčne nemení**; mení sa vrstva
hrán. Schéma DB sa **zmení až migráciou pri sprinte F1** (nová migrácia — staré sa nemažú),
teraz je to len rozhodnutie + planned stav v `SCHEMA.md`. F1 musí ošetriť: **bezvýpadkový
cutover cez compat-views** rovnakého názvu ako dnešné `rel_*` (vzor prevzatý z D-048),
**recreate odvodených views** (`v_asset_effective`, `v_asset_classifications`, `v_floors`,
`v_actors`), **update `supabase/seed.sql`**, zachovanie **D-031 idempotencie**.

**Doplnenie (F1 implementácia, 2026-07-07) — vyriešené otvorené body:**
- **N-árnosť = binárne `from→to`** (zvolené z vidlice; N-árne = N riadkov). Dôvod: konzistencia
  s D-048, LLM-friendly views, a zachovanie deterministického `edge_id` (UUIDv5) + `ON CONFLICT
  (id)` idempotencie (D-031) — objektifikovaná member-tabuľka by oboje rozbila bez zisku pri
  našom objeme (tisíce hrán).
- **Manifest = tabuľka `relationship_types`** generovaná/overená proti IFC schéme cez
  `ifcopenshell` (`etl/manifest.py`, `python -m etl.manifest --sql`). Na `rel_type` nesie:
  `ifc_entity`, `ifc_family` (odvodené zo supertypu pod `IfcRelationship`), `is_ifc_rel`,
  `relating_end` (`from`/`to`), `from_object_types`/`to_object_types`, `to_is_classification`,
  `namespace` (`rel`/`aim`), `export_path` (`ifcrel`/`resource`/`icdd`/`ifcx`), `unique_active_from`.
  Jeden zdroj pravdy → poháňa validačný trigger, ETL routing (`db.py`) aj export. `rel_member_of`
  = `IfcPersonAndOrganization` (resource, `is_ifc_rel=false`, `export_path='resource'`).
- **Integrita bez polymorfného FK = BEFORE trigger `relationships_validate()`** čítajúci manifest
  (overí `rel_type`, povolené `object_type` oboch strán, a `to` endpoint objects vs
  `classification_references`). `to_id` je zámerne bez FK (polymorfné); `from_id` má FK+CASCADE
  → reset (TRUNCATE) aj mazanie uzla bez osirelých hrán. unique-active-parent = parciálne unique
  indexy s `rel_type` literálom v predikáte.
- **Kľúčový insight cutoveru:** kanonické views nesú **rovnaké názvy** ako pôvodné `rel_*` →
  sú zároveň compat-vrstvou. App číta cez ne bez zmeny; **LLM/whitelist dotazuje LEN views**,
  nie base `relationships`. Zápis (ETL/seed) ide na base tabuľku (views nie sú insertovateľné).
- **Partície ODLOŽENÉ** (potvrdené): `LIST` podľa `rel_type` nesie „PK musí obsahovať partičný
  kľúč" → kolízia s `ON CONFLICT (id)` — index na `rel_type` dnes stačí.
- **Migrácia** `supabase/migrations/20260707150000_relationships_metamodel.sql` (backfill z 8
  tabuliek so **guardom identických počtov**, drop starých, kanonické + odvodené views, trigger).
  Overené na čistej PostgreSQL 16 (`psql`): migračný reťazec, seed cez trigger, identické počty
  pred/po backfille (10=10), idempotentný ETL re-run (`db.load_model` 2×), unique-active-parent
  a trigger odmietajú neplatné vstupy. **Po nasadení na Supabase treba reload PostgREST schema
  cache** (`notify pgrst, 'reload schema'`).
- **Nasadenie na Supabase prod (2026-07-07, projekt `acwoupricatirhlfkhvk`):** pred F1 odstránené
  zvyšné D-048 prechodné compat views (`rel_located_in`, `rel_has_document`, …), ktoré na prod
  prežili cutover — blokovali drop `rel_*` tabuliek. F1 migrácia prešla atomicky; backfill guard
  **4461=4461** hrán; odvodené views nezmenené (`v_asset_effective`=1715, `v_asset_classifications`=615).
  Migračná história (`supabase_migrations.schema_migrations`) **zosúladená** so všetkými 8 súbormi
  v `supabase/migrations/` (predtým evidovaná len `init` + 2 záznamy s nesprávnymi verziami).
  Výsledok: **0 legacy compat views**, **0 base tabuliek `rel_*`** (len kanonické views), trigger aktívny.

### D-052 — Geometrický cross-file containment (element → `IfcSpace`) + IDS verifikácia
**Kontext:** MEP prvky (napr. `IfcAirTerminal` z VZT.ifc) aj časť ASR prvkov visia dnes na
`IfcBuildingStorey`, nie na konkrétnom `IfcSpace`. Sú **dva use-casey** (overené v štúdii
IFCstudy): (UC1) reassignment v rámci jedného súboru (ASR: storey→space); (UC2) priradenie
**naprieč súbormi** (VZT element → ASR space). UC2 **nemôže žiť v IFC** — `IfcRelContained…`
sú priame inštančné odkazy v jednej populácii a `GlobalId` je UNIQUE len v súbore; vzťah
musí žiť **mimo oboch IFC** = shadow-relationship (GUID→GUID).

**Rozhodnutie (smer):** Shadow-relationship = **naša DB hrana** `rel_contained_in_spatial_structure`
(element→space, `source='geom'`). Výpočet v **Python ETL** (`ifcopenshell.geom` + `geom.tree`,
solid-in-solid), **needeštruktívne** (zdrojové IFC sa neprepisujú — single source of truth).
Oba use-casey u nás konvergujú na to isté (oba konce sú `objects` riadky). **Postgres sa
geometrie nedotýka** (D-044) — ukladá sa len výsledná hrana. Verifikácia cez natívny
`ifctester` (IDS), **napojená na jednotnú definíciu D-033/D-034** (jedna definícia = scope
+ extrakcia + validácia): **IDS#1** (dodávateľ) = element→storey (jediná vymáhateľná
požiadavka, nástrojový limit Revitu); **IDS#2** (po ETL) = element→space (požiadavka na
výstup ETL). **Scoping:** len prvky fyzicky vnútri jednej miestnosti (terminály/jednotky/
zariadenie); hraničné/viac-priestorové prvky (steny/dvere/dosky) ostávajú na storey (neskôr
príp. `IfcRelSpaceBoundary`). **Nezávisí od D-051** (píše existujúcu hranu). Viewer číta
containment z **dvoch zdrojov** (natívny in-file + syntetický cross-file), inak by
cross-file väzby neboli vidno. ICDD serializácia shadow-relationshipu = horizont rokov.

### D-053 — Live upload + verifikácia proti požiadavkám (SharePoint-like, IDS-driven)
**Rozhodnutie (smer):** Umožniť nahranie ľubovoľného súboru (predstava: SharePoint-like
upload) s **verifikáciou voči vopred definovaným požiadavkám**, ktoré zabezpečujú previazané
dáta: (1) kontrola **mennej konvencie** názvu (CDE, `doc_scheme.py`, D-036); (2) druhá
vrstva = **prednastavené SNIM/IDS požiadavky** (zdroj = tá istá definícia ako D-033/D-034,
nie nová schéma). **Nice-to-have** — ak výpočtovo/časovo náročné, dočasne bez tejto vrstvy.
Detail (klient-side kontrola názvu vs server-side ingest/worker, rozsah IDS) sa doladí na
začiatku sprintu. Ťaží z IDS vrstvy D-052.

### D-054 — PDF prehliadačka rework
**Kontext:** Prepojenie prvok↔PDF funguje princiálne dobre (E4/DV, D-041/D-042/D-043), ale
**modul prehliadania je nemotorný a nedostatočný**. **Rozhodnutie (smer):** prestavať UX/výkon
prehliadačky výkresov/dokumentov (`/drawing/[id]`, `drawing-viewer.tsx` a spol.). Nezávislé
od D-051 — **kandidát na skorý quick-win**. Konkrétne bolesti (zoom/pan, mobil, layout
panela, výkon) sa zbierajú na začiatku sprintu.

**Implementované — kadencia 1 (interakcia vieweru, `drawing-viewer.tsx`):** Bolesti pôvodného
vieweru (identifikované z kódu): zoom len tlačidlami, žiadny pinch/pan, fixná `BASE_WIDTH`
(bez fit-to-width), neresponzívny na mobile. Rework (needeštruktívny — zachovaná overlay
math, `focus` deep-link, `onSelect` bočný panel, Ctrl/⌘-klik nová karta, skladby D-043,
`devicePixelRatio` ostrosť):
- **Koliesko myši = zoom** zacielený na kurzor (zoom-to-pointer): natívny non-passive `wheel`
  listener (`preventDefault` scrollu stránky) + kotva (fraction v `wrapperRef`) obnovená po
  rerastri v `useLayoutEffect` → bod pod kurzorom ostáva na mieste.
- **Pinch = zoom, prst/ťah = pan** cez pointer eventy (`touch-action: none`), rAF-throttle
  rerastra; pan gesto potlačí následný klik na región (`didPan` threshold, `onClickCapture`).
- **Fit-to-width** default (zoom=1 = šírka viewportu, `ResizeObserver`, mobile-first);
  percento v toolbare resetuje na fit.
- **Fullscreen** („veľká obrazovka") cez Fullscreen API na root wrapperi (`Maximize2`/
  `Minimize2`), plátno `flex-1 h-screen`, sync cez `fullscreenchange` (aj Esc).
- Ostrosť zachovaná **rerastrom** pri každom zoome (nie CSS-scale) do `devicePixelRatio` 2×
  (strop `MAX_RENDER_PX`).
- **Overené:** `tsc --noEmit` čistý, `next build` skompiluje (Turbopack), bez nových lint
  chýb (ostáva len baseline `set-state-in-effect` na focus-efekte, prítomný aj pred zmenou).
  Live drive v prehliadači nebolo v tejto session možné (bez Supabase creds + reálneho PDF).

**Implementované — kadencia 2 (double-tap, výkon gest, mobilný layout panela):**
- **Double-tap-to-zoom** (dotyk): dva tapy do `DOUBLE_TAP_MS`/`RADIUS` → zoom 2.5× kotvený
  na miesto tapu; z priblíženého stavu → späť na fit-to-width. Druhý tap nie je klik na región.
- **Výkon zoom gest** (`drawing-viewer.tsx`): počas bežiaceho kolieska/pinchu sa strana
  NErastruje per frame — škáluje sa lacným CSS transformom wrappera okolo zmrazenej kotvy
  gesta (`preview` ref, translate+scale); ostrý rerastr príde raz, po ustálení
  (`GESTURE_COMMIT_MS` debounce kolieska / pustenie prstov). Veľké výkresy sa tak pinchujú
  plynulo namiesto rastrovania pri každom evente.
- **Mobilný layout panela** (`drawing-workspace.tsx`): na úzkych šírkach bol panel v toku
  POD viewerom (klik na kód „nič neurobil" — detail pod foldom). Vybraný prvok sa teraz
  zobrazuje ako plávajúci **bottom-sheet** (`fixed inset-x-3 bottom-3`, vlastný scroll, bez
  backdropu — výkres ostáva interaktívny, tap na iný kód panel prepne); od `lg` sa to isté
  DOM vracia do statického bočného stĺpca. Info o dokumente ostáva vo flow.
- **Bugfixy z live verifikácie** (pre-existujúce z kadencie 1, vtedy bez live drive):
  (1) `setPointerCapture` hneď v pointerdown presmeroval click na scroller → **klik myšou
  na región bol na desktope mŕtvy** (dotyk fungoval — syntetizovaný click z tapu cieli
  pôvodný target); capture teraz príde až po prekročení pan thresholdu / pri pinchi.
  (2) Kotva zoomu sa aplikovala so **starým rastrom** (`dims` za `width` zaostáva o async
  render) → `scrollLeft` sa clampol na starý rozsah a pri väčšom skoku kotva ustrelila;
  scroll restore sa teraz aplikuje až keď `dims.width ≈ width` (po dobehnutí rastra).
- **Overené live** (Playwright/Chromium, devtest harness bez Supabase — recept
  v `.claude/skills/verify/SKILL.md`): mobil 390×844 s dotykom (tap → bottom-sheet,
  „Späť na dokument", double-tap 100→250→100 %, CDP pinch: preview transform počas gesta,
  commit 420 %) + desktop 1440×900 (wheel burst: CSS preview, rerastr po ustálení, kotva
  drží fx 0.4808→0.4807; klik na región otvára panel; pan aj za okraj scrollera; pan
  potláča klik; fullscreen toggle tam/späť; stránkovanie 1→2/3). `tsc` čistý, bez nových
  lint chýb, `next build` compile ✓ (prerender `/` padá len na chýbajúcich DB creds).
**Implementované — kadencia 3 (rýchle prvé načítanie veľkých PDF + IFC WASM cache):**
- **Range/lazy loading PDF** (`drawing-viewer.tsx`): `Document options` =
  `disableAutoFetch + disableStream + rangeChunkSize 256 KB` → pdf.js si cez HTTP Range
  requesty ťahá len xref/page tree + objekty aktuálne zobrazenej strany namiesto celého
  súboru; listovanie doťahuje chunky on-demand. **Klikateľné regióny (`_drawing_links`
  overlay) sú aktívne hneď po rasteri prvej strany** — nečaká sa na zvyšok súboru. Ak
  server Range nepodporuje, pdf.js automaticky spadne na dnešné plné stiahnutie (žiadna
  regresia). Supabase Storage Range podporuje; po deployi spot-check v DevTools (206).
  K tomu progress % v loading state (`onLoadProgress`).
- **IFC (bezpečný rozsah):** `next.config.ts` — `Cache-Control` pre `ifc-lite_bg.wasm`
  (~3 MB): deň cache + týždeň `stale-while-revalidate` → opakovaný vstup do 3D nečaká na
  WASM download. **Viac sa IFC loadingu teraz nedotýkame** — fetch/parse path žije presne
  v súboroch 3D federácie (D-050, medzičasom zamknutá); pokračovanie
  (napr. komprimovaný variant IFC, progress) podľa spätnej väzby z prevádzky.
- **Overené live** (devtest harness, 40-stranové 3,8 MB PDF, `next dev` Range = 206):
  strana 1 viditeľná ~1,1 s po prenose **387 KB = 10 % súboru** (meranie
  `resource.transferSize`; predtým sa sťahoval celý súbor), región klikateľný okamžite,
  panel sa otvára; skok na stranu 40 → chunky on-demand (100 % až po prejdení všetkých
  strán); regresná sada kadencie 2 (sheet, double-tap, pinch preview+commit, wheel kotva
  fx 0.4808→0.4807, klik, stránkovanie) zelená. `tsc` čistý, bez nových lint chýb,
  `next build` compile ✓.
**Review kolo (2026-07-08, 8-uhlový code-review nad kadenciami 2–3 + live verifikácia fixov):**
- **Fullscreen × výber prvku:** bočný panel/bottom-sheet žije mimo fullscreen elementu
  (top-layer ho nekreslí) → tap na kód vo fullscreene vyzeral, že nič neurobil. Fix:
  výber prvku fullscreen ukončí (`handleSelect`), panel je hneď vidno.
- **`pointercancel` nabíjal double-tap** (palm rejection / prebratie gesta OS-om →
  najbližší tap spustil nechcený zoom). Fix: tap sa registruje len z `pointerup`.
- **Stale kotva zoomu:** čakajúca kotva (commit gesta) sa vedela aplikovať na inú stranu
  (goPage ju nečistil) alebo prepísať čerstvý pan užívateľa. Fix: `goPage` → `cancelPreview()`
  (zahodí náhľad, timer aj kotvu); štart panu kotvu tiež zahodí (pan má prednosť).
- **Stale touch pointery:** dotyk sa opäť captureuje hneď v pointerdown (syntetizovaný
  click z tapu cieli touchstart target aj pri capture — myši/pera sa to netýka, tie
  ostávajú na threshold capture kvôli klikom) → prst pustený mimo scrollera už nenechá
  v mape pointer, ktorý by z ďalšieho tapu robil phantom pinch.
- **Pinch follow-pan:** stred pinchu ťahaný po obrazovke teraz obsah sleduje (translácia
  v CSS náhľade aj v commit kotve); čistý dvojprstový pan bez zmeny zoomu sa prenesie
  do scrollu. Koliesko kotvu zámerne nesleduje (pohyb kurzora nie je pan).
- **Cleanup:** zoom mení jediná `applyZoom` (clamp + no-op guard + kotva — zoomTo aj
  commitPreview ju zdieľajú, logika sa nerozdvojí); `key={id}` na `DrawingWorkspace`
  (soft-navigácia na iný dokument resetuje stranu/zoom/výber — predtým nový dokument
  zdedil napr. stranu 3); verify skill linkuje poučenia sem namiesto duplikátu (D-017).
- **Ponechané trade-offy (vedomé):** bottom-sheet prekrýva spodok výkresu (bez backdropu,
  výkres ostáva interaktívny — kód pod sheetom treba odscrollovať/zavrieť); počas dlhého
  pomalého zoomu je obraz CSS-škálovaný (ostrý rerastr až po ustálení, to je pointa
  výkonu); kotva kolieska sa zmrazí na začiatku burstu.
- **Otvorené (ďalšie kadencie):** prípadný drag-handle/swipe-to-dismiss bottom-sheetu;
  IFC loading UX po zamknutí D-050 — podľa reálnej spätnej väzby z prevádzky.

### D-055 — 3D / IFClite feature port
**Rozhodnutie (smer):** Postupne prebrať ďalšie **vhodné IFClite moduly** do 3D vrstvy
(rozširuje D-044, deliaca čiara „čítanie/zobrazovanie/validácia IFC = prebrať z IFClite",
D-046 §5). Kandidáti: 2D výkresy z modelu (`drawing-2d`), meranie, rezové roviny, IDS
validátor, `IfcQuery`/DuckDB. Nezávislé od D-051. Priority sa určia na začiatku sprintu
(pin verzie, izolovaný modul, tenká vlastná interface vrstva — riziko maturity trvá).

### D-056 — LLM rozhranie nad grafom
**Rozhodnutie (smer):** Konkretizácia D-047. **API-pluggable model** (vieme pripojiť
ľubovoľný LLM cez API), rozhranie ako **tool-calling nad whitelistovanými kanonickými views**
(nie surové text-to-SQL), guardraily D-005 (read-only, whitelist, row-limit). **Trust loop:**
každá odpoveď dohľadateľná — deep-link do 3D (highlight prvku) + do zdrojového dokumentu
(región cez `_drawing_links`, D-042). Headline dotaz „ukáž prvok v 3D + na ktorých výkresoch
a kde konkrétne" beží na **dnešnom grafe** (z D-051 ťaží, nevyžaduje ho). Dotaz „kde je
najbližší uzatvárací ventil" má **dátovú prerekvizitu = import vodného modelu** (ÚK/ZTI;
D-049: 0 `IfcValve`) a spôsob určenia „najbližší" (topológia portov cez `IfcRelNests`/
`IfcRelConnectsPorts` vs geometrická vzdialenosť) — **doriešime neskôr**.

**Kadencia 1 (2026-07-09) — implementácia jadra:**
- **Provider vrstva `lib/llm/`** — neutrálne typy správ/tool-callov (`provider.ts`) +
  factory z env `LLM_PROVIDER`; `anthropic.ts` = Anthropic Messages API cez čistý `fetch`
  (bez SDK — žiadna nová dependency, server-only), `mock.ts` = deterministický provider
  pre devtest/e2e bez API kľúča (trvalá súčasť — umožňuje overiť celú slučku offline).
  Model z env `LLM_MODEL` (default `claude-sonnet-5`; výber pre demo = otvorený bod D-047).
- **Dodatok (2026-07-10) — Gemini ako štartovací provider (free tier):** pridaný
  `gemini.ts` (generateContent API cez fetch); demo beží na **Gemini free tier**
  (rozhodnutie používateľa), API-pluggability tým dostala okamžitý dôkaz. Default model
  `gemini-flash-lite-latest` (alias — konkrétne modely Google vypína pre nové kontá,
  napr. `gemini-2.5-flash` už nejde; plný flash na free tieri často 503). Bez explicitného
  `LLM_PROVIDER` sa provider **auto-detekuje z dostupného kľúča** (`GEMINI_API_KEY` má
  prednosť pred `ANTHROPIC_API_KEY`) — na Verceli stačí pridať kľúč. Gemini 3.x špecifiká:
  functionCall parts nesú `thoughtSignature` + natívne `id` a API ich **vyžaduje vrátiť**
  → neutrálne bloky dostali opaque `providerMeta` (round-trip bez presakovania do route);
  `functionResponse` sa páruje cez `name`/`id` dohľadané z predošlých správ; 429/503
  retry s backoffom. Overené live proti reálnemu API (2-kolová slučka, tool error vetva,
  slovenská odpoveď).
- **Tools = read-only executory nad whitelistom** (`lib/llm/tools.ts`), NIE text-to-SQL:
  `search_objects`, `get_object`, `get_asset_details` (`v_asset_effective` +
  `v_asset_classifications`), `list_relations` (LEN 8 kanonických `rel_*` views, D-051),
  `get_spatial_path`, `find_in_drawings` (`_drawing_links`). Guardraily D-005: každý tool
  má tvrdý row-cap (≤ 50, default 20), dotazuje len whitelistované views/tabuľky cez
  `service_role` server-side (D-026), žiadny zápis.
- **Agentická slučka v `app/api/ask/route.ts`** — max 8 kôl tool-callov, orezaná história,
  `max_tokens` cap; bez nakonfigurovaného kľúča vráti 503 s návodom (UI to zobrazí ako
  empty-state, nie crash). Chyba toolu (napr. výpadok DB) sa vracia modelu ako tool error —
  slučka nespadne.
- **Trust loop deterministicky zo servera, nie z formátovania modelu:** server pri behu
  slučky **automaticky zbiera „zdroje" zo všetkých tool výsledkov** (id → meta + aktívny
  IFC GUID + výkresové regióny) a vracia ich štruktúrovane popri odpovedi. UI z nich
  renderuje deep-linky: karta `/node|/type/[id]`, 3D `/ifc?focus=<guid>`, výkres
  `/drawing/[docId]?focus=<id>&page=<n>`. Model je inštruovaný citovať `object_ref`,
  ale dohľadateľnosť nestojí na jeho poslušnosti.
- **UI `/ask`** (`components/ask-panel.tsx`, klient) + položka v sidebari; vlákno správ,
  collapsible „Ako som hľadal" (tool trace), zdroje ako chips s deep-linkami.
- **Odložené (ďalšie kadencie):** streaming odpovede, highlight regiónu vo výkrese priamo
  z odpovede, ventilový dotaz (čaká na import ÚK/ZTI), výber produkčného modelu.

**Dodatok (2026-07-10) — celá DB + spoľahlivosť (spätná väzba z prevádzky):** prvá
prevádzka odhalila dve slabiny: (1) model nemal ako nájsť „AIRCONDITIONINGUNIT" — je to
`predefined_type` enum, nie `ifc_type`, a search hľadal len name/object_ref; (2) na „koľko X
a kde" nemal count ani batch lokalizáciu, tak hádal — a lite modely si po zlyhaní toolov
**vymysleli čísla** napriek promptu. Riešenie:
- **`query_view`** — generický read-only dopyt nad **celou dátovou vrstvou** (whitelist
  všetkých tabuliek + views vrátane JSONB ciest do properties, AND filtre, in-reťazenie
  namiesto joinov, count_only). Base `relationships` ostáva mimo (D-051). Nie je to surové
  text-to-SQL — štruktúrovaný dopyt drží guardraily D-005 (whitelist, read-only, row-cap).
- **`locate_objects`** — batch „koľko a kde": filtre/ids → presný count + rozpad po
  podlažiach (containment element→space|floor, space→floor, dávkované po 100).
- **`count_objects`**, **`get_model_stats`** (slovník tried modelu = grounding filtrov),
  `search_objects` query rozšírené aj na `ifc_type`/`predefined_type` + nový filter.
- **Doménový preklad v prompte** (VZT→IfcUnitaryEquipment/AIRCONDITIONINGUNIT, vyústka→
  IfcAirTerminal…) + postup podľa typu otázky.
- **Anti-konfabulačná poistka v route:** keď všetky tool cally zlyhajú, odpoveď modelu sa
  zahodí a vráti sa deterministická chybová hláška (overené live: flash-lite si inak vymyslel
  „12 jednotiek s rozpadom po podlažiach").

**Dodatok (2026-07-10) — globálny dock + UI akcie:** chat presunutý zo samostatnej `/ask`
stránky na **plávajúci dock pri spodku Viewera** (`ask-dock.tsx` vo `(viewer)` layoute;
zbalený = pilulka vpravo dole, rozbalený = panel; stav aj vlákno prežívajú navigáciu aj
reload cez sessionStorage; `ssr:false` cez `next/dynamic` — storage sa číta v useState
initializeri bez hydration mismatchu). **UI akcie cez tools:** `show_in_3d` (id/ref →
aktívny GUID → `/ifc?focus=`), `open_drawing` (`/drawing/[id]?focus&page`), `open_node`
(karta podľa object_type) — server ich vracia ako `actions` (URL stavia výhradne server
z whitelistu, nikdy model) a klient na prvú naviguje; dock pritom ostáva otvorený, takže
„zobraz VZT jednotku v 3D" otvorí 3D pod bežiacou konverzáciou. `/ask` stránka a sidebar
odkaz odstránené (dock ich nahrádza).

**Dodatok (2026-07-10) — multi-focus 3D + voľné okno (spätná väzba):** „zobraz ich v 3D"
pre 3 prvky zvýraznilo len jeden — klient vykonáva len prvú navigáciu a `/ifc?focus=`
bral jediný GUID. Oprava v celom reťazci: (1) `focus` podporuje **viac GUIDov oddelených
čiarkou** — viewer zvýrazní všetky, zoomne na spoločný bounding box a floor filter prepne
len keď sú všetky na jednom podlaží (inak by skryl zvyšok); (2) `show_in_3d` prijíma
`ids_or_refs` pole (viac prvkov = jeden call); (3) server v `finalActions()` **zlúči**
viacero 3D akcií do jednej multi-focus URL (model občas volá per prvok napriek inštrukcii).
Dock prestavaný na **voľné okno**: drag za hlavičku, resize za pravý dolný roh (min
320×300, clamp do viewportu aj pri resize okna prehliadača), geometria v sessionStorage;
default ostáva ukotvené pri spodku v strede.

**Druhé kolo (root cause):** ani multi-focus URL nepomohla — hlavný efekt viewera beží
len na `[modelsKey]` a focus aplikoval **iba pri načítaní modelu**. AI dock ale mení
`?focus=` **soft navigáciou** (komponent sa neremountuje, model sa nereloadne) → nový
focus sa ignoroval. Oprava vzorom `applyFloorFilterRef`: `applyFocus` žije v ref-e
(obnoví materiály predchádzajúceho focusu, zvýrazní nové meshe, zoomne na spoločný bbox,
multi-floor = floor filter vypne) a samostatný efekt na `[focus]` ju volá pri každej
zmene. Kapacita zvýrazniť veľa meshov naraz nebola problém — filter bar to robí bežne.

**Tretie kolo (opakované požiadavky v jednom chate):** druhá požiadavka „zobraz iné/znova"
nemusela prebehnúť — identická focus URL je pre router no-op a `staleTimes: {dynamic: 30}`
(D-030) môže do 30 s od návštevy servírovať klientskú cache. Riešenie: **každá 3D akcia
nesie unikátny nonce `&r=`** (generuje server v `show_in_3d`/`finalActions`) → URL je vždy
nová (cache aj no-op vylúčené) a viewer focus efekt beží na `[focus, focusNonce]` → focus
sa re-aplikuje aj pri identickej množine prvkov. `applyFocus` predtým obnoví materiály
starého zvýraznenia, takže „iné prvky" = staré zhasnú, nové svietia. Prompt doplnený:
každá požiadavka na zobrazenie = nový `show_in_3d` s prvkami, ktoré majú svietiť PO nej
(„pridaj X" = predošlé + X v jednom poli). Overené Playwright replikou mechaniky
(force-dynamic page + probe efekt): 3 akcie za sebou vrátane identického focusu s novým
nonce — 4/4.

### D-057 — Eval harness pre LLM rozhranie (zlaté otázky)
**Rozhodnutie:** Presnosť `/api/ask` sa meria **deterministickou eval sadou**, nie pocitom —
každá zmena LLM vrstvy (tools, prompt, model) sa pred commitom overí behom evalov a výsledok
sa porovná s baseline. Prvý krok programu presnosti (analýza 2026-07-10: schéma je pre LLM
dotazovanie správna, limituje grounding/agregácie/model — D-058 až D-063 stavajú na meraní
odtiaľto).

**Implementácia:**
- **`eval/questions.json`** — ~32 zlatých otázok v kategóriách counts / location /
  psets_standard / psets_custom (fail-by-design pred D-059 — metrika úspechu fulltextu) /
  classifications / relations / documents / negative (anti-konfabulácia) + 2 `smoke`
  (mock-only, mechanika slučky). Skórovanie deterministické, bez LLM-judge (v1):
  regex asercie nad `answer` (`answer_matches`/`answer_not_matches`), kontrola trust-loop
  **`sources`** (`sources_any_ref`/`source_types` — dôkazy zbiera server, nezávisí od
  formulácie modelu) a `no_facts` pre negatívne otázky (musí zaznieť „nenašiel som",
  žiadne viacciferné čísla, a beh so všetkými zlyhanými tools sa nepočíta — fallback
  pri výpadku DB nie je dôkaz).
- **`scripts/eval-ask.ts`** (`npm run eval`, tsx) — POST na bežiaci dev server
  (`--base-url`), `--runs N` (variancia), `--label` (porovnanie modelov), `--filter`
  (kategória/id). Výstup: tabuľka per kategória + JSON `eval/results/<ts>_<label>.json`;
  baseline runy sa commitujú.
- **`verified` workflow:** otázky písané na prod dataset (Office centrum Brno) majú
  v `notes` verifikačný dopyt; kým sa očakávaná hodnota neoverí proti prod DB, otázka má
  `verified=false` a runner ju preskakuje (spustí ju `--include-unverified` — odpovede sa
  vypíšu na doplnenie očakávaní, do headline pass-rate sa nerátajú). Vyplnenie hodnôt =
  prvý krok pri behu s prod prístupom; potom sa commitne baseline.

**Overené:** mock smoke (`--filter smoke`) 2/2 — mechanika runnera, tool slučka aj
anti-konfabulačná vetva bez API kľúča a bez DB.

### D-058 — Runtime slovník psetov (`v_property_dictionary`)
**Rozhodnutie:** LLM nemá hádať JSONB cesty do `properties` — **grounding slovník sa
generuje z reálnych dát** ako SQL view `v_property_dictionary` (migrácia
`20260711120000`): per `object_type × ifc_type × pset × property` vracia typ hodnoty,
počet objektov, počet distinct hodnôt, 5 vzoriek a min/max numeriky. Pokrýva štandardné
**aj custom** psety (D-022 vrstva 3) — presne to, čo statická IFC schéma nevie (custom
psety, reálna vyplnenosť); statický IFC slovník definícií je komplementárny D-061.
Rezervované `_kľúče` (D-022) vynechané.

**Prečo view a nie výpočet v TS:** whitelistovaná relácia = model si ju sám filtruje cez
`query_view` (`where ifc_type='IfcValve'`), jeden zdroj pravdy použiteľný neskôr aj v UI,
a flattening robí Postgres jedným lateral scanom. Pri ~10³ objektoch full scan v ms;
pri raste nad ~10⁵ prejsť na materialized view s refreshom po ETL loade (definícia sa
nemení).

**Napojenie:** `v_property_dictionary` vo whiteliste `QUERY_RELATIONS`;
`get_model_stats` rozšírený o grounding bloky (zoznam psetov s počtom properties,
podlažia, systémy, klasifikačné systémy, dokumenty — best-effort, výpadok bloku nezhodí
tool); system prompt: „otázky na vlastnosti → najprv v_property_dictionary, nikdy
nehádaj názvy psetov."

### D-059 — Fulltext nad všetkým (`search_text` + `search_everything`)
**Rozhodnutie:** Cieľ = **parita s človekom skenujúcim panel vlastností**: LLM musí nájsť
kľúčové slovo kdekoľvek v obsahu uzla — vrátane **custom psetov**, ktoré `search_objects`
(identita/typológia) principiálne nevidí. Recall rieši DB, úsudok nad nájdeným ostáva na
modeli (dôkazovo — viď trust loop nižšie). Migrácia `20260712120000`.

**Mechanika:**
- **`f_unaccent`** — IMMUTABLE wrapper nad `unaccent` (extension funkcia je STABLE, do
  generated column/indexu nesmie); poradie `lower(f_unaccent(…))` — unaccent najprv
  (Ú→U je ASCII, `lower` potom funguje bez ohľadu na DB locale).
- **`f_object_search_text`** — IMMUTABLE flattener: `name + object_ref + ifc_type +
  predefined_type + user_defined_type + všetky psety` (názov psetu + celý JSON = kľúče aj
  hodnoty), deterministické poradie; rezervované `_kľúče` (D-022) vynechané —
  `_drawing_links` (stovky regiónov) by utopili signál.
- **`objects.search_text`** — STORED generated stĺpec (pri ~10³ riadkoch bloat
  irelevantný) + GIN indexy: `to_tsvector('simple', …)` (fulltext) a `gin_trgm_ops`
  (preklepy/podreťazce). Zmena konvencie `_kľúčov` ⇒ regenerácia stĺpca novou migráciou.
  ETL/seed insertujú explicitné stĺpce → kompatibilné bez zmeny.
- **RPC `search_everything(q, object_types[], max_rows)`** — prvé `.rpc()` v repe,
  čisto parametrizované; kombinuje FTS (`websearch_to_tsquery('simple')` — slovenský
  stemmer neexistuje, morfológiu aproximuje trigram) s fuzzy vetvou (`word_similarity`,
  threshold 0.4 cez SET na funkcii — default 0.6 nechytal bežné preklepy). FTS zásah
  vždy ranked nad čisto fuzzy (+1.0). Vracia `score`, `match_kind`, `headline`
  (ts_headline úryvok) a **`matched_properties`** — v ktorom psete/property match nastal
  (lateral len nad vrátenými riadkami; dôkaz pre trust loop). Row-cap 50 (D-005).
- **Tool `search_everything`** + prompt: hľadanie podľa obsahu → search_everything,
  skúsiť aj anglický ekvivalent (kľúče psetov bývajú anglické), citovať
  matched_properties ako dôkaz, záver z fuzzy zhody formulovať ako odvodenie.

**Overené na lokálnom PG 16 (migrácie + seed):** diakritika („cerpadlo" → „Obehové
čerpadlo ÚK-01"), custom pset hodnota („daikin" → matched_properties
`VZT_Parametre.Manufacturer`), preklep („carpadlo" → fuzzy 0.56), multiword
(„vzduchotechnicka jednotka" → VZT uzly), prázdny dopyt → 0 riadkov, object_types filter.
Eval metrika: kategória psets_custom (fail-by-design pred D-059) → cieľ ≥ 75 %.

### D-060 — Agregácie + numericky bezpečné filtre (`aggregate_objects`)
**Rozhodnutie:** Súčty/priemery/min/max a **každé číselné porovnanie** hodnoty psetu počíta
**databáza**, nie model z orezaných riadkov (row-cap 50 → vymyslené čísla — pozorované
v prevádzke D-056). Dôvod v koreni: PostgREST filter nad JSONB cestou porovnáva gt/lt ako
**text** (lexikograficky `'9' > '10'`) a `::numeric` cast sa v ňom vyjadriť nedá → RPC.
Migrácia `20260713120000`.

**RPC `aggregate_objects`** (plpgsql, `stable`, `set search_path`, read-only):
- `agg count|sum|avg|min|max` nad `prop_path` (cesta v properties); **guarded numeric
  cast** (regex) — nenumerické hodnoty sa preskočia a reportujú v `skipped_non_numeric`
  (poctivosť voči modelu).
- `group_by` (stĺpec z whitelistu) alebo `group_by_path` (pset cesta, napr. výrobca),
  skupiny capped ≤ 50, radené podľa hodnoty.
- AND `filters` `{column|path, op, value}` — `gt/gte/lt/lte` nad path porovnáva
  **numericky** (nečíselná value → raise); `ids uuid[]` na reťazenie (locate → agregácia).
- `return_rows=true` = escape hatch: top 50 riadkov s hodnotou (implicitný not-null),
  vrátane `object_type` pre trust-loop zdroje.
- **Bezpečnosť dynamického SQL** (jediné miesto v repe): whitelisty relation
  (objects|v_asset_effective) / agg / op / stĺpcov, identifikátory `format('%I')`,
  literály `format('%L')`, JSONB cesty ako pole `%L` literálov. Injection pokusy
  (relation, group_by, filter column, quote breakout vo value, path prvok) overené —
  raise alebo neškodný literál.

**Napojenie:** tool `aggregate_objects`; **guidance guard v `query_view`** — pokus
o gt/gte/lt/lte nad JSONB cestou vyhodí chybu s presným návodom na aggregate_objects
(viditeľné v trace; lepšie než tiché zlé výsledky aj než neviditeľný re-routing);
prompt: „súčty a číselné porovnania psetov → aggregate_objects, nikdy nepočítaj
z orezaných riadkov."

**Overené na lokálnom PG 16:** sum s dedičnosťou type→occurrence (9800 = 4800 + 5000
zdedených), count group by ifc_type, numerický filter gt 4900 (vráti len 5000, text
porovnanie by zlyhalo), rows režim s object_type, injection sada.

### D-061 — Statický IFC slovník psetov (`ifc_property_definitions`)
**Rozhodnutie:** Definície **štandardných** psetov (Pset_/Qto_) žijú v DB ako referenčná
tabuľka `ifc_property_definitions` — LLM grounding **významu**: description, dátový typ
(PrimaryMeasureType), enum hodnoty (PEnum_*), aplikovateľné triedy. Zrkadlo vzoru
`relationship_types` (D-051): zdroj pravdy = Python modul **`etl/pset_manifest.py`**,
ktorý číta bSDD/psd šablóny zabudované v `ifcopenshell`
(`ifcopenshell.util.pset.PsetQto("IFC4X3")`), `--sql` generuje deterministické INSERTy
commitované do migrácie `20260714120000`. Komplementárne k `v_property_dictionary`
(D-058): statický slovník = čo property ZNAMENÁ; runtime slovník = čo v dátach reálne JE
(vrátane custom psetov, ktoré statická schéma z princípu nepozná).

**Rozsah:** LEN triedy prítomné/plánované v projekte (kurátorovaný `DEFAULT_CLASSES` —
ARCH+VZT demo model + ÚK/ZTI triedy pre ventilový use-case; 25 tried → 973 properties
v 127 psetoch), nie celý IFC4.3 katalóg. Description orezané na 200 znakov (grounding,
nie špecifikácia). Enum hodnoty rozbalené na čisté stringy (wrappedValue). Regenerácia
po zmene dát: `--classes-from-db` (distinct `objects.ifc_type`) → nová migrácia; trieda
bez šablón sa reportuje, nezhodí generovanie. PK `(pset, property)` +
`applicable_classes text[]` (žiadna class×pset×property explózia).

**Napojenie:** tabuľka vo whiteliste `QUERY_RELATIONS` (dedikovaný tool netreba —
`query_view` stačí); prompt: „význam/jednotku/enum štandardnej property →
ifc_property_definitions; skutočný výskyt → v_property_dictionary."

### D-062 — Výber produkčného modelu (eval-driven)
**Rozhodnutie (procedúra):** Produkčný model pre `/api/ask` sa vyberá **meraním na eval
sade (D-057), nie pocitom** — používateľ rozhodol prejsť z free tieru (gemini-flash-lite,
zdokumentovaná konfabulácia D-056) na platený model. Zmena je čisto konfiguračná
(`LLM_PROVIDER`/`LLM_MODEL` env, provider vrstva D-056 je pluggable); anti-konfabulačná
poistka v route ostáva bez ohľadu na model.

**Procedúra výberu (spustiť po nasadení D-058–D-060 na prod a doplnení verified hodnôt
v eval sade):**
1. Pre každého kandidáta: plný eval run `npm run eval -- --runs 3 --label <model>`
   (variancia; lokálny dev + prod Supabase).
2. Porovnať: pass-rate celkovo aj per kategória (kritické: negative/anti-konfabulácia,
   psets_custom, aggregation), priemerný počet tool kôl, latenciu, cenu na otázku
   (vstup ~5–15k tokenov/otázku pri tool slučke).
3. Víťaza zapísať sem ako dodatok (tabuľka výsledkov) + commitnúť results JSON +
   nastaviť `LLM_MODEL` vo Vercel env; ROADMAP changelog.

**Kandidáti (model ID a ceny overené 2026-07-10, claude-api referencia; pri behu znova
overiť proti aktuálnym cenníkom):**
- `claude-sonnet-5` (Anthropic) — $3/$15 za MTok (intro $2/$10 do 2026-08-31), 1M kontext;
  near-Opus kvalita na agentic/tool-calling — **primárny kandidát** (je aj default
  v `lib/llm/anthropic.ts`). Pozn.: adaptívne myslenie je pri ňom default — provider
  vrstva posiela čisté Messages API cez fetch, netreba nič meniť.
- `claude-haiku-4-5` (Anthropic) — $1/$5, 200k kontext; dolná hranica ceny — zmerať, či
  po D-058/D-059/D-060 groundingu stačí (deterministické tools kompenzujú slabší úsudok).
- `claude-opus-4-8` (Anthropic) — $5/$25; horná hranica kvality, pravdepodobne overkill
  pre demo Q&A — merať len ak sonnet-5 nesplní cieľ na psets_custom/aggregation.
- platený Gemini tier (flash) — provider už existuje (`gemini.ts`); konkrétne ID/cenu
  overiť pri behu (Google modely sa menia rýchlo, viď D-056 dodatok).

**Cieľ:** negative kategória 100 % (žiadna konfabulácia), psets_custom ≥ 75 % (metrika
D-059), celkový pass-rate ≥ 85 % pri akceptovateľnej cene na otázku.

### D-063 — Obsah dokumentov (`document_pages` + `search_documents`)
**Rozhodnutie:** Otázky na **obsah** dokumentov („v ktorom dokumente sa píše o X") boli
principiálne nezodpovedateľné — dokumenty boli len metadáta (D-036) + E4 regióny. Text sa
extrahuje z PDF per strana do tabuľky `document_pages` a vyhľadáva RPC `search_documents`
(FTS, rovnaká normalizácia lower+f_unaccent ako D-059). Migrácia `20260715120000`.

**Implementácia:**
- **`etl/pdf_text.py`** — rovnaký vstupný kontrakt ako E4 (`docs.csv`: `source_path` pod
  `podklady/FINAL`, `container_name` = object_ref dokumentu), ale VŠETKY PDF (nie len
  výkresy VD). PyMuPDF (už ETL závislosť, D-041), `page.get_text("text")` + normalizácia
  bielych znakov, prázdne strany von. Idempotentné (delete+insert per dokument v jednej
  transakcii). Dokument mimo DB → warning, beh nezhodí. `--dry-run` = report.
- **RPC `search_documents(q, max_rows)`** — websearch FTS + ts_rank + ts_headline snippet,
  join na objects (identita dokumentu v jednom calle), row-cap 50, guardraily podľa
  AGENTS pravidla (stable, search_path, parametrizované).
- **Tool `search_documents`** — vracia dokument/stranu/snippet + `deep_link
  /drawing/<id>?page=<n>` (stavia server); dokumenty idú do trust-loop zdrojov. Prompt:
  obsah → search_documents, metadáta → query_view.

**Poctivé očakávanie:** výkresy sú prevažne vektorová grafika — text je riedky (legendy,
rohové pečiatky, špecifikácie); OCR zámerne mimo scope. Dokument bez lokálneho zdrojového
PDF stránky nemá a tool to v hinte povie. Extrakcia sa spúšťa tam, kde sú PDF lokálne
(rovnaký workflow ako E4), po E3 uploade dokumentov.

---

## 8. Budúce rozhodnutia (D-037+)

> Brainstorm smerov, ešte **nerozhodnuté** — sú to kandidáti, nie záväzky.
> Číslovanie rezervované; finálne rozhodnutie sa zapíše až keď príde na rad
> (najskôr post-S4, po funkčnom ETL s reálnym IFC z diplomky).

### D-037 — 3D IFC Viewer integrácia *(→ rozhodnuté ako D-044)*
**Status: supercedovaný D-044** — rozhodnutie prijaté, viď D-044 (IFClite, S5,
paralelná vetva, obojsmerná selekcia cez IFC GUID). Predpoklad ETL (S4) splnený (E2 ✅).
**Kontext (zachovaný pre históriu):** AIM Viewer je momentálne čisto dátový (S0–S3). Keď príde čas na geometrickú
vrstvu, kandidát je IFClite (`@ifc-lite/geometry` + Three.js integrácia do existujúceho
Next.js). WebGPU renderer alebo Three.js podľa browser support požiadaviek.
**Otvorené otázky:** Kedy (post-S4), ako hlboko (read-only viewer vs. mutácie), server
mód pre veľké súbory.
**Závislosť:** Vyžaduje funkčný ETL s reálnym IFC z diplomky (S4).

### D-038 — PDF / DWG výkres vedľa IFC viewera (split-screen) *(→ rozhodnuté ako D-072)*
**Status: supercedovaný D-072** — split 2D+3D pohľad je súčasťou georeferencovaných
PDF podkladov (D-072); DWG/DXF vektorová cesta ostáva ako neskoršia fáza tam.
**Kontext (zachovaný pre históriu):** Stavebný sektor je závislý na 2D autorizovaných výkresoch (pečiatka).
Minimálne riešenie: split-screen — PDF viewer (`react-pdf`) na jednej strane, IFC viewer
na druhej, používateľ si porovnáva manuálne.
**Výhoda DWG oproti PDF:** DXF obsahuje vektorové entity so súradnicami, georeferencing
je potenciálne automatický. DWG → DXF konverzia zadarmo (DWG TrueView), render cez
`three-dxf`.
**Závislosť:** Vyžaduje D-037 (3D viewer).

### D-039 — Georeferencing PDF/DWG výkresov do IFC priestoru *(→ rozhodnuté ako D-072)*
**Status: supercedovaný D-072** — 2-bodová manuálna kalibrácia + `_georef` úložisko
prevzaté do D-072; IfcGridAxis/AI auto-kalibrácia ostáva ako neskoršia fáza tam.
**Kontext (zachovaný pre históriu):** Prepojenie 2D výkresu s 3D IFC modelom cez spoločný referenčný systém.
Základný prístup: manuálne označenie bodu v PDF + zodpovedajúci bod v IFC scéne →
transform matica. Z súradnica z `floors.elevation`. Transform sa uloží do
`documents.properties` ako `_georef` — jednorazová práca per výkres.
**Algoritmizovateľná alternatíva:** IFC nesie `IfcGridAxis` (osová sieť s presnými XY
súradnicami). PDF nesie tie isté osi nakreslené v mierke (1:50, 1:100...). Flow:
extrakcia `IfcGridAxis` z IFC → detekcia osí v PDF (OCR + čiary alebo AI vision) →
párovanie minimálne 2 priesečníkov → homografia → transform matica. Mierka sa dopočíta
automaticky.
**AI potenciál:** `GPT-4 Vision` alebo špecializovaný model na detekciu osovej siete
v PDF výkrese — eliminuje manuálnu prácu pri párovaní.
**Závislosť:** Vyžaduje D-038 (split-screen), ideálne `IfcGridAxis` v ETL pipeline.

### D-064 — Multi-projekt / multi-model pripravenosť LLM vrstvy *(kandidát)*
**Status:** brainstorm — inventúra pripravenosti spísaná, rozhodnutie padne pri 2. projekte
(línia D-033: multi-projekt = aditívne, keď príde).

**Kontext:** Program presnosti D-057–D-063 je stavaný na demo budove; otázka je, čo z neho
je viazané na projekt a čo prežije ľubovoľnú budúcu budovu/disciplínu.

**Inventúra (2026-07-11):**
- **Generické (data-driven, bez zmeny):** `v_property_dictionary`, `search_text` +
  `search_everything`, `aggregate_objects`, `document_pages`/`search_documents`,
  `get_model_stats` — všetko sa počíta z dát, nič nepozná konkrétnu budovu. Schéma
  IFC-kanonická (D-046/D-051), klasifikácia referenčná (D-011), kódovacie schémy
  pluggable per projekt (D-033/D-036). LLM provider vrstva API-pluggable (D-056),
  výber modelu eval-driven (D-062).
- **Per-projekt (z povahy veci):** `eval/questions.json` — verified hodnoty patria
  datasetu; runner má `--questions <cesta>` → per-projekt sady (napr.
  `eval/<projekt>/questions.json`). Verifikačný SQL vzor je opakovateľný (viď D-057
  workflow).
- **Per-projekt (dnes v kóde, pri 2. projekte presunúť do konfigurácie):** príklady
  v system prompte `/api/ask` (SNIM `DD01.06.03`, doménové preklady) — kandidát na
  per-projekt prompt segment; `DEFAULT_CLASSES` v `etl/pset_manifest.py` (rieši
  `--classes-from-db`).
- **Chýba (aditívne pri 2. projekte, už rozhodnuté v D-033):** `project` dimenzia
  v DB — dva projekty by sa dnes miešali (kolízie `object_ref`, dve podlažia „1NP",
  LLM dopyty naprieč budovami). Dôsledok pre LLM vrstvu: tools dostanú project scope
  (filter), `get_model_stats`/slovníky per projekt — všetko aditívne, žiadna prestavba.

**Záver:** dlhodobo neobmedzuje nič štrukturálne; jediná skutočná prerekvizita
multi-projektu je `project` entita (D-033) + scoping v tools. Eval sady a prompt
segmenty sa škálujú súbormi/konfiguráciou.

### D-065 — Pasportizácia existujúcej budovy *(kandidát)*
**Status:** brainstorm — strategické smery rozhodnuté, konkrétna zákazka nepotvrdená.

**Kontext:** Nový use-case — pasportizácia existujúcej budovy pre prevádzku a údržbu
(priestorový, technický/TZB, stavebný pasport, vybavenie). Zákazka v hre (zákazník bez
CAFM), ale nie dotiahnutá — preto kandidát, nie finálne rozhodnutie.
Odborný rámec overený: MPO ČR Pravidlá pre prevádzkovú pasportizáciu 2024 (statické dáta
→ pasport; dynamické → CAFM); COBie handover štandard (Facility/Floor/Space/Type/Component/
System/Contact/Document ≈ 1:1 s `objects` schémou → export prirodzený); USIBD LOA (measured
vs represented accuracy) + LOIN/LOI (ISO 19650) pre provenance/kvalitu; v praxi provenance
na úrovni scan session / survey batch, nie per-property.

**Rozhodnuté (platí bez ohľadu na zákazku):**
1. **Zostávame data/CDE provider (D-001)** — Nestávame sa CAFM. Funkcie delíme: statické
   dáta (čo budova je) = naše; dynamické (čo sa s ňou deje) = operatíva.
2. **Platform features (patria do platformy):** 360° fotky naviazané na space/asset (vizuálna
   provenance zamerania), prepojenie 360°/2D/3D na IFC model (reálny diferenciátor, S5/S6
   vízia), pasportizačný register s provenance/LOA, validácia úplnosti (LOIN-driven), export
   do CAFM (COBie/ICDD, D-015).
3. **Dynamika = hybrid — Cesta A teraz, dvere k B.** Cesta A = governance/monitoring nad
   operatívou (sledovanie, či sa pravda v pasporte nerozchádza s realitou). Cesta B =
   vlastnené dynamické dáta = neskôr, až keď reálna prevádzka povie, čo treba postaviť.
4. **Pre zákazku — Odoo as-is** (žiadna prestavba). Odoo berie prevádzkový náklad (24/7);
   my platíme len lacnú integráciu. Prestavba zamietnutá — tretí stack, verziová pasca,
   slabší vibecoding leverage; ak investovať vývoj do operatívy, tak do vlastného stacku
   (Cesta B), nie do cudzieho frameworku. Zákazka = field study pre budúcu vlastnú vrstvu.
5. **Deliaca čiara** (lacné vyriešiť, vysoká hodnota): identita/lokácia/typové vlastnosti/
   klasifikácie/dokumenty → pasport (naše); stav/work orders/servisy/náklady → operatíva.
   Toto je governance diferenciátor.

**Dôsledok pre schému:** ŽIADNA zmena. Nové `object_type` hodnoty (napr. `door`/`window`
ako maintainable assets, povrchy ako properties priestoru), nové `rel_*` hrany, lifecycle
events (vzor `ifc_guid_history` s `valid_from`/`valid_until`) + integračná vetva na Odoo =
všetko aditívne. Model z D-018 to drží.

**Otvorené (do potvrdenia zákazky):** ~~granularita provenance~~, ~~metóda zamerania~~,
~~povrchy vs samostatné objects~~ *(→ vizuálny zber rozhodnutý ako **D-073**: metóda =
manuálny upload fotky + equirect 360, provenance na úrovni capture/survey-session, capture =
samostatné `objects` riadky)*; ostáva mapa vlastníctva polí pasport↔Odoo.

**Závislosť:** Vyžaduje reálnu zákazku (field study) + funkčný ETL pipeline (D-031).

### D-066 — AI chat ovláda 3D scénu (ofarbenie / skrytie / izolácia)
**Status:** implementované (2026-07-12).

**Kontext:** LLM rozhranie (D-056) vedelo prvky v 3D len zvýrazniť a priblížiť
(`show_in_3d` → `/ifc?focus=…` → bridge správa `FOCUS`). Používateľ chce chatom
vykonávať aj viewer operácie IFClite („ofarbi všetky dvere na červeno", „skry steny",
„vyizoluj VZT", „zobraz všetko") — teda funkcie, ktoré IFClite SDK už má
(`colorize`/`hide`/`show`/`isolate`/`resetVisibility`/`resetColors`).

**Rozhodnutie:** rozšíriť existujúcu D-056 architektúru (server stavia URL akciu →
klient naviguje → viewer wrapper prekladá URL na postMessage), NIE zavádzať nový kanál:

1. **Nový tool `style_in_3d`** (`lib/llm/tools.ts`): `action` = colorize | hide |
   show | isolate | show_all | reset_colors; výber prvkov explicitne
   (`ids_or_refs`, batch resolve) alebo filtrom (`ifc_type`/`predefined_type`/
   `query` — „všetky dvere" = jeden call, bez enumerácie), cap `STYLE_CAP=400`
   (GUIDy cestujú v URL); `color` = validovaný hex RRGGBB (model prekladá
   pomenované farby). GUIDy sa resolvujú dávkovo cez `ifc_guid_history`
   (aktívne, `valid_until IS NULL`).
2. **Wire formát `ops`** v URL `/ifc?ops=<op>:<arg>:<guid.guid…>[;…]&r=<nonce>` —
   kompaktný (GUID abeceda bodku neobsahuje → separátor `.`, žiadny JSON quote
   bloat), viac operácií sa vo `finalActions()` zreťazí cez `;` do jednej URL
   spolu s prípadným `focus` (klient vykonáva len prvú navigáciu).
3. **Bridge rozšírenie** (`components/ifc-viewer.tsx` ↔ fork
   `apps/viewer/src/aim/AimBridge.tsx`, vetva `aim-integration`): nové správy
   `COLORIZE{guids,color}` · `HIDE` · `SHOW` · `ISOLATE` · `SHOW_ALL` ·
   `RESET_COLORS` mapované 1:1 na IFClite SDK (`bim.viewer.*`). Počiatočné ops
   z deep-linku sa aplikujú až po `MODELS_LOADED` (GUID resolve potrebuje
   naparsované modely), soft-nav reaktívne cez nonce `r` (vzor focus, D-056).
4. **Sémantika stavu:** efekty sa vo vieweri HROMADIA naprieč požiadavkami
   (iframe pri soft-nav nezaniká); reset je explicitná operácia
   (`show_all`/`reset_colors`) — model to má v system prompte.

**Dôsledky:** klientský chat panel (`ask-panel.tsx`) sa nemení (stále len
navigácia); žiadna zmena DB ani schémy; deploy vyžaduje aj redeploy forku
(ifc-lite-viewer.vercel.app). Izolácia rešpektuje federáciu — GUIDy sa resolvujú
naprieč všetkými modelmi (D-049/D-050).

**Dodatok (2026-07-12) — výber podľa hodnoty vlastnosti psetu:** „vyizoluj nosné
prvky (LoadBearing=true)" model aproximoval triedami (isolate_sel IfcWall+IfcSlab+
IfcColumn) → izoloval aj nenosné steny. Fix: `style_in_3d` dostal `property` +
`value` (+ voliteľný `pset`): psety, v ktorých vlastnosť existuje, sa zistia
z `v_property_dictionary` (D-058), match beží PostgREST `or()` nad JSONB cestami
na **`v_asset_effective`** (zmergované properties → dedičnosť z typu zahrnutá),
`ilike` bez `%` = case-insensitive presná zhoda. Kombinovateľné s ifc_type/
predefined_type (AND), cap `STYLE_CAP` s explicitnou poznámkou o orezaní.
Prompt: „NIKDY neaproximuj vlastnosť triedami ani doménou" + `domain=structure`
preznačený na konštrukčné TRIEDY (nie filter nosnosti). Číselné porovnania
(>, <) zámerne nevie — na to je `aggregate_objects` (D-060) + `ids_or_refs`.

### D-067 — AIM karta v natívnom paneli embed viewera
**Status:** implementované (2026-07-12).

**Kontext:** po migrácii 3D na embednutý IFClite fork (iframe wrapper, PR #17–22 +
prepnutie `ifc-workspace.tsx` na wrapper `ifc-viewer.tsx`) mal vybraný prvok dva
panely: natívny properties panel viewera + plávajúci `ElementInfoPanel` hosta nad iframom.

**Rozhodnutie:** jeden panel — host po `ENTITY_SELECTED` dotiahne DB súhrn
(`/api/element/{id}`) a pošle ho cez bridge ako **generickú render schému**
(`lib/aim-panel.ts`; správy `AIM_PANEL_DATA{guid,data}` / `AIM_PANEL_EMPTY{guid,reason}`);
viewer ju vykreslí v natívnom paneli (fork: `apps/viewer/src/aim/AimCard.tsx` +
`aimPanelStore.ts`). Schéma je verzovaná (`version: 1`) a data-driven — nové polia/sekcie
sa pridávajú len na hoste, bez redeployu viewera. `href` v karte sú host-relatívne cesty;
viewer ich neinterpretuje, klik pošle späť `AIM_NAVIGATE{href}` a naviguje parent appka.
Odpovede sú GUID-stampované — stale odpoveď po zmene výberu viewer zahodí. Popri tom
`next.config.ts` dostal `NEXT_DIST_DIR_OVERRIDE` (paralelný devtest server popri
`npm run dev` — Next 16 drží single-instance lock na distDir).

---

### D-068 — Ochrana `/api/ask`: per-IP rate limit + origin guard
**Status:** implementované (2026-07-12).

**Kontext:** `/api/ask` je verejný endpoint bez auth (línia D-025/D-026 — auth zatiaľ
nie je) a jedna požiadavka spustí až `MAX_TOOL_ROUNDS+1` volaní LLM providera
(platené tokeny) + desiatky DB dotazov. Na verejnom Verceli priamy vektor na
vyčerpanie kreditu / DoS (nález nočného auditu 2026-07-12).

**Rozhodnutie:** dve lacné vrstvy bez externých závislostí (`lib/api-guard.ts`):
1. **Origin guard** — POST s Origin hlavičkou iného hostu = 403 (cudzia stránka
   strieľajúca z prehliadača používateľa). Požiadavky bez Origin (curl, eval
   runner D-057) prechádzajú — je to CSRF vrstva, nie autentifikácia.
2. **Per-IP sliding-window rate limit** — default 20 req / 10 min, len v produkcii
   (eval runner búši do dev servera desiatkami otázok); override
   `ASK_RATE_LIMIT_MAX` / `ASK_RATE_LIMIT_WINDOW_MS` (0 = vypnuté). 429 + Retry-After.
   IP z `x-real-ip`/`x-forwarded-for` (na Verceli ich nastavuje platforma).

**Vedomé limity:** in-memory stav je per serverless inštancia — nie presný
distribuovaný limit (ten by vyžadoval KV/Upstash; zbytočná závislosť pre demo).
Skutočná ochrana účtov príde s auth + RLS (mimo línie D-025); Turnstile/WAF je
prípadná ďalšia vrstva. LLM vrstva (tools/prompt/model) sa nemení ⇒ eval beh
podľa D-057 nie je nutný; limiter je v dev vypnutý, takže evaly bežia bez zmeny.

### D-069 — Hlasový vstup pokynov (STT) do LLM rozhrania
**Status:** implementované (2026-07-12).

**Kontext:** pokyny pre `/api/ask` sa písali len na klávesnici — v teréne/na mobile
nepraktické. Vstup je slovenčina s odbornou terminológiou (VZT, ÚK, ZTI) a kódmi
prvkov (DD01.06.03), čo kladie vysoké nároky na presnosť prepisu. Rešerš (2026-07):
Web Speech API nevyhovuje (Firefox vypnuté, SK kvalita slabá, bez doménového
slovníka); on-device Whisper v prehliadači pre SK nepraktický (250 MB+ model);
Anthropic API audio vstup nemá — STT musí byť externá vrstva; platené STT
(OpenAI gpt-4o-transcribe ~$0.006/min, Deepgram Nova-3 ~$0.0077/min s realtime
streamingom a keyterms) sú cieľ pre produkciu, demo malo byť zadarmo.

**Rozhodnutie:** dictation pattern (vzor ChatGPT/Claude) + Gemini ako bezplatný STT:
1. **UX — žiadne auto-send:** mikrofón v ask-paneli nahrá diktát (MediaRecorder,
   webm/opus; Safari mp4/AAC cez `isTypeSupported`), prepis sa PRIDÁ do textarea
   ako editovateľný text a používateľ ho odošle sám — pri kódoch prvkov môže STT
   urobiť chybu, kontrola je nutná. Max 60 s, časovač, zrušenie, chybové stavy;
   tlačidlo sa bez `MediaRecorder`/`getUserMedia` podpory vôbec nezobrazí.
2. **STT provider vrstva `lib/stt/`** (zrkadlí `lib/llm/provider.ts`, D-056):
   server-only, `STT_PROVIDER`/`STT_MODEL` env, default **gemini** —
   `generateContent` prijíma audio natívne (`inline_data`), beží na existujúcom
   `GEMINI_API_KEY` (free tier pokrýva demo, $0, žiadny nový účet). Prompt nesie
   doménový slovník (VZT/ÚK/ZTI/IFC/pset, tvar kódov) — hlavná výhoda LLM-STT.
   Mock provider (`STT_PROVIDER=mock`) pre testy/devtest bez kľúča a siete.
3. **`/api/transcribe`** — route handler s ochranou podľa D-068 (origin guard +
   per-IP limit, default 30/10 min len prod, `TRANSCRIBE_RATE_LIMIT_MAX` override),
   limit 4 MB, len `audio/*`; `SttConfigError` → 503 s návodom.

**Vedomé limity:** batch prepis (nie streaming) — diktáty sú krátke (input cap
2000 znakov), latencia 1–3 s stačí; realtime (Deepgram) je aditívny ďalší provider.
Kvalita SK prepisu Gemini flash-lite sa priebežne overí na reálnych diktátoch —
prepnutie na platený STT je čisto env zmena. Systémové diktovanie OS (iOS/macOS
podporuje SK) funguje do textarea nezávisle od tejto vrstvy. LLM vrstva
(tools/prompt/model) sa nemení ⇒ eval beh podľa D-057 nie je nutný.

### D-070 — Assetin design kit (zdieľané brand tokeny naprieč appkami)
**Status:** kit v0.1.0 publikovaný (`AssetinSpace/design-kit`), AIMviewer nabrandovaný (2026-07-12), IFClite viewer fork nabrandovaný (2026-07-17); ArchiveApp migrácia čaká.

**Kontext:** brand assetin žije de facto len v ArchiveApp
(`frontend/src/styles.css`, ~3700 riadkov plain CSS): zelená `#1a7431`
(hover `#156028`), navy `#121a2b`, Inter, radius 6–8 px, dotykové targety
(tlačidlá ≥44 px, inputy ≥48 px/16 px), triedy `.btn-*`, `.card`, `.fab`;
logá `assetin-logo.png`/`assetin-mark.png` (len PNG). Zvyšné farby sú surové
Tailwind hex hodnoty (gray/green/red/amber/blue škály) bez semantiky.
AIMviewer (Next.js + Tailwind v4 + shadcn) beží na defaultnej neutrálnej
téme bez brandu a loga. Inšpirácia: That Open Company
(`@thatopen/ui`) — tokens-first (CSS custom properties), nad tým adaptéry,
npm distribúcia, showcase stránka so živými ukážkami.

**Rozhodnutie:** samostatný repozitár `AssetinSpace/design-kit` (npm balík
inštalovaný z GitHubu), rozsah v1 = tokeny + CSS + logá (bez React/web
komponentov), light **aj** dark od začiatku:
1. **Vrstva 0 — tokeny:** `tokens.css` (`:root` + `.dark`; farby vrátane
   semantických stavov success/warning/danger/info, typografia, radius,
   spacing, touch targets, z-index) + `tokens.json` ako strojový zdroj pravdy.
2. **Vrstva 1a — plain-CSS adaptér** (`archive.css`): dnešné triedy
   ArchiveAppu (`.btn-*`, `.card`, `.fab`, modaly…) čerpajúce výhradne
   z tokenov — ArchiveApp prejde na kit bez zmeny markupu.
3. **Vrstva 1b — shadcn adaptér** (`shadcn.css`): mapovanie tokenov na
   shadcn premenné (`--primary` = assetin zelená v oklch, `--radius`,
   `--font-sans`, sidebar/chart škály) pre light aj dark — AIMviewer sa
   nabranduje bez zásahu do komponentov.
4. **Assets:** logá (cieľ: prekresliť do SVG; PNG ako fallback), favicon.
5. **Showcase:** statická HTML stránka (à la That Open docs) — farby,
   typografia, tlačidlá, inputy, karty, logá.

**Aplikácia na AIMviewer (prvý konzument, hotové 2026-07-12):** závislosť
`github:AssetinSpace/design-kit` v `package.json`; v `app/globals.css`
nahradené defaultné `:root`/`.dark` bloky importom kitového `shadcn.css`;
font Geist → Inter (`next/font`, premenná `--font-sans`); assetin mark
v hlavičke sidebaru + brand `favicon.ico`; overené vizuálne (light + dark,
devtest stránka + Playwright) a `tsc`/vitest (22/22). ArchiveApp migruje
ako druhý (výmena `:root` bloku + postupné nahradenie surových hexov
tokenmi).

**Vedomé limity:** kit repo zatiaľ neexistuje (prerekvizita: založiť
`AssetinSpace/design-kit` a sprístupniť); logo existuje len ako PNG —
SVG prekreslenie je samostatný krok; zdieľané React komponenty a web
components sú vedome mimo v1 (aditívna vrstva 2, keď bude ≥3. konzument).

### D-071 — Stratégia forku IFClite (upstream sync + vlastná AIM vrstva)
**Status:** rozhodnuté (2026-07-12).

**Kontext:** 3D vrstvu embedujeme cez fork `AssetinSpace/ifc-lite` originálu
[`LTplus-AG/ifc-lite`](https://github.com/LTplus-AG/ifc-lite) (MPL-2.0; viď D-044, D-055,
D-067). Originál pravidelne vydáva vylepšenia, ktoré chceme preberať, no zároveň si držíme
vlastné úpravy (AIM iframe bridge, AIM karta, `?models=` federácia, FOCUS colorize). Bez
disciplíny by sa naše zmeny bili s každou aktualizáciou upstreamu.

**Rozhodnutie:** IFClite konzumujeme ako **optimalizovaný fork**, nie ako npm balík (upravili
sme *vnútro* viewer appky, nie len publikované `@ifc-lite/*`).
- Vlastný kód žije ako **izolovaná vrstva** v `apps/viewer/src/aim/` (upstream tam nemá súbory →
  nulová kolízia).
- Nevyhnutné napojenia do upstream súborov (`App.tsx`, `ViewerLayout.tsx`, `PropertiesPanel.tsx`)
  sú obalené sentinelom `// >>> AIM-FORK … // <<< AIM-FORK`, aby merge konflikt bol okamžite
  viditeľný a rozhodnutie „keep our side" jednoznačné.
- Upstream sa preberá periodickým **merge** (nie rebase — `main` je nasadený cez Vercel a nesie
  PR-ka) cez `upstream` remote; fetch je voči originálu len na čítanie — nič sa mu neposiela.
- Sync spúšťa **bot-PR** vo vlastnom repe (`.github/workflows/upstream-sync.yml`, týždenne +
  manuálne); pri konflikte otvorí PR s markermi a labelom `needs-manual-merge`. Beží na
  **fine-grained PATe** (secret `UPSTREAM_SYNC_TOKEN`), nie na `GITHUB_TOKEN` — ten nesmie
  pushnúť nič pod `.github/workflows/` a scope `workflows` sa mu nedá udeliť (viď dodatok
  2026-07-27). Recept a tabuľka
  touchpointov: `ifc-lite/docs/FORK_MAINTENANCE.md`, konvencia v `ifc-lite/AGENTS.md`. CI: heavy
  joby (Build+WASM, Rust tests) bežia na forku na `ubuntu-latest` (Depot je upstream-only),
  upstream-only workflowy (release/docs/docker) sú guardnuté `if: github.repository ==
  'LTplus-AG/ifc-lite'`.

**Dôvod:** fork drží plný prístup ku celému stromu (aj rust core) a funguje hneď; layering +
sentinely + merge (nie rebase) minimalizujú konflikty pri každom syncu.

**Dôsledok:** generické bugfixy (drag cez iframe) zatiaľ držíme u nás, neposielame upstream.
Budúca migrácia na čistý npm-balíkový model ostáva otvorená — podmienená tým, že upstream vystaví
extension-pointy (props/sloty); pri riešení každého wiring-konfliktu si poznamenáme, ktorý hook by
ho odstránil (podklad pre neskoršie upstream PR).

**Prevádzkový model (od 2026-08-01):** rozhodnutie hore hovorilo *čo* sa má diať, nie *kto to
odsleduje* — a presne tam to tri týždne stálo (viď dodatok 2026-08-01). Doplnené:

| Kedy | Čo sa deje | Kto zasiahne |
|---|---|---|
| pondelok 06:00 UTC | cron spustí `upstream-sync.yml` | nikto |
| bezkonfliktný sync | PR sa otvorí, počká na CI a **zmerguje sa sám** (merge commit) | nikto |
| konfliktný sync | PR ostane otvorený s `needs-manual-merge` | človek dorieši, „keep our side" |
| každý beh (aj zlyhaný) | prepíše sa pinnutý issue **`Upstream sync status`** vo forku | — |
| raz týždenne | pozrieť ten jeden issue: koľko pozadu, ako dopadol posledný beh, expirácia PATu | človek, 30 s |

Tri pravidlá, ktoré nie sú kozmetika a nesmú sa „upratať":
- **Žiadne `|| true` okolo `gh` volaní** — presne tým sa stratili tri týždne.
- **Sync PR sa merguje merge commitom, nikdy squashom** — squash zahodí merge-base voči
  upstreamu a ďalší sync prekonfliktuje celý strom.
- **CI sa čaká v jobe (`gh pr checks --watch`), nie cez `gh pr merge --auto`** — `--auto`
  merguje hneď ako je PR mergeable, takže bez required status checks na `main` by mergol
  pred CI, a sync PAT nemá Administration scope na to, aby si overil, či sú nastavené.

**Verzie IFClite máme na dvoch nezávislých osiach a neplietť si ich:** (1) *fork* = 3D viewer
v iframe, drift rieši cron vyššie; (2) *npm balíky* `@ifc-lite/*` v `package.json` AIMviewera,
drift rieši Renovate (`renovate.json`, pondelok, zoskupené do jedného PR). Os (2) je dnes
**mŕtva váha** — `@ifc-lite/geometry|query|wasm` ani `three` sa nikde neimportujú
(`hooks/use-ifc-query.ts` je zakomentovaný Phase-4 placeholder) a `public/ifc-lite_bg.wasm`,
ktorý `postinstall` kopíruje, nikto nefetchuje; drží sa zámerne pre in-app render, ale keď
padne rozhodnutie, že nebude, celá os (2) sa má zmazať, nie updatovať.

### D-072 — Georeferencované PDF podklady (drawing underlay) v 3D viewri
**Status:** rozhodnuté (2026-07-14), MVP v implementácii — supersedovuje kandidátov
D-038 (split-screen) a D-039 (georeferencing); preberá ich 2-bodový prístup
a `_georef` úložisko.

**Kontext:** Stavebníctvo je závislé na 2D autorizovaných pôdorysoch. Chceme podložiť
3D model výkresom naviazaným na podlažie podľa vzoru Dalux „Locations": 2D Drawing view,
Split 2D+3D so zamknutou úrovňou a synchronizovanou značkou polohy/smeru kamery,
a PDF rovina viditeľná v 3D reze podlažia (Ctrl+scroll posúva rez).

**Rozhodnuté:**
1. **Nový samostatný balík `@ifc-lite/drawing-underlay`** vo forku (D-071), verzovaný
   changesetom + api-surface snapshot — čistá, framework-free logika: 2-bodová
   similarity transformácia (uniform scale + rotácia + translácia), `DrawingPlacement`
   schéma, self-contained WebGPU `PdfPlanePipeline` (vzor `SymbolicFillPipeline`,
   `render(pass, viewProj)`). **Nulová AIM/Supabase/React/pdf.js závislosť** →
   upstreamovateľný modul (línia D-071: hook namiesto forku vnútra). pdf.js žije
   v appke viewera, do balíka vstupuje `ImageBitmap`.
2. **AIM-špecifické lepidlo** (bridge správy `UNDERLAYS_LOAD`/`UNDERLAY_SAVE`,
   perzistencia) v `apps/viewer/src/aim/` a v AIMvieweri; úpravy upstream súborov
   v sentineloch `// >>> AIM-FORK` (D-071).
3. **Perzistencia bez migrácie:** transform v `_georef` v `properties`
   dokumentového objektu (`objects.properties`, rezervovaný `_` kľúč ako
   `_drawing_links` — tabuľka `documents` properties nemá; schéma v1:
   `storey_guid`, `storey_z`, `page`, `page_size`, `affine[a,b,tx,c,d,ty]`,
   `calibration[2]`, `opacity`,
   `visible`, `discipline`, `calibrated_at`). Väzba na podlažie cez **IFC storey
   GlobalId** (D-010/D-044 GUID-ako-spojka). Zdroj PDF = existujúce `documents`
   (E3, bucket `documents/`). Zápis cez nový route handler (PATCH), pre demo gated
   env secretom — poctivý limit, kým nepríde auth (línia D-025/D-026).
4. **Kalibrácia MVP:** 2 body v PDF + 2 zodpovedajúce body v modeli (existujúci
   raycast `raycastScene`/`raycastStoreyFloor`) → similarity; Z z `storeyElevations`
   (fallback cachované `storey_z`, keď cache-only load nemá elevácie). In-viewer,
   živý náhľad roviny, uložené kalibračné body = re-editovateľné.
5. **Render MVP:** PDF rovina v 3D perspektíve (nová WGSL textúrovaná quad pipeline;
   alpha-blend, depth-test bez depth-write; tiling ≤ limit zariadenia pre A0, mip,
   LRU cez viac výkresov, deterministický `.destroy()`) + Drawing view (ortho
   top-down zamknutá na podlažie, vždy-zapnutý horizontálny rez nezávislý od section
   toolu) + jednoduchý Split (povýšený plávajúci 2D panel, klik v 2D → skok kamery,
   zelená značka + smerový klin) + Ctrl/Cmd+scroll posúva rez (binding je voľný).

**Vedomé limity / riziká:** federácia — placement žije vo world frame ukotvenej scény
(anchor model, dodatok D-050); nová GPU pipeline + pamäť textúr; zápis `_georef` bez
auth len za env bránou.

**Neskôr (po MVP, aditívne):** plnohodnotný resizable split pane; viac výkresov/
disciplín na podlažie (Dalux „folders") → prípadná tabuľka `drawing_placements`;
DWG/DXF vektor (D-038); IfcGridAxis/AI auto-kalibrácia (D-039); 3-bodová affine;
viacstranové PDF.

**Závislosti:** D-044 (IFClite viewer), D-049/D-050 (federácia), D-071 (fork), E3 (documents).

### D-073 — Reality Capture v1 (fotky + statické 360° panorámy)
**Status:** rozhodnuté (2026-07-14), v implementácii — konkretizuje a **zatvára otvorené
body D-065** (metóda zamerania, granularita provenance, povrchy vs samostatné objects).

**Kontext:** Modul reálneho zberu (inšpirácia Dalux Capture). v1 rieši dve veci — **klasické
fotky** a **statické 360° equirectangular panorámy** — obe ukotvené **naraz troma spôsobmi**
(2D PDF plán · 3D web-ifc scéna · sémantika = IfcSpace/asset) a **obojsmerne prepojené**
(klik na priestor → jeho snímky; otvorenie snímky → navigácia na priestor + pin na pláne aj
v 3D). Je to „platform feature" už načrtnutá v D-065 (360°/2D/3D naviazané na IFC ako vizuálna
provenance zamerania). Prieskum repa vyvrátil pôvodné predpoklady (žiadny Express/Railway/R2/
three.js-in-app/bitemporal/multi-tenancy) — stavia sa na existujúcich vzoroch: `_georef`
(D-072), `documents` (D-014/D-032), GUID bridge (D-044/D-067), guarded write route (D-068/D-072).

**Rozhodnuté:**
1. **Dátový model „ako dokumenty" (D-018), žiadna prestavba schémy:** capture point =
   `objects` riadok `object_type='capture'` + tenká prípona `captures(kind)`. Ukotvenie
   (2D `plan`{documentId,page,u,v} + 3D `world`{x,y,z} + `yaw`) v rezervovanom
   `properties._capture` JSONB (versioned, validované; presný vzor `_georef`, §4). Jednotlivá
   snímka/verzia = `objects` riadok `object_type='capture_media'` + prípona `capture_media`
   (analóg `IfcDocumentInformation`: `location`, `storage_type`, rozmery, `captured_at`,
   `valid_from`/`valid_until`). Migrácia `20260716120000_reality_capture.sql`.
2. **Hrany — prvé `aim_` položky manifestu (D-051/D-048):** `aim_rel_capture_located`
   (capture → space|floor, unique-active) a `aim_rel_capture_media` (capture → capture_media,
   1:N append-only). IFC pre „reality-capture bod s verzovaným médiom" nemá čistý koncept →
   `aim_` namespace + `export_path='icdd'` (ICDD linkset, D-015). **Zámerne NErozširujeme**
   `rel_contained_in_spatial_structure` o `capture` — držíme captures mimo IFC-kanonických
   asset/priestorových čítaní (žiadny leak do „prvky v priestore", zachovaná unique-active
   sémantika assetov). *(Odchýlka od pôvodného plánu „reuse bez zmeny manifestu": validačný
   trigger z manifestu (D-051) by `capture` ako `from` typ inak odmietol.)*
3. **Verzovanie v čase = append-only** (D-065 „lifecycle events" vzor): nová snímka lokácie =
   nový `capture_media` + `aim_rel_capture_media` hrana; „aktuálna" = `valid_until IS NULL`
   (+ najnovší `captured_at`), stará sa uzavrie `valid_until`, needituje sa in-place.
   **Granularita provenance = capture/survey-session** (nie per-property) cez `source` na
   hrane — zatvára otvorený bod D-065.
4. **Úložisko = Supabase Storage** (nie R2 — v repe neexistuje): verejný bucket `captures`
   (vzor `documents`/`ifc`), idempotentne založený z upload route; kľúče
   `captures/<capturePointId>/<mediaId>_{orig,preview,thumb}`. **Server-side `sharp`** (priama
   závislosť; už tranzitívne cez Next) generuje `preview` (rýchle načítanie, 360 downscale pod
   GPU limit) + `thumb`. Serving = priama public CDN URL, žiadne signovanie (viewer je public
   read-only, D-025/D-026).
5. **360° viewer = Photo Sphere Viewer** (MIT, three.js) cez `react-photo-sphere-viewer`,
   **host-side** v Next.js modáli (pluginy Markers/Compass/Gallery/Plan; `VirtualTour` NIE —
   to je SiteWalk fáza). Kľúčové: BIM engine forku je **WebGPU** a AIM host neimportuje žiadny
   `three` → PSV len „oživí" dnes mŕtvy `three` dep, žiadna koexistenčná kolízia s rendererom.
   Textúry: `orig` do 16K + generovaný `preview` (equirect 2:1) pod GPU limit (~8K mobil / 16K
   desktop); tiling super-panorám (`EquirectangularTilesAdapter`) je mimo v1.
6. **Zápis = browser upload za env bránou** (vzor D-072): route handlery `POST /api/captures`
   (+ `[id]/media`) sú default VYPNUTÉ (`CAPTURE_WRITE_ENABLED`), origin guard + per-IP rate
   limit (D-068). **Single-project** ako zvyšok appky; autor best-effort (bez auth). Čítanie
   server-only cez `service_role` + ISR tag `aim` (D-026/D-030).
7. **3D piny vo forku (D-071):** capture pins ako AIM vrstva v `apps/viewer/src/aim/`
   (`CapturePinLayer` — reuse `annotationsSlice`/`AnnotationLayer` billboard nad WebGPU
   canvasom, standalone `capturePinsStore`), bridge správy `CAPTURES_LOAD` (host→viewer, render)
   a `CAPTURE_PIN_CLICK` (viewer→host, otvor priestor so snímkami). **Authoring pinov**
   (raycast 3D pick → world coords; klik na 2D plán → normalizované u,v; auto-odvodenie
   plán↔3D cez `@ifc-lite/drawing-underlay` `world-transform` `worldToIfcMetres`→`ifcMetresToPage`
   kde má podlažie `_georef`) je **aditívny follow-up** — dátový/render/bridge kontrakt ho už
   drží (`_capture.plan`/`.world` sú nepovinné, dopĺňajú sa neskôr bez migrácie).

**Dôsledok:** nové `object_type` hodnoty `capture`/`capture_media` (aditívne, D-018), 2 nové
`aim_rel_*` v manifeste, nový rezervovaný `_capture` kľúč, nový bucket, `sharp` +
`react-photo-sphere-viewer`/`@photo-sphere-viewer/*` závislosti, redeploy forku (AIM vrstva).
Geometria sa DB nedotýka (D-044). Obojsmernosť = jedna hrana čítaná z oboch strán.

**Vedomé limity / mimo v1:** SiteWalk / prepojená virtuálna prehliadka (Street-View nódy,
`VirtualTour`); priama in-app/in-browser capture (v1 je čistý upload); extrakcia snímok z 360
videa; BIM compare (realita vs model); multi-tenancy/project scoping + auth (prerekvizita mimo
modulu — `project` entita D-033/D-064); tiling super-panorám.

**Závislosti:** D-018 (objects model), D-051 (manifest hrán), D-072 (`_georef`/world-transform,
guarded write), D-044/D-067 (GUID bridge, AIM karta), D-071 (fork), E3 (documents/Storage vzor).

---

### D-074 — Zoskupenie prvkov v strome podľa IFC triedy
**Status:** rozhodnuté (2026-07-16).

**Kontext:** priestorový strom (S1, D-018/D-021) vysypal pod podlažie všetkých potomkov naplocho
v jednom zozname — na 3NP je to 210 riadkov, kde sa priestory miešajú s dverami, oknami,
koncovými elementmi VZT atď. Z názvu ani ikony nie je vidieť, čo je `IfcSpace` a čo prvok;
orientácia v podlaží znamenala scrollovať celý zoznam.

**Rozhodnutie:** medzi uzol a jeho potomkov sa vkladá **rozbaľovacia skupina podľa `ifc_type`**
(`IfcSpace`, `IfcWall`, …) s počtom členov.
- Zoskupuje sa **len tam, kde sú medzi deťmi assety** a tried je aspoň 2 — čisto štruktúrne
  úrovne (site→building→floor) ostávajú ploché.
- Poradie: priestorová štruktúra (`IfcSpace`) prvá, potom triedy abecedne (`sk` collation).
- Skupina **nie je objekt v AIM** — nemá `/node/` odkaz, len rozbaľuje; open-stav drží pod
  syntetickým id `${parentId}::${ifcType}`, takže funguje aj „Rozbaliť/Zbaliť všetko".
- Štítok = surová IFC trieda; slovník ľudských názvov zámerne nezavádzame (nemáme ho a bol by
  ďalší zdroj pravdy navyše).

**Dôvod:** `ifc_type` už je v `objects` aj v `SpatialNode` — zoskupenie je čistá prezentačná
vrstva v `components/spatial-tree.tsx`, bez zásahu do data vrstvy, DB a bez ďalších dotazov.

**Dôsledok:** prvok je o jeden klik hlbšie (skupiny sú default zbalené). `TYPE_ORDER` je
v klientskom komponente zduplikovaný oproti `SPATIAL_TYPES` — `lib/data/spatial.ts` je
`server-only` modul, import hodnoty by zhodil klientský build.

### D-075 — Projektová dokumentácia v jednom rozhraní (2D/3D prepínač, dokumenty v kartách)
**Status:** rozhodnuté (2026-07-16) — koncept odsúhlasený, **M1–M3 implementované na vetve**
`claude/pdf-rendering-document-view-v6nivv` (oba repá; stav → ROADMAP F9). Stavia na D-072
(kalibrácia + split view, F7).

**Kontext:** Cieľ je Dalux-like zážitok — celá projektová dokumentácia (PDF výkresy,
textové PDF, fotky/skeny) prehliadateľná priamo v ifc-lite viewri, aby 2D výkresy a 3D
model pôsobili ako jedno rozhranie. D-072 už dodal kalibráciu, PDF rovinu v 3D, Drawing
view a jednoduchý split so zelenou značkou; chýba (1) prvotriedny **prepínač 2D / 3D /
Split** (dnes zakopaný v `DrawingUnderlayPanel`), (2) prehliadanie **ne-kalibrovaných
dokumentov** vo viewri a (3) **karty / viac okien** pre dokumenty.

*Analýza CDE prístupov:* **Dalux** (primárny vzor): „Locations" = budova → podlažie →
výkresy (2-bodové mapovanie = D-072); režimy 2D / 3D / Split (split = 2D naviguje 3D,
zelený kruh + smerový klin, kamera zamknutá na podlažie); dokumentový modul s **file
tabs**, karty možno otvoriť v novom okne prehliadača, hyperlinky sa otvárajú ako nové
karty, väzby objekt↔dokument z modelu. **Revizto:** jednotné 2D/3D prostredie, overlay
sheetov v 3D, „related sheets" podľa polohy kamery, issues v 2D aj 3D. **ACC:** Sheets
& Views, „Align 2D drawing", porovnanie verzií 2D/3D. **Procore:** revízie, OCR
auto-split sád, markup vrstvy. Spoločné vzory: výkresy per podlažie kalibrované na model
(✅ D-072), explicitný top-level prepínač režimu, sync polohy 2D↔3D (✅ D-072), dokumenty
v kartách s pop-out, prepojenia objekt↔dokument (✅ `rel_associates_document`,
`_drawing_links`).

**Návrh (validovaný proti kódu oboch repov):**
1. **Architektúra = línia D-071/D-072:** feature žije **genericky v ifc-lite**
   (upstreamovateľná, standalone s lokálnymi súbormi cez drag&drop, `local:` id vzor),
   AIMviewer dodá dáta cez bridge adapter. Formáty v1: PDF + obrázky; Office/DWG neskôr.
2. **Prepínač 3D | 2D | Split** — segmented control v `MainToolbar` (jednoriadková
   inzercia, logika v novom `ViewModeSwitcher.tsx`) + storey dropdown pri režime ≠ 3D.
   Žiadny nový slice: režim je *derivovaný* z existujúcich flagov (`underlaySplitView`,
   `underlayViewLocked`); do `drawingUnderlaySlice` pribudne len `underlayPlanFull`
   (2D na celú plochu — `viewport-3d-panel` sa kolabuje na 0 cez ref, WebGPU canvas sa
   neremountuje, zrkadlový trik k `drawing-plan-panel`) a `underlayLastStoreyGuid`.
   Nový hook `useViewMode.ts` orchestruje existujúce `enterSplitView`/`enterDrawingView`/
   `exit*` (`useFloorplanView.ts`); fallback bez kalibrovaného výkresu = locked ortho
   top-down model (Dalux správanie). 2D plocha = zovšeobecnený `DrawingPlanPane`
   (+ výber výkresu pri >1 na podlažie). Vektorová 2D (`packages/drawing-2d`) mimo scope
   — neskôr ako alternatívny zdroj do tej istej plochy. Režim je session-only (iframe
   `src` vlastní host; deep-linky len postMessage).
3. **Documents panel + karty dokumentov** — karty v **resizable center pane**: tretí
   Panel `document-pane-panel` vo vnútornom PanelGroup (vedľa `drawing-plan-panel`
   a `viewport-3d-panel`); split dokument↔3D aj dokument↔2D vypadne z resize handles
   zadarmo. (Zamietnuté: plávajúce okná ako primár — 360×460 default je na A1 malé;
   top-level tab bar nad viewportom — prestavba shellu.) Nový
   `store/slices/documentsSlice.ts` (`viewerDocuments: Map`, `docTabs` s per-tab
   page/zoom/scroll, `openDocument` dedupe→focus, `documentEventHandler` vzor
   `underlaySaveHandler`); panel `'documents'` append do `lib/panels/registry.ts`
   (zadarmo sidebar dock, floating, OS-window pop-out; `documentsPanelVisible` pristúpi
   k exclusivity subscription v `store/index.ts`). Komponenty: `DocumentsPanel.tsx`
   (strom podľa `folder`, filter, drag&drop, „Show in 2D/Split" pri výkresoch),
   `DocumentPane.tsx` (Radix Tabs strip), `PdfDocumentView.tsx` (virtualizovaný zoznam
   strán nad existujúcim `rasterizePdfPage`, raster len viditeľné ±1, LRU ≤ 4, strop
   ~2400 px), `ImageDocumentView.tsx`. Mobil: doc tab = full-screen overlay (vzor
   mobilného split view). Doc↔doc split a per-tab pop-out do OS okna (kľúč
   `panel-windows.ts` zovšeobecniť na `doc:${tabId}`) = neskorší míľnik.
4. **Bridge / dáta:** `DOCUMENTS_LOAD` ako **súrodenec** `UNDERLAYS_LOAD` (nie superset
   — georef kontrakt sa nekazí; kalibrované výkresy prídu v oboch, prepoja sa cez
   `documentId`/`storeyGuid`), `DOCUMENT_OPEN` (host→viewer deep link po
   `MODELS_LOADED`), `DOCUMENT_EVENT` (viewer→host opened/closed). Wire typ
   `DocumentDescriptorWire` (`kind: 'drawing'|'document'|'image'`, `storeyGuid?`,
   `folder?`, `meta?`) v `aim/bridge-protocol.ts`. AIMviewer: nové `lib/data/documents.ts`
   — `fetchProjectDocuments()` z `objects`/`documents`, `folder` z
   `rel_associates_document` hrán, kind podľa role/mime; push v `components/ifc-viewer.tsx`;
   voliteľný `?doc=` param. **`/drawing/[id]` ostáva natrvalo** — `_drawing_links` (SNIM
   regióny) sú AIM-doménové UI (D-071 drží generické jadro čisté), route beží bez bootu
   WebGPU viewera (rýchla, shareable, cieľ full-text výsledkov D-063). In-viewer
   workspace = flow „dokumenty v kontexte modelu"; `/drawing/[id]` = „dokument ako cieľ".
5. **Fázovanie (každý míľnik shippable):** **M1** View modes (len ifc-lite) →
   **M2** Documents workspace s lokálnymi súbormi (len ifc-lite) → **M3** host integrácia
   (bridge + `fetchProjectDocuments` + AimCard doc linky in-viewer; oba repá) = v1 →
   **M4** power features (doc↔doc split, per-tab OS pop-out, raster tuning, voliteľný
   `VIEW_SET` deep link).

**Vedomé limity / riziká:** pamäť iframe = riziko #1 (IFC geometria + underlay textúry +
doc taby v jednom procese; plan pane rastruje až 8192 px ≈ ~190 MB RGBA transient) —
mitigácie sú súčasť návrhu (strop ≤ 2400 px, okno ±1 strany, LRU ≤ 4, neaktívne taby
zahodia rastre, `ImageBitmap.close()` ihneď); fork friction — M1/M2 je generický kód
v upstream súboroch → jednoriadkové inzercie + logika v nových súboroch + registry len
append (Alt mapping frozen), kandidát na upstream PR do LTplus-AG; mobil bez center pane,
pop-out len desktop (PiP API); PostgREST 1000-row cap pri raste počtu dokumentov.

**Dodatok — ostrý zoom PDF čítačky (2026-07-17):** pôvodný raster strop ≤2400 px robil
hlboký zoom rozmazaným (CSS upscaling) a portrait strany sa pod-rastrovali (target sa
viazal na najdlhšiu hranu namiesto šírky). Po oprave raster sleduje zoom až po 4096 px,
portrait target sa koriguje pomerom strán a LRU canvasov je riadená pixel budgetom
(~32 MP + count cap) namiesto fixného počtu — pamäťová mitigácia ostáva.

**Dodatok — vektorový zoom (2026-07-17):** nad base raster pribudol **sharp-crop overlay**:
keď layout prerastie strop base rastra, viditeľný výrez strany sa re-renderuje z PDF
vektorov v presnej device mierke (`rasterizePdfRegion`, viewport offsety pdf.js) a
prekryje base canvas — zoom je ostrý na ľubovoľnej úrovni ako v natívnom PDF prehliadači
(ZOOM_MAX 16). Crop = viewport + 50 % margin, cap 4096/hranu, prepočet po ustálení
scroll/zoom gesta, zahodenie pri opustení render okna. Overené Playwright testom
(overlay density 1.0 pri ~9× aj ~14×, odstránenie pri oddialení).

**Dodatok — auto-prepínanie režimu pri dokumentoch (2026-07-17):** klik na **kalibrovaný
výkres** v Documents paneli otvára rovno Split view jeho podlažia (Dalux správanie;
plochá PDF karta ostáva ako sekundárna ikona v riadku); nekalibrované výkresy, texty a
obrázky otvárajú kartu. Otvorenie/fokus karty už nikdy neprebehne neviditeľne: v 2D
režime sa automaticky klesne do Split (doc pane sa vráti vedľa plánu) a na mobile sa
split overlay zavrie, aby sa karta ukázala (na telefóne jedna plocha naraz).

**Dodatok — mobile pinch-zoom (2026-07-17):** dvojprstový pinch na mobile predtým padal
do browser page-zoomu (rozmazané natiahnutie bitmapy — nahlásené zo živého nasadenia
na iPhone). PDF čítačka aj image viewer teraz pinch zachytávajú samy (pointer events +
`touch-action: pan-x pan-y`, iOS `gesturestart` preventDefault) a ženú ním vlastný ostrý
zoom s kotvou na midpoint prstov; double-tap prepína fit ↔ 3×; zoom tlačidlá a Ctrl+wheel
kotvia na stred/kurzor. Overené CDP touch testom (pinch 8.3× rozostup → 833 % zoom,
canvas re-raster 363→2173 px, double-tap 100 %↔300 %).

**Dodatok — textová vrstva (2026-07-17):** PDF čítačka dostala selekčnú textovú vrstvu
(pdf.js `TextLayer` cez `renderPdfTextLayer`, scoped CSS `.pdf-doc-text-layer`):
označovanie a kopírovanie textu ponad canvas ako v natívnom prehliadači. Spany sú
v percentách strany a fonty cez `--total-scale-factor`, takže zoom je len CSS update
bez re-renderu; vrstva sa renderuje len pre stránky v render okne a pri opustení sa
zahodí. Overené Playwright testom (dvojklik/drag selekcia, zarovnanie po zoome).

**Dodatok — odchýlky implementácie M1–M3 od návrhu (2026-07-16):** `document-pane-panel`
je NAPRAVO od `viewport-3d-panel` (nie vedľa plan pane) — resize handle tak nikdy nesusedí
s kolabovaným prázdnym panelom a pôvodný split handle ostáva nedotknutý; karty sú kľúčované
`docId` (dokument = max 1 karta, dedupe→focus), nie `tabId`; tab strip je vlastný flex row
(Radix Tabs by pre close buttons pridával ceremóniu); `DOCUMENT_EVENT` sa pre `local:` súbory
hostovi neposiela (nemá ich ako resolvnúť); LRU canvasov nikdy nevyprázdni canvas pripojený
v DOM. Host `DOCUMENT_EVENT` zatiaľ len prijíma (no-op) — recents/analytics je kandidát.

**Závislosti:** D-072 (kalibrácia/split/`_georef`), D-071 (fork vrstvenie), D-044/D-067
(bridge/AIM karta), D-042/D-054 (`/drawing/[id]` + `_drawing_links`), D-063 (full-text
deep-linky), E3/D-032/D-036 (documents + Storage).

**Dodatok — záložka „Documents" v ribbone (2026-08-02, D-072/D-075/D-071):** upstream
sync priniesol tabbed **ribbon** ako default toolbar (ich #1880: File · Home · View ·
Elements · Analyze · Author). Náš toolbar zásah (`ViewModeSwitcher`, toggle Drawing
Underlays) žije v *klasickom* stripe, takže v defaultnom UI ostali naše funkcie
dosiahnuteľné len cez ikonovú lištu vpravo — v ribbone neboli nikde. Doplnená
**fork-only záložka `Documents`** (posledná v strip poradí, aby upstream pridával
tabs nad nás): skupina **Library** = Documents (D-075) + Underlays (D-072), skupina
**View mode** = 3D | 2D | Split + výber podlažia (D-075). *Iba presun vstupných
bodov, nula zmien správania:* tlačidlá volajú tie isté store akcie ako rail aj
klasický toolbar, ktorý si všetko ponecháva (obidva štýly majú naďalej rovnakú
sadu príkazov). Telo záložky je v izolovanej vrstve `apps/viewer/src/aim/
DocumentsRibbonTab.tsx` (upstream taký súbor nemá → nulový konflikt), zapojenie do
ribbonu = 3 riadky v `AIM-FORK` sentineloch; zoznam režimov, storey picker a gate
(kalibrácia/žiadne podlažia) sú teraz zdieľané jedinou definíciou, aby sa klasický
a ribbon prepínač nerozišli. Tabuľka touchpointov v `docs/FORK_MAINTENANCE.md`
regenerovaná zo sentinelov (chýbalo v nej 5 súborov — dlh zaznamenaný v D-071
dodatku 2026-07-27). AIMviewer bez zmien kódu.

**Dodatok — ribbon je toolbar aj na mobile (2026-08-02, D-075/D-071):** predošlý
dodatok dal našim funkciám miesto v ribbone, ale **na telefóne ribbon vôbec
nerenderuje** — upstream `ViewerLayout` posiela každú malú obrazovku (`isMobile`
= šírka < 768, alebo touch < 1024) do `MobileToolbar`, takže `isMobile` prebíjal
voľbu štýlu. Overené naživo (Playwright, profily iPhone 14 / Pixel 7 / iPad Mini
proti dev serveru forku): na 390 aj 412 px sa vykreslila 44px lišta ikon, záložka
`Documents` nikde a Documents/Underlays len v „…" menu; ribbon nabehol až od
1024 px (iPad landscape). Toolbar bol teda jediná časť viewera, ktorá sa medzi
mobilom a stolom líšila — a AIM appka viewer na telefóne vkladá cez iframe, takže
to bije práve tam.

**Rozhodnutie:** o toolbare rozhoduje **zvolený štýl, nie veľkosť obrazovky**.
`ribbon` (default) obsluhuje všetky šírky, `classic` si na malých necháva
`MobileToolbar` — čiže „Keep the classic bar" v `RibbonSwitchNotice` ostáva plnou
cestou späť a `MobileToolbar` neostáva mŕtvym kódom. Ribbon je na malých
obrazovkách nastavený pre palec: pás 44 px s 36px cieľmi, **vodorovne
scrollovateľný** pás záložiek (sedem sa na telefón nezmestí; predtým sa
stláčali a vytláčali klaster téma/help/collapse mimo obrazovku), progres bez
textu fázy, menší prepínač témy (48 px) a aktívna záložka sa sama doscrolluje do
záberu (kontextové záložky ju vedia prepnúť mimo výrezu). **Band ostáva 88 px** —
nižší by orezal dvojriadkové popisky — a šetrí sa inak: bez uloženej voľby ribbon
na malej obrazovke **štartuje zbalený**, takže stojí 44 px (menej než pôvodná
mobilná lišta). Ťuknutie na záložku band otvorí, ale na mobile **len dočasne**
(zápis do store, nie do storage) — jedno ťuknutie po príkaz nesmie stáť 88 px v
každej ďalšej session; „nechaj otvorené" povie chevron, ktorý voľbu uloží.
Rovnaké delenie medzi ukázaním a pripnutím bandu robí aj Office; na desktope
ostáva pôvodné správanie (ťuknutie pripína).

*Implementácia:* prepínač v `ViewerLayout` v `AIM-FORK` sentineloch (naše
produktové rozhodnutie, upstream má iné); responzívnosť samotného ribbonu +
`lib/viewport.ts` (jediná definícia „malej obrazovky", predtým duplikovaný
breakpoint v `ViewerLayout`) + `size` prop `ThemeSwitch` sú **generické** a
vedené ako kandidát na upstream PR — ribbon sa rozpadal pri každej úzkej šírke,
nielen u nás. Testy: `lib/viewport.test.ts` (pravdivostná tabuľka breakpointov) a
`resolveInitialRibbonCollapsed` v `uiSlice.toolbar-style.test.ts`. AIMviewer bez
zmien kódu (viewer je iframe).

### D-076 — Identifikátorové hyperlinky v 2D IFC-lite prehliadači
**Status:** rozhodnuté + implementované (2026-07-17), vetva
`claude/ifc-identifier-hyperlinks-jzd5p5` (fork ifc-lite; AIMviewer len docs).

**Kontext:** PDF prehliadačka dokumentov (Assetin Archives, `/drawing/[id]`) už má
identifikátor → hyperlink → preview: kódy prvkov (SNIM `DD02.05.04`) detekuje ETL
(`etl/pdf_link.py`, PyMuPDF + regexy zo schémy), regióny persistuje do
`objects.properties._drawing_links` a klient (`RegionBox` → `onSelect` →
`ElementInfoPanel`) ich renderuje ako klikateľné hotspoty — rovnaká akcia ako klik na
prvok v 3D modeli. Rovnaké správanie chceme v 2D IFC-lite prehliadači (plan pane s PDF
underlay, D-072/D-075).

**Rozhodnutie:** feature žije **genericky vo forku ifc-lite** (línia D-071/D-075),
celá klient-side — žiadne ETL, žiadna DB:
1. **Konfigurovateľný zdroj identifikátora** (rôzni BIM koordinátori ukladajú kód
   inak): `Name` / `Description` / `ObjectType` / `Tag` / custom **Pset + property**
   (napr. `Pset_Custom.ElementCode`), s **fallback poradím** (prvý zdroj, ktorého
   hodnota po normalizácii matchuje vzor, vyhráva). Per-projekt persistencia
   (localStorage kľúčovaný názvom primárneho modelu); host push cez bridge je
   neskorší kandidát.
2. **Tvar kódu = konfigurovateľný regex** (default pokrýva `DD.01.02.003` aj
   `DD01.06.03`), aby sa nechytali náhodné zhody (kóty, mierky). Normalizácia:
   case-insensitive, trim, medzery/pomlčky/podčiarkovníky → bodky.
3. **Index `normalizovaný kód → GlobalId(y)`** sa buduje raz nad všetkými
   federovanými modelmi (chunkované s yieldom, signature-guard proti duplicitným
   buildom, cache v store, invalidácia pri zmene configu/modelov). Lacné stĺpcové
   zdroje čítajú columnar EntityTable; `Tag`/pset idú cez on-demand extraktory.
4. **Matchovanie nad výkresom:** pdf.js text items stránky (`getPdfPageTextItems`)
   → tokeny → regex → klikateľné boxy v page-point súradniciach
   (`IdentifierLinkLayer` v `DrawingPlanPane`). Klik volá **presne tie isté store
   akcie ako pick v scéne** (`setSelectedEntityId` + `setSelectedEntity` +
   `showWorkspacePanel('properties')`) — jeden zdroj pravdy, iný vstupný trigger.
5. **Duplicitné kódy:** preferencia prvkov na podlaží výkresu
   (`placement.storeyGuid`); zvyšná nejednoznačnosť = malý výber kandidátov.
   **Kód bez zhody v modeli** = bežný text; v debug móde čiarkovaný obrys.
6. **Settings UI** v paneli Documents (presun z drawing-underlays, 2026-07-17): zdroje s poradím, regex s live-test
   poľom, enable/debug prepínače, stav indexu.

**Vedomé limity:** sub-token bbox je proporčná aproximácia (bez glyph metrík); IFC
anotácie/generované 2D labely zatiaľ neskenované — matcher je čistá funkcia, dá sa
na ne neskôr nasadiť; proximity-join spája max. dvojice fragmentov (vzor bare+frag
z `pdf_link.py`), nie troj- a viacdielne kódy.

**Dodatok (2026-07-17):** na požiadavku doplnené: (1) zdroj identifikátora aj
**GlobalId (GUID)** atribút — popri Name/Description/ObjectType/Tag/Pset; (2)
**rotované texty** sa matchujú (box = axis-aligned obal skutočného glyph quadu,
vertikálne popisky sú klikateľné); (3) **proximity-join rozsekaných kódov** ako v
`pdf_link.py`: kód rozdelený do dvoch text runs v bubline (`DD01` nad `02.03`,
alebo vedľa seba) sa spojí v čítacom poradí (zhora nadol / zľava doprava) do
vzdialenosti `PROXIMITY_PT = 28 pt` a re-testuje voči vzoru; plné zhody sa nikdy
nespájajú, pri viacerých kandidátoch vyhráva najbližší fragment. GlobalId zdroj je
**case-sensitívny** (výnimka z normalizácie — IFC GUID rozlišuje veľkosť písmen,
`_`/`$` sú payload): index kľúčuje trimmed raw hodnotu a lookup skúša normalizovaný
aj exaktný kľúč.

**Dodatok (2026-07-17, live feedback):** linky fungujú aj v **PDF čítačke dokumentov**
(karty dokumentov, `PageIdentifierLinks` — skenuje sa len render okno virtualizácie),
nie len v kalibrovanom 2D/Split pláne; zhodné kódy majú **jemné bledozelené
podsvietenie s podčiarknutím** (zdieľaný `IdentifierLinkBoxes` pre obe plochy);
nastavenia sa otvárajú **ozubeným kolieskom v hlavičke Documents panelu**
(enable + mapovanie atribútu/property, regex live-test), nie sekciou pod zoznamom.
CAD-exportované PDF emitujú text po jednotlivých glyphoch — `mergeTextItems` ich pred
matchovaním skladá do riadkov/slov (smer baseline + kolmý offset; dotyk = spojenie,
medzera slova = space, väčšia medzera = nový run); PyMuPDF to v referenčnej
`pdf_link.py` robil implicitne. Rotované strany (`/Rotate 90`, bežné CAD sheets):
text transformy sa remapujú do zobrazeného viewport rámca (`mapTextTransformToViewport`,
pre nerotované strany identita) a čítacie poradie proximity-joinu sa vyhodnocuje
v lokálnom ráme textu — bez toho boxy padali mimo stránku. Nastavenia zobrazujú
diagnostiku posledného skenu (text items / codes / matched + hint pre každú nulu).
Overené live Playwright behom (11/11: textová vrstva + selekcia s overlay,
rotovaná strana, spájanie bublín). Ladenie na reálnom výkrese (spustenie skenu
nad skutočným PDF v Node): (a) `getTextContent` na niektorých PDF hádže —
sken číta `streamTextContent` (rovnaká cesta ako textová vrstva); (b) klastrovanie
riadkov bolo reťazové a na hustom výkrese zlievalo cudzie riadky do pásma
(bubliny skenovali ako `02.01DD01`) — teraz je ukotvené na prvý run riadku
a priame zlepenie glyphov vyžaduje kompatibilnú výšku písma; výsledok na
reálnom liste 63→101 kódov (25→61 joinov). Join preferuje kódy existujúce
v modeli (kóty nekradnú fragmenty), otvory (IfcOpeningElement) sa neindexujú,
mobilné bottom sheets sú nad fullscreen dokumentom (z-50) — klik na link
otvorí properties aj na telefóne. **Composite occurrence kľúče (overené na
reálnom ASR modeli):** autorský nástroj exportuje v Name len TYPOVÝ kód
(`Family.CC:DD01.02 - popis:id`) a inštančný diskriminátor drží v Revit `Mark`
parametri — occurrence kód z bubliny (`DD01.02.03`) sa SKLADÁ a nie je v žiadnom
jednom poli. Index registruje aj `<kód>.<Mark>` (validované anchored vzorom);
typový kľúč ostáva. Na reálnom modeli 50→176 kódov, 121/126 occurrence kódov
→ presne 1 prvok (priamy preview); zvyšných 5 sú skutočné duplicity v dátach
(dve families zdieľajú typový kód, každá čísluje Mark od 01).

**Dodatok — dvojúrovňová schéma + auto-analýza (2026-07-18):** konfigurácia má
explicitné dve úrovne: **typový kód** (vlastný regex + zdroje) a **occurrence
kód** (vlastný regex + režim `auto`/`direct`/`composed`; composed =
`<typový kód>.<diskriminátor>`, zdroje diskriminátora konfigurovateľné, prázdny
pset = hľadaj vo všetkých). Tlačidlo **Analyze model** navrhne celú konfiguráciu
z dát modelu (polia s kódmi, syntéza regexov z pozorovaných tvarov,
direct-vs-composed, probe Mark parametra) — beží aj automaticky pri prvom
kontakte s projektom (bez uloženého configu) a návrh sa persistuje; v1 configy
migrujú (starý pattern → occurrence pattern). Stránkový sken akceptuje oba tvary.

**Závislosti:** D-072 (plan pane + `storeyGuid`), D-075 (pdf.js infra), D-071 (fork),
D-044 (GUID bridge); referenčné správanie D-042/D-054 (`_drawing_links`).

### D-077 — AIM inspector: viewer-first konsolidácia info vrstvy
**Status:** rozhodnuté + implementované na vetve (2026-07-17).

**Kontext:** audit (`AUDIT-KONSOLIDACIA-2026-07-17.md`) potvrdil zvyškové duplicity po
D-067: na `/ifc` dva ľavé stromy elementov (host `spatial-tree.tsx` z DB + fork
`HierarchyPanel` z IFC súboru), dva vzory detailu prvku (AIM karta v 3D vs
`ElementInfoPanel` v 2D), psety z dvoch zdrojov bez prepojenia, dve vyhľadávania, mŕtvy
`filter-bar.tsx`. Rešerš CDE nástrojov (ACC, iTwin, Trimble, Dalux, Solibri, Speckle,
Bimplus) ukázala konvergentný vzor „link v paneli, záznam v module" — natívne IFC dáta
a DB dáta sa nikdy nemiešajú do jedného zoznamu.

**Rozhodnutie (viewer-first):** IFC-lite UI je jediná vstupná brána do AIM dát v 3D
kontexte; celá dátová logika ostáva v hoste.
1. **AIM inspector:** `AimPanelData` `version: 2` (aditívne typované sekcie
   `responsibilities`/`captures`/`history` popri v1 poliach) + tab lišta **AIM | IFC**
   v `PropertiesPanel` forku (`aim/AimInspectorTabs.tsx`; natívny obsah pod AIM tabom
   skrytý `display:contents` wrapperom — standalone režim bez zmeny). `/api/element/[id]`
   obohatený reuse-om `fetchNodeSections` + `fetchCaptureSummaryForObject` (NodeSummary
   polia aditívne zachované); drill-down `AIM_NAVIGATE` → `/node/[id]` bez zmeny.
2. **Jeden strom:** natívny `HierarchyPanel` dekorovaný per-GUID badges (dokumenty/
   zodpovednosti/snímky) — bridge `AIM_TREE_DECORATIONS` (Record<guid,{d,r,c}>, po
   `MODELS_LOADED` + reaktívne), fork `aimDecorationsStore`, rezolúcia riadok→GlobalId
   cez `guidForEntity`. Host: `lib/data/decorations.ts` (agregácia existujúcich `rel_*`
   views, **bez migrácie**; pure `buildDecorations` s testami). Host sidebar sa na
   `/ifc` nerenderuje (`components/sidebar-gate.tsx`); mimo `/ifc` ostáva.
3. **Jeden render detailu:** `components/aim-panel-view.tsx` (host render AimPanelData,
   Next `<Link>`); `ElementInfoPanel` v 2D mapuje cez `nodeSummaryToAimPanel` — obsah
   detailu sa mení už len v `lib/aim-panel.ts`, 2D aj 3D ho zobrazia zhodne.
4. `filter-bar.tsx` zmazaný (mŕtvy od D-066).

**Dôvod:** rieši dvojstrom štrukturálne (jeden strom, nie skrytý druhý), drží fork
disciplínu D-071 (do forku idú len dáta/dekorácie ako JSON, žiadna logika) a zodpovedá
overenému vzoru trhu. Hranica proti „viewer = celá appka": *IFC-lite renderuje len
generické schémy/dekorácie; dátová logika, plné záznamy a navigácia ostávajú v hoste.*

**Dôsledky:** `/ifc` je hlavný vchod do aplikácie (prehliadanie štruktúry vyžaduje
načítaný model); `/node`/`/type` = „záznam na preklik" (breadcrumb). Bitemporalita má
prvé UI využitie (sekcia História GUID, read-only). **Deploy order fork-first** (fork
toleruje v2 skôr, než ju host posiela; starý viewer neznáme správy ignoruje). Vedomé
odklady: vstupný bod pre ne-priestorové uzly (typy/osoby/systémy) vo viewri — zatiaľ
linky v inspectore; psety ostávajú z dvoch zdrojov (file vs DB) bez diffu; mŕtvy
`ifc-viewer-embed.tsx` je kandidát na upratanie.

**Dodatok — mobil (2026-07-17):** na mobile viewer renderuje ten istý
`PropertiesPanel`/`HierarchyPanel` v bottom sheetoch, ale tap na prvok sheet
neotváral (len malé plávajúce tlačidlo) — AIM inspector bol prakticky
neobjaviteľný. Fix vo forku (`aim/AimBridge.tsx`, selection effect): používateľská
selekcia v embede na mobile automaticky otvorí Properties bottom sheet (default
tab AIM); FOCUS z hosta sheet neotvára, standalone režim bez zmeny. Hostovský
AskDock zmenu nepotreboval — default je zbalený pill.

---

### D-078 — Detekcia nového deployu → ponuka obnovy ("staré UI po deployi")
**Status:** rozhodnuté (2026-07-24).

**Kontext:** po nasadení nového buildu používateľ v už otvorenom tabe stále videl staré UI.
Nešlo o HTTP cache — HTML má `no-store`, JS chunky sú content-hashované, WASM je jediná
dlho-cachovaná statika a nie je service worker. Príčina: otvorený tab ďalej beží starý
klientský bundle a sám o novom deployi nevie; „otvorenie" = prepnutie na už bežiaci tab
bez reálneho reloadu.

**Rozhodnutie:** klientský ostrov `<VersionWatcher>` (v root `app/layout.tsx`) sleduje SHA
živého deployu a pri jeho zmene ponúkne obnovu.
- Zdroj pravdy = `GET /api/version` (`force-dynamic` + `Cache-Control: no-store`), vracia
  `VERCEL_GIT_COMMIT_SHA` (fallback `VERCEL_DEPLOYMENT_ID`, inak `"dev"`).
- Klient si **zapamätá prvé videné SHA** a porovnáva ho každých 60 s + pri `visibilitychange`
  (návrat na tab). Bez závislosti na `NEXT_PUBLIC_*` — funguje aj pri vypnutých systémových
  env premenných; v dev je SHA vždy `"dev"` → nikdy nefalošne nevyskočí.
- **Toast, nie auto-reload:** obnova je na kliknutie (tlačidlo „Obnoviť"), aby to nevyhodilo
  používateľa uprostred rozrobenej selekcie/práce; toast sa dá aj zavrieť.

**Dôvod:** HTTP vrstva bola už správna (revalidácia), chýbal len signál smerom ku klientovi.
Porovnanie prvého-videného SHA (namiesto zapečeného build-SHA) je bulletproof voči tomu,
či Vercel `NEXT_PUBLIC_*` premenné exponuje.

**Dôsledok:** medzi deployom a zbadaním novej verzie je latencia ≤60 s (alebo hneď po
prepnutí na tab). Endpoint je zámerne dynamický (necachovaný) — zanedbateľný payload
(`{"sha":...}`), volaný raz za minútu na klienta.

---

### D-079 — Claude cez MCP konektor + živý príkazový kanál do viewera (Realtime)
**Status:** rozhodnuté (2026-10-16), pre demo Bencont.

**Kontext:** demo má ukázať, že kvalitný IFC model (správne triedy, vzťahy, federácia ARCH+VZT)
dáva AI okamžité a overiteľné odpovede. Vstavaný `/ask` (D-056) beží na Gemini free tieri;
lepší model cez API = ďalší náklad. Autor má predplatné Claude (Max), v ktorom vie Claude
používať vlastné nástroje cez **custom connector (MCP)** bez platenia za tokeny. Cena: chat
beží v Claude **vedľa** viewera, nie v ňom — a Claude o otvorenom vieweri nevie nič.

**Rozhodnutie:**
1. **MCP server v AIMvieweri** — `POST /api/mcp/<MCP_TOKEN>` (Streamable HTTP, JSON odpovede,
   bezstavový). Vystavuje **tie isté tools** ako `/ask` (`TOOL_DEFINITIONS` + `AskToolRuntime`,
   jeden zdroj pravdy) a ten istý doménový prompt ako MCP `instructions`
   (`lib/llm/system-prompt.ts`). Žiadna závislosť: JSON-RPC vrstva je ~150 riadkov
   (`lib/mcp/server.ts`), lebo potrebujeme len `initialize` / `tools/list` / `tools/call` /
   `ping`; oficiálne SDK by priviedlo express+hono kvôli trom metódam. Bez `MCP_TOKEN` je
   endpoint vypnutý (404) — vzor env brán D-068/D-072. Token v ceste = autentifikácia
   konektora (claude.ai podporuje konektor bez OAuth); dáta sú aj tak verejné read-only.
2. **Živý príkazový kanál** — UI akcie (`show_in_3d`, `style_in_3d`, `open_node`,
   `open_drawing`) sa z MCP nevrátia klientovi (žiadny nie je), ale **odvysielajú** cez
   Supabase Realtime Broadcast (REST z servera, `service_role`) na kanál `LIVE_CHANNEL`.
   Viewer otvorený s `?live=<kanál>` (pamätá si ho v `sessionStorage`) je prihlásený na
   kanál a príkaz vykoná **tou istou cestou ako AI dock**: `router.push(url)` na whitelist URL
   postavenú serverom. Dávka príkazov do 350 ms sa zlúči rovnako ako `finalActions()`
   (`lib/llm/actions.ts`, zdieľané server aj klient), aby rýchle po sebe idúce `style_in_3d`
   nezhodili jeden druhého.
3. **Anon kľúč v prehliadači — až po odobratí práv (mení D-026).** Realtime klient potrebuje
   anon (publishable) kľúč. S vypnutým RLS (D-025) by anon kľúč dal komukoľvek čítanie aj
   zápis celej DB cez PostgREST, preto migrácia `20261016120000_revoke_anon_grants.sql`
   odoberie rolám `anon` a `authenticated` všetky práva v schéme `public` (tabuľky,
   sekvencie, funkcie + default privileges). Appka číta výhradne cez `service_role` (D-026),
   takže sa nič nerozbije; anon kľúču ostane len Realtime broadcast na verejné kanály a
   čítanie verejných bucketov (tie sú verejné už dnes). **Poradie nasadenia je povinné:
   najprv migrácia, až potom `NEXT_PUBLIC_SUPABASE_ANON_KEY` na Verceli.**

**Zavrhnuté:** polling tabuľky príkazov (latencia ~1 s, ďalšia tabuľka, funkcia na každý tik);
SSE z Next routy (serverless inštancie nezdieľajú stav); Claude cez API v `/ask` (funguje
už dnes cez `LLM_PROVIDER=anthropic`, ale platí sa za tokeny — ostáva ako záloha);
privátne Realtime kanály s RLS na `realtime.messages` (vyžadujú auth, ktoré nemáme).

**Vedomé limity:** kanál je verejný broadcast — kto pozná názov kanála a anon kľúč, môže
viewerom pohnúť (len pohľad, žiadne dáta). Názov kanála preto nie je triviálny a mení sa
per demo. MCP nevie, či niekto počúva — tool vráti „odoslané do živého viewera", nie
„zobrazené". Rate limit na MCP neriešime (bez LLM nákladov na našej strane).

**Dôsledok:** env `MCP_TOKEN`, `LIVE_CHANNEL` (server), `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (klient). `/ask` ostáva nezmenený (prompt presunutý do
modulu bez zmeny textu). Návod na pripojenie konektora v README.

---

### D-080 — Odvodzovače nad federáciou; prvok → priestor ako `rel_referenced_in_spatial_structure`
**Status:** rozhodnuté (2026-10-16). **Spresňuje D-052** (typ hrany a rámec).

**Kontext:** demo potrebuje odpoveď „ktoré VZT prvky sú v miestnosti X". VZT.ifc nemá
žiadne IfcSpace a všetkých 1021 prvkov je natívne zaradených len na podlaží; miestnosti
sú v ASR.ifc. Vzťah naprieč súbormi v IFC žiť nemôže (D-052), musí byť v našej DB.
D-052 navrhoval hranu `rel_contained_in_spatial_structure` so `source='geom'`. Kontrola
proti schéme IFC4X3_ADD2: `IfcElement.ContainedInStructure` je **SET[0:1]** — prvok smie
byť obsiahnutý len v jednej štruktúre a natívne už je (podlažie); manifest to drží ako
unique-active-parent. Druhá contained hrana by porušila IFC aj našu integritu.

**Rozhodnutie:**
1. **Typ hrany = `rel_referenced_in_spatial_structure`** (IfcRelReferencedInSpatialStructure,
   `IfcElement.ReferencedInStructures` SET[0:?]) — IFC presne na to má neexkluzívny vzťah
   „prvok sa nachádza aj v ďalšej priestorovej štruktúre". Je IFC-kanonický (namespace
   `rel`, export `ifcrel`), nie `aim_`. Natívny containment (podlažie) ostáva nedotknutý.
   `role` = `inside` (≥ 50 % vzorky bodov prvku v priestore) | `partial` (≥ 10 %, napr.
   potrubie prechádza miestnosťou).
2. **Rámec odvodzovačov** `etl/derive/` (`python -m etl.derive <rule> --models …`):
   post-processing nad naloadenými modelmi, nie súčasť `etl.main`. Odvodzovač dostane
   modely federácie a vráti hrany s IFC GUID na oboch koncoch; zápis je spoločný
   (`etl/derive/db.py`): deterministické id, `source='derive:<rule>'`, hrany, ktoré nový
   beh neodvodí, sa **uzavrú** (`valid_until`), nemažú. Ďalšie odvodzovače (systém
   obsluhuje miestnosti, zóny…) = nový modul v registri, žiadna zmena zápisu.
3. **Geometria `spatial_reference` = ifcopenshell, nie vlastný kód.** BVH strom nad
   presnými BRep telesami (`ifcopenshell.geom.tree`, OpenCascade; iterátor s
   `iterator-output=NATIVE` len pre vybrané triedy): `inside` = prvok celý v tele
   priestoru (`select(space, completely_within=True)`), `partial` = prvok telo pretína
   (`select(space)`). Rozhoduje telo IfcSpace tak, ako ho nesie model — žiadna heuristika
   (prvý návrh predlžoval miestnosť do podhľadu po podlažie nad ňou; zahodené: ak VZT
   v podhľade nepadne do miestnosti, je to chyba tela priestoru v modeli a patrí do
   požiadaviek/IDS, nie do kódu). ifcopenshell nemá hotový „priraď prvky do miestností"
   (žiadny ifcpatch recept, `util.element` len číta existujúce väzby), má však presne
   tieto stavebné kamene. Default prvky `IfcDistributionElement` + `IfcFurnishingElement`
   (steny/dosky/dvere sú hraničné prvky — tie patria do `IfcRelSpaceBoundary`, nie sem),
   priestory `IfcSpace` + `IfcSpatialZone` (IfcSpatialElement s geometriou).
4. **Zarovnanie federácie cez IfcMapConversion** (ako viewer, D-050 dodatok): ASR a VZT
   majú rôzne Eastings/Northings (lokálny posun VZT → ASR = 30,26 m / −7,77 m), posun sa
   odovzdá ifcopenshell ako `model-offset`. Bez zarovnania by sa prvky VZT minuli
   miestností o desiatky metrov. Rôzna rotácia = chyba.
5. **IfcZone sa geometriou nerieši:** IfcZone je IfcSystem (skupina priestorov cez
   IfcRelAssignsToGroup), nemá telo. „Prvky v zóne" = prvky v jej priestoroch, teda
   tranzitívny dopyt, nie uložená hrana. Zóna s vlastnou geometriou patrí do
   IfcSpatialZone a tú odvodzovač berie.
6. **Pohľad `v_space_elements`** = natívny containment do priestoru ∪ odvodené referencie
   (`relation` contained|referenced) — jeden dopyt pre LLM aj viewer.

**Export:** zdrojové IFC sa neprepisujú, export pôvodných súborov sa nemení. Pri exporte
zlúčeného modelu sa hrana serializuje ako IfcRelReferencedInSpatialStructure — s natívnym
containmentom nekoliduje, lebo IFC na to rátá. Pri exporte po súboroch je cross-file hrana
mimo oboch súborov → ICDD linkset (D-015), ako pri ostatných vrstvách naprieč modelmi.

**Zavrhnuté:** `rel_contained_in_spatial_structure` (exkluzívne, D-052 pôvodne);
vlastná geometria v numpy s predĺžením miestnosti do podhľadu (prvý návrh v ten istý
deň — duplikovala ifcopenshell a skrývala chyby modelu);
`IfcRelInterferesElements` (IFC4.3 ho povoľuje aj pre IfcSpatialElement, ale opisuje
geometrický stret, nie zaradenie — vhodný na budúcu clash vrstvu); presun prvku zo
storey do space v DB (prepisuje zdroj, koliduje s re-importom na unique-active-parent,
heuristika by sa tvárila ako fakt) — presun patrí do zdrojového modelu (požiadavka
autorovi, overenie IDS) alebo do pravidla exportu zlúčeného modelu (jediná `inside`
referencia nehraničného prvku → IfcRelContainedInSpatialStructure do IfcSpace).

**Nález pri prvom behu (pôvodné ASR + VZT, 22 s):** 321 z 1112 prvkov v priestore (292
inside, 84 partial), **131 zo 139 vyústení mimo tela akejkoľvek miestnosti** — telá
IfcSpace nedosahujú k VZT. QA výstup odvodzovača: ASR.ifc má miestnosti 2. a 3. NP
**zdvojené** (rovnaké číslo, výška tela 8,0 a 8,8 m), Revit Areas („Zóna 1 – Retail +
Lobby", „Nájomný priestor") exportované ako IfcSpace (patria do IfcZone/IfcSpatialZone),
1. NP má len dve skutočné miestnosti a 5. NP žiadnu. Odvodzovač to hlási ako prekrývajúce
sa priestory; náprava patrí do modelu, nie do kódu.

**Dodatok 2026-10-19 (#92): steny IfcFacetedBrep sa preorientujú.** Nález "131 zo 139
vyústení mimo tela miestnosti" vyššie nebol stav modelu, ale chyba odvodzovača. Väzbu
nedostal **žiadny** prvok s telom `IfcFacetedBrep` (568 z 568 v aktuálnych ASR + VZT z bucketu 19. 10.:
výustky a tvarovky cez `IfcMappedItem` typu, potrubia s telom Brep aj odvodňovače ASR),
zatiaľ čo `IfcExtrudedAreaSolid` a `IfcSurfaceCurveSweptAreaSolid` prechádzali. Revit
exportuje tieto telá s nejednotne orientovanými stenami a presný test BVH stromu voči telu
priestoru ich minie. Hypotéza z issue (mapovaná geometria, chýbajúca trieda) neplatí:
`IfcAirTerminal` je `IfcDistributionElement` a tvar mapovaného prvku je v strome na správnom
mieste. Oprava: iterátor má `reorient-shells`. Výsledok nad ASR + VZT: 1061 z 1092 prvkov
v priestore (predtým 513), 948 inside a 188 partial, bez prekrývajúcich sa priestorov a bez
duplicitných hrán. Ostáva 31 prvkov mimo priestorov (20 odvodňovačov OV04 na 4.-5. NP, 11
VZT), to je obsah modelu. Čas výpočtu narástol asi trikrát (lokálne 58 s -> 189 s). Hrany sa
prepočítajú pri ďalšom behu `python -m etl.derive run` (zápis je idempotentný, D-080 bod 3).
Duplicitné hrany pri VV.07.01.002 z issue sa nad aktuálnou DB nereprodukujú (tri rôzne
ciele: 2.12, N2.03, PZ13); odvodzovač duplicity nevydáva a id hrany je deterministické.

---

### D-081 — Kontrola modelu voči IDS z knižnice požiadaviek (`etl.ids_check`)
**Status:** rozhodnuté (2026-10-17), demo Bencont. **Realizuje IDS časť D-052 a E6.**

**Kontext:** posolstvo dema je „správne zadanie → overený model → AI, ktorej môžeš veriť".
Požiadavky žijú v knižnici `AssetinSpace/assetin-library` (MD poznámky, jediný zdroj pravdy);
jej prototyp generátora (`tests/fixtures/ids/dry_run_er0101_arch.py`) z nich skladá IDS 1.0
pre výmenu ER-0101 × ARCH (8 špecifikácií: miestnosť, podlažie, zóna, STD-CL-01…06), ktorý
prechádza `ids.xsd`. AIMviewer doteraz žiadny výsledok kontroly nemal (E6 parkované).

**Rozhodnutie:**
1. **IDS sa do AIMviewera nekopíruje ani nepíše ručne** — ETL krok
   `python -m etl.ids_check --ids <cesta k .ids z knižnice> --model <ifc> --label ASR`
   ho číta zo súboru, ktorý vyrobila knižnica. Pôvod (cesta/commit, `ids:info` title/version,
   SHA-256 súboru) sa ukladá k behu. Požiadavka má jedného nositeľa — knižnicu.
2. **Validácia = ifctester** (oficiálna referenčná implementácia IfcOpenShell pre IDS, LGPL),
   nie vlastný kód (línia D-080).
3. **Výsledky ako dve tabuľky** `ids_runs` (beh: IDS, model, počty) a `ids_results`
   (špecifikácia × prvok: `pass`/`fail` + dôvody), prvok párovaný cez aktívny IFC GUID
   (`ifc_guid_history`). Špecifikácia, ktorá nemá žiadny vyhovujúci prvok, ale je povinná
   (`minOccurs ≥ 1`, napr. zóny), dostane riadok bez prvku. IFC na výsledok kontroly
   koncept nemá (BCF je formát nálezov, nie úložisko) → deklarovaná extenzia SCHEMA §5.
4. **Čítacia vrstva:** `v_ids_latest` (výsledky posledného behu každej dvojice IDS × model,
   s object_ref/menom prvku) a `v_ids_summary` (špecifikácia: počet prvkov, splnené,
   nesplnené, príklad dôvodu). LLM ich dotazuje cez `query_view`; nesplnené prvky ofarbí
   `style_in_3d` cez `ids_or_refs`.
5. **ETL podlažia akceptujú zápis knižnice** `2.NP` popri `2NP` (`_np_key`): IU-O-storey
   predpisuje `[0-9]{1,2}.(NP|PP)` a premenovanie modelu podľa štandardu nesmie rozbiť
   federáciu podlaží (D-049).

**Zavrhnuté:** ručne písané IDS v AIMvieweri (druhý nositeľ požiadaviek); kontrola v
prehliadači cez IDS modul IFClite (výsledok by nebol v DB, AI by ho nevidela); BCF ako
úložisko (je to výmenný formát, export BCF z `ids_results` je neskorší krok).

**Vedomé limity:** IDS 1.0 nevie overiť vzťah naprieč súbormi (VZT prvok v miestnosti ASR)
— to rieši odvodená vrstva D-080, nie IDS. Kým knižnica nemá F4 generátor, IDS pochádza
z jej prototypu (deterministický výstup, overený XSD).

### D-082 — Výber prvku v 3D ako klik: tool `select_in_3d` a op `select`
**Status:** rozhodnuté (2026-10-17), pripomienka z dema Bencont. **Rozširuje D-066 a D-079.**

**Kontext:** Claude cez konektor (D-079) vedel prvok v 3D len zvýrazniť a priblížiť
(`show_in_3d` → bridge `FOCUS`) alebo otvoriť jeho kartu mimo 3D (`open_node` → `/node/<id>`).
Stav „prvok vybraný kliknutím" (selekcia vo viewri + natívny panel vlastností s AIM kartou,
D-077) sa takto navodiť nedal, hoci práve ten používateľ pri prehliadke modelu chce vidieť.

**Rozhodnutie:**
1. **Nový tool `select_in_3d(id_or_ref)`** — jeden prvok s aktívnym IFC GUID. Popis toolu
   ho výslovne odlišuje od `show_in_3d` (zvýraznenie, aj veľa prvkov, bez panelu) a
   `open_node` (karta mimo 3D).
2. **Transport = existujúca viewer op v `ops` (D-066):** `select::<guid>`. Zlučovanie akcií
   (`mergeIfcActions`), živý kanál (D-079) aj záložný odkaz fungujú bez zmeny; výber sa
   aplikuje po `focus` a ostatných ops v poradí, v akom ich model vydal.
3. **Bridge správa `SELECT{guid}` (host → viewer).** Fork viewera ju vykoná tou istou cestou
   ako klik myšou: nastaví selekciu, zarámuje kameru na prvok a otvorí panel vlastností;
   následne pošle hostovi `ENTITY_SELECTED{guid}` ako pri kliku. AIM kartu teda dotiahne
   host existujúcim tokom (`/api/element/<id>` → `AIM_PANEL_DATA`) — žiadna druhá cesta
   k dátam karty.

**Zavrhnuté:** `FOCUS` + automatické otvorenie karty hostom (panel vlastností vo viewri by
ostal zavretý a selekcia by sa líšila od kliku); rozšírenie `show_in_3d` o príznak výberu
(miešal by množinové zvýraznenie s výberom jedného prvku a model by ho používal nejednoznačne).

**Druhá strana (fork `Menezeris/ifc-lite`, `apps/viewer/src/aim/AimBridge.tsx`):** `SELECT`
ide tou istou cestou ako klik vo viewporte (`selectPickedGlobalId`), odfarbí predošlý FOCUS,
otvorí panel vlastností (`openPanelInHome('properties')`) a priblíži kameru (`flyTo`); selekcia
sa zámerne neoznačí ako programová, takže `ENTITY_SELECTED` príde hostovi ako po kliku. Kým
nasadený fork `SELECT` nepozná, viewer ho ticho ignoruje (tool hlási úspech bez efektu) —
preto sa obe strany nasadzujú spolu.

### D-083 - Claude ovláda viewer cez MCP (F12): pohľad, rez, režim, potom spätný kanál a zápis
**Status:** návrh (2026-10-17), **čaká na schválenie Samuelom**; implementácia fázy 1 až po
schválení. **Rozširuje D-066, D-079, D-082; fáza 1 realizuje `VIEW_SET` z D-075 M4.**

**Kontext:** po F11 (D-079, D-082) vie Claude cez konektor čítať graf AIM a vo vieweri prvky
zvýrazniť, ofarbiť, skryť, izolovať a vybrať. Nevie však pohnúť **pohľadom**: rez, kamera,
režim 3D|2D|Split a podlažie, dokument v paneli vedľa 3D. Viewer (fork) to všetko už vie
(SDK `setSection`/`setCamera`, `cameraCallbacks.setPresetView`, `useViewMode`,
`DOCUMENT_OPEN`), chýba len cesta od MCP toolu po bridge správu. Druhá medzera je smer
**viewer -> Claude** (čo je vybrané, čo je vidno, snímka): kanál D-079 je jednosmerný,
tool hlási "odoslané", nie "zobrazené". Tretia je **zápis** (porucha, BCF komentár), ktorý
dnes nemá ani dátový model, ani autorizáciu.

**Katalóg use-casov (overené 2026-10-17 voči kódu oboch vetiev `claude/vigilant-cannon-cuizq0`
a živo cez konektor nad prod dátami).** Stav: ✅ funguje · 🟡 čiastočne · ❌ nie.

| # | Rola | Požiadavka | Dnes | Čo presne chýba | Odomkne |
|---|---|---|---|---|---|
| 1 | FM technik | Kde je VZT jednotka na 2. NP a čo obsluhuje | ✅ | nič; `locate_objects` (AIRCONDITIONINGUNIT) vráti JV.01.01.001 na 2NP, obsluhu cez `rel_assigns_to_group` + `v_space_elements`. Jednotka je na podlaží, nie v miestnosti (D-049), prompt to hovorí | - |
| 2 | FM technik | Požiarne klapky a ktoré sú po revízii | ❌ | **dáta, nie viewer**: v modeli nie je ani jeden `IfcDamper` (`get_model_stats`), dáta revízie tiež nie. Pôvodný odhad "čiastočne" neplatí | import / model |
| 3 | FM technik | Ukáž strop nad 2.05, kade idú potrubia | ❌ | rez a kamera. Po fáze 1: `set_section` (vodorovne, `floor=3NP`, `offset_m` pod stropnou doskou) + `style_in_3d hide IfcCovering` + `set_camera top` s cieľom 2.05. Pozor: 2.05 je v dátach dvakrát (`2.05`, `2.05-2`, zdvojené miestnosti, D-080) | fáza 1 |
| 4 | FM technik | Zapíš poruchu na tento ventil | ❌ | zápis (dátový model + autorizácia) **a** dáta: v modeli nie je `IfcValve` (ÚK/ZTI nenaimportované) | fáza 3 + import |
| 5 | Správca | Ofarbi miestnosti podľa plochy / nájomcu | 🟡 | plocha: 89 priestorov má `Qto_SpaceBaseQuantities.NetFloorArea`; Claude prečíta hodnoty (`query_view`, 89 < cap 100), sám roztriedi do pásiem a pošle `style_in_3d` s `ids_or_refs` po pásmach. Funguje pre malé množiny, pásma počíta model, nie DB. Nájomca: ❌, v dátach žiadna vlastnosť (`search_everything` "tenant najomca" = 0) | mimo poradia (číselný filter) + dáta |
| 6 | Správca | Ktoré miestnosti nespĺňajú požiadavky a prečo | ✅ | nič; `v_ids_summary` / `v_ids_latest` + colorize (D-081) | - |
| 7 | Správca | Ukáž fotky z 1.12 | 🟡 | priestor `1.12` v dátach nie je (object_ref 1.x: 1.17, 1.18, 1.28...). 3 capture body existujú, ukotvené **len na pláne** (`_capture.plan`, bez `world`), takže 3D piny sa nezobrazia. `open_node(priestor)` otvorí kartu s galériou, ale Claude nevie zistiť, ktorý priestor fotky má: `captures` ani `aim_rel_capture_located` nie sú vo whiteliste `query_view` | fáza 1b + dáta (`world`) |
| 8 | Koordinátor | Izoluj VZT a ASR na 3. NP | 🟡 | `style_in_3d` nemá filter podlažia; `model=VZT` izoluje celý súbor. `locate_objects` vracia na podlažie len vzorku, takže úplný zoznam ids sa nedá poskladať. Pôvodný odhad "funguje" neplatí | fáza 1 (voliteľne, Q2) |
| 9 | Koordinátor | Kde sa VZT križuje s nosnými prvkami | ❌ | upstream `@ifc-lite/clash` beží v prehliadači (`clashSlice`, `bim.clash.run`); chýba príkaz na spustenie a spätný kanál na výsledok | fáza 4 (po 2) |
| 10 | Koordinátor | Čo sa zmenilo medzi revíziou A a B | ❌ | upstream `@ifc-lite/diff` (`diffModels`) a ComparePanel existujú, ale AIM nesie jednu revíziu modelu; chýba druhá revízia ako dáta aj ako načítaný model | fáza 4 + dáta |
| 11 | Investor | Prejdi budovu podlažie po podlaží | ❌ | kamera + podlažie. Po fáze 1: `set_view_mode 2d floor=1NP..5NP` (bez kalibrovaného výkresu = zamknutý ortho pohľad zhora s rezom 1,2 m nad podlahou, `enterDrawingView`), krok za krokom na pokyn používateľa | fáza 1 |
| 12 | Investor | Obrázok fasády s ofarbenými oknami | ❌ | ofarbenie ✅, kamera `front` po fáze 1; obrázok: fork má `captureViewportScreenshot()` (JPEG data URL), chýba spätný kanál, ktorým by sa dostal ku Claude ako MCP image | fáza 1 (pohľad) + fáza 2 (obrázok) |
| 13 | všetci | Čo mám práve vybrané / čo vidím | ❌ | kanál je jednosmerný; stav vo forku je čitateľný (`selectedEntity`, `hiddenEntities`, `isolatedEntities`, `getViewpoint()`, `getSections()`, `deriveViewMode`) | fáza 2 |
| 14 | Projektant | Otvor pôdorys 2NP vedľa modelu | 🟡 | `open_drawing` otvorí `/drawing/<id>` mimo 3D. Viewer vie `DOCUMENT_OPEN{documentId,page}` a `/ifc?doc=` existuje, ale MCP ho nepoužíva a `mergeIfcActions` parameter `doc` zahodí | fáza 1 (op `doc`) |
| 15 | všetci | Vráť pohľad do pôvodného stavu | 🟡 | `show_all` + `reset_colors` áno; rez, kamera a režim nie | fáza 1 |
| 16 | FM technik | Kde je najbližší uzatvárací ventil | ❌ | dáta (import ÚK/ZTI, ROADMAP F6) | import |
| 17 | Koordinátor | Spusti IDS kontrolu na aktuálnom modeli | 🟡 | posledný beh áno (E6); nový beh len cez ETL (`python -m etl.ids_check`), nie z MCP. Upstream `@ifc-lite/ids` (`useIDS().runValidation`) validuje v prehliadači | fáza 4 |

Pozn.: use-casy 2, 4, 7 a 16 nezablokuje viewer, ale **dáta** - ani fáza 1 až 4 ich
nevyrieši bez importu (klapky, ventily, priestor 1.12, `world` ukotvenie snímok).

**Rozhodnutie (fázovanie F12):**

1. **Fáza 1 - pohľad (bez zmeny DB, bez nového kanála).** Tri nové MCP tools
   `set_section`, `set_camera`, `set_view_mode` + voľba `in_viewer` v `open_drawing` +
   `reset` v `set_view_mode`. Transport = existujúci `ops` wire formát (D-066) cez živý
   kanál (D-079) a záložný odkaz, bez zmeny `isSafeViewerUrl` (už dnes pustí každé
   `/ifc?...`). Vo forku tri nové bridge správy `SET_SECTION`, `SET_CAMERA`,
   `SET_VIEW_MODE` (mená zhodné s upstream `@ifc-lite/embed-protocol`, payload
   GUID-centrický ako zvyšok AIM bridge, D-067), ktoré obaľujú existujúce volania
   (`showSectionCut` / `clearSectionCut`, `cameraCallbacks.*`, `useViewMode`), plus
   `DOCUMENT_OPEN` bez zmeny. Podlažie cestuje ako **IFC GUID podlažia** (v DB aktívny
   GUID na `floor`, napr. 2NP = `27hbQtAoP6qvoEYhPARoI7`); výšku rezu počíta viewer zo
   svojej elevácie podlažia (metre, viewer Y-up, `worldToPercent`), nie host z
   `floors.elevation` (mm) - jedna pravda o súradniciach je vo vieweri. Odomkne use-casy
   3, 11, 14, 15 a pohľadovú časť 12.
2. **Fáza 1b - drobnosti bez forku.** `captures` + `aim_rel_capture_located` do whitelistu
   `query_view` (use-case 7), prípadne filter podlažia v `style_in_3d` (Q2).
3. **Fáza 2 - spätný kanál viewer -> Claude.** Tool `get_viewer_state` (výber, viditeľnosť,
   kamera, rez, režim, podlažie) a `get_viewer_snapshot` (obrázok). Mechanizmus a
   autorizácia samostatným rozhodnutím (Q5); kým nie je, tools hlásia "odoslané", nie
   "zobrazené".
4. **Fáza 3 - prvý zápis** (porucha / BCF komentár k prvku) **samostatným rozhodnutím**:
   dátový model (kde je nositeľ tiketu), autorizácia zápisu (dnes len token v ceste MCP,
   D-079) a MCP anotácie (`readOnlyHint: false`). Bez neho sa zápis nestavia.
5. **Fáza 4 - analýzy z upstreamu vo vieweri** (kolízie, porovnanie revízií, IDS v
   prehliadači) nad načítaným modelom, výsledok cez kanál fázy 2. Upstream `@ifc-lite/mcp`
   **nepreberáme ako server**: jeho tools pracujú nad IFC súborom načítaným headless v Node
   a jeho `viewer_*` tools ovládajú samostatný `@ifc-lite/viewer-core`, nie náš fork v
   iframe ani graf AIM. Preberáme **knižnice**, ktoré už viewer používa (`@ifc-lite/clash`,
   `@ifc-lite/diff`, `@ifc-lite/ids`, `@ifc-lite/bcf`), a z `@ifc-lite/mcp` len inšpiráciu
   pre tvar tools (napr. `viewer_set_section {axis, position, flipped, enabled}`,
   `viewer_color_by_property` s legendou, `viewer_wait_for_selection`).

**Zdôvodnenie poradia:** fáza 1 je najlacnejšia (všetko je vo vieweri, mení sa len host a
tenká vrstva v `aim/`), nemení DB ani bezpečnostný model a dáva demo moment "Claude mi
ukáže strop / prejde podlažia". Spätný kanál ide pred zápis aj analýzy, lebo obe ho
potrebujú (výsledok kolízií, potvrdenie výberu pred zápisom "na tento ventil"). Zápis ide
pred analýzy len ak ho Samuel uprednostní pre FM demo; technicky sú nezávislé.

**Zavrhnuté:**
- *Nový kanál pre pohľadové príkazy* (WebSocket, SSE): `ops` + Realtime (D-066, D-079)
  unesie všetko z fázy 1; nový kanál by zdvojil whitelist aj zlučovanie akcií.
- *Výška rezu počítaná hostom z `floors.elevation`*: DB je v mm a v súradniciach IFC,
  viewer reže v recentrovaných metroch (Y-up, `bcfWorldOffset`); dve pravdy o súradniciach
  by sa rozišli pri prvej zmene georeferencovania (D-050).
- *Prevziať upstream `@ifc-lite/mcp` ako druhý MCP server*: iné dáta (súbor, nie graf AIM),
  iný viewer, druhý konektor pre používateľa; duplikát tools nad tými istými prvkami.
- *Jeden univerzálny tool `set_view {section, camera, mode}`*: model ho volá nejednoznačne
  (vzor D-082 - rozšírenie `show_in_3d` o výber bolo zavrhnuté z toho istého dôvodu);
  tri úzke tools s jasným popisom sa skladajú v jednom kole.
- *Prehliadka podlaží ako jeden príkaz s časovačom vo vieweri*: tempo má určovať
  používateľ ("ďalej"), Claude a viewer o sebe nevedia (bez fázy 2); krok = jeden call.

**Plán fázy 1 (implementácia až po schválení):**

*MCP tools (vstupné schémy):*
- `set_section`
  `{ action: "set"|"clear" (req), orientation?: "horizontal"|"vertical_x"|"vertical_z"
  (default horizontal), floor?: string (id_or_ref podlažia: "3NP", "3.NP", "3. NP", UUID),
  offset_m?: number (výška nad úrovňou podlažia, default 1.2, rozsah -5..20),
  position_percent?: number (0..100, alternatíva bez podlažia, jediná pre zvislé rezy),
  flipped?: boolean }`. Vodorovný rez vyžaduje `floor` alebo `position_percent`.
  Mapovanie na SDK osi: horizontal = `y` (viewer `down`), vertical_x = `x` (`side`),
  vertical_z = `z` (`front`).
- `set_camera`
  `{ preset: "top"|"bottom"|"front"|"back"|"left"|"right"|"iso"|"fit_all" (req),
  target_ids_or_refs?: string[] (1..100, zarámuje kameru na prvky, napr. miestnosť),
  projection?: "perspective"|"orthographic" }`. `iso` = `cameraCallbacks.home()` (SE
  izometria), s cieľom = rotácia + `frameEntities` (pri implementácii overiť, že
  `frameEntities` zachová smer pohľadu presetu).
- `set_view_mode`
  `{ mode: "3d"|"2d"|"split" (req), floor?: string (id_or_ref; pre 2d/split, inak
  posledné/prvé podlažie), reset?: boolean (s mode=3d: zruší rez, ofarbenie, skrytie a
  vráti kameru home) }`. 2d s kalibrovaným výkresom = pôdorys PDF na celú plochu
  (`enterPlanView`), bez výkresu = zamknutý ortho pohľad zhora s rezom 1,2 m nad
  podlahou (`enterDrawingView`).
- `open_drawing` dostane `in_viewer?: boolean` - true otvorí dokument ako kartu vedľa 3D
  (op `doc`), default ostáva `/drawing/<id>`.

*Wire formát (rozšírenie D-066; `parseOps` delí len `;` a `:`, takže argument smie niesť
bodku aj mínus; tretie pole = GUIDy oddelené bodkou):*
- `section:<y|x|z>[~h=<m>][~p=<pct>][~f=1]:<storeyGuid>` · `section_clear::`
- `camera:<preset>[~proj=o|p]:<guid.guid...>`
- `view:<3d|2d|split>:<storeyGuid>`
- `doc:<page>:<documentId>`
- `reset` = server poskladá existujúce ops: `section_clear` · `view:3d` · `show_all` ·
  `reset_colors` · `camera:iso` (žiadna nová op).

*Bridge správy (host -> viewer, fork `apps/viewer/src/aim/`):*
- `SET_SECTION { action: "set"|"clear", axis?: "x"|"y"|"z", storeyGuid?: string,
  offsetM?: number, position?: number (0..100), flipped?: boolean }`
- `SET_CAMERA { preset, projection?: "perspective"|"orthographic", guids?: string[] }`
- `SET_VIEW_MODE { mode: "3d"|"2d"|"split", storeyGuid?: string }`
- `DOCUMENT_OPEN` bez zmeny (už má `page`).
Neznáme podlažie (GUID nie je medzi `storeyOptions`) = fallback na normalizovaný názov
(`3NP_VZT` -> `3NP`, D-049), inak no-op s varovaním v konzole. Rez cez Section tool
(viditeľný a posúvateľný v UI); v režime 2d/split riadi rez podlažia `underlayCut`, ktorý
má prednosť (`aim/underlayCut.ts`), preto `SET_VIEW_MODE 3d` aj `SET_SECTION clear`
nechávajú stav jednoznačný.

*Súbory - AIMviewer (`Menezeris/AIMviewer`, vetva `claude/f12-mcp-viewer-control`):*
- `lib/viewer-ops.ts` (nový, čistý, server aj klient): typy `ViewerOp`, `parseOps`
  presunutý z `components/ifc-viewer.tsx` + buildery `sectionOp`, `cameraOp`,
  `viewModeOp`, `docOp`. Jeden zdroj wire formátu (dnes ho tools.ts skladá reťazcami a
  komponent parsuje bez spoločného testu).
- `components/ifc-viewer.tsx`: import `parseOps`, nové prípady v `applyOps`
  (`SET_SECTION`, `SET_CAMERA`, `SET_VIEW_MODE`, `DOCUMENT_OPEN`), komentár protokolu;
  **v `MODELS_LOADED` presunúť `applyOps(ops)` za `UNDERLAYS_LOAD`/`DOCUMENTS_LOAD`/
  `CAPTURES_LOAD`** - dnes idú ops pred výkresmi a `view:2d` aj `doc` z deep linku by
  prišli skôr, než ich viewer pozná.
- `lib/llm/tools.ts`: tri definície + handlery `setSection`, `setCamera`, `setViewMode`,
  helper `resolveFloor` (object_ref/meno s normalizáciou `3NP`/`3.NP`/`3. NP`, aktívny
  GUID z `ifc_guid_history`), `in_viewer` v `openDrawing`.
- `lib/llm/system-prompt.ts`: kedy ktorý tool a skladby (strop nad miestnosťou,
  prehliadka podlaží, reset). Mení prompt -> eval kadencia D-057.
- `scripts/eval-ask.ts` + `eval/questions.json`: nové `expect.actions_match` (regex na URL
  akcie) a 4 otázky (strop nad 2.05, 2NP v 2D, pôdorys vedľa modelu, reset).
- Testy: `lib/viewer-ops.test.ts` (build -> parse round-trip, odmietnutie zlých hodnôt,
  regresia existujúcich ops D-066/D-082, GUID s `$`/`_`), `lib/llm/actions.test.ts`
  (nové ops prežijú `mergeIfcActions` v poradí; `isSafeViewerUrl` ich pustí),
  `lib/mcp/server.test.ts` (tools/list obsahuje nové tools).
- Dokumenty: dodatok D-083 (implementované), ROADMAP stav + changelog, README (zoznam
  tools konektora).

*Súbory - fork (`Menezeris/ifc-lite`, vetva `claude/f12-mcp-viewer-control`), všetko v
`apps/viewer/src/aim/`, **bez zásahu do upstream súborov** (očakávané; ak by bol nutný,
AIM-FORK sentinely + riadok v `docs/FORK_MAINTENANCE.md`):*
- `aim/view-protocol.ts` (nový): typy troch správ + `isViewMessage` (validácia rozsahov).
  Samostatný súbor, lebo `bridge-protocol.ts` je na rozpočte module-size (458/458);
  v ňom len union typ a jedno delegovanie, rozpočet sa nezvyšuje (vyrovná sa presunom).
- `aim/viewCommands.ts` (nový): čisté výpočty (podlažie -> percento rezu cez
  `mergedSectionBounds`/`sectionAxisRange`/`worldToPercent`, preset -> volanie
  `cameraCallbacks`, fallback podlažia podľa mena).
- `aim/useAimViewCommands.ts` (nový hook): `useViewMode` + `storeyOptions` z
  `useFloorplanView` (sú to hooky, preto nie v listeneri priamo).
- `aim/AimBridge.tsx`: tri prípady v dispatchi.
- Testy (`node:test`, vzor `bridge-protocol.test.ts`): `aim/view-protocol.test.ts`
  (accept/reject každej správy), `aim/viewCommands.test.ts` (výpočet percenta, mapovanie
  presetov, neznáme podlažie).

*Overenie pred pushom:* AIMviewer `npm test`, `npx tsc --noEmit`, `npm run lint`,
`npm run eval` (ak je v prostredí kľúč a DB, inak výslovne "nespustené"); fork
`pnpm typecheck`, `TEST_PATTERN=aim/ pnpm test` v `apps/viewer`, `pnpm check:module-size`,
`check:i18n-literals`, `check-agents-md-size`. Živé overenie: Vercel preview forku +
AIMviewer s `?live=` a konektor v claude.ai (Q8). **Push zoskupene:** jeden push na repo na
konci fázy 1 (fork = jeden build ifc-lite-viewer).

*Závislosti:* vetvy stoja na `claude/vigilant-cannon-cuizq0` (fork PR 54, AIMviewer
`select_in_3d`). Ak sa PR 54 alebo PR AIMviewera zmenia pred zlúčením, F12 vetva sa
zmerguje s ich koncom; po zlúčení s `main`.

**Otvorené otázky pre Samuela (zrkadlo v chate, odpovede patria sem ako dodatok):**
- **Q1** Rozsah fázy 1: tri tools + `in_viewer` v `open_drawing` + `reset` - súhlas?
- **Q2** Filter podlažia v `style_in_3d` (use-case 8): do fázy 1 (selektor `s=<podlažie>`
  rozkladaný vo vieweri, normalizovaný label D-049, aj pre VZT) alebo neskôr?
- **Q3** Rez z MCP cez Section tool (viditeľný, používateľ ho môže posúvať) - alebo
  "neviditeľný" rez ako `underlayCut`?
- **Q4** Prehliadka podlaží (use-case 11): stačí 2D bez výkresu (ortho zhora s rezom),
  alebo radšej 3D izometria s izoláciou podlažia (potrebuje Q2)?
- **Q5** Fáza 2: request/response cez ten istý Realtime kanál (verejný = podvrhnuteľný
  stav, D-079 limit) alebo zápis stavu cez API route s tokenom? Má niesť aj snímky?
- **Q6** Fáza 3: kto je nositeľ tiketu/poruchy (princíp jedného nositeľa: AIM vs. CDE/CAFM)
  a ako sa autorizuje zápis?
- **Q7** Use-casy 2 a 7 stoja na dátach (klapky v modeli nie sú, 1.12 neexistuje):
  je to vzorová otázka, alebo očakávaš import (ktorý model)?
- **Q8** Živé overenie: má AIMviewer preview mieriť na preview forku
  (`NEXT_PUBLIC_IFC_VIEWER_URL` per vetva na Verceli), alebo overujeme až po zlúčení forku?


**Dodatok D-083 (2026-10-17) - pohľad bez súradníc, `scene.actions`, motor na serveri.**
Po prieskume forku a balíka `@ifc-lite/mcp` (D-084):
- **Pohľad ostáva bez súradníc** (`SET_SECTION {storeyGuid, offsetM, axis}`, `SET_CAMERA {preset,
  guids}`, `SET_VIEW_MODE`). Fork má kontrakt `scene.actions` (`lib/actions/scene-actions.ts`,
  `applySceneActions`), ten však berie rovinu rezu a kameru vo svetových súradniciach IFC, ktoré
  host nepozná, a pri každom použití vráti späť predchádzajúcu sadu. Viewer preto prepočíta
  podlažie na rovinu sám (`storeyOptions` z `useFloorplanView`, kontrola cez
  `lib/actions/scene-coordinates.ts`) a zapíše ju tým istým kanálom sekcie ako `scene-apply.ts`.
  `scene.actions` sa použije až vo fáze 2 ako `viewer_apply_scene` (vždy celá sada naraz).
- **Oprava poradia** v `MODELS_LOADED` (ops až po `UNDERLAYS_LOAD`/`DOCUMENTS_LOAD`) patrí do fázy 1.
- **Bod 5 (analýzy vo vieweri) nahrádza D-084:** kolízie, IDS a porovnanie revízií počíta motor
  na serveri, nečakajú na spätný kanál.
- **Fáza 1 implementovaná (2026-10-17):** tools `set_section`, `set_camera`, `set_view_mode`
  (+ `reset`) a `open_drawing.in_viewer` (`lib/llm/view-tools.ts`, čistá logika
  `lib/llm/view-plan.ts`); formát ops a preklad na bridge správy na jednom mieste
  `lib/viewer-ops.ts` (presunuté z `components/ifc-viewer.tsx`); ops sa v `MODELS_LOADED`
  aplikujú až po `UNDERLAYS_LOAD`/`DOCUMENTS_LOAD`/`CAPTURES_LOAD`. Fork
  (`Menezeris/ifc-lite`, rovnaká vetva, z `main` po zlúčení PR 54): `aim/view-protocol.ts`,
  `aim/viewCommands.ts`, `aim/useAimViewCommands.ts`, bez zásahu do upstream súborov.
  Overené: AIMviewer vitest 83/83, `tsc`, `next build`; fork `tsc` (viewer) 0 chýb, testy
  `aim/` 35/35, `check-module-size` OK.
- **Overenie naživo (2026-10-17):**
  - *Zostava:* fork lokálne (`vite`), AIMviewer `IFCViewer` na dočasnej devtest stránke
    a Playwright (headless Chromium) nad ASR+VZT.
  - *Obmedzenie:* softvérové WebGPU (SwiftShader) stratí zariadenie, preto sa overoval
    stav viewera (store), nie obraz.
  - *Rez:* nad 3NP o -0,4 m leží v IFC výške 8,8 m (podlažie 9,2 m).
  - *Kamera:* `top` s ortografickou projekciou a rámovaním na miestnosť 2.05 sa pozerá
    zhora; `iso` prepne na perspektívu.
  - *Režimy:* 2D na 2NP = zamknutý pohľad zhora s rezom 6,2 m, na 3NP 10,4 m; Split a
    návrat do 3D fungujú.
  - *Odkaz s ops:* `view:2d` + `doc` pri prvom načítaní otvorí 2D aj kartu dokumentu,
    takže poradie DOCUMENTS_LOAD -> DOCUMENT_OPEN sedí; reťazec resetu funguje.
  - *Oprava:* neznáme podlažie predtým potichu prepol do 2D na naposledy použité
    podlažie; teraz sa správa nevykoná (`pickStorey`).
  - *Rez v 2D/Split:* má prednosť rez podlažia (`underlayCut`), vizuálne neoverené.

### D-084 - IFC motor `@ifc-lite/mcp` ako knižnica v MCP konektore AIM
**Status:** rozhodnuté (2026-10-17), fáza 0 (prototyp) beží. **Rozširuje D-079, D-083.**

**Kontext:** cieľ (Samuel, 17. 10.) je, aby Claude cez konektor vedel vo vieweri všetko, čo sa dá
naklikať, robil analýzy a reporty na zadanie a neskôr **zapisoval psety a validoval ich voči
požiadavkám** (IDS z knižnice). Upstream balík `@ifc-lite/mcp` (npm, MPL-2.0) má 125 tools nad IFC
súborom (dotazy s číselnými filtrami, kolízie, IDS, porovnanie, úpravy, export). Overené
spustením nad ASR+VZT:
- načítanie 1,2-2,5 s pri ~300 MB, kolízie ~2,5 s pri ~600 MB;
- `NetFloorArea>20` vráti 32 miestností;
- výsledky nesú GlobalId;
- funguje aj zapojenie v tom istom procese (`createMCPServer` + `InProcessTransport`).

**Rozhodnutie:**
1. **Jeden konektor, tri rodiny tools:** dnešné AIM tools nad DB, `ifc_*` = motor `@ifc-lite/mcp`
   ako knižnica (vybraná podmnožina, nie 125 tools) a viewer tools cez náš bridge. Výsledky motora
   sa prepoja na AIM cez GUID (`ifc_guid_history` -> `object_ref`) a nesú pripravený vstup pre
   `show_in_3d`/`style_in_3d`. Smerovanie v `mcpInstructions`: DB tools pre graf AIM, `ifc_*` pre
   to, čo je len v súbore, číselné porovnania, IDS ad hoc a zápis.
2. **Balík nepoužívame ako samostatný server**, lebo:
   - HTTP relácie začínajú bez modelu a model načíta len z cesty na disku;
   - `viewer_*` tools riadia jeho vlastný viewer na 127.0.0.1;
   - má jeden statický token a žiadny OAuth;
   - nevidí dáta AIM.
3. **Bezstavový motor:** parsovaný store sa drží v pamäti inštancie (keyed URL+ETag, jedno načítanie
   aj pri súbežných requestoch), každý request dostane nový `HeadlessLikeBackend`. Úpravy
   (overlay) visia na backende a balík ich nevie zmazať, takže zdieľaný model by medzi requestmi
   "zdedil" cudzie úpravy.
4. **Zápis (fáza 3) ako propose -> commit:**
   - zmeny sa aplikujú na čerstvý backend, exportujú (`bim.export.ifc()` vráti STEP text), znova
     načítajú a validujú;
   - `ids_validate` vlastné úpravy vlastností existujúcich prvkov nevidí;
   - commit uloží nemennú revíziu a change set (audit, dá sa aplikovať na ďalší export projektanta);
   - zápis má samostatný token a anotáciu `readOnlyHint:false`.
   Detail v D-086.
5. **Fázy:** 0 prototyp (merania, porovnanie IDS motorov) · 1 čítanie + pohľad (D-083 fáza 1) ·
   2 zhoda s UI + spätný kanál (D-085) · 3a zápis psetov + Name/Description/ObjectType/Tag ·
   3b klasifikácia, LongName, PredefinedType, IfcZone · 4 reporty a analýzy (kolízie ASR×VZT cez
   zlúčenie modelov).

**Brány fázy 0** (ak niektorá neprejde, motor pôjde ako samostatná Node služba za
`lib/engine/client.ts`, ostatné sa nemení):
1. build prejde a vytrasovaná veľkosť MCP route je < 200 MB (Vercel limit 250 MB, celá inštalácia
   balíka má 255 MB);
2. studené prvé volanie p95 < 12 s, teplý dotaz p95 < 1,5 s, špička pamäte < 1,2 GB;
3. izolácia backendov nad jedným parsovaným storeom;
4. zhoda IDS motorov na ER-0101 × ASR: 8/8 verdiktov, ≥ 99 % prvkov, rozdiely vysvetlené.

**Vedomé limity (overené v kóde 0.27.0):**
- `entity_set_attribute` vie len Name/Description/ObjectType/Tag. ER-0101 × ASR zlyháva na mene
  podlažia (`1NP` vs. `\d.NP`), CCI klasifikácii priestorov a chýbajúcej IfcZone, takže fáza 3a
  opraví len podlažia a zvyšok je 3b.
- Filter dotazu nevidí vlastnosti zdedené z typu.
- `geometry_*` čítajú len množstvá (Qto), nie skutočnú geometriu.
- Kolízie fungujú len v rámci jedného modelu.
- `export_pdf_report` a `raycast` sú v 0.27.0 len kostry.

**Zavrhnuté:**
- *Upstream MCP ako druhý konektor:* iné dáta (súbor bez AIM), iný viewer, duplicitné tools.
- *Prepísať AIM do IFC a nechať balík čítať všetko:* balík nečíta aktérov ani roly, odvodené
  väzby do miestností ignoruje vo filtroch, väzby naprieč súbormi IFC4 neunesie a obsah CDE
  (texty PDF, fotky, behy IDS) do modelu nepatrí; vytvorilo by to druhého nositeľa tých istých dát.
- *Vlastná implementácia dotazov, IDS a úprav nad IFC:* balík ich má a je aktívne udržiavaný.

**Otvorené otázky (pred fázou 3):** samostatná služba ak brána neprejde; ktorý IDS motor je
záväzný (návrh: ifctester pre zaznamenané behy, `@ifc-lite/ids` ako predkontrola) a odkiaľ server
číta IDS; či je upravené IFC nová autoritatívna revízia alebo change set nad exportom projektanta;
autorizácia zápisu (token vs. OAuth); prvý GitHub Actions workflow pre re-ETL; spoločný
`LIVE_CHANNEL` vs. párovanie per relácia pre spätný kanál.

**Závislosť a licencia:** `@ifc-lite/mcp` 0.27.0 (MPL-2.0, pripnutá presná verzia), transitívne
MIT/ISC/Apache-2.0/BSD; `jszip` dvojlicencia MIT/GPL (volíme MIT); žiadna AGPL.
Priame závislosti `@ifc-lite/parser` 9.5.1 a `@ifc-lite/sdk` 9.5.0 (MPL-2.0) - načítanie z bajtov.
Odstránené nepoužívané `@ifc-lite/geometry`/`query`/`wasm` a `postinstall` kopírujúci WASM do
`public/` (3D renderuje fork v iframe, v kóde ostali len komentáre).

**Výsledky fázy 0 (2026-10-17, lokálne, Node 22; ASR 20,1 MB + VZT 9,6 MB z verejného bucketu):**

| Brána | Meranie | Stav |
|---|---|---|
| 1 veľkosť | `next build` prejde; trasovanie route `/api/mcp/[token]` = **75,8 MB** (2863 súborov, WASM aj xmldom pribalené cez `outputFileTracingIncludes`) | ✅ |
| 2 čas a pamäť | zbuildovaný Next server (`next start`) cez MCP endpoint: studené načítanie ASR **1,1 s** + VZT **0,5 s** (vrátane sťahovania), teplé **0 ms** (tá istá inštancia), `query_entities` s číselným filtrom **8-30 ms** (32 miestností), `clash_check` VZT **2,1-2,6 s** (228 kolízií), RSS **~625 MB**. **Vercel preview** (Fluid, štandardná pamäť, iad1, Node 24): studené volanie **7,4 s** spolu (nová inštancia po 20 min nečinnosti; ASR 2,1 s + VZT 0,8 s), studené s kolíziami **10,0 s** (kolízie 4,1 s), teplé **0,22-0,55 s** spolu (dotaz 9-20 ms), RSS max **~715 MB** | ✅ |
| 3 izolácia | úprava psetu na backende A sa v ďalšom volaní nad tým istým storeom neprejaví (`engine.test.ts` + benchmark nad ASR) | ✅ |
| 4 zhoda IDS | ER-0101 × ASR: `@ifc-lite/ids` vs. ifctester (`etl.ids_check --dry-run --report`) = **8/8 verdiktov, 189/189 párov špecifikácia × prvok (100 %)**, `ids_validate` ~0,34 s | ✅ |

Výhrada k bráne 4: ER-0101 testuje atribúty, klasifikáciu a väzby, nie hodnoty psetov ani
dedičnosť z typu - porovnanie sa zopakuje s prvým IDS, ktoré psety testuje (pred fázou 3).
Rozhodnutie: **motor beží v procese MCP route na Verceli** (všetky štyri brány prešli),
samostatná služba netreba. Meranie na preview: env `ENGINE_SPIKE=1` a dočasný `MCP_TOKEN`
len pre preview vetvy `claude/f12-mcp-viewer-control`, dočasný "Protection Bypass for
Automation"; po meraní bypass zrušený a preview `MCP_TOKEN` zmazaný. Nástroje: `scripts/spike/engine-bench.mts`,
`scripts/spike/ids-compare.mts` (spúšťajú sa cez `npx vite-node@6.0.0`, lebo `tsx` preloží
`lib/engine` do CommonJS a `@ifc-lite/ids` používa top-level await).

**Dodatok D-084 (2026-10-17) - fáza 1 implementovaná na vetve `claude/f12-mcp-viewer-control`.**
- **IFC motor:** tools `ifc_models`, `ifc_query` (triedy, podlažie podľa štítku AIM,
  až 3 podmienky na psety vrátane číselných), `ifc_get` (ciele = object_ref / objects.id /
  GlobalId, psety výskytu aj z typu, množstvá, klasifikácie, dokumenty), `ifc_count`
  (s podmienkou alebo zoskupené podľa triedy / podlažia / materiálu), `ifc_property_values`
  (histogram) a `ifc_ids_validate` (IDS z registra `IDS_SOURCES`, nič neukladá).
  Zapína ich env `ENGINE_ENABLED=1`, kód motora sa načíta lenivo až pri prvom `ifc_*`
  volaní (`lib/engine/tool-defs.ts` vs. `lib/engine/run.ts`).
- **Prepojenie na AIM:** výsledok nesie `object_id`/`object_ref`/`aim_url` (aktívny GUID v
  `ifc_guid_history`), `unmapped` a pole `show_in_3d`. `show_in_3d`/`style_in_3d` dostali
  `global_ids` (max 600), takže sa dajú ukázať aj prvky, ktoré sú len v súbore.
- **Smerovanie:** pravidlá v `mcpInstructions` (len pri zapnutom motore). MCP anotácie sa
  dajú nastaviť pre jednotlivé tools (default ostáva "len na čítanie").
- **Overené:** vitest 83/83 (motor nad inline mini-modelom, prepojenie, podlažia, IDS), smoke
  nad ASR+VZT (VZT jednotka na 2NP cez štítok podlažia, 13 miestností > 20 m² na 2.NP,
  IfcCovering po podlažiach). Evaly `/ask` motor neobsahujú (ifc_* sú len v MCP); overenie
  motora = živé scenáre cez konektor.
- **Overenie cez MCP na Vercel preview so skutočnou DB (2026-10-17):**
  - *Zostava:* `ENGINE_ENABLED` a dočasný token len pre preview vetvy, dočasný bypass;
    po overení zrušené.
  - *Prešlo:* všetkých 17 scenárov - `ifc_query` (13 miestností > 20 m² na 2NP, všetky
    namapované na `object_ref`), `ifc_count` (97 dverí po podlažiach),
    `ifc_property_values` (`LoadBearing` 114/95), `ifc_get` (cez `object_ref` aj GUID),
    tools pohľadu (podlažie `3. NP` sa rozpozná, neznáme vráti zoznam dostupných),
    `open_drawing.in_viewer`, `global_ids` v 3D tools a staré tools bez regresie.
  - *`ifc_ids_validate`:* hlási prázdny register, kým nie je nastavený `IDS_SOURCES`.
  - *Oprava `ifc_get`:* trval 5,5 s, lebo balík pri hľadaní podľa GlobalId prechádza
    všetky entity súboru (~1 s na volanie). Teraz je index GlobalId -> expressId
    produktov postavený raz na parsovaný model: prvé volanie 0,34 s, ďalšie ~2 ms.
  - *Popisky akcií:* záporná výška rezu = "pod úrovňou", počet cieľov kamery bez
    chybného skloňovania.

**Dodatok D-084 (2026-10-18) - IDS zatiaľ vo vieweri forku, zdroj IDS pre server otvorený.**
- **Rozhodnutie (Samuel):** kontrola modelu voči IDS sa zatiaľ robí v IDS paneli viewera
  forku (`apps/viewer/src/components/viewer/IDS*`). Uložené behy ifctesteru (D-081,
  `v_ids_latest`/`v_ids_summary`) ostávajú záväzným záznamom.
- **Server:** `IDS_SOURCES` sa zatiaľ nenastavuje. `ifc_ids_validate` ostáva v kóde; pri
  prázdnom registri vráti chybu, ktorá odkáže na IDS panel viewera a na uložený beh.
- **Otvorené rozhodnutie (Samuel, aj neskôr):** odkiaľ bude server brať IDS (súbor z
  `assetin-library` na pevnom commite, alebo bucket, do ktorého ich knižnica publikuje) a
  kedy kontrolu na serveri zapnúť. Najneskôr pred fázou 3 (D-086), lebo commit zápisu
  stojí na IDS bráne na serveri. Do vtedy je otázka 2 plánu F12 (zdroj IDS) odložená, nie
  zodpovedaná.

### D-085 - Spätný kanál viewer -> Claude: obálky, stav pohľadu, rez cez prvok
**Status:** rozhodnuté (2026-10-18, Samuel: "áno začni"). **Realizuje fázu 2 D-083 (bez
snímky obrazovky); rozširuje D-079.**

**Kontext:** Claude dostal úlohu "pozdĺžny rez schodiskom" a rez nevedel položiť: `set_section`
poznal len percentá rozmeru modelu a viewer nič nehlásil, takže Claude hádal naslepo. Sám
pomenoval, čo potrebuje: obálku prvku v súradniciach modelu, rozsah modelu a jeho osi, stav
rezu a kamery a rez na presnej súradnici alebo cez zvolený prvok. Balík `@ifc-lite/mcp` to
nevyrieši: `geometry_bbox` počíta rozmery z množstiev (Qto), nie polohu, a `viewer_set_section`
berie len os a číslo; jeho `viewer_*` ovládajú vlastný lokálny viewer (D-083, D-084). Polohu
prvkov pozná len náš viewer, ktorý má načítanú geometriu.

**Rozhodnutie:**
1. **Kanál = ten istý živý kanál D-079.** Server sa pripojí na `LIVE_CHANNEL` (Supabase
   Realtime, `service_role`), pošle udalosť `query` {id, query, guids?} a čaká na `reply` s tým
   istým id (`lib/live/query.ts`, timeout 8 s). Viewer s `?live=` ju odovzdá forku ako bridge
   správu `QUERY` a odpoveď `QUERY_RESULT` vráti do kanála (`components/live-channel.tsx`,
   `lib/live/viewer-query-bus.ts`, `components/ifc-viewer.tsx`). Na rozdiel od príkazov to nie je
   fire-and-forget: bez otvoreného viewera príde timeout a tool povie, čo má používateľ otvoriť.
2. **Tools (len MCP):** `get_bounds` (obálky prvkov a celého modelu, osi, ktoré `orientation`
   ktorú os reže) a `get_viewer_state` (režim a podlažie, rez, kamera, výber, počty skrytých a
   izolovaných). GUIDy výsledku dostanú `object_ref` z AIM.
3. **Rez cez prvok a na súradnici:** `set_section` s cieľom (`target_ids_or_refs` / `global_ids`)
   + `fit` along / across (zvislo pozdĺž / naprieč dlhšej vodorovnej strany, os volí viewer) /
   center (stredom na zadanej `orientation`), alebo `coordinate_m` (súradnica na osi orientation).
   Wire formát ops: `section:auto~fit=along:<guid...>`, `section:y~c=<m>:`.
4. **Jedna pravda o súradniciach je vo vieweri (ako D-083).** Odpovede aj `coordinate_m` sú IFC
   svet (m, Z hore): fork prevádza render rámec cez `@ifc-lite/geometry/world-frame` a
   `bcfWorldOffset` (to isté pravidlo ako BCF a meranie), obálky berie zo scény renderera (tie
   isté ako rámovanie kamery, aj inštancie; zostava bez vlastnej geometrie, napr. IfcStair ako
   kontajner, cez svoje časti) a rez vykoná cez `showSectionCut`. Žiadny upstream súbor forku
   sa nemení, všetko je v `apps/viewer/src/aim/`.

**Zavrhnuté:**
- *Obálky z ETL do DB:* geometria je ephemerálny kontajner viazaný cez GUID (D-044) a render
  rámec sa posúva s georeferencovaním (D-050); uložená obálka by bola druhý nositeľ.
- *Obálky na serveri z IFC (geometria v Node):* pamäť a čas na každý request, a iné súradnice
  než tie, v ktorých reže viewer.
- *`geometry_bbox` z balíka:* rozmery z Qto, nie poloha v modeli.
- *Samostatný kanál (WebSocket/SSE zo servera):* Realtime už máme, druhý kanál by zdvojil
  autorizáciu aj párovanie.

**Vedomé limity:**
- Kanál je spoločný (`LIVE_CHANNEL`): pri viacerých otvorených vieweroch platí prvá odpoveď.
  Párovanie per relácia ostáva otvorené (otázka z D-084).
- Kanál je verejný: kto pozná jeho názov, vidí otázky aj odpovede (obálky, stav pohľadu).
  Názov má byť netriviálny (README); dnešný `aim-viewer` treba zmeniť pred zdieľaním mimo tímu.
- Rez cez prvok z odkazu príde s `MODELS_LOADED`, keď geometria ešte prúdi do scény; most ho
  skúša znova každých 500 ms (najviac 30 s), novší rez opakovanie zruší.
- Snímka pohľadu (`get_viewer_snapshot`, use-case 12 z D-083) nie je súčasťou, obrázok cez
  Realtime by narazil na limit veľkosti správy.

**Overené (2026-10-18):** fork `view-protocol.test.ts` 9/9 a 6 chirurgických mutácií (všetky
OBSERVED, `docs/architecture/evidence/aim-d085-view-queries/` vo forku); AIM vitest 99/99. Naživo:
lokálny fork + AIM dev server + falošný Realtime server s protokolom realtime-js 2 (vrátane
binárneho broadcastu): MCP `get_bounds` na točité schodisko `AC20-FZK-Haus.ifc` -> Realtime ->
host -> most -> späť za 227 ms (x 6.718..8.315, y 2.243..3.952, z 0..3.56); `set_section` fit
along z odkazu reže na X 7.517 m (stred schodiska, rovnakú hodnotu ukazuje nástroj Section
viewera); `coordinate_m` 1.2 vodorovne sa vráti v `get_viewer_state` ako 1.2. Proti
skutočnému Supabase Realtime a v claude.ai overené ešte nie je.

### D-087 - Pravidlo pre nové nástroje: najprv originál, adaptér v `aim/`, vlastné len tam, kde originál nič nemá
**Status:** rozhodnuté (2026-10-18, Samuel). **Rozširuje D-071, D-083, D-084.** (D-086 je
rezervované pre zápis, D-084.)

**Kontext:** obava, že namiesto nástrojov, ktoré už niekto odskúšal, začneme písať vlastné a pri
synchronizácii forku s originálom budú kolízie. Kolízie pri synchronizácii vznikajú len v
upstream súboroch označených `AIM-FORK` (`ifc-lite/docs/FORK_MAINTENANCE.md`), nie v nových
nástrojoch: tools motora sú v AIMviewer nad npm balíkom a most pohľadu je v
`apps/viewer/src/aim/`, kde originál nemá žiadny súbor.

**Rozhodnutie (poradie, v ktorom sa nový nástroj hľadá):**
1. **Najprv originál.** Ak tool v `@ifc-lite/mcp` existuje a funguje na serveri, preberie sa
   takmer 1:1: názov s prefixom `ifc_`, rovnaký opis a parametre, žiadna vlastná logika; jediný
   doplnok je prepojenie GUIDov na AIM. Opis a schému stráži test proti registru balíka
   (`lib/engine/passthrough.test.ts`), takže zmena pri povýšení verzie padne v teste.
2. **Pohľad vo vieweri len ako tenký adaptér v `apps/viewer/src/aim/`** nad funkciami viewera
   originálu (store, renderer, SDK). Do upstream súborov forku nič nové; keď sa to nedá,
   rozhodnutie sa zapíše (sentinel `AIM-FORK` a riadok vo `FORK_MAINTENANCE.md`).
3. **Vlastný nástroj len tam, kde originál nič nemá**, a s parametrami v štýle originálu
   (napr. `axis` / `position` + nový `target`). Takú vec možno ponúknuť originálu ako PR;
   keď ju prijme, náš kód sa zmaže.
4. **Neduplikovať DB tools:** tool balíka, ktorý odpovedá na to isté ako tool nad grafom AIM
   (napr. `spatial_hierarchy` vs. `get_spatial_path`), sa nepreberá, lebo by dal dve odpovede na
   tú istú otázku.

**Prvé uplatnenie (2026-10-18):** prevzaté 1:1 `ifc_model_info`, `ifc_materials_list`,
`ifc_classifications_list`, `ifc_model_audit`, `ifc_geometry_area`, `ifc_geometry_volume`,
`ifc_schema_describe` (len čítanie, jeden model, bez súborov a siete; naživo nad ASR a VZT 0,3 až
1,4 s). Vlastné podľa bodu 3: `get_bounds`, `get_viewer_state` a rez cez prvok (D-085), lebo
originál polohu prvkov ani rez cez prvok nemá. Zatiaľ neprevzaté: `clash_check` (pamäť na
Verceli, kolízie ASR x VZT potrebujú zlúčenie modelov, fáza 4), `geometry_bbox` (Qto, nie
poloha), `spatial_hierarchy` a `containment_chain` (bod 4), `ids_*` okrem validácie (zdroj IDS
je otvorený, D-084), exporty (úložisko pre súbory), zápis (D-086), BCF a toky (stav medzi
volaniami), `bsdd_*` (externé API).

**Dodatok D-087 (2026-10-18) - nová funkcia viewera nemá stáť na CI forku.** Prvý fork PR
podľa tohto pravidla (Menezeris/ifc-lite#58) stál hodiny na kontrole veľkosti vstupného
balíka viewera (perf ratchet `viewer-entry-js-bytes`, tolerancia 0,1 %): `main` forku bol
už 2 365 B nad stropom a funkcia aj po lenivom načítaní potrebuje +968 B.
- **Rozhodnutie (Samuel):** strop zvýšený na 3 151 632 B a odteraz je zvýšenie
  **predschválené**, keď je kód v `apps/viewer/src/aim/`, je najprv lenivý (dynamický
  `import()`, lenivý modul neimportuje nič, čo importuje vstup) a zvýšenie je najviac 2 kB
  vstupu a 10 kB eager JS nad `main`, ako vlastný commit s nameranými číslami
  (`ifc-lite/docs/FORK_MAINTENANCE.md`, "Pre-approved raises for new AIM features").
  Väčšie zvýšenie sa pýta.
- **Postup:** skill `ifc-lite/.claude/skills/aim-feature/SKILL.md` - čo spustiť pred prvým
  pushom (typy, testy, kontroly forku, meranie balíka voči `main` rovnakým skriptom ako CI,
  mutačné dôkazy a štítok `revert-oracle-exempt` už pri otvorení PR, živé overenie vo
  vloženom vieweri) a čo počas CI nerobiť (neupravovať PR, `edited` prehrá starý verdikt).
  Cieľ: CI forku zelené na prvý beh.

---

### D-086 - Úpravy IFC modelu cez agentov: revízie, úlohy z chatu, GitHub Actions (F13)
**Status:** rozhodnuté (2026-10-18), fáza 0 overená. **Mení D-084 bod 4** (zápis nejde cez
motor `@ifc-lite/mcp` v MCP route, ale cez ifcopenshell v GitHub Actions) a **dodatok D-084
z 2026-10-18** (zverejnenie revízie zatiaľ nestojí na IDS bráne). Uzatvára otvorené otázky
D-084 "upravené IFC ako autoritatívna revízia vs. change set" a "workflow pre re-ETL".

**Kontext:** ASR sa doteraz upravoval v claude.ai projekte "úprava IFC" skriptami ifcopenshell
nad exportom z Revitu (hlavička v71: `IfcOpenShell 0.9.0.post1 (post-processing Assetin, v29
až v71)`); výsledok sa odovzdával ako BCF a súbor sa nahrával ručne. V buckete je stále
`ASR.ifc` z 11. 7. (20,1 MB), prod DB nesie pôvodný model a F2/E6 čakajú na opravený model.
Cieľ (Samuel, 18. 10.): v Claude (konektor AIM) napíšem alebo vo vieweri označím, čo zmeniť;
úloha sa spracuje na pozadí, viac úloh naraz, zmena sa hneď prejaví vo vieweri a staré
verzie ostanú zálohované. Bez novej služby a na free plánoch, ktoré už máme.

**Rozhodnutie (Samuel, 18. 10.):**
1. **IFC je master.** ASR (od v71) a VZT sú autoritatívne súbory; Revit sa neprehráva.
   Recepty slúžia na audit a na prepočet úlohy nad novšou revíziou, nie na prehrávanie nad
   exportom.
2. **Pracovisko agenta = repo `Menezeris/OCB`** (dáta jednej stavby oddelene od kódu appky):
   `CLAUDE.md` pre agenta, kontext z Claude projektu, skripty v29-v71, referencia IFC4X3_ADD2
   (schéma z ifcopenshell + odkaz na dokumentáciu buildingSMART), český preklad IFC z ardit.cz
   (snímka webu), recepty `recepty/<model>/vNNN-*.py`, zoznamy zmien `zmeny/<model>/vNNN.json`
   a workflow. IFC súbory v gite nie sú.
3. **Úloha beží v GitHub Actions OCB:** Claude Code s `CLAUDE_CODE_OAUTH_TOKEN` (Max
   predplatné) + ifcopenshell; jedna úloha = jeden beh (`workflow_dispatch` s `task_id`).
   Výstup úlohy je **recept** (deterministický skript nad `ifcopenshell.api`) + **zoznam zmien**
   (GUID, čo, pred, po), nie len upravený súbor.
4. **Pripravuje sa paralelne, zapisuje sa po jednom.** Zápis revízie je compare-and-swap v DB
   (aktuálna revízia == základ úlohy). Ak medzitým vznikla novšia revízia, recept sa spustí
   znova nad ňou; ak na nej zlyhá, Claude ho v tom istom behu prispôsobí (obmedzený počet
   pokusov), inak úloha skončí stavom "konflikt". GitHub `concurrency` sa na frontu
   nepoužije: drží jeden čakajúci beh a ďalšie čakajúce ruší.
5. **Revízie:** nemenné skomprimované kópie `ifc/archive/<model>/vNNN.ifc.gz` + tabuľka
   `model_revisions` (model, číslo, rodič, sha256, veľkosť, úloha, commit receptu v OCB,
   autor, čas). Aktuálna revízia sa nahrá aj na doterajší kľúč `ifc/<model>.ifc`, takže
   viewer, motor (cache URL + ETag, D-084) a ETL čítajú ako doteraz; URL modelu vo vieweri
   dostane `?rev=` kvôli cache prehliadača. **Návrat** = nová revízia s obsahom staršej
   (história sa neprepisuje). Free Supabase stačí: limit 50 MB na súbor, ASR v71 má 24 MB
   (gzip 4,5 MB), bucket je obsadený na 45 MB z 1 GB, revízia ASR + VZT ~6-7 MB.
6. **Zverejnenie hneď, bez IDS brány** (Samuel). Pred zverejnením len **technická poistka**:
   súbor sa otvorí v ifcopenshell, schéma ostáva IFC4X3_ADD2, žiadny GlobalId `IfcRoot` sa
   nestratil ani nezdvojil okrem tých, ktoré zoznam zmien deklaruje, a počty entít podľa
   triedy sa zmenili len tam, kde to zoznam zmien hovorí. Neprejde -> nič sa nezverejní a
   úloha vráti dôvod. Beh IDS (D-081) môže po zverejnení bežať ako záznam, nie ako brána.
7. **Po zverejnení v tom istom behu:** re-ETL z checkoutu AIMviewer `main` (verejné repo)
   - `etl.main` pre ASR, `--federate` pre VZT, `etl.derive spatial_reference` - nikdy
   `--reset`; cache AIM sa obnoví do 60 s (ISR, D-030); broadcast "nová revízia" na
   `LIVE_CHANNEL` (D-079) a viewer s `?live=` model načíta znova.
8. **Vstup úlohy:** text z chatu + voliteľne výber z viewera (GUID, neskôr pohľad). Úloha sa
   ukladá v tvare **BCF témy** (`model_tasks`: názov, popis, komponenty GUID, viewpoint, stav,
   základná a výsledná revízia, komentáre), aby sa v ďalšej fáze dala zakladať aj z BCF
   panela forku (`packages/bcf-api`, BCF API 2.1, Bearer token) cez malý BCF API server
   v AIMvieweri. BCF je vstup a záznam, nie nosič zmeny.
9. **MCP:** tools `model_change_request` (založí úlohu a spustí workflow v OCB) a
   `model_change_status`, anotácia `readOnlyHint:false`, vystavené len pod samostatným tokenom
   zápisu (`MCP_WRITE_TOKEN`, druhý konektor v claude.ai), ako predpokladal D-084. Vercel
   dostane fine-grained GitHub token s právom Actions: write len na OCB.

**Fáza 0 - overené 2026-10-18:**
- **Token z predplatného v Actions OCB** (run `39136236745`): Claude Code 2.1.302 odpovedal
  za 3 s; bez `--model` beží Sonnet 5.5. Výstup uvádza cenníkovú cenu 0,02 USD
  (`costBasis: list`); či beh čerpá limity predplatného alebo mesačné API kredity Max (100 USD),
  sa overí na spotrebe po prvých úlohách.
- **Runner:** 2 vCPU, 7 GB RAM. ifcopenshell 0.9.0 nad ASR z bucketu (21 MB): otvorenie 0,5 s,
  zápis 3,0 s, 186 MB; celý beh 25 s. Lokálne nad v71 (24 MB): otvorenie 0,7 s, zápis 1,6 s,
  265 MB (~11-násobok súboru, pri 250 MB modeli by to bolo ~2,7 GB, stále pod limitom runnera).
- **ETL `--dry-run` nad v71** prejde za 7 s: 985 objektov, 1795 hrán, 737 prvkov, platný SNIM
  87,5 % prvkov so SNIM dátami. Report hlási kódy TSP mimo `scheme.py` (WC 46, VP 12, SC 3) a
  kódy na nečakaných triedach (napr. `ST@IfcCovering` 92) - nie chyba, prejsť pred prvým loadom.
- **Supabase** je na free pláne: `fileSizeLimit` 52428800 (Management API), obsadené 45 MB.
- **Vercel** funkcia má 2 GB (Hobby) / 4 GB (Pro); motor `ifc_*` nad modelom > ~100 MB by
  musel ísť mimo route (záloha D-084). Pri OCB to netreba.

**Vedomé limity a riziká:**
- **ETL je len upsert:** prvok, ktorý úprava zmaže, ostane v DB. Pred prvou úlohou, ktorá maže,
  treba v ETL uzavrieť zánik (`valid_until` na GUID histórii a hranách prvkov, ktoré v zdroji
  chýbajú; riadok `objects` ostáva, D-010). Fáza 1.
- **Prvá revízia = prvý load v71 na prod** (bucket aj DB nesú pôvodný model).
- **Repo OCB je súkromné** (oprava 2026-10-18: pôvodný záznam ho mylne označil za verejné;
  anonymné volanie API prešlo cez proxy prostredia, `private: true`). Minúty Actions sa počítajú do limitu.
- **Prenos zo Supabase** na free pláne 5 GB/mesiac, jedno otvorenie viewera ASR + VZT ~34 MB.
- **Neoverené:** limit súbežných behov predplatného, platnosť tokenu, `workflow_dispatch` z Vercelu.
- **Bez IDS brány** chybnú obsahovú zmenu zachytí až človek; ochrana = revízie a návrat.

**Zavrhnuté:**
- *Zápis cez `@ifc-lite/mcp` v MCP route (D-084 bod 4):* `entity_set_attribute` vie len
  Name/Description/ObjectType/Tag, klasifikáciu, PredefinedType, IfcZone ani geometriu nie;
  doterajších 40+ úprav modelu je v ifcopenshell.
- *Úpravu robí priamo chat cez MCP tools:* bez paralelizmu a Vercel funkcia nemá Python ani
  ifcopenshell.
- *Claude API / Managed Agents na serveri:* nová služba a platba za tokeny.
- *Claude Code cloud sessions:* z MCP servera sa automaticky nespúšťajú.
- *IFC v gite (LFS):* limit 100 MB na súbor a kvóta LFS; bucket už máme.
- *Supabase Pro alebo Cloudflare R2 teraz:* OCB je ďaleko pod 50 MB; prehodnotiť, keď
  skomprimovaná revízia prekročí ~40 MB.
- *BCF ako nosič zmeny:* opisuje "čo a kde", zmenu vykonať nevie.
- *Prepisovaný `ASR.ifc` bez archívu:* nedá sa vrátiť.

**Fázy (F13):**
- **0** ✅ token a ifcopenshell na runneri OCB.
- **1 Revízie a záloha (AIMviewer):** migrácia `model_revisions` + `model_tasks`;
  `etl/model_publish.py` (technická poistka, archív gz, compare-and-swap, nahranie na
  aktuálny kľúč, broadcast); zánik prvkov v ETL; `?rev=` v `getIfcModels`; v71 a súčasný
  VZT ako prvé revízie a load v71 na prod.
- **2 Pracovisko agenta (OCB):** `CLAUDE.md`, kontext, schéma, preklad, skripty v29-v71,
  workflow `uloha.yml`; jedna ručne zadaná úloha od textu po revíziu vo vieweri.
- **3 Úlohy z chatu:** MCP tools zápisu pod `MCP_WRITE_TOKEN`, GitHub token na Verceli, stav
  úlohy, viewer znova načíta model po správe "nová revízia" (bridge forku).
- **4 BCF:** BCF API server nad `model_tasks`, úlohy z BCF panela forku, BCF export k revízii.
- **Neskôr:** IDS brána (dodatok D-084), porovnanie revízií (`@ifc-lite/diff`, D-083 fáza 4).

**Otvorené otázky:**
- **Q1** odkaz na český preklad IFC na ardit.cz;
- **Q2** export Claude projektu "úprava IFC" (inštrukcie, znalosti, skripty alebo popis v29-v71);
- **Q3** je VZT v buckete aktuálny?
- **Q4** ~~OCB verejné alebo súkromné~~ uzavreté: súkromné;
- **Q5** predvolená vetva OCB (dnes `claude/epic-tesla-06p2q4`, lebo repo bolo prázdne);
- **Q6** model pre úlohy (Sonnet 5.5 predvolený vs. Opus 5.5);
- **Q7** číslovanie revízií: ASR pokračuje v72, VZT začína v1?

**Závislosti a licencie:** bez novej závislosti v AIMvieweri (ifcopenshell LGPL-3.0 už v ETL).
V OCB: ifcopenshell (LGPL-3.0), Claude Code CLI (`@anthropic-ai/claude-code`, licencia
Anthropic, nástroj v CI, nie súčasť distribuovaného kódu). Žiadna AGPL.

**Dodatok D-086 (2026-10-18) - fáza 1 implementovaná na vetve `claude/epic-tesla-06p2q4`.**
- **Kód:** migrácia `20261018120000_model_revisions.sql` (`model_revisions`, `model_tasks`);
  `etl/model_publish.py` (`publish` s poistkou a compare-and-swap pod advisory lockom,
  `revert`, `sync`, `status`, `announce`, `close-legacy`); `etl.main --model`;
  `getCurrentIfcModels` pridá `?rev=` k URL modelu (bez tabuľky ostane URL bez zmeny);
  živý kanál počúva udalosť `model_revision` a zavolá `router.refresh()` (iframe dostane
  nový `src`, fork netreba meniť).
- **Oznámenie až po re-ETL:** `publish` neoznamuje, `announce` sa volá po `etl.main` a
  `etl.derive`. Inak by viewer načítal nový model skôr, než DB pozná nové GUID. GUID mapa
  má cache 60 s (D-030), takže úplne nové prvky môžu mať AIM kartu až po nej.
- **Zistenie 1 - ETL model v71 nenačíta.** Hrany `has_document` idú aj z entít, ktoré ETL
  neemituje (IfcSpatialZone 93, IfcProject 44, IfcZone 15, IfcGroup 8), a
  `_resolve_cross_file_refs` zhodí celý load. Oprava: väzby dokumentov a aktorov len na
  emitované objekty, vynechané sa vypíšu podľa triedy (vzor systémov D-047). Zóny a skupiny
  ako objekty AIM sú samostatné rozhodnutie (Q9).
- **Zistenie 2 - upsert nechá zastarané hrany.** Nad kópiou prod DB (ASR z 30. 6. + VZT,
  lokálny Postgres 16, rovnaké počty ako prod: 4251 hrán, 2024 GUID) padol load v71 aj na
  `uniq_active_aggregate` (priestor dostal nového rodiča). Po oprave rotácie rodiča by
  starý postup nechal 5836 aktívnych hrán, 2616 aktívnych GUID a **454 GUID aktívnych na
  dvoch objektoch**. Oprava: zdroj podľa modelu (`etl:ASR`, `IFC import:ASR`), uzavretie
  toho, čo beh nevydal (vzor `etl.derive`, D-080), nový rodič uzavrie starého pred insertom
  (vzor rotácie GUID, D-010) a jednorazové `close-legacy`. Výsledok: 4436 hrán, 2067 GUID,
  0 duplicitných GUID, 83 aktívnych priestorov = 83 `IfcSpace` v súbore.
- **Zistenie 3 - 549 objektov bez aktívneho GUID** (zmazané alebo premenované object_ref)
  po prechode ostane v `objects`, lebo `objects` nemá platnosť (D-010). Hrany ani GUID už
  nemajú, ale dotazy priamo nad `objects` (napr. počty podľa triedy) ich uvidia. Q8.
- **Zistenie 4 - najnovší ASR je v72**, nie v71 (balík `pipeline/` od Samuela:
  `v72_bcf_fixes.py`, README: "nové kroky stavaj na ASR_v72"). Balík nesie aj kontrolu
  `run_checks.py` (`ifcopenshell.validate --rules`, kontroly priestorov, zón, LOP, psetov,
  audit) a `tools/ardit.py` s cache `ifc.ardit.cz` (český preklad, Q1) - vstup fázy 2.
- **Poistka nad skutočnými súbormi:** v71 voči ASR z 30. 6. za 1,3 s; bez zoznamu zmien hlási
  243 pribudnutých a 366 zmiznutých objektov (preto prvá revízia ide s `--bootstrap`).
- **Overené:** pytest ETL 34/34 (vrátane zápisu revízií proti Postgresu: bootstrap, zmena,
  konflikt, neprejdená poistka nič nezapíše, návrat, úloha `resolved`), vitest 91/91, `tsc`,
  eslint; naživo dočasná stránka s `LiveChannel` + skutočný Supabase Realtime (testovací
  kanál): neplatná správa nič neurobí, platná obnoví stránku zo servera a ukáže
  "Nová revízia ASR v073: …". Nahrávanie do bucketu a `announce` z Pythonu naživo neoverené
  (v prostredí nie je service role kľúč); `next build` nespustený.
- **Nenasadené:** migrácia nie je na prode, revízie nie sú založené, prod DB nesie stále
  model z 30. 6. Prvé revízie (návrh k Q7): ASR v0 = súčasný `ASR.ifc` (export 30. 6., záloha),
  ASR v72 s `--bootstrap`, VZT v1 = súčasný `VZT.ifc`; potom load oboch s `--model`,
  `close-legacy`, `etl.derive`, `announce`.
- **Nové otázky:** **Q8** zaniknuté objekty: (A) `objects.valid_until` + filter vo views,
  RPC a dátovej vrstve, (B) nechať, kým to nevadí, (C) mazať (proti D-010); **Q9** zóny
  (IfcZone, IfcSpatialZone) a skupiny (IfcGroup) ako objekty AIM; **Q10** balík `pipeline/`
  obsahuje výťahy textov projektovej dokumentácie (`ext/`) - pri verejnom OCB budú verejné.


**Dodatok D-086 (2026-10-18) - odpovede Samuela:** Q2 balík `pipeline/` (skripty v29-v72,
kontroly, `tools/ardit.py` s cache `ifc.ardit.cz` = Q1); Q4 a Q10 OCB je súkromné; Q7 číslovanie
podľa návrhu (ASR v0 = export 30. 6., ASR v72, VZT v1); Q8 a Q9 riešené v D-088. Najnovší súbor
ASR v72 dodaný (hlavička "post-processing Assetin, v29 až v72").

---

### D-088 - Platnosť objektov a projekt, zóny, skupiny ako uzly AIM
**Status:** rozhodnuté (2026-10-18, Samuel: Q8 "objekty tam fakt nebudú, platnosť, že sú zmazané,
vôbec sa s nimi nezapodievať"; Q9 "áno, IfcProject, IfcSite, zóny, IfcSpatialZone, IfcGroup").
Implementované na vetve `claude/epic-tesla-06p2q4`, nenasadené. **Rozširuje D-010, D-018, D-047,
D-051, D-086.** Pôvodne očíslované D-087 (kolízia s D-087 "pravidlo pre nové nástroje" z PR #55, ktorý sa zmergoval skôr); migrácia `20261018130000`, `comment on column objects.valid_until` a popisy v `relationship_types` na prode ostávajú s pôvodným číslom D-087 a znamenajú tento záznam.

**Kontext:** prechod prod DB z exportu 30. 6. na ASR v72 (D-086) nechá 549 objektov, ktoré už
žiadny model nevydáva (zmazané prvky, zmenené object_ref, 26 typov z v62). `objects` platnosť
nemá, takže by ich videli počty, fulltext aj agregácie AI. Model zároveň od v29 nesie IfcProject,
IfcZone (18), IfcSpatialZone (46) a IfcGroup (23) s dokumentmi; ETL ich neemitoval a väzby na
dokumenty z nich (160) vypadávali.

**Rozhodnutie:**
1. **`objects.valid_until`** (migrácia `20261018130000`): objekt, ktorý mal GUID zo zdroja modelu
   a už nemá žiadny aktívny GUID, dostane `valid_until = now()` (`etl.main --model`,
   `model_publish close-legacy`). Riadok ostáva (Master UUID, D-010); keď sa objekt do modelu
   vráti, upsert mu platnosť zruší.
2. **Zaniknuté objekty appka ani AI nevidia:** views `v_actors`, `v_asset_classifications`,
   `v_asset_effective`, `v_floors`, `v_property_dictionary`, `v_spaces` a RPC `search_everything`,
   `aggregate_objects`, `search_documents` filtrujú `valid_until is null` (definície prevzaté z
   predošlých migrácií, na prode zhodné okrem komentárov); v TS zoznamy a vyhľadávanie
   (`applyObjectFilters` v nástrojoch AI, `getObject`/`resolveObject`, štatistiky modelu, sidebar,
   strom, výkresy podlaží, filter podľa triedy, dokumenty, `aim-lookup`). Hrany a GUID zaniknutého
   objektu sú uzavreté, takže dotazy cez väzby ho nedosiahnu. Pravidlo pre nový kód je v AGENTS.
3. **Nové `object_type`** (aditívne, D-018/D-051): `project` (IfcProject), `zone` (IfcZone),
   `spatial_zone` (IfcSpatialZone), `group` (čistá IfcGroup, podtypy majú vlastný typ). Emituje
   ich len hlavný model (VZT má vlastný IfcProject toho istého projektu, zóny nemá). IfcSite sa
   emitoval už predtým, teraz visí pod projektom.
4. **Väzby zo súboru** (IFC-first, D-046): `rel_aggregates` site → projekt, časť priestorovej
   zóny → zóna, podskupina → skupina; `rel_contained_in_spatial_structure` priestorová zóna →
   podlažie; `rel_referenced_in_spatial_structure` zo súboru (priestor v priestorovej zóne, zóna
   a prvok na podlaží, dvere a stĺpy v priestore); `rel_assigns_to_group` člen → zóna / skupina
   (priestor, zóna, priestorová zóna, prvok). Manifest (`etl/manifest.py`) a `relationship_types`
   povoľujú nové typy na koncoch hrán.
5. **UI:** štítky typov (`Projekt`, `Zóna`, `Priestorová zóna`, `Skupina`, druhy priestorovej zóny
   `požiarny úsek` / `energetická zóna`); stránka uzla použije zovšeobecnený detail systému
   (členovia, časti a prvky v zóne podľa IFC triedy). Strom priestorov sa nemení (hrany mimo
   priestorových typov sa do neho nedostanú, site ostáva koreňom). Prompt AI pozná nové typy.

**Overené 2026-10-18 (lokálny Postgres 16, kópia prod DB: ASR z 30. 6. + VZT, obe migrácie):**
- load ASR v72 `--model ASR`, VZT `--model VZT --federate`, `close-legacy`, `etl.derive
  spatial_reference` bez chyby (3,5 min, z toho väčšinu derive);
- platné objekty 2207: asset 1758, asset_type 206, space 83, document 52, spatial_zone 46,
  group 23, zone 18, system 13, floor 5, project 1, site 1, building 1; zaniknuté 549 (asset 471,
  space 50, asset_type 26, site 1, building 1); 0 GUID na dvoch objektoch; 0 aktívnych hrán na
  zaniknutý objekt; `v_spaces` 83; `aggregate_objects` 2207; fulltext zaniknuté nevracia;
- opakovaný beh nič neuzavrie; zmazaná stena (SN07.04.0005) uzavrie 3 hrany, 1 GUID a 1 objekt,
  po návrate ožije;
- všetkých 163 väzieb na dokumenty ostáva;
- `etl.derive` teraz zapíše aj prvky v priestorových zónach (979 inside + 122 partial), lebo
  IfcSpatialZone je v jeho predvolených triedach od D-080 a zóny už sú v DB; prvky v
  priestoroch 435 + 148 (prod dnes 376 z pôvodného modelu);
- pytest ETL 36/36, vitest 91/91, `tsc`, eslint. Evaly `/ask` nespustené (prompt sa zmenil o
  nové typy; bez kľúča a DB v prostredí). UI nových typov naživo neoverené (stránka uzla číta DB).

**Zavrhnuté:**
- *Mazať zaniknuté objekty:* stratí sa história (GUID, hrany) a väzby fotiek a dokumentov,
  proti D-010.
- *Premenovať `objects` na tabuľku a `objects` spraviť view s filtrom:* všetky dotazy by sa
  filtrovali samé, ale PostgREST embedding, zápisy cez view a FK by sa museli overiť naprieč
  appkou bez DB v prostredí; riziko väčšie ako prínos.
- *Zóny ako `aim_*` hrany alebo properties:* IFC ich má ako objekty (IfcGroup, IfcSpatialElement),
  takže sú uzly (IFC-first).

**Poradie nasadenia:** migrácie `20261018120000` a `20261018130000` pred prvým behom nového ETL
(upsert zapisuje `valid_until`).

**Dodatok D-088 (2026-10-18) - nasadenie na prod.**
- **Migrácie** `20261018120000` a `20261018130000` nasadené cez Management API (história
  `supabase_migrations` zosúladená). Funkcia `search_everything` sa bez superusera dala vytvoriť
  až po načítaní pg_trgm v tej istej transakcii (`select word_similarity('a', 'a')`); je to
  v migrácii, takže prejde aj `supabase db push`.
- **Secrets v OCB** overené workflowom `kontrola-secrets` (storage, REST, DB cez Session pooler,
  advisory lock, Realtime).
- **Workflow `bootstrap-revizie`** (OCB, beh `39146709453`): revízie ASR v0, VZT v1, ASR v72;
  re-ETL oboch modelov so zdrojom modelu 35 min (zápis po riadkoch z runnera v USA do DB vo
  Švédsku; kandidát na dávkový zápis), derive 7,5 min, oznámenie oboch revízií.
- **Prod po bootstrape:** platných objektov 2226 (asset 1758, asset_type 206, space 83, document
  65, spatial_zone 46, group 23, zone 18, system 13, floor 5, capture 3, capture_media 3,
  project 1, site 1, building 1), zaniknutých 549, 0 GUID na dvoch objektoch, 163 väzieb na
  dokumenty z IFC, 24 požiarnych úsekov, `v_spaces` 83.
- **Nález: 264 aktívnych hrán na zaniknuté objekty** (lokálna kópia ich nemala, chýbali v nej
  odvodené a ručné väzby): (a) 242 hrán derive - id hrany je z GUID, upsert však neprepísal
  `from_id`/`to_id`, takže hrana ostala na premenovanom priestore; (b) 20 ručných väzieb na
  objekty, ktoré sa len premenovali (rovnaký GUID): 9 výkresových väzieb na dvere
  (`DD03.04.09` -> `DD03.05.09`), 2 na typy, 9 dokumentov E3 na budovu; (c) 2 fotky v
  priestoroch `2.01-2` a `2.27`, ktoré v v72 nemajú nástupcu.
- **Oprava** (commit `2b4a7d6`): derive pri upserte prepíše `from_id`/`to_id`; `close_stale` a
  `close_legacy` presunú ručné väzby (zdroje mimo `etl*` a `derive:*`) na platný objekt s
  rovnakým GUID. Overené na kópii prod DB s odvodenými hranami z júla: 0 hrán na zaniknuté
  objekty. Na prode: workflow `odvodenie` (beh `39150583359`) uzavrel 242 hrán z (a); presun
  ručných väzieb (b) so Samuelovým súhlasom cez Management API: 11 výkresových, 9 dokumentov
  a 1 fotka (`2.27` má nástupcu s rovnakým GUID). Fotku v priestore `2.01-2` (vo v72 bez
  nástupcu) Samuel zatiaľ odstránil: capture `a2608cf3…` a jeho médium dostali `valid_until`,
  ich 2 väzby sú uzavreté, súbory v úložisku ostávajú (vratné). Zoznam fotiek
  (`fetchAllCapturePointsImpl`) preto filtruje `valid_until is null`. Na prode 0 aktívnych hrán
  na zaniknuté objekty.


**Dodatok D-088 (2026-10-18) - overenie na produkcii a otvorené body.**
- Po merge PR #56: konektor AIM vracia 83 priestorov (pred merge 133 vrátane zaniknutých), 2224
  objektov, 24 požiarnych úsekov; `DD03.04.09` neexistuje, `DD03.05.09` áno. Stránka uzla N2.04
  ukazuje "Priestorová zóna", druh "požiarny úsek" a 35 prvkov. Workflow `odvodenie` (OCB)
  zavolal `announce` a otvorený viewer s `?live=aim-viewer` sa sám obnovil s hlásením o revízii
  (Samuel potvrdil).
- **Odvodenia do zón neboli schválené:** `etl.derive` má IfcSpatialZone v predvolených triedach od
  D-080 a s D-088 začal priraďovať prvky aj do požiarnych úsekov a energetických zón. Samuel
  (18. 10.): vzťahy majú byť IFC vzťahmi nad súbormi modelov, zobrazené vo vieweri ako ďalšia
  vrstva vedľa modelov (záložka spracovaní) a v Relationship records s odznakom AIM; vrstva
  prežije zmeny súborov, export spolu so súbormi neskôr cez ICDD (D-015); vzťah v rámci jedného
  súboru sa zapíše do súboru (revízia D-086), medzi súbormi ostáva vo vrstve. Pravidlá odvodení
  (ktoré, medzi čím, kedy) sú samostatné rozhodnutie pred ďalšou prácou na vieweri.
- Drobnosti: panel AIM vo vieweri ukazuje pri zóne odznak "Prvok"; LongName priestorových zón
  sa neukladá ("Požiarny úsek - Technická miestnosť 2NP"), preto ich fulltext nenájde; VZT
  prvky bez SNIM kódu sa zobrazujú ako GUID namiesto názvu.


---

### D-089 - Register pravidiel odvodení a vrstva AIM nad modelmi
**Status:** rozhodnuté (2026-10-18, Samuel), fáza A implementovaná na vetve
`claude/epic-tesla-06p2q4`. **Rozširuje D-080, D-086, D-088.**

**Kontext:** odvodzovač `etl.derive` (D-080) beží len preto, že je krokom workflowov v OCB; nedá
sa vypnúť, nikde nevidno, čo a kedy prepočítal, a s D-088 začal priraďovať prvky aj do
IfcSpatialZone bez výslovného rozhodnutia. Samuel (18. 10.): odvodené vzťahy majú byť IFC vzťahmi
nad súbormi modelov, vrstva musí prežiť zmeny súborov (drží sa GUID), vo vieweri má byť ďalšou
vrstvou vedľa modelov a v Relationship records s odznakom AIM; vzťah v rámci jedného súboru sa
zapíše do súboru, medzi súbormi ostáva vo vrstve; zóny aj priestorové zóny áno; odvodenia majú
byť pod kontrolou (zapnúť, vypnúť, vidieť behy).

**Tri druhy vzťahov v AIM:** *zo súboru* (IFC, projektant alebo pipeline), *ručný* (človek v AIM:
fotka, výkres), *odvodený* (pravidlo nad dátami; ručne sa needituje, mení sa prepočtom).

**Rozhodnutie:**
1. **Register pravidiel ako dáta** - tabuľka `derivation_rules`: id, názov, popis, druh
   (`geometry` | `via_space`), IFC vzťah, zdrojové a cieľové triedy, roly (`inside`, `partial`),
   **zapnuté**, **režim** (`auto` = po každej novej revízii, `manual` = len na vyžiadanie) a zdroj
   hrán (`source`), pod ktorým pravidlo zapisuje.
2. **Záznam každého behu** - `derivation_runs` (pravidlo, revízie modelov, zapísané, uzavreté,
   GUID mimo DB, stav, spúšťač), vzor `ids_runs` (D-081).
3. **Vypnutie pravidla** jeho hrany uzavrie (história ostáva), **zapnutie** ich prepočíta.
   Ovládanie zatiaľ cez CLI a workflow `odvodenie` v OCB (vstupy), neskôr zo záložky vo vieweri.
4. **Pravidlá na štarte:**
   - `element_in_space` - prvok (IfcDistributionElement, IfcFurnishingElement) -> IfcSpace podľa
     geometrie, `rel_referenced_in_spatial_structure`, inside + partial, zdroj
     `derive:spatial_reference` (doterajšie hrany D-080 ostávajú);
   - `element_in_spatial_zone` - to isté -> IfcSpatialZone (požiarne úseky, energetické zóny),
     zdroj `derive:element_in_spatial_zone`; partial = prestupy cez hranicu úseku;
   - `element_in_zone` - prvok -> IfcZone **cez priestory** (prvok v priestore, priestor člen
     zóny, aj vnorené zóny). IfcZone nemá teleso a sdružuje len priestory (IFC4.3, ardit.cz:
     "zóna sdružuje prostory, systémy sdružují prvky"), takže IFC na "prvok v IfcZone" vzťah
     nemá: pravidlo nezapisuje hranu, je to pohľad `v_zone_elements`, ktorý platí, len keď je
     pravidlo zapnuté.
   Všetky zapnuté, režim `auto`.
5. **Geometria sa počíta raz** pre všetky zapnuté geometrické pravidlá (jeden BVH strom) a hrany
   sa rozdelia podľa cieľovej triedy; každé pravidlo zapisuje pod vlastným zdrojom, takže sa dá
   vypnúť samostatne.
6. **Vrstva AIM nad modelmi** (fáza B): viewer dostane odvodené vzťahy k GUID ako vrstvu (vzor
   AIM panel D-077, podklady D-072); fork ukáže záložku spracovaní vedľa Models (pravidlá, stav,
   posledný beh) a v Relationship records záznamy s odznakom AIM a zdrojom namiesto čísla
   entity. Export vrstvy spolu so súbormi neskôr cez ICDD (D-015).
7. **Povýšenie do súboru** (fáza D): odvodený vzťah v rámci jedného modelu môže agent na
   schválenie zapísať do súboru ako novú revíziu (D-086); odvodzovač ho potom preskočí, lebo ho
   nesie súbor. Vzťahy medzi súbormi (IFC4 ich neunesie) ostávajú vo vrstve.

**Fázy:** **A** register, behy, CLI `etl.derive run|rules|enable|disable`, `v_zone_elements`,
workflowy v OCB · **B** vrstva vo vieweri (fork: záložka, odznak AIM) · **C** AI: `v_zone_elements`
v `query_view` a prompt (evaly) · **D** povýšenie do súboru cez agenta.

**Zavrhnuté:**
- *Prvok ako člen IfcZone cez `rel_assigns_to_group`:* proti IFC (zóna sdružuje priestory).
- *`aim_` hrana pre prvok v IfcZone:* informácia sa dá vždy presne vypočítať z priestorov; uložená
  kópia by zastarávala (princíp jedného nositeľa).
- *Prepínače v env alebo kóde workflowu:* nevidno ich vo vieweri ani v DB a nemajú históriu behov.

**Dodatok (fáza B, strana AIMviewera):** UI v rozhraní forku je striktne oddelené od upstreamu:
vlastná záložka ribbonu "Documents" sa premenuje na **AIM** so skupinami *Documents* a
*Derivations* (oko "AIM vzťahy", Pravidlá, Prepočítať), ľavý panel dostane sekciu **AIM VRSTVY**
pod MODELS (pravidlo: oko, počet, režim, posledný beh; čísla revízií pri modeloch) a pravý panel
záznamy s odznakom AIM, zdrojom a rolou v Relationship records. Oko je len lokálne zobrazenie;
zapnúť/vypnúť/prepočítať je zmena dát s potvrdením, zatiaľ cez workflow `odvodenie` v OCB
(`manageUrl`), zápis z viewera až vo fáze 3 (D-086). Most (`lib/derivations.ts`):
- host -> viewer `AIM_DERIVATIONS_LOAD { layer }` po `MODELS_LOADED` a pri zmene: pravidlá so
  stavom (`count` aktívnych hrán alebo riadkov `v_zone_elements`, `lastRun`), aktuálne revízie
  modelov, `manageUrl`; bez migrácie `20261018140000` sa neposiela nič;
- `AIM_PANEL_DATA.data.derivedRelations` + `derivedTotal`: odvodené vzťahy vybraného prvku
  v oboch smeroch (pravidlo, IFC vzťah alebo NULL pri IfcZone, rola, druhý koniec s GUID,
  `viaSpaceRef`), najviac 200 na smer. Čítajú sa len zapnuté pravidlá.
Popri tom: odznak typu v paneli AIM podľa `object_type` (zóna už nie je "Prvok").

---

### D-090 - Pripomienky a požiadavky na nové tools z konektora; issue spustí Claude session
**Status:** rozhodnuté (2026-10-18, Claude v nočnej session na pokyn Samuela "rozhodni všetko,
čo môžeš"), implementované na vetve `claude/mcp-tools-comments-tw8wl5`. **Mení zavrhnutie
"Claude Code cloud sessions sa z MCP servera automaticky nespúšťajú" v D-086:** odvtedy existuje
API trigger routines. **Nadväzuje na D-079, D-084, D-086, D-087.**

**Kontext:** Samuel (18. 10.): keď cez konektor AIM zistím, že Claude na niečo nemá tool, má si
to zaznamenať a poslať ďalej, nech sa tá funkcia začne stavať: najprv GitHub issue, z neho
automaticky Claude session, ktorá rieši a môže sa ma dopytovať. Popri tom pridávať pripomienky
(niečo nefunguje, vrátilo nezmysel). Dnes taká potreba ostane v rozhovore a stratí sa.

**Rozhodnutie:**
1. **Tri tools konektora, len v MCP** (nie v `/ask`, `lib/feedback/tools.ts`):
   `request_tool` (chýbajúca schopnosť: potreba, skúšané tools, prečo nestačia, voliteľný
   návrh mena/vstupov/výstupu, oblasť), `report_feedback` (pripomienka: `bug`, `wrong_data`,
   `wrong_answer`, `improvement`; session len s `start_session`) a `feedback_status` (zoznam
   otvorených alebo stav jedného issue: session, PR, posledné komentáre = otázky session).
   Zápisové tools majú `readOnlyHint:false`, `openWorldHint:true`, takže klient si vypýta súhlas.
2. **Záznam je GitHub issue v repe konektora** (`FEEDBACK_REPO`, predvolene
   `Menezeris/AIMviewer`), štítky `mcp` + `novy-tool` alebo `pripomienka` + druh/oblasť,
   po spustení `session`. **Žiadna tabuľka v DB:** issue je jediný nositeľ (stav, diskusia,
   väzba na PR), kópia v DB by zastarávala. Bez tokenu alebo pri chybe GitHubu tool vráti
   koncept issue, aby sa požiadavka nestratila.
3. **Opakovaná potreba sa nezakladá znova:** skrytá značka v tele (`<!-- aim-mcp {...} -->`,
   odtlačok z `proposal.name` alebo názvu bez diakritiky) a zhoda s otvoreným issue = komentár
   "Ďalší výskyt". Ak ešte nebeží session, opakovanie ju spustí (náprava po doplnení routine).
4. **Session spúšťa routine cez API trigger:** server po založení issue zavolá
   `POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire` (hlavička
   `anthropic-beta: experimental-cc-routine-2026-04-01`, token viazaný na routine) s textom
   repo + číslo issue; odpoveď nesie `claude_code_session_url`, ktorý tool vráti Claudovi a
   zapíše do issue. Routine **"AIM: požiadavka z konektora"** (`trig_01HfMX6dt9uNSkd2zZ8HHPST`,
   bez rozvrhu, nová session pri každom spustení, push notifikácia) je založená; API trigger a
   token sa dajú vytvoriť len vo webe (claude.ai/code/routines).
5. **Ako session rieši, je v gite, nie v routine:** prompt routine je krátky (payload je
   nedôveryhodný, vezmi len repo a číslo issue, pripoj repo, čítaj skill) a postup je skill
   `.claude/skills/mcp-poziadavka/SKILL.md`: najprv overiť, či to nejde existujúcimi tools
   (často stačí prompt), či nechýbajú dáta (tool to nevyrieši), až potom D-0xx a tool; pri
   viewere a motore D-087; otázky v session aj ako komentár v issue; výsledok PR s
   `Closes #N`, nikdy merge.
6. **Na hlavnom konektore, nie pod `MCP_WRITE_TOKEN`:** D-086 dáva pod token zápisu tools, ktoré
   menia dáta AIM alebo model. Tieto nemenia nič v AIM; zapisujú do GitHubu a míňajú limity
   predplatného. Potreba vzniká počas bežnej práce, takže musia byť tam, kde sa pracuje.
7. **Verejné repo:** AIMviewer je verejné, issue tiež. Opis tools a prompt zakazujú mená,
   kontakty a tokeny; server pred zápisom nahradí hodnoty `MCP_TOKEN`, `MCP_WRITE_TOKEN`,
   `LIVE_CHANNEL` a oboch tokenov D-090 textom `[skryté]`. Ak to bude málo, `FEEDBACK_REPO` sa
   prepne na súkromné repo bez zmeny kódu.

**Env (Vercel):** `FEEDBACK_GITHUB_TOKEN` (fine-grained PAT, len `Menezeris/AIMviewer`,
Issues: read and write, Metadata: read), voliteľne `FEEDBACK_REPO`; `CLAUDE_ROUTINE_FIRE_URL`
(URL z API triggera routine) a `CLAUDE_ROUTINE_TOKEN`. Bez prvého tools vracajú koncept, bez
druhých dvoch vznikne issue a session čaká.

**Vedomé limity:**
- API routines je beta (`/fire` sa môže zmeniť, nové hlavičky s dátumom, dve predošlé platia).
- Limity: 30 spustení za hodinu na routine, 100 za hodinu na účet; každá session ide na
  predplatné vlastníka routine (Samuel).
- **Routine založená cez MCP nemá repo ani konektory** (overené testom, issue #58): session
  vznikla, ale `gh api` vrátil 403 a `add_repo` v nej nebol. Repo `Menezeris/AIMviewer`,
  konektory (GitHub, aim-viewer) a model sa routine pridávajú vo webe spolu s API triggerom;
  bez repa prompt povie, čo chýba, a skončí. Bez nastavenia modelu beží Sonnet 5.5 (ako D-086 Q6).
- Session zatiaľ beží len nad AIMviewer; fork `ifc-lite` si pripojí sama cez `add_repo`, ak má
  prístup (D-087).
- Neoverené naživo: `/fire` z Vercelu (token ešte neexistuje); spustenie routine overené len
  cez `fire_trigger` z inej session. Chýbajúce štítky GitHub pri zakladaní issue vytvorí sám
  (overené na #58); pri 422 sa issue založí bez štítkov.

**Zavrhnuté:**
- *claude-code-action v GitHub Actions na štítok issue:* beh nie je session v claude.ai, nedá sa
  v ňom rozprávať, otázky len cez `@claude` komentáre a nový beh; pre úpravy modelu (D-086)
  ostáva.
- *GitHub trigger routine:* routines poznajú len udalosti PR a release, nie issues.
- *Tabuľka `mcp_feedback` v DB:* druhý nositeľ toho istého; GitHub má stav aj diskusiu.
- *Jeden tool s parametrom druhu:* model lepšie trafí dva tools s jasným opisom kedy.
- *Pravidelná routine, ktorá prechádza issues:* prázdne session každý deň; opakované volanie
  toolu po doplnení routine rieši ten istý prípad.

**Závislosti a licencie:** bez novej závislosti (fetch na GitHub REST a Anthropic API).

**Dodatok D-090 (2026-10-18) - koordinácia súbežných sessions.** Samuel: automatické sessions
sa majú vzájomne koordinovať, nevyvíjať to isté dvakrát a nerobiť konflikty. Za noc sa zrazili
čísla rozhodnutí dvakrát (assetin-library Z5, D-090/D-091 tu). Úplnú záruku dať nevieme
(sessions o sebe nevedia, kým sa nepozrú), preto štyri vrstvy od najtvrdšej:
1. **Jedna session na issue** - server: opakovanie sa pripíše k otvorenému issue a štítok
   `session` zabráni druhému spusteniu (už v D-090).
2. **Zoznam súbežných požiadaviek** - server pri zakladaní issue pripíše do tela otvorené issues
   `mcp` (s príznakom, či na nich beží session) a vráti ich aj Claudovi v rozhovore
   (`other_open`).
3. **Register čísel D-0xx** - issue #60 (štítok `koordinacia`, nezatvára sa): číslo sa
   rezervuje komentárom pred použitím, prvý komentár vyhráva.
4. **Pravidlá pre každú session** - `AGENTS.md` sekcia "Súbežné session" a krok "Koordinácia" v
   skille `mcp-poziadavka`: ohlásiť vetvu v issue, pred plánom pozrieť otvorené PR a vetvy,
   pri rovnakých súboroch dať vedieť a novú logiku dať do vlastného modulu, pred PR zlúčiť
   `main`; konflikt rieši vetva, ktorá prišla do `main` neskôr.
*Zavrhnuté:* zámok v DB alebo tabuľka sessions (druhý nositeľ stavu, GitHub ho už má); jedna
sekvenčná fronta požiadaviek (zahodila by paralelizmus, ktorý D-086 chce); čísla rozhodnutí
pridelené až pri merge (odkazy medzi vetvami by sa menili).

**Dodatok D-090 (2026-10-19) - strop súbežných sessions a fronta.** Samuel: naraz najviac tri
sessions z issues; issues vznikajú ďalej a keď sa miesto uvoľní, má prísť notifikácia, či spustiť
ďalšiu. Riešenie bez novej služby, stav je v štítkoch issues (jeden nositeľ):
- **Beží** = otvorené issue so štítkom `session`, ktoré sa hýbalo za posledných 24 h (spadnutá
  alebo zabudnutá session strop neblokuje navždy; `feedback_status` ju ukáže ako `stale`).
  Strop `FEEDBACK_MAX_SESSIONS`, predvolene 3.
- **Fronta** = štítok `fronta`. `request_tool` (a pripomienka so `start_session`) pri plnom strope
  issue založí, dá do fronty a povie pozíciu; `start_session=false` len zapíše (dávka bez sessions).
- **Uvoľnenie** robí session sama (skill, krok Výsledok): po otvorení PR alebo keď už len čaká na
  Samuela vymení `session` za `pr` alebo `caka-na-samuela` a ak je fronta neprázdna, pošle
  notifikáciu (alebo ju dá do záverečnej správy, ktorú routine pošle ako push).
- **Spustenie ďalšej** robí Samuel cez konektor: nový tool `start_queued_session` (najstaršia z
  fronty alebo konkrétne issue; pri plnom strope nič nespustí, `over_limit` len na výslovnú žiadosť).
*Vedomé limity:* dve súbežné volania tesne pri strope môžu spustiť jednu session navyše (GitHub
nemá atomický zámok, risk je malý); session, ktorá štítok nevymení, drží miesto najviac 24 h.
*Zavrhnuté:* automatické spustenie ďalšej bez otázky (Samuel chce rozhodnúť, a míňa to
predplatné); pravidelná routine, ktorá frontu kontroluje (prázdne sessions každú hodinu).

**Dodatok D-090 (2026-10-19) - issue len na pokyn.** Samuel: issue sa nemá zakladať samo, keď
Claude niečo nevie, ale až keď to Samuel povie. Mení bod 1 a MCP inštrukcie: Claude chýbajúcu
schopnosť alebo zlyhanie toolu povie a jednou vetou **ponúkne** zápis ("Mám to zapísať ako
požiadavku na nový tool?"); `request_tool` a `report_feedback` volá len na výslovný pokyn. Dôvod:
každé issue je verejné a každá session míňa predplatné, o oboch rozhoduje Samuel. Súhlas klienta
pri zápisovom toole (`readOnlyHint:false`) ostáva ako druhá poistka.

**Dodatok D-090 (2026-10-19) - komentár do existujúceho issue (#98).** Opakované issue #97 (revízia
tools riadená evalmi) má po každom kole dostať nové eval prípady a výsledky pred / po; konektor vedel
issue len založiť a čítať, takže každé kolo by bolo nové issue a história by sa rozdrobila. Nový tool
`feedback_comment` (len MCP, `lib/feedback/tools.ts`): `issue_number`, `text` (markdown, do 16 000
znakov), voliteľne `kind` = `eval_round` / `result` / `note` (nadpis komentára), vráti odkaz na
komentár. Rovnaký token a pravidlá ako `report_feedback`: len na výslovný pokyn, maskovanie tajomstiev,
`readOnlyHint:false`; session nespúšťa. Komentuje **issues so štítkom `mcp`** v repe konektora,
otvorené aj zatvorené (iné issues a PR odmietne, token má Issues: write na celé repo). Samuel
(2026-10-19): voliteľné `reopen: true` zatvorené issue pred komentárom znovu otvorí, len na výslovný
pokyn používateľa. Skrytá značka `<!-- aim-mcp-comment {...} -->`, `feedback_status` ju vráti ako
`via_connector` pri komentári. *Zavrhnuté:* pripísanie cez `report_feedback` s rovnakým názvom (odtlačok je krehký a text by bol "Ďalší výskyt").

---

### D-091 - Kde žije AIM funkcia: predvolene AIMviewer, vo forku len zobrazenie vnútri panelov viewera

**Dátum:** 2026-10-18 · **Stav:** prijaté (Samuel) · **Súvisí:** D-071, D-072, D-087, D-089

**Kontext:** UI vrstvy odvodení (D-089 fáza B) sa stavalo vo forku `ifc-lite` a trvalo hodiny,
hoci samotné komponenty boli hotové rýchlo. Každá zmena forku platí poistky, ktoré držia fork
zosynchronizovateľný s upstreamom (D-071): build celého monorepa, stovky testov, meranie veľkosti
balíka so stropom, mutačné dôkazy, kontrola nepoužitých premenných; navyše zlúčenie forku a potom
AIMviewera. AIMviewer má databázu, prihlásenie a rýchle nasadenie (Vercel za minúty). Viewer beží
v iframe, takže do jeho ribbonu a panelov (MODELS, Relationship records) host kresliť nevie.

**Rozhodnutie:**
1. **Predvolené miesto pre novú AIM funkciu je AIMviewer** (stránky, panely a dialógy hosta,
   API, MCP). Do forku ide len to, čo **musí byť vnútri panelov viewera**, aby dávalo zmysel:
   odznak alebo záznam v jeho paneli, prepínač zobrazenia v scéne, sekcia v jeho strome.
2. **Fork len zobrazuje a lokálne prepína.** Dáta dostane mostom (`aim-bridge`) hotové; fork
   nečíta databázu, nerozhoduje o dátach a nemá vlastné formuláre na ich zmenu.
3. **Akcia, ktorá mení dáta** (zapnúť/vypnúť pravidlo, prepočítať, zápis z viewera vo fáze 3
   D-086, správa pravidiel, história behov) **patrí do AIMviewera**. Tlačidlo vo forku smie
   akciu len otvoriť (odkaz alebo správa mostom hostovi), samotný dialóg, potvrdenie a zápis
   robí host.
4. Pri návrhu funkcie sa najprv povie, ktorá časť musí byť vo forku a prečo; čo sa dá urobiť
   v hostovi, sa vo forku nerobí. Stav D-089: tlačidlá Pravidlá a Prepočítať vedú zatiaľ na
   workflow `odvodenie` v OCB (`manageUrl`); keď vznikne stránka pravidiel v AIMvieweri,
   `manageUrl` na ňu ukáže bez zmeny forku.

**Dôsledky:** zmeny forku sú zriedkavé a malé (zobrazenie), väčšina iterácií beží v AIMvieweri
s rýchlym CI. Most sa rozširuje o dáta na zobrazenie a o správy "otvor akciu v hostovi".

**Zavrhnuté:**
- *Všetky AIM tlačidlá a panely vo forku (doterajší postup pri D-089 B):* každá iterácia platí
  plnú cenu poistiek forku; správa dát vo forku by ďalej potrebovala prihlásenie a prístup k DB,
  ktoré má host.
- *Všetko v hostovi, aj odznaky a záznamy:* host do panelov v iframe kresliť nevie; overlay nad
  iframe by sa rozišiel s rozložením viewera.

### D-092 - set_section vracia polohu roviny z viewera; opravy rezu vo forku

**Dátum:** 2026-10-19 · **Stav:** prijaté (výška, orezanie, widget a potvrdenie hotové; percentá bez zmeny) · **Súvisí:** D-083, D-085, D-087, D-090, D-091 · **Issue:** #63

**Kontext:** pripomienka z konektora (#63): vodorovný rez nad 3NP s `offset_m=1` dal rovinu na
13,55 m a s `offset_m=-2` na 12,10 m, strecha a fasáda ostali viditeľné, widget rezu sa nedá
skryť a `position_percent` 50 % padlo na asi 15 % budovy. Podlažie 3NP má v DB `elevation = 9200`
(mm), správne výšky sú teda 10,2 m a 7,2 m: chyba nie je len v mierke offsetu (sklon 0,486), ale
aj v základnej výške. AIMviewer posiela viewer op `section:y~h=<offset>:<GUID podlažia>`;
výšku, orezávanie, widget aj percentá počíta fork (D-083: "jedna pravda o súradniciach" je viewer).
`set_section` pritom vracal len to, čo poslal, takže Claude potvrdil zlý rez.

**Rozhodnutie:**
1. **Potvrdenie z viewera (host, hotové):** MCP konektor po odvysielaní `set_section action=set`
   prečíta tým istým živým kanálom stav viewera (`view_state`, D-085, timeout 4 s) a do odpovede
   pridá `viewer_section` = rez, ako ho viewer naozaj má. Pri reze nad podlažím výsledok nesie
   `floor_elevation_model_units` (IfcBuildingStorey.Elevation z AIM DB, jednotky modelu), aby
   Claude porovnal polohu roviny s eleváciou + offsetom a pri nesúlade rez nepotvrdil.
   Výpočet výšky ostáva vo vieweri, host ho len kontroluje.
2. **Opravy rezu patria do forku** (D-087/D-091, je to správanie scény): (a) rovina oreže všetky
   federované modely a všetky typy prvkov; (b) výška = elevácia podlažia + offset v metroch
   IFC sveta (oprava mierky aj základnej výšky); (c) skrytie widgetu rezu pri aktívnom reze
   (nový parameter op aj toolu); (d) percento voči budove alebo zvolenému modelu, nie voči celej
   federovanej obálke. Fork nebol v session pripojený, preto sa robí ako samostatná zmena forku
   a po nej doplnenie parametrov toolu v hostovi.

**Otvorené (Samuel):** pripojenie forku; či do opravy forku posielať namiesto `storeyGuid +
offset` absolútnu výšku `coordinate_m` z DB (obchádzka, mení princíp D-083); voči čomu má byť
predvolené percento rezu.

**Zavrhnuté:**
- *Vypočítať očakávanú výšku v metroch v hostovi a hlásiť nesúlad automaticky:* `floors.elevation`
  je v jednotkách modelu (ETL ho neprevádza), host by musel hádať jednotky; porovnanie robí Claude
  s oboma číslami v ruke.

**Dodatok 2026-10-19 (oprava vo forku, Menezeris/ifc-lite vetva `claude/stoic-bohr-6n8rmb`):**
- **Príčina výšky aj mierky:** renderer (a Section bar) rozkladá percento rezu na obálku
  `usePlacementCoordinateInfo` (živé obálky modelov zo scény), AIM vrstva forku na holé
  `mergedSectionBounds`. Vo federácii sú to dve rôzne veľké obálky, rez padol inam a sklon
  0,486 je ich pomer. `view_state` čítal rez cez tú istú holú obálku, takže hlásil požadovanú
  výšku, nie skutočnú. Fork teraz počíta všetko (rez nad podlažím, rez cez prvok a súradnicu,
  `view_state`, obálka modelu) voči obálke renderera; elevácia podlažia v rámci jeho modelu.
  Overené naživo: rez 3NP-analógie s offsetom 1 a -2 m pred opravou 11,93 a 4,45 m, po oprave
  presne 3,7 a 0,7 m (elevácia + offset). Princíp D-083 ostáva, obchádzka cez `coordinate_m`
  netreba.
- **Orezanie (bod 1):** strecha "nad rovinou" bola dôsledok zlej výšky: rovina pre 3NP + 1 m
  bola v skutočnosti nad podlahou 4NP (13,4 m), pôdorys 3NP zakryla doska 4NP. Renderer
  orezáva všetky modely; samostatná zmena netreba, overí sa naživo po nasadení.
- **Widget (bod 3):** bridge `SET_SECTION showGizmo` a `action: 'gizmo'`; host op
  `section:...~g=0|1` a `section_gizmo:<0|1>:`, tool `set_section show_widget` a `action=widget`.
  `view_state.section.show_gizmo` hlási stav.
- **Percentá (bod 4, Samuel 2026-10-19: netreba):** `position_percent` ostáva voči obálke celej
  scény (všetky viditeľné modely, rovnako ako Section bar). Je to núdzová možnosť; presný rez
  dáva `floor` + `offset_m` alebo `coordinate_m` z `get_bounds`. Opis toolu a prompt to hovoria.

---

### D-093 - get_viewer_state: súhrn výberu, príznak orezania a identita položiek

**Dátum:** 2026-10-19 · **Stav:** navrhnuté (kontrakt forku podľa dodatku, schváli Samuel mergom) · **Súvisí:** D-085, D-087, D-090, D-091 · **Issue:** #64

**Kontext:** Používateľ vybral celý ľahký obvodový plášť (1810 prvkov). `get_viewer_state` vrátil
`selection.count` 1810, ale len prvých 50 GUID bez triedy, podlažia a rodiča, bez stránkovania a bez
povedania, že zoznam je orezaný. Claude zobral vzorku (náhodou celá z 1NP) a povedal, že výber je
len 1NP. Orezanie robí odpoveď mosta vo forku, host ju len preposiela. Overené nad prod DB: AIM má
55 `IfcCurtainWall` (1NP až 4NP), ale ich časti (`IfcPlate`, `IfcMember`) nie, takže triedu, podlažie
a zostavu týchto prvkov pozná len viewer s načítaným IFC.

**Rozhodnutie:**
1. Server (`lib/live/selection-summary.ts`, DB časť `selection-context.ts`) vráti vo `selection`:
   `count`, `returned`, `truncated`, `summary` (počty podľa IFC triedy, podlažia, rodičovskej zostavy
   a modelu, `covers` = `all` alebo `returned`, `in_aim`), stránku `items` (`guid`, `object_ref`,
   `name`, `ifc_type`, `floor`, `parent`, `model`, `in_aim`; `items_offset`/`items_limit`, default 50,
   strop 200) a vetu `note`, keď je zoznam orezaný alebo stránkovaný. Surové `guids` z odpovede
   odpadnú, ostatné polia viewera (napr. `bbox`) ostanú.
2. Zdroj údajov o prvku: najprv viewer (`selection.items`), inak AIM: podlažie cez
   `rel_contained_in_spatial_structure` (priestor -> podlažie cez `rel_aggregates`), alebo kontajner
   zostavy; zostava cez `rel_aggregates` na nepriestorový uzol; zaniknuté objekty nie (D-088).
3. **Kontrakt pre fork** (odpoveď `view_state`, len `apps/viewer/src/aim/`): `selection.guids` celé
   (strop 5000, `MAX_SELECTION_GUIDS`) a voliteľne `selection.items[]` {`guid`, `name`, `ifc_type`,
   `storey`, `model`, `parent_guid`, `parent_type`, `parent_name`} a `selection.bbox`. Je to dátová
   odpoveď mosta, nie rozhodovanie o dátach (D-091). Server použije, čo príde; kým fork posiela
   50 GUID, `truncated` a `covers=returned` zabránia záveru zo vzorky.
4. Prompt MCP: na "čo mám vybrané" odpovedať zo `summary`, pri `truncated` nepopisovať výber ako celok.

**Dôsledky:** chyba z issue (záver z čiastočnej vzorky) je zavretá hneď po nasadení hosta; úplný súhrn
pre časti zostáv príde so zmenou forku. 1810 GUID je ~45 kB v Realtime odpovedi, AIM lookup ide po
dávkach 100.

**Dodatok (2026-10-19, strop Realtime):** Realtime projektu má `max_payload_size_in_kb` 256 a
`max_bytes_per_second` 100000 (Management API). Celý výber s identitou (1810 položiek ~400 kB, 5000
GUID ~125 kB) sa do jednej odpovede nezmestí. Preto fork súhrn spočíta sám nad **celým** výberom a
zoznamy oreže: `selection.summary` {`of`, `by_ifc_type`, `by_storey`, `by_parent` (`key`, `count`,
`guid`, `ifc_type`, `name`), `by_model` pri viacerých modeloch}, `selection.guids` najviac 1000,
`selection.items` najviac 100, `selection.truncated` a `selection.bbox` (obálka výberu v IFC svete).
Odpoveď má aj pri 5000 prvkoch ~60 kB. Server súhrn viewera prevezme (`covers=all`, keď `of` pokrýva
`count`), zostavu známu v AIM pomenuje `object_ref` a pri orezanom zozname povie, že súhrn platí pre
celok; bez súhrnu z viewera platí pôvodné správanie (bod 1). Strop 5000 z bodu 3 sa týka len servera.

**Zavrhnuté:**
- *Dopočítať triedu a rodiča na serveri cez IFC motor (`ENGINE_ENABLED`):* studený štart ~7 s a druhá
  kópia IFC, ktorú viewer už má načítanú. Otvorené ako otázka pre Samuela v #64.
- *Nový tool `get_selection`:* ten istý stav viewera by mal dve cesty; stránkovanie stačí v
  `get_viewer_state`.

---

### D-096 - `style_in_3d` nad Lens: systém, zóna a podlažie ako filtre, AND kritériá, skupiny s farbou a počty z viewera

**Dátum:** 2026-10-19 · **Stav:** navrhnuté (požiadavka z konektora, issue #68), PR čaká na Samuela
· **Súvisí:** D-066, D-079, D-085, D-087, D-088, D-089, D-090, D-091

**Kontext:** "zafarbi celú prívodnú vetvu" zafarbilo len samotný systém, lebo `style_in_3d`
vie triedu, doménu, model, vlastnosť a explicitné prvky, ale nie členov systému ani zóny.
Kritériá sa nedali kombinovať (trieda AND podlažie AND systém) a viac farieb znamenalo viac
volaní bez počtov. Fork viewera má od upstreamu **Lens** (`@ifc-lite/lens` 2.2.0,
`@ifc-lite/rules` 0.7.7, panel Lens): pravidlá s AND nad IFC (trieda, predefined_type,
podlažie, skupina IfcSystem/IfcZone, vlastnosť, atribút, model, GlobalId...), farba a akcia na
pravidlo, počty, legenda a autoColor. Originál `@ifc-lite/mcp` ho ovláda len vo vlastnom
vieweri balíka, nie v našom iframe, takže podľa D-087 bod 3 ide o vlastný adaptér.

**Rozhodnutie (Samuel, 2026-10-19: všetko nad Lens, jeden celok):**
1. **Rozšírenie existujúceho `style_in_3d`, nie nový tool.** `colorize`, nové `transparent`
   a `isolate` zostavia pravidlá **lens "AIM chat"**; `groups` = viac pravidiel s farbou;
   `color_by` (system, ifc_type, material, model, classification, property, attribute) =
   autoColor s legendou; `mode` add (pridáva) / replace. `reset_colors` lens vypne,
   `show_all` zruší izoláciu z chatu. **Izolácia nejde cez lens** (Samuel, 2026-10-19:
   izolované prvky sa farbia len na žiadosť): pravidlá sa vyhodnotia tým istým federovaným
   filtrom ako lens a ich zjednotenie sa izoluje kanálom izolácie viewera, prvky bez farby
   ostanú v pôvodnom vzhľade; skupina s farbou je navyše pravidlo lens. **Skrývanie len na
   výslovnú žiadosť** (Samuel): `hide`/`show` ostávajú na kanáli skrývania viewera mimo Lens,
   stlmené (ghost) sú len prvky mimo farebných pravidiel lens.
2. **Pravidlá:** trieda/doména -> `ifcType`, predefined_type -> `predefinedType`, podlažie ->
   `storey` (meno podlažia z grafu AIM), systém a `system_type` -> mená systémov z grafu AIM
   (aj podľa ObjectType) -> `group` IfcSystem s regexom na presné mená, `not_in_system` ->
   `group isNotSet`, vlastnosť -> `property` s dedičnosťou z typu, text -> `name contains`,
   model -> meno modelu, ktoré fork preloží na identitu modelu vo vieweri, konkrétne prvky
   -> `globalId` (strop 400 v URL). Kritériá jednej skupiny sú AND.
3. **Zóna** (IfcZone, IfcSpatialZone, IfcGroup) = miestnosti (aj cez vnorené zóny) a **vždy aj
   prvky v nich alebo dotýkajúce sa ich** (contained + referenced inside/partial, aj z iného
   modelu federácie; len miestnosti iba na výslovnú žiadosť cez `ifc_type`). Lens to z IFC
   nevie, preto ide v URL symbolicky (pravidlo `aim_zone` s id zón) a klient viewera si GUIDy
   stiahne z `GET /api/style-scope?zone=<id>` (strop 5000 na správu), takže dĺžka URL zónu
   neobmedzuje.
4. **Transport:** op `lens:<mode>~r=<rev>:<base64url JSON>` v tej istej `/ifc?ops=` URL (D-066,
   živý kanál D-079); klient pošle forku `APPLY_LENS`. Fork (`apps/viewer/src/aim/aimLens.ts`,
   lenivo) vloží lens do dočasného slotu `auto-color-from-list` (upstream ho neukladá ani
   neexportuje), aktivuje ju a otvorí panel Lens; vyhodnotenie robí upstream `useLens`.
   Upstream súbory sa nemenia.
5. **Počty pre Clauda z viewera, nie odhadom:** po odoslaní sa MCP spýta spätným kanálom
   (D-085) `lens_state` s tým istým `rev`; fork počká na vyhodnotenie práve tejto verzie
   (`LENS_QUERY` -> `QUERY_RESULT`, najviac 6 s) a vráti počet na pravidlo, izolované prvky a
   legendu. Bez živého viewera tool vráti zostavenú lens a povie, že počty sú v paneli Lens.
6. **Bez pevnej palety** (Samuel): farby určuje používateľ, inak model zvolí odlíšiteľné a vráti
   legendu; izolácia bez farby prvky nefarbí. Dáta VZT: predefined_type a
   ObjectType rozlišujú prívod od odvodu, ale nie prívod od nasávania (VENTILATION,
   "Přiváděný vzduch") ani odvod od výfuku (EXHAUST, "Odváděný vzduch"); rozlíši ich len názov.
7. Kód: `lib/viewer-lens.ts` (wire formát, server aj klient), `lib/llm/lens-plan.ts` (čisté
   pravidlá), `lib/llm/style-lens.ts` (mená z DB), `lib/llm/style-scope.ts` (rozbalenie zóny,
   systémov, podlažia; GUID cesta pre `hide`/`show` so systémom, zónou alebo podlažím),
   `lib/live/lens-counts.ts`, `app/api/style-scope`; fork `lens-protocol.ts`,
   `aimLensPlan.ts`, `aimLens.ts`, v `AimBridge.tsx` len registrácia.

**Dôsledky:** filter systému ukáže len to, čo nesie model: Prívod-1NP má v DB 8 členov (stav
2026-10-19). Lens farbí prvou zhodou, preto novšie pravidlá idú v AIM chat lens dopredu (nová
farba prebije staršiu). Kým je lens aktívna, izolované prvky bez farby sú stlmené ako všetko
mimo farebných pravidiel; bez lens ostanú v pôvodnom vzhľade. Lens `group` vidí len priame IfcRelAssignsToGroup (systémy VZT sú ploché).
Podlažie ide podľa mena v IFC (ASR aj VZT majú 1NP...4NP). Poradie zlúčenia: fork, potom
AIMviewer (starý fork správy Lens ignoruje, nič sa nerozbije).

**Zavrhnuté:**
- *Nový tool `style_in_3d_rozsirenie`:* dva tools na to isté by model mýlili.
- *GUIDy v URL pre všetko (prvá verzia PR #85):* strop 500 prvkov na volanie, žiadna legenda ani
  panel; ostáva len pre `hide`/`show`.
- *Vyhodnotenie lens na serveri cez `@ifc-lite/rules`:* adaptér dát Lens žije vo vieweri, kópia
  na serveri by sa rozišla s tým, čo používateľ vidí; počty dáva priamo viewer.
- *`viewer_*` tools z `@ifc-lite/mcp`:* ovládajú vlastný viewer balíka, nie náš iframe.

---

### D-094 - set_camera: relatívny pohyb, fit na viditeľné, cieľ filtrom, pohľad kolmo na rez

**Dátum:** 2026-10-19 · **Stav:** implementované (revízia podľa D-098), fork PR Menezeris/ifc-lite#60 · **Súvisí:** D-066, D-083, D-085, D-087, D-090, D-098 · **Issue:** #65

**Kontext:** požiadavka z konektora (#65): "oddiaľ pôdorys o 15 %", "VZT v perspektíve na celú
obrazovku", "pozri sa na rez schodiskom kolmo". `set_camera` vedel len presety a framing na GUIDy:
`fit_all` zmení smer pohľadu, `iso` nezafituje na izolované prvky, cieľ nejde zadať filtrom a pohľad
kolmo na rez chýba. Originál `@ifc-lite/mcp` 0.27.0 má z kamery len `viewer_fly_to` (zarámuj
entity), relatívny pohyb ani rez nemá, preto podľa D-087 bod 3 vlastné, v štýle originálu.

**Rozhodnutie:**
1. **Rozšírenie `set_camera`, nie nový tool** (jeden tool na kameru, model nevolí medzi dvoma).
   Staré volania platia bez zmeny.
2. `preset` je voliteľný; nové hodnoty `keep` (zachovať smer, default) a `section` (kolmo na
   aktívny rez, zo strany, z ktorej je rez viditeľný).
3. `fit`: `visible` (viditeľné, teda aj izolované prvky, `fitAll` forku) alebo `selection` (výber
   vo vieweri, `frameSelection`). S cieľom sa rámuje naň, `fit` sa s cieľom nekombinuje. Bez `fit`
   a bez cieľa ostáva doterajšie správanie presetu.
4. Cieľ aj filtrom ako `style_in_3d`: `ifc_type`, `ifc_types`, `domain`, `model`. Selektor
   rozloží viewer z entity tables (op `camera_sel`, rovnaký tvar `t=..~m=..` ako `*_sel`, D-066).
5. Relatívne kroky: `zoom_percent` (-90 až 500; kladné priblíži, vzdialenosť / (1 + p/100),
   záporné oddiali, vzdialenosť * (1 + |p|/100); pri ortografickej projekcii mierka rovnako),
   `orbit_h_deg` (-180 až 180, kladné = kamera obehne cieľ doľava), `orbit_v_deg` (-89 až 89,
   kladné = viac zhora), `pan_x_percent`/`pan_y_percent` (-100 až 100 % šírky/výšky pohľadu,
   kladné = obsah sa posunie doľava/dole, teda pohľad doprava/hore).
6. **Relatívny krok je samostatné volanie** (bez presetu, fit, cieľa a projection): počíta sa
   z aktuálnej pózy a preset či fit ju menia animáciou. Poradie vo vieweri pri jednom volaní:
   projekcia, smer, po animácii smeru rámovanie; relatívne kroky orbit, zoom, posun. Tool vráti,
   čo poslal; skutočnú polohu kamery vráti `get_viewer_state` (D-085), model ju má overiť.
7. **Wire formát** (D-066): `camera:<preset>[~proj=o|p][~fit=v|s][~z=..][~oh=..][~ov=..]
   [~px=..][~py=..]:<guid.guid..>` a `camera_sel:<to isté>:t=..~m=..`. Bridge `SET_CAMERA` dostane
   `fit` a `selector`. Relatívne kroky do mosta nejdú: host (`components/ifc-viewer.tsx`) sa
   opýta `QUERY view_state`, čistou funkciou `relativeViewpoint` (`lib/viewer-camera.ts`) vypočíta
   novú pózu v IFC svete a pošle `SET_CAMERA {preset: keep, viewpoint}` (D-098).
8. **Fork** (`apps/viewer/src/aim/viewCamera.ts`, D-087 bod 2, D-098): len existujúce funkcie.
   `section` = upstream Set view (`presetViewForAxis` / `customPlaneViewpoint`), `fit` =
   `fitAll` / `frameSelection`, cieľ = `flyTo`, `viewpoint` = `applyViewpoint`. `view_state`
   vracia aj `up`, `fov_deg`, `ortho_size`, `aspect`. Oprava chyby z #65 (preset `front`/`back`
   s cieľom nepohol kamerou): rámovanie hneď po presete prepísalo koncový bod jeho animácie, teraz
   ide až po nej. Poradie zlúčenia: fork, potom AIMviewer (starý fork nové presety odmietne).
   Známe obmedzenie upstream ViewCube: rovnaký pevný preset dvakrát po sebe otočí pohľad o 90°.

**Zavrhnuté:**
- *Nový tool `camera_control` popri `set_camera`:* dva tools na to isté, model by volil zle.
- *Absolútna poloha kamery (x, y, z):* model nepozná mierku scény; relatívne kroky a fit stačia.

---

### D-098 - Najprv to, čo viewer a originál už majú; fork len sprístupní

**Dátum:** 2026-10-19 · **Stav:** prijaté (Samuel) · **Súvisí:** D-087, D-091, D-094, D-090 · **Issue:** #65

**Kontext:** prvá verzia D-094 navrhla do forku nové výpočty kamery (relatívny zoom, orbit, posun,
pohľad na rez v moste). Pri čítaní kódu forku sa ukázalo, že takmer všetko už existuje: `fitAll`
rámuje viditeľné prvky bez zmeny smeru (#5884), tlačidlo Set view sa pozerá kolmo na rez (#7545),
`applyViewpoint`/`getViewpoint` nastaví a prečíta presnú pózu, `frameSelection` a `flyTo` rámujú.
Nové funkcie vo forku zväčšujú balík, rozchádzajú sa s originálom pri synchronizácii a potrebujú
vlastné testy a dôkazy.

**Rozhodnutie:**
1. **Prednostne využívame to, čo fork a originál už majú, a nevymýšľame nové funkcie.** Pred
   návrhom sa prehľadá store forku (`CameraCallbacks`, slices), SDK `@ifc-lite/sdk`,
   `@ifc-lite/mcp`, embed protokol a akcie UI originálu (tlačidlá, ViewCube).
2. **Fork len tenko sprístupní existujúcu funkciu cez most** (adaptér v `apps/viewer/src/aim/`).
   Výpočty, ktoré vie urobiť host z dát, ktoré fork vráti (napr. relatívna kamera z
   `view_state`), robí AIMviewer.
3. Pravidlo je v `AGENTS.md` (3D Viewer), v skille `mcp-poziadavka` (krok 2) a vo forku v
   `docs/FORK_MAINTENANCE.md` (Conventions) a skille `aim-feature` (krok 1).

**Zavrhnuté:**
- *Výpočty kamery v moste forku:* duplikovali by funkcie viewera, zväčšili vstupný balík a pri
  synchronizácii s originálom by sa rozchádzali.

**Doplnené (Samuel, 2026-10-19) - rýchle CI forku pre PR len v AIM vrstve:** `test.yml` vo forku
(job `changes`, krok `aimonly`) vypne ťažké vetvy (Rust, WASM, viewer shards, E2E, perf
ratchet), `aim-fast.yml` pustí AIM testy, lacné gates a typecheck viewera (približne 10 min).
Plné CI ostáva pri sync s originálom a pri zmene upstream súborov. Balík a revert oracle sa
merajú lokálne (skill `aim-feature`). Detail: `docs/FORK_MAINTENANCE.md` vo forku.

**Nasleduje:** D-103 rozširuje rýchle CI na malé AIM-FORK úpravy pôvodných súborov a pridáva
nočné plné CI na `main`.

---

> Kompaktný reverse-chrono log pridaných/zmenených rozhodnutí. Plný kontext = príslušný
> D-záznam vyššie.

- **2026-10-20** - **D-119 (miestnosti a farby z chatu, #135 #136 #137):** Lens z chatu a `show` zapnú skryté IfcSpace/IfcSpatialZone, fork v 2D vyplní a popíše ofarbené miestnosti, `color_by` rešpektuje filter volania (inak viditeľné prvky) cez `capturedScope`, `style_in_3d action=legend` s `legend_size` zväčší legendu.
- **2026-10-20** - **D-116 (release train, rozširuje D-103):** feature PR forku len rýchla cesta, plné CI raz na balíku `release/aim-*` (merge na pokyn Samuela), výber viewera nad 3D (`?viewer=pr-N`, náhľad PR forku) na živé testovanie s MCP pred zlúčením, smoke po nasadení, tag balíka (ifc-lite #77).
- **2026-10-19** - **D-112 (meranie z geometrie, #74):** `ifc_measure` tesseluje model ako `clash_check` a meria svetlú vzdialenosť dvoch prvkov (aj ASR voči VZT), výšku nad doskou, rozmery, povrch, pôdorys a objem z meshu s porovnaním s Qto.
- **2026-10-19** - **D-110 (prechod VZT sieťou, #75):** `ifc_relations(through_ports, recursive, stop_at)` prejde sieť cez porty a vráti najbližšiu jednotku alebo klapku (aj `IfcDamper.FIREDAMPER`) s cestou a `path_show_in_3d`; `max_steps`, `cut_off`.
- **2026-10-19** - **D-109 (verzia modelu v ifc_models, #73):** aktuálna revízia z `model_revisions` (vNNN, dátum, autor, súhrn, sha256, poistka), `history: N`, cesta k zoznamu zmien v OCB; `loaded` vysvetlené ako cache motora; CRS a hlavička ostávajú v `ifc_model_info`.
- **2026-10-19** - **D-108 (materiálové vrstvy z IFC, #69):** `ifc_get` vracia materiály (vrstvy, hrúbky, kategórie, aj z typu), nový `ifc_material_layers` nájde prvky podľa materiálu alebo kategórie vrstvy so súhrnom podľa skladby a `show_in_3d`.
- **2026-10-19** - **D-113 (panel vlastností z chatu, #71):** `select_in_3d` s `panel_tab`, `panel_section` a `highlight`; fork prepne záložku AIM | IFC, sekciu a zvýrazní vlastnosť cez upstream `pendingPropertyFocus` bez režimu úprav.
- **2026-10-19** - **D-111 (zoznam z chatu, #70):** `open_list` s filtrami ako `style_in_3d` a stĺpcami otvorí builder panela Lists (fork `OPEN_LIST`, návrh zoznamu); Run a Export (CSV/XLSX/PDF) robí používateľ.
- **2026-10-19** - **D-106 (Odvodené záznamy ako strom, #93):** jeden AIM badge a odlíšená sekcia, strom vzťah > IFC trieda / PredefinedType > inštancia s počtami, host posiela `other.predefinedType`.
- **2026-10-19** - **D-105 (X-ray context z chatu, #106):** `style_in_3d action=xray` cez AIM chat lens s príznakom `x: 1`, fork dá zjednotenie pravidiel do kanála ghost viewera (ako tlačidlo duch), `mode=add` rozšíri, `show_all` zruší; drôtový model zatiaľ nie (renderer ho nemá).
- **2026-10-19** - **D-104 (dokumenty z IFC):** jedna sada dokumentov z IFC (stará sada E3 sa odstráni), ETL podľa IfcDocumentInformation vrátane stromu a odkazov na strany, efektívne dokumenty objektu cez vzťahy (typ, skupina, zóna, priestorová zóna, odvodené) v DB aj v tooloch, prehliadanie a preklikávanie PDF cieľovo vo vieweri (fork), súbory v buckete podľa `Identification`.
- **2026-10-19** - **D-103 (rýchle CI forku, rozširuje D-098):** rýchla cesta aj pre PR s úpravami pôvodných viewer súborov len vnútri AIM-FORK blokov (build viewera, súvisiace viewer testy, ratchet viewer JS), nočné plné CI na `main`, nálezy review bota neblokujú merge okrem bezpečnostných (ifc-lite #69).
- **2026-10-19** - **D-102 (kolo 3 latencie MCP):** kód prvku (SD04.0001, VV.03.01.040) ako cieľ všetkých toolov cez meno v AIM a IFC Name/Tag, predčítané indexy motora (`ifc_search` 2 až 90 ms), kód bez preklepu, `set_section relative_to=ceiling` z Qto miestností (vážený medián), `get_object` s podlažím, kamera na miestnosť a `CLEAR_SELECTION` vo forku.
- **2026-10-19** - **D-101 (potvrdenie príkazov viewera):** `ACK_REQUEST`/`APPLIED` s `cmdId` namiesto pevných limitov, fronta príkazov vo forku počas načítania, `ISOLATE` presná množina a Lens `mode: add` rozšíri izoláciu (#95), `CLEAR_FOCUS` (#94), widget rezu trvalo (#63), príkaz na `/ifc` bez navigácie, teplý Realtime kanál, predčítanie motora aj na studenej inštancii.
- **2026-10-19** - **D-100 dodatok (meranie v iad1, región `arn1`):** 12 úloh správne, 6 nad stropom volaní; server väčšinou pod 1 s, čas tvoria počty volaní; funkcie presunuté do `arn1` pri databáze.
- **2026-10-19** - **D-100 (latencia MCP konektora):** log volaní `mcp_call_log` s fázami, eval úlohy konektora merané agentom (`eval/mcp-tasks.json`), predčítanie IFC motora pri pripojení, panel chatu vo vieweri skrytý, `ifc_property_values` číta aj Qto (#96); región `arn1` samostatne po baseline (#97).
- **2026-10-19** - **D-090 dodatok (`feedback_comment`, #98):** komentár do issue konektora (štítok `mcp`, aj zatvoreného, `reopen` na pokyn) s druhom `eval_round` / `result` / `note`, vráti odkaz; `feedback_status` označí komentáre konektora (`via_connector`).
- **2026-10-19** - **D-096 (`style_in_3d` nad Lens):** farbenie, priehľadnosť a izolácia ako lens "AIM chat" v paneli Lens forku; filtre `system`, `system_type`, `not_in_system`, `zone`, `storey` (AND), `groups` s farbou, `color_by` s legendou; zóna sa doťahuje na klientovi; počty na pravidlo vracia viewer spätným kanálom.
- **2026-10-19** - **D-093 dodatok (súhrn výberu počíta fork):** strop Realtime 256 kB, fork posiela `summary` nad celým výberom, zoznamy orezané (1000 GUID, 100 položiek) a `bbox`; server súhrn prevezme.
- **2026-10-19** - **D-093 (súhrn výberu v `get_viewer_state`):** `selection` s `count`/`returned`/`truncated`, súhrnom (trieda, podlažie, zostava, model, `covers`), stránkou položiek s identitou a `note` pri orezaní; kontrakt pre fork (celé `guids`, voliteľné `items` a `bbox`); prompt nerobí závery zo vzorky.
- **2026-10-19** - **D-098 (najprv existujúce funkcie, fork len sprístupní):** pred návrhom sa prehľadá store, SDK, `@ifc-lite/mcp` a embed protokol; fork len tenký most, výpočty v AIMvieweri. Pravidlo v `AGENTS.md`, skilloch `mcp-poziadavka` a `aim-feature`, `FORK_MAINTENANCE.md`; rýchle CI forku pre PR len v `aim/` (`aim-fast.yml`) (#65).
- **2026-10-19** - **D-094 (set_camera: relatívny pohyb, fit, filter, kolmo na rez):** `set_camera` dostal `preset` keep/section, `fit` visible/selection, cieľ filtrom (`ifc_type(s)`, `domain`, `model`, op `camera_sel`), `zoom_percent`, `orbit_h_deg`/`orbit_v_deg`, `pan_x_percent`/`pan_y_percent` (samostatné volanie, pózu počíta host z `view_state`); fork `SET_CAMERA` cez existujúce funkcie a oprava front/back s cieľom (ifc-lite#60, #65).
- **2026-10-19** - **D-092 dodatok (oprava rezu vo forku, widget):** výška rezu a `view_state` voči obálke renderera (príčina sklonu 0,486), skrytie widgetu cez `show_widget` / `action=widget`; percentá ostávajú voči celej scéne, len opis (#63).
- **2026-10-19** - **D-092 (set_section vracia polohu roviny z viewera):** MCP po odoslaní rezu prečíta `view_state` a vráti `viewer_section`, rez nad podlažím nesie eleváciu z DB na kontrolu; opravy orezávania, výšky, widgetu a percent sú vo forku (#63).
- **2026-10-19** - **D-090 dodatok (issue len na pokyn):** Claude zápis len ponúkne, `request_tool`/`report_feedback` volá až na výslovný pokyn Samuela.
- **2026-10-19** - **D-090 dodatok (strop a fronta):** najviac 3 súbežné sessions (`FEEDBACK_MAX_SESSIONS`), ďalšie issues so štítkom `fronta`, session po PR uvoľní miesto a pošle notifikáciu, ďalšiu spustí tool `start_queued_session`; `request_tool.start_session=false` pre dávky.
- **2026-10-18** - **D-091 (kde žije AIM funkcia):** predvolene AIMviewer; do forku len zobrazenie, ktoré musí byť vnútri panelov viewera (odznaky, záznamy, lokálne prepínače); akcie meniace dáta robí host, tlačidlo vo forku ich len otvorí.
- **2026-10-18** - **D-090 (pripomienky a požiadavky na nové tools z konektora):** MCP tools `request_tool`, `report_feedback`, `feedback_status`; záznam = GitHub issue v repe konektora (bez tabuľky v DB, opakovanie = komentár), požiadavka na tool spustí Claude Code session cez API trigger routine "AIM: požiadavka z konektora", postup session v skille `mcp-poziadavka`; mení zavrhnutie cloud sessions v D-086.
- **2026-10-18** - **D-089 (register pravidiel odvodení, vrstva AIM nad modelmi):** `derivation_rules` + `derivation_runs`, pravidlá `element_in_space`, `element_in_spatial_zone` (geometria) a `element_in_zone` (cez priestory, pohľad `v_zone_elements`, IFC na prvok v IfcZone vzťah nemá), zapnúť/vypnúť a režim auto/manual; vrstva vo vieweri s odznakom AIM a povýšenie do súboru ako ďalšie fázy.
- **2026-10-18** - **D-088 dodatok (prod):** migrácie nasadené, bootstrap revízií a load ASR v72 + VZT do prod DB (2226 platných, 549 zaniknutých objektov, 0 duplicitných GUID); nález 264 hrán na zaniknuté objekty a oprava (derive prepisuje koncové objekty, ručné väzby na nástupcu s rovnakým GUID).
- **2026-10-18** - **D-088 (platnosť objektov, projekt/zóny/skupiny ako uzly):** `objects.valid_until` pre objekty, ktoré žiadny model nevydáva (views, RPC a TS zoznamy ich filtrujú); `project`, `zone`, `spatial_zone`, `group` z IfcProject/IfcZone/IfcSpatialZone/IfcGroup s väzbami zo súboru; UI cez zovšeobecnený detail systému. Overené nad kópiou prod DB s v72: 2207 platných, 549 zaniknutých, 0 duplicitných GUID. + dodatok D-086 (odpovede Q1, Q2, Q4, Q7, Q10; OCB je súkromné).
- **2026-10-18** - **D-086 dodatok (fáza 1):** revízie `model_revisions`/`model_tasks`, `etl/model_publish.py` (poistka, compare-and-swap, revert, announce po re-ETL), `etl.main --model` (zdroj podľa modelu, uzavretie zastaraných hrán a GUID, rotácia rodiča), väzby dokumentov len na emitované objekty, `?rev=` v URL modelu a obnova viewera na `model_revision`. Zistené: ETL v71 nenačítal; starý postup by nechal 454 GUID na dvoch objektoch; 549 zaniknutých objektov (Q8); najnovší ASR je v72.
- **2026-10-18** - **D-086 (úpravy IFC cez agentov, F13):** IFC je master; úlohy z chatu (neskôr z BCF panela) bežia v GitHub Actions repa `Menezeris/OCB` (Claude Code s tokenom predplatného + ifcopenshell), výstup = recept + zoznam zmien; zápis po jednom cez compare-and-swap; nemenné revízie `ifc/archive/<model>/vNNN.ifc.gz` + `model_revisions`, aktuálna na doterajšom kľúči; zverejnenie hneď s technickou poistkou, bez IDS brány; re-ETL a broadcast "nová revízia". Mení D-084 bod 4. Fáza 0 overená (token, ifcopenshell na runneri, ETL dry-run nad v71).
- **2026-10-18** - **D-087 (pravidlo pre nové nástroje):** najprv tool z `@ifc-lite/mcp` 1:1 (prefix `ifc_`, opis a parametre z balíka, test proti registru), pohľad len ako adaptér v `apps/viewer/src/aim/`, vlastný nástroj len kde originál nič nemá, DB tools sa neduplikujú. Prvých 7 prevzatých tools motora.
- **2026-10-18** - **D-085 (spätný kanál viewer -> Claude):** `get_bounds` a `get_viewer_state` cez ten istý živý kanál (query/reply s id, timeout namiesto "odoslané"), `set_section` cez prvok (`fit` along/across/center) a na súradnici IFC (`coordinate_m`); súradnice počíta viewer (IFC svet, Z hore), fork bridge `QUERY`/`QUERY_RESULT` a rozšírený `SET_SECTION` len v `aim/`.
- **2026-10-18** - **D-084 dodatok (IDS):** IDS kontrola zatiaľ v IDS paneli viewera forku, uložené behy ifctesteru ostávajú; `IDS_SOURCES` sa nenastavuje; zdroj IDS pre server je otvorené rozhodnutie pre Samuela, najneskôr pred fázou 3.
- **2026-10-17** - **D-084 dodatok (fáza 1) + D-083 dodatok (fáza 1 implementovaná):** `ifc_*` tools motora prepojené na AIM cez GUID (za `ENGINE_ENABLED`), tools pohľadu `set_section`/`set_camera`/`set_view_mode` + `open_drawing.in_viewer`, `global_ids` v 3D tools, spoločný formát ops `lib/viewer-ops.ts`; fork: bridge `SET_SECTION`/`SET_CAMERA`/`SET_VIEW_MODE`. Brána 2 na Verceli prešla (studené 7,4 s, teplé < 0,6 s, ~715 MB), motor ostáva v procese.
- **2026-10-17** - **D-084 (IFC motor `@ifc-lite/mcp` ako knižnica v konektore) + dodatok D-083:** jeden konektor s tromi rodinami tools (AIM nad DB, `ifc_*` motor nad IFC súbormi, viewer cez bridge), výsledky motora prepojené na AIM cez GUID; bezstavový motor (nový backend na request); zápis ako propose -> commit s IDS bránou a nemennými revíziami (D-086). Pohľad ostáva bez súradníc, `scene.actions` až vo fáze 2. Fáza 0 meria Vercel a zhodu IDS motorov.
- **2026-10-17** - **D-083 (návrh: Claude ovláda viewer cez MCP, F12):** katalóg 17 use-casov overený voči kódu a živo (2, 4, 7, 16 stoja na dátach, nie na vieweri; 8 je len čiastočne). Fáza 1 = tools `set_section`, `set_camera`, `set_view_mode` + `open_drawing in_viewer` + reset cez existujúci `ops` formát a živý kanál, vo forku bridge `SET_SECTION`/`SET_CAMERA`/`SET_VIEW_MODE` nad existujúcimi volaniami (bez zmeny DB, bez zásahu do upstream súborov); fáza 2 spätný kanál, fáza 3 zápis a fáza 4 analýzy z upstreamu, každá so samostatným rozhodnutím. Upstream `@ifc-lite/mcp` sa nepreberá ako server. Čaká na schválenie (Q1-Q8).
- **2026-10-17** — **D-082 (výber prvku v 3D ako klik):** nový tool `select_in_3d` vydá viewer op `select::<guid>` (D-066 wire formát, živý kanál a záložný odkaz bez zmeny); host pošle bridge správu `SELECT{guid}`, fork ju vykoná ako klik (selekcia, kamera, panel vlastností) a odpovie `ENTITY_SELECTED`, takže AIM kartu dotiahne existujúci tok. Vyžaduje podporu `SELECT` vo forku.
- **2026-10-17** — **D-081 (kontrola modelu voči IDS z knižnice):** `python -m etl.ids_check` spustí ifctester s IDS, ktorý vyrobila knižnica požiadaviek (nekopíruje sa), výsledky do `ids_runs`/`ids_results` (prvok cez aktívny GUID, pôvod IDS so SHA-256), čítanie `v_ids_latest`/`v_ids_summary` pre LLM a 3D. ETL podlažia akceptujú `2.NP` (štandard knižnice) popri `2NP`.
- **2026-10-16** — **D-080 (odvodzovače; prvok → priestor):** rámec `etl/derive/` pre hrany odvodené nad federáciou (idempotentné, `source='derive:<rule>'`, zastarané sa uzavrú). Prvý odvodzovač `spatial_reference` zaraďuje prvky do priestorov geometriou ako **`rel_referenced_in_spatial_structure`** (IfcRelReferencedInSpatialStructure — neexkluzívny; spresňuje D-052, kde contained koliduje so SET[0:1]), zarovnanie federácie cez IfcMapConversion, ifcopenshell `geom.tree` (inside = celý v tele priestoru, partial = pretína), žiadna heuristika podhľadu. Pohľad `v_space_elements`. IfcZone tranzitívne, nie geometriou.
- **2026-10-16** — **D-079 (Claude cez MCP + živý kanál do viewera):** `POST /api/mcp/<MCP_TOKEN>` vystavuje tools `/ask` pre custom connector v Claude (Max, bez platby za tokeny); UI akcie idú cez Supabase Realtime Broadcast na kanál `LIVE_CHANNEL` do viewera otvoreného s `?live=<kanál>`, ktorý ich vykoná ako AI dock (`router.push`). Anon kľúč smie do prehliadača až po migrácii, ktorá odoberie `anon`/`authenticated` práva v `public` (mení D-026).
- **2026-08-02** — **D-075 dodatok (ribbon je toolbar aj na mobile):** upstream posielal každú malú obrazovku (`isMobile`: šírka < 768, alebo touch < 1024) do `MobileToolbar`, takže na telefóne ribbon — aj s našou záložkou `Documents` — vôbec nerenderoval (overené Playwrightom na profiloch iPhone 14 / Pixel 7 / iPad Mini: 44px lišta ikon, naše funkcie len v „…" menu; ribbon až od 1024 px). Teraz o toolbare rozhoduje **zvolený štýl, nie veľkosť obrazovky**: `ribbon` obsluhuje všetky šírky (44px pás, 36px ciele, vodorovne scrollovateľné záložky, bez uloženej voľby štartuje zbalený → 44 px; ťuknutie na záložku band otvorí len dočasne, pripína chevron), `classic` si na malých necháva `MobileToolbar` ako cestu späť. Prepínač v `ViewerLayout` je fork-only (sentinely), responzívnosť ribbonu + `lib/viewport.ts` + `ThemeSwitch size` sú generické (kandidát na upstream PR). AIMviewer bez zmien kódu.
- **2026-08-02** — **D-075 dodatok (záložka „Documents" v ribbone):** upstream sync spravil z tabbed ribbonu default toolbar, čím naše vstupné body (Documents, Underlays, 3D|2D|Split) ostali len v klasickom stripe a v ikonovej lište; doplnená fork-only záložka `Documents` (telo v `apps/viewer/src/aim/DocumentsRibbonTab.tsx`, zapojenie cez sentinely). Iba presun vstupných bodov, nula zmien správania.
- **2026-08-01** — **D-071 dodatok (sync sa merguje sám, hlási stav; audit driftu):** kontrola stavu ukázala, že fork je **146 commitov (~3 týždne) pozadu** — posledný upstream commit reálne na `main` je `beeb8ed5` z **2026-07-11**, upstream je na `ff03b862` (2026-08-01). Nešlo o jednu poruchu, ale o štyri: **(1)** oprava workflowu z 27. 7. nikdy nepristála na `main` — commity `eba104bc`/`ad78ca33`/`922bf8a0` ostali na vetve `claude/mame-zas-s-tymto-problem-uvo65y` **bez otvoreného PR**, a keďže GitHub cron číta workflow *vždy* z default branch, beh 3. 8. by padol identicky ako 20. a 27. 7.; **(2)** beh **13. 7. hlásil „success", hoci nevytvoril žiadny PR** — `gh` mieril na LTplus-AG a 403 zožralo `|| echo`, jediná stopa je osirotená vetva `sync/upstream-2026-07-13`, takže automat *nikdy* nedobehol celý cyklus; **(3)** PR #35 bol zelený od 27. 7. 13:50 a **päť dní ho nikto nezmergoval**, fork medzitým zaostal o ďalších 27 commitov — toto, nie CI, je hlavná príčina driftu; **(4)** o zaostávaní neinformovalo nič. Opravené vo forku (PR #36): každé `gh` volanie buď prejde, alebo zhodí beh (zlyhaný scheduled workflow pošle e-mail); **bezkonfliktný sync počká na CI a zmerguje sa sám** merge commitom, konfliktný ostáva s `needs-manual-merge`; každý beh (aj po zlyhaní, `if: always()`) prepíše jediný issue `Upstream sync status` — koľko commitov pozadu, ktorý upstream commit `main` reálne obsahuje, výsledok posledného behu a odpočet do expirácie PATu z repo variable `UPSTREAM_SYNC_TOKEN_EXPIRES`. CI sa čaká v jobe, nie cez `gh pr merge --auto`, lebo `--auto` merguje v momente mergeability — bez required status checks teda pred CI, a sync PAT nemá Administration scope na overenie, či sú nastavené. `FORK_MAINTENANCE.md` tabuľka touchpointov (označená za zastaranú v predošlom dodatku) pregenerovaná zo sentinelov: mala 3 súbory, realita je **9** vrátane `packages/renderer/src/index.ts` (generický external-overlay hook — najďalej postúpený kandidát na upstream PR). V AIMviewer: `@ifc-lite/geometry|query|wasm` **pinnuté na presnú verziu** (2.9.2 / 1.14.10 / 2.13.4 — zosúladené s guardrailom v ROADMAPe a s 24h cache `ifc-lite_bg.wasm` v `next.config.ts`) a pridaný `renovate.json` (pondelok, `@ifc-lite/*` v jednom PR, majory oddelene, dependency dashboard) — lock zamrzol na `e83ef55` (28. 6.) a nikto si nevšimol, že `@ifc-lite/wasm` medzitým vyskočil z 2.13.4 na **4.2.0**, dva majory. Majory sa zámerne nebumpli v tejto zmene — prídu ako samostatný Renovate PR, lebo AIMviewer nemá CI a každý bump treba overiť ručne receptom z `.claude/skills/verify`. **Overené naživo:** PR #36 zmergovaný → PR #35 (zelený, 30/30 checkov) domergovaný **merge commitom** → zaostávanie kleslo **146 → 27**; ostrý `workflow_dispatch` opraveného workflowu potom zmergoval upstream, pushol vetvu a otvoril **PR #37** (`ff03b862`, 27 commitov, 285 súborov, konflikty, oba labely) — celý cyklus teda po prvý raz dobehol. **Zlyhal však posledný krok:** `the 'AssetinSpace/ifc-lite' repository has disabled issues` — GitHub dodáva forky s **vypnutou feature Issues**, čo sme dovtedy nevedeli. Sync fungoval, červený bol kvôli reportingu; a červená za funkčný beh učí ignorovať červenú, teda presne ten návyk, ktorý nás stál tri týždne. Opravené v PR #38: status ide **vždy** do `$GITHUB_STEP_SUMMARY` (nepotrebuje žiadnu zapnutú feature), issue je best-effort a tolerovaná je **len** podmienka „has disabled issues" (warning + exit 0) — každé iné zlyhanie `gh` beh naďalej zhodí. `FORK_MAINTENANCE.md` dostal tabuľku nastavení, ktoré workflow očakáva. **Nastavenia, ktoré kód nevyrieši a treba klik v Settings:** zapnúť Issues (potom vznikne `Upstream sync status`, raz ho pripnúť) a nastaviť variable `UPSTREAM_SYNC_TOKEN_EXPIRES` = `2027-07-27`. **Otvorené:** `@assetinspace/design-kit` v AIMviewer ostáva `github:AssetinSpace/design-kit#main` (plávajúca vetva, v locku `git+ssh://`) — fork to už má ako HTTPS tarball pinnutý na `d41bbbb`, ale AIMviewer ide na **npm**, ktorý na rozdiel od pnpm robí HTTPS fallback, takže tu to build nerozbíja a je to reprodukovateľnosť, nie požiar; prepnutie sa nedalo dokončiť, lebo v tomto prostredí je GitHub HTTPS egress blokovaný (403) a lockfile sa nedá pregenerovať bez stiahnutia tarballu.
- **2026-07-27** — **D-071 dodatok (sync 40b4eab dorobený + `design-kit` cez HTTPS tarball):** prvý sync po oprave workflowu priniesol 8 konfliktov, dorobené ručne (PR #35, `sync/upstream-2026-07-27`). Rozhodnutia: `MainToolbar.tsx` upstream prepísal (−799/+81, refaktor do hookov) → vzatá upstream verzia + prenesené naše 4 zásahy, pričom toggle Drawing Underlays **zámerne nepoužíva** nový `handleToggleRightPanel` (je typovaný na `RightPanel` a mutually exclusive, náš panel koexistuje); `store/index.ts` a `registry.ts` = append konflikty, union s našimi položkami na konci; `collab-server` upstream refaktoroval do `access-control.ts` → vzatá upstream verzia + náš `startup-guard` nahrádza ich warn-only blok (fail-closed); `pnpm-lock.yaml` pregenerovaný, nie merdžovaný. **Bezpečnostne najdôležitejšie:** upstream pridal do `ViewerLayout.tsx` same-origin kontrolu pre `?model=` (drive-by model injection cez podvrhnutý odkaz). Doslovné „keep our side" by ju zahodilo, doslovné prevzatie by rozbilo AIM federáciu (modely idú zo Supabase = cross-origin). Zámer opravy preto presunutý do `parseAutoloadUrls` (`lib/autoload.ts`), kde už bol validačný gate: http(s) only + limit počtu + **same-origin ALEBO explicitný allowlist**, jednotne pre `?model=` aj `?models=`; allowlist cez `VITE_AIM_MODEL_ORIGINS` s defaultom na AIM storage bucket, takže stock deploy federuje bez konfigurácie a cudzí origin je odmietnutý ešte pred fetchom (4 nové testy vrátane „prázdny allowlist = upstream same-origin pravidlo"). **Druhý blokér:** `@assetinspace/design-kit` bol deklarovaný `github:` skratkou, ktorú pnpm **vždy** rezolvuje na SSH (`repo: git@github.com:…` v locku) bez ohľadu na to, či sa specifier napíše ako `git+https://` — overené proti prázdnemu store. CI runnery ani Vercel nemajú SSH kľúč, takže od pridania design-kitu (D-070 dodatok, 17. 7.) padal každý job inštalujúci viewer závislosti; nevšimli sme si to, lebo sync PR-ka vôbec nevznikali. Fix: HTTPS tarball pinnutý na `d41bbbb` (design-kit je verejný a bez build scriptov — len css/tokens/assets), žiadny kľúč ani zásah do CI. Overené: PR #35 celý zelený (Test vrátane Node tests, E2E, Typecheck, Rust, WASM + 6 ďalších workflowov). Zásahy do upstream súborov teraz **obalené `AIM-FORK` sentinelmi** — pred merge ich väčšina nemala (`MainToolbar`, `registry`, `store/index`, `collab-server` = nula), čo je priama príčina toho, prečo bolo konfliktov osem namiesto dvoch; `FORK_MAINTENANCE.md` tabuľka touchpointov je zastaraná a treba ju doplniť.
- **2026-07-27** — **D-071 dodatok (upstream sync beží na PATe):** behy 2026-07-20 a 2026-07-27 zhoreli na push kroku — `refusing to allow a GitHub App to create or update workflow .github/workflows/… without 'workflows' permission`. Upstream siahol na CI súbory (`test.yml`, nový `wide-arithmetic.yml`) a taký push default `GITHUB_TOKEN` nikdy neprejde: scope `workflows` sa v `permissions:` bloku nedá udeliť, pre `GITHUB_TOKEN` neexistuje. Beh 13. 7. prešiel len preto, že sa CI súborov nedotkol — nie je to regresia, ale časovaná bomba pri každom syncu s CI zmenami. `upstream-sync.yml` teraz autentikuje **fine-grained PATom** (secret `UPSTREAM_SYNC_TOKEN`, scoped na `AssetinSpace/ifc-lite`: Contents/Workflows/Pull requests/Issues = write) — checkout ho perzistuje pre `git push`, `gh` kroky cez `GH_TOKEN`; vedľajší zisk: sync PR spustí CI (PR od `GITHUB_TOKEN` ho zámerne nespúšťa). Preflight krok chýbajúci secret nahlási hneď, `gh pr create` už neprehĺta chyby cez `|| echo`. **Odstránenie toho prehĺtania hneď odhalilo druhý, starší bug:** `gh` si base repo odvodzuje z git remotes a uprednostňuje ten menom `upstream` — ktorý si krok „Fetch upstream" sám pridáva na LTplus-AG → `gh label create` aj `gh pr create` mierili na upstream (403). Bug tam bol od začiatku a `|| true`/`|| echo` ho maskovali: aj keby push býval prešiel, PR by nikdy nevznikol a workflow by hlásil zelenú; pri tokene s dosahom na upstream by sme im otvorili PR, čo D-071 zakazuje. Fix: `GH_REPO: ${{ github.repository }}` pinne všetky `gh` volania na fork. Zmena len vo forku (`.github/workflows/upstream-sync.yml`, `docs/FORK_MAINTENANCE.md` → „Sync token" + varovanie o `gh`), AIMviewer bez zmien kódu. Overené naživo: beh #6 zelený, vznikol PR #35 `sync/upstream-2026-07-27` s oboma labelmi. PAT expiruje (max 1 rok) — po expirácii sync padne na 403 pri pushi.
- **2026-07-24** — **D-078 (detekcia nového deployu):** `<VersionWatcher>` v root layoute polluje `GET /api/version` (`no-store`, `VERCEL_GIT_COMMIT_SHA`) každých 60 s + pri návrate na tab; pri zmene oproti prvému videnému SHA ukáže toast „Obnoviť" (nie auto-reload). Rieši „staré UI po deployi" — otvorený tab bežal starý JS. Bez závislosti na `NEXT_PUBLIC_*`; v dev SHA=`"dev"` → nevyskočí.
- **2026-07-17** — **D-077 (AIM inspector — viewer-first konsolidácia):** audit duplicít (dva ľavé stromy na `/ifc`, dva vzory detailu prvku) + rešerš 7 CDE nástrojov → rozhodnutie viewer-first: `AimPanelData v2` (zodpovednosti/captures/história) + tab lišta AIM | IFC v `PropertiesPanel` forku, per-GUID badge dekorácie natívneho stromu (`AIM_TREE_DECORATIONS`, `lib/data/decorations.ts` bez migrácie), host sidebar sa na `/ifc` nerenderuje (`SidebarGate`), jednotný render detailu `AimPanelView` (2D `ElementInfoPanel` = tá istá schéma), `/api/element` obohatený (reuse `fetchNodeSections`), `filter-bar.tsx` zmazaný. Logika ostáva v hoste (D-071); deploy fork-first. Implementované na vetve `claude/aim-viewer-ifc-consolidation-r7z04q` (oba repá).
- **2026-07-17** — **D-076 (identifikátorové hyperlinky v 2D IFC-lite prehliadači):** kódy prvkov v texte PDF pôdorysu (pdf.js text items) sa rozpoznávajú konfigurovateľným regexom a renderujú ako klikateľné linky v `DrawingPlanPane`; klik = tie isté selection akcie ako pick v scéne (select + Information panel). Zdroj identifikátora konfigurovateľný per projekt (Name/Description/ObjectType/Tag/Pset.property, fallback poradie), index kód→GlobalId nad všetkými modelmi budovaný raz s cache, duplicity preferujú podlažie výkresu + výber kandidátov, not-found = plain text (debug obrys). Celé genericky vo forku ifc-lite (`lib/identifier-links/`, `identifierLinksSlice`, `IdentifierLinkLayer`, settings v underlay paneli), AIMviewer bez zmien kódu. Testy 27/27 nové, viewer 1768 pass, typecheck čistý.
- **2026-07-17** — **D-070 dodatok (aplikované na IFClite fork):** viewer fork prebrandovaný cez design kit — `@assetinspace/design-kit` git závislosť v `apps/viewer`, nová vrstva `src/aim/assetin-theme.css` (import po `index.css`): remap upstream Tokyo Night palety (`--tokyo-*`) na semantické `--ds-*` aliasy (povrchy navy, primary/ring brand green, cyan→info, teal/green→success, red→danger, yellow→warning) + shadcn `--color-*` a hierarchy/tabs premenné pre light aj dark; Inter font, assetin favicony a brand `theme-color` v `index.html` (AIM-FORK markery). `.colorful` režim ostáva zámerne upstream. AIMviewer už zmeny nepotreboval.
- **2026-07-16** — **D-075 M1–M3 implementované (projektová dokumentácia v jednom rozhraní):** fork — prepínač 3D|2D|Split v `MainToolbar`/`MobileToolbar` (`ViewModeSwitcher` + `useViewMode`, derivovaný režim; `underlayPlanFull`/`underlayLastStoreyGuid` v `drawingUnderlaySlice`, `enterPlanView` v `useFloorplanView`, kolabovateľný `viewport-3d-panel`, výber výkresu pri >1 v `DrawingPlanPane`); documents workspace (`documentsSlice` + testy, panel `documents` v registry, `DocumentsPanel` drag&drop, `DocumentPane` karty napravo od 3D, `PdfDocumentView` virtualizovaný ≤2400 px LRU ≤4, `ImageDocumentView`, mobil overlay); bridge `DOCUMENTS_LOAD`/`DOCUMENT_OPEN`/`DOCUMENT_EVENT` (+ testy). AIMviewer — `lib/data/documents.ts` `fetchProjectDocuments()` (kind podľa E3 role/prípony, folder = Výkresy/podlažie alebo purpose, meta revision/status/purpose), push v `ifc-viewer.tsx` po MODELS_LOADED, `?doc=` deep link cez `/ifc` page. Odchýlky v dodatku D-075.
- **2026-07-16** — **D-075 (kandidát: projektová dokumentácia v jednom rozhraní):** koncept z analýzy CDE prístupov (Dalux/Revizto/ACC/Procore) — prvotriedny prepínač 3D|2D|Split v toolbare ifc-lite (derivovaný režim nad D-072 flagmi, `underlayPlanFull`), documents panel + karty dokumentov v resizable center pane (textové PDF virtualizovane, obrázky), bridge `DOCUMENTS_LOAD`/`DOCUMENT_OPEN`/`DOCUMENT_EVENT`; genericky vo forku (standalone s lokálnymi súbormi), AIMviewer dodá dáta; `/drawing/[id]` ostáva. Fázy M1–M4; implementácia až po diskusii.
- **2026-07-16** — **D-074 (zoskupenie stromu podľa IFC triedy):** pod uzlom s assetmi (≥2 triedy) sa potomkovia zoskupia do rozbaľovacích skupín podľa `ifc_type` s počtom členov (`IfcSpace` prvá, zvyšok abecedne); skupina nie je AIM objekt (bez `/node/` odkazu, open-stav pod `${parentId}::${ifcType}`); čisto prezentačná vrstva v `components/spatial-tree.tsx`, bez zmien data vrstvy/DB.
- **2026-07-14** — **D-073 (Reality Capture v1):** modul fotiek + statických 360° panorám ukotvených 2D/3D/IfcSpace, obojsmerne. Model „ako dokumenty" (D-018): `object_type='capture'` + prípona `captures`, `object_type='capture_media'` + prípona `capture_media` (analóg `documents`), ukotvenie v rezervovanom `properties._capture` (vzor `_georef`). Prvé `aim_` hrany manifestu (`aim_rel_capture_located`, `aim_rel_capture_media`, export ICDD). Úložisko = Supabase bucket `captures` + server-side `sharp` thumbnaily; 360 = Photo Sphere Viewer host-side (BIM engine je WebGPU → žiadna three.js kolízia). Zápis za env bránou `CAPTURE_WRITE_ENABLED` (D-068/D-072), single-project. 3D piny vo forku (reuse `annotationsSlice`/`AnnotationLayer`). Migrácia `20260716120000`. Zatvára otvorené body D-065.
- **2026-07-14** — **D-072 (georeferencované PDF podklady):** Dalux-style „Locations" — PDF pôdorys naviazaný na podlažie (2-bodová kalibrácia → similarity transform, Z z elevácie podlažia, väzba cez IFC storey GlobalId); nový upstreamovateľný balík `@ifc-lite/drawing-underlay` vo forku (WGSL textúrovaná rovina) + AIM bridge `UNDERLAYS_LOAD`/`UNDERLAY_SAVE`; perzistencia `_georef` v `objects.properties` dokumentu (bez migrácie). Supersedovuje D-038/D-039.
- **2026-07-12** — **Dodatok D-066 (výber podľa vlastnosti psetu):** `style_in_3d` dostal `property`+`value`(+`pset`) — psety z `v_property_dictionary`, match `or()` nad JSONB cestami na `v_asset_effective` (dedičnosť z typu), case-insensitive presná zhoda; prompt zakazuje aproximovať vlastnosť triedami (fix „nosné prvky" izolovali aj LoadBearing=false).
- **2026-07-12** — **D-071 (stratégia forku IFClite):** fork `AssetinSpace/ifc-lite` originálu `LTplus-AG/ifc-lite` konzumujeme ako optimalizovaný fork — vlastná AIM vrstva v `apps/viewer/src/aim/`, wiring obalený `// >>> AIM-FORK … // <<< AIM-FORK`, upstream sa preberá periodickým **merge** (nie rebase) cez `upstream` remote, sync spúšťa bot-PR (`.github/workflows/upstream-sync.yml`) vo vlastnom repe (fetch je read-only voči originálu); CI heavy joby na forku bežia na `ubuntu-latest` (Depot upstream-only), release/docs/docker guardnuté upstream-only. Recept: `ifc-lite/docs/FORK_MAINTENANCE.md`.
- **2026-07-12** — **D-070 dodatok (aplikované na AIMviewer):** kit v0.1.0 pushnutý do `AssetinSpace/design-kit` (vetva `claude/design-system-archive-8iy6go`); AIMviewer prebrandovaný — kit ako git závislosť, `shadcn.css` import namiesto defaultných tokenov, Inter namiesto Geist, assetin mark v sidebar hlavičke + favicon. Overené devtest+Playwright (light/dark), tsc, vitest 22/22.
- **2026-07-12** — **D-070 (assetin design kit):** rozhodnutie o zdieľaných brand tokenoch — nový repo `AssetinSpace/design-kit` (tokens.css + tokens.json, plain-CSS adaptér pre ArchiveApp, shadcn adaptér pre AIMviewer, logá, showcase), light+dark; AIMviewer = prvý konzument.
- **2026-07-12** — **D-069 (hlasový vstup pokynov):** dictation pattern v ask-paneli (MediaRecorder → `/api/transcribe` → editovateľný prepis do inputu, žiadne auto-send) + STT provider vrstva `lib/stt/` (default Gemini `inline_data` audio na existujúcom kľúči — demo zadarmo; mock pre testy); doménový slovník v prompte; ochrana routy podľa D-068.
- **2026-07-12** — **D-068 (ochrana /api/ask):** per-IP sliding-window rate limit (20/10 min, len prod, env override) + cross-origin guard v `lib/api-guard.ts`; 429 + Retry-After; in-memory per inštancia (vedomý trade-off). Nález nočného auditu.
- **2026-07-12** — **D-067 (AIM karta v paneli viewera):** host render schéma `lib/aim-panel.ts` → bridge `AIM_PANEL_DATA`/`AIM_PANEL_EMPTY` → fork `AimCard.tsx`; kliky späť cez `AIM_NAVIGATE`; `ElementInfoPanel` overlay nahradený natívnym panelom; `NEXT_DIST_DIR_OVERRIDE` pre paralelný devtest server.
- **2026-07-12** — **D-066 (AI chat ovláda 3D scénu):** tool `style_in_3d` (colorize/hide/show/isolate/show_all/reset_colors; výber filtrom ifc_type/predefined_type alebo ids_or_refs, cap 400) → URL `ops` wire formát → nové bridge správy do IFClite forku (COLORIZE/HIDE/SHOW/ISOLATE/SHOW_ALL/RESET_COLORS → `bim.viewer.*`). Efekty sa hromadia, reset explicitný. Zároveň doplnený stratený nadpis D-065 (pasportizácia).
- **2026-07-11** — **Dodatok D-050 (georeferencovanie federácie):** viewer prešiel z `exportGlb`
  na IFClite low-level pipeline so zdieľaným RTC offsetom prvého modelu + delta `IfcMapConversion`
  ako group transform — modely federácie už sedia na sebe ako v iných prehliadačoch.
- **2026-07-11** — **D-057 verified hodnoty + D-064 kandidát:** eval sada overená proti prod datasetu (42/44 verified; verifikačný SQL cez Supabase SQL editor); runner `--questions <cesta>` pre per-projekt sady; D-064 = inventúra multi-projekt pripravenosti LLM vrstvy (grounding vrstvy data-driven; jediná prerekvizita = `project` entita z D-033).
- **2026-07-10** — **D-063 (obsah dokumentov):** `document_pages` (text PDF strán, `etl/pdf_text.py` cez PyMuPDF, idempotentné) + RPC/tool `search_documents` (FTS + snippet + deep_link na stranu). OCR mimo scope. Migrácia `20260715120000`.
- **2026-07-10** — **D-062 (výber produkčného modelu):** procedúra eval-driven výberu (kandidáti claude-sonnet-5 / claude-haiku-4-5 / claude-opus-4-8 / platený Gemini; ciele: negative 100 %, psets_custom ≥ 75 %, celkovo ≥ 85 %). Beh po nasadení D-058–D-060 a doplnení verified eval hodnôt; zmena čisto env.
- **2026-07-10** — **D-061 (statický IFC slovník psetov):** `etl/pset_manifest.py` (PsetQto šablóny z ifcopenshell, deterministický --sql) → tabuľka `ifc_property_definitions` (973 properties / 127 psetov pre triedy projektu; description/data_type/enum/applicable_classes) vo whiteliste. Migrácia `20260714120000`.
- **2026-07-10** — **D-060 (agregácie + numerika):** RPC `aggregate_objects` (sum/avg/min/max/count + group_by + numericky bezpečné filtre nad psetmi, guarded cast + skipped_non_numeric, interné whitelisty) + tool + guidance guard v query_view (gt/lt nad JSONB = text). Migrácia `20260713120000`.
- **2026-07-10** — **D-059 (fulltext nad všetkým):** `objects.search_text` (generated, unaccent+lower flattening psetov) + GIN tsvector/trgm indexy + RPC `search_everything` (FTS + fuzzy, matched_properties ako dôkaz) + tool a prompt. Custom psety sú prvýkrát vyhľadateľné. Migrácia `20260712120000`.
- **2026-07-10** — **D-058 (runtime slovník psetov):** view `v_property_dictionary` (pset × property × typ × vzorky z reálnych dát, aj custom psety) + rozšírený `get_model_stats` (psety, podlažia, systémy, klasifikácie, dokumenty) + prompt „nehádaj názvy psetov". Migrácia `20260711120000`.
- **2026-07-10** — **D-057 (eval harness):** zlaté otázky `eval/questions.json` + runner `scripts/eval-ask.ts` (`npm run eval`) — deterministické skórovanie answer/sources/no_facts, verified workflow nad prod datasetom, mock smoke overený. Štart programu presnosti LLM dotazov (→ D-058…D-063).
- **2026-07-09** — **D-056 kadencia 1 (F6 — LLM rozhranie):** provider vrstva `lib/llm/` (Anthropic cez fetch + mock, API-pluggable), read-only tools nad whitelist views s row-capom, agentická slučka `/api/ask`, trust-loop zdroje zbierané deterministicky serverom (deep-linky karta/3D/výkres), UI `/ask`.
- **2026-07-09** — **D-050 (3D vrstva federácie):** multi-model render ASR+VZT v jednej scéne, identita cez IFC GUID, floor filter cez normalizované podlažie.
- **2026-07-09** — **Výkon preklikávania, kolo 2 (dodatok 2 D-030):** spinner na kliknutom
  odkaze (`useLinkStatus`), priestorový graf ako jeden zdieľaný cache záznam (prvý klik na
  nový uzol už nenačítava celý graf z DB), `prefetch={true}` na nav linkách +
  `staleTimes` klientská router cache.
- **2026-07-09** — **Výkon preklikávania (dodatok D-030):** streaming S3 sekcií `/node/[id]`
  cez `<Suspense>`, paralelný dispatch `fetchNode`+`fetchObjectMeta`, orezané DB waterfally
  (`fetchResponsibilities` 4→3, `fetchAssetType` ~5→2 round-tripov). Bez zmeny schémy/API.
- **2026-07-07** — **F1 nasadené na Supabase prod (D-051):** migrácia `relationships_metamodel`
  na `acwoupricatirhlfkhvk`; cleanup D-048 compat views; migračná história sync (8 migrácií =
  `supabase/migrations/`); 4461 hrán, PostgREST reload.
- **2026-07-07** — **F1 implementované (D-051):** meta-model vzťahov B — generická
  `relationships` (diskriminátor `rel_type`) + manifest `relationship_types` (z `ifcopenshell`)
  + kanonické views rovnakého názvu ako `rel_*` (bezvýpadkový cutover) + validačný trigger;
  migrácia `20260707150000`, ETL/seed repointnuté na base tabuľku, D-031 idempotencia zachovaná.
- **2026-07-07** — Plánovacie kolo (nové inputy k demu): D-051 (meta-model vzťahov B — generická `relationships` + kanonické views + manifest; revízia D-048), D-052 (geom cross-file containment + IDS), D-053 (upload+verifikácia), D-054 (PDF rework), D-055 (3D/IFClite port), D-056 (LLM rozhranie). D-050 rezervované (3D federácia).
- **2026-07-07** — Dokumentačná konsolidácia (D-017 v praxi): `AGENTS.md` = zdroj pravdy konvencií, nástrojové súbory sú pointery. Pripravuje sa D-050 (3D vrstva federácie D-049).
- **2026-07-05** — D-048 (IFC-kanonická vrstva hrán) + D-049 (federácia disciplinárnych modelov, VZT) rozhodnuté a implementované.
- **2026-07-02** — D-046 (IFC alignment: IFC4.3 teraz, pripravené na IFC5/IFCX) + D-047 (demo north-star: LLM nad grafom + trust loop).
- **2026-06-28** — Zjednotenie vetiev do `main`; D-045 (kandidát: pasportizácia + dynamika).
- **2026-06-22** — D-044 (IFC 3D viewer — IFClite, geometria ephemerálna cez GUID); sprint DV (D-042/D-043).
- **2026-06-20** — D-036 (CDE naming), D-040 (`IfcSpace.LongName`), D-041 (E4 auto-linking), D-042 (plánovaná prehliadačka výkresov).

### D-097 - ifc_relations: všetky IFC vzťahy entity zo súboru, so smerom, rekurziou a stránkovaním

**Dátum:** 2026-10-19 · **Stav:** implementované (PR, čaká na merge) · **Súvisí:** D-084, D-087, D-088, D-090 · **Issue:** #67

**Kontext:** Claude cez konektor nevedel odpovedať na "ktoré priestory sú prenajímateľné", "kto patrí
do systému Prívod-1NP" ani "ku ktorým zónam patrí miestnosť". `ifc_get` členov IfcZone/IfcGroup
nevracia, `list_relations` vidí len graf AIM (zóny a prvky bez `object_id` v ňom nie sú) a má strop
100 riadkov bez stránkovania, porty a ich prepojenia (IfcRelNests + IfcRelConnectsPorts) nevidel vôbec.
Pravidlo z požiadavky: čo je viditeľné v UI viewera, musí vedieť prečítať aj Claude.

**Overenie (D-087, krok 1):** `@ifc-lite/mcp` 0.27.0 má tool `relationships`, ktorý vráti všetky hrany
grafu entity v oboch smeroch s presnou triedou IfcRel* (AssignsToGroup, Nests, ConnectsPorts,
ConnectsPortToElement, SpaceBoundary*, Voids/Fills, Contained/ReferencedInSpatialStructure,
DefinesByType, Associates*, ServicesBuildings...). Motor ho mal povolený (`ENGINE_UPSTREAM_TOOLS`),
len nevystavený. Chýba mu filter, rekurzia, stránkovanie a GlobalId druhej strany, takže stačí
adaptér, nie vlastné čítanie IFC.

**Rozhodnutie:**
1. Nový tool motora `ifc_relations` (`lib/engine/relations.ts`, registrácia v `tool-defs.ts` a
   `tools.ts`): `target` = object_ref / objects.id / GlobalId (aj entita mimo grafu AIM), `model?`,
   `rel_types?`, `direction` forward | inverse | both, `recursive`, `through_ports`, `limit` 1-200 a
   `cursor`.
2. Smer je smer balíka: forward = entita je Relating strana (skupina -> členovia, podlažie -> prvky,
   celok -> časti, prvok -> porty), inverse = kam entita patrí.
3. `recursive` ide do šírky cez tie isté triedy a smer, max hĺbka 10, každá entita raz (riadok nesie
   `depth` a `via`). Bez `rel_types` ide len cez IfcRelAssignsToGroup: cez všetky vzťahy by sa z
   jednej zóny rozliala cez hranice priestorov a otvory do celého modelu (overené: 2361 vzťahov z
   "Požiarne úseky" namiesto 24 úsekov). Strop prechodu 20 000 vzťahov, nad ním `incomplete`.
4. `through_ports` = jeden krok sieťou: vlastné porty (IfcRelNests, v IFC2X3 IfcRelConnectsPortToElement)
   -> IfcRelConnectsPorts -> port druhej strany -> jeho hostiteľský prvok; riadok nesie `via_port` a `port`.
5. Bez `rel_types` sa skrývajú IfcRelDefinesByProperties (psety a Qto dáva `ifc_get`).
6. Výstup: cieľ, `total` a `counts` (po triede a smere) za celý výsledok, `items` (rel_type, direction,
   global_id, ifc_type, name, object_ref/object_id len ak ich AIM pozná), `next_cursor` (null =
   koniec), `unmapped`, `show_in_3d`. Dávka sa skráti tak, aby JSON nikdy nebol orezaný uprostred;
   strop odpovede 40 000 znakov (ostatné `ifc_*` 20 000), aby systém s 824 členmi prešiel na 5 stránok.
7. Pravidlo v `ENGINE_RULES` (`lib/llm/system-prompt.ts`): úplný zoznam členov a vzťahy entít len v
   súbore -> `ifc_relations`, `list_relations` ostáva pre graf AIM. `list_relations` sa nemení.

**Overené nad ASR a VZT (lokálne, bez DB):** "Nájomné priestory" rekurzívne 36 členov (vnorené zóny
NJ a ich miestnosti, 1,7 s so studeným načítaním), "Technické priestory" 11 miestností, "Požiarne
úseky" 24 IfcSpatialZone, systém Odvod-2NP 824 vzťahov (823 členov + IfcRelServicesBuildings) po 200,
vyústka VV.02.01.006 cez porty -> tvarovka TA.02; teplé volania 1-230 ms.

**Mimo rozsahu:** import zón a členstva do grafu AIM (návrh v issue) je úloha ETL (D-088), nie toolu
konektora. Otázka Samuelovi je v issue #67.

---

### D-095 - `ifc_search`: full-text priamo v IFC súbore, zdroj pri každom výsledku
**Status:** rozhodnuté (2026-10-19), implementované (issue #66, PR #89).
**Rozširuje D-059, D-084, D-087.**

**Kontext:** Claude cez konektor nenašiel "karuselové dvere" ani "prenajímateľné priestory".
V ASR má IfcDoor `DD01.08.0001` atribút Description "Karuselové dvere" a IfcZone "Nájomné
priestory" LongName "Nájomné priestory (prenajímateľné)". Graf AIM tieto atribúty nenesie
(`objects` nemá Description, ObjectType, Tag ani LongName zón), takže `search_everything`
(D-059) ich nájsť nemôže, a `ifc_query` vie len triedu a presné podmienky psetov. Navyše
nebolo jasné, ktoré hľadanie ide do IFC a ktoré do DB. `@ifc-lite/mcp` 0.27.0 full-text tool
nemá (`query_entities`, `ids_schema_search` a `bsdd_search` hľadajú niečo iné).

**Rozhodnutie:**
1. **Nový tool `ifc_search`** (D-087 bod 3, vlastný nad balíkom): dáta berie cez
   `query_entities` + `get_entities_bulk` balíka, hľadanie je v `lib/engine/search.ts`. Index sa
   postaví raz na parsovaný store (nemení sa, vzor indexu GlobalId v `ifc_get`) a obsahuje
   atribúty (Name, Description, ObjectType, Tag, LongName, PredefinedType...), psety a Qto
   výskytu aj z typu, klasifikácie a materiály - prvkov, priestorov, zón, skupín, systémov aj
   typov (IfcTypeObject).
2. **Zhoda:** bez diakritiky a veľkých písmen, každé slovo dotazu musí sedieť v niektorom poli
   (začiatok slova alebo podreťazec od 3 znakov), inak fuzzy (Levenshtein 1 od 4 znakov, 2 od 8
   znakov, aj voči začiatku slova). Skóre zvýhodní Name/Description/LongName/ObjectType a
   celú frázu v jednom poli.
3. **Vstupy:** `text`, `model?` (inak všetky modely), `ifc_types?` (vrátane podtried),
   `fields?` (attribute | property | quantity | type_property | classification | material),
   `fuzzy?`, `limit`/`offset`. **Výstup:** `source: "ifc"` pre celý výsledok a pri každej
   položke `source` `ifc` (len v súbore) alebo `ifc+aim` (AIM prvok pozná, má `object_ref`),
   `matched` (pole, cesta, hodnota ako dôkaz), `match_kind`, `score` a `show_in_3d`.
4. **Zdroj v opisoch:** `search_everything` = "ZDROJ: graf AIM v DB", `ifc_search` = "ZDROJ:
   IFC súbor"; pravidlo v MCP inštrukciách (len pri zapnutom motore): text hľadaj v oboch,
   "nenašiel som" až po oboch, v odpovedi uveď zdroj.
5. **`search_everything` sa nepremenúva** na `aim_search` (návrh z issue): používa ho aj chat
   `/ask`, evaly a prompt, premenovanie by rozbilo staré rozhovory. Samuel potvrdil v #66.
6. **Kombinované `search_all`** (dodatok 2026-10-19, na žiadosť Samuela v #66: "kombinované,
   ale tak, aby bolo jasné, čo je čo, s badge a filtrovateľné"): jedno volanie hľadá naraz cez
   `ifc_search` aj `search_everything`, výsledky spojí podľa `objects.id` (IFC prvok ho má, ak
   ho AIM pozná), inak podľa GlobalId. Každý výsledok má **badge** podľa toho, kde sa našiel
   TEXT: `IFC`, `AIM` alebo `IFC+AIM`; či prvok AIM pozná, ukazuje `object_ref` (badge `IFC` s
   `object_ref` = prvok je v AIM, ale text je len v súbore, napr. Description). Dôkaz z každého
   zdroja je v `evidence.ifc` / `evidence.aim`. Vstup `badges` filtruje, `counts` sú počty po
   badge pred filtrom; `ifc_types` a `model` zúžia aj AIM časť. Poradie: `IFC+AIM` najprv,
   potom podľa poradia v zdroji (skóre zdrojov nie sú porovnateľné). Zlyhanie jedného zdroja
   je v `errors`, druhý ostane. Len MCP a len pri zapnutom motore (bez neho je to
   `search_everything`); kód `lib/engine/search-all.ts`, prompt odporúča `search_all` ako prvý
   krok. `ifc_search` aj `search_everything` ostávajú na cielené hľadanie v jednom zdroji.

**Zavrhnuté:**
- *Description/LongName/ObjectType/Tag do grafu AIM (ETL):* vyrieši len atribúty, nie
  neimportované psety, Qto a materiály; a druhý nositeľ dát, ktoré sú v súbore (D-084).
  Ak ich AIM bude potrebovať ako stĺpce (IFC-first, D-046), je to samostatné rozhodnutie.
- *Rozšíriť `ifc_query` o `contains` na atribútoch:* balík atribútové termy v selektore
  nepodporuje a full-text naprieč poliami by aj tak potreboval vlastný index.

**Najprv to, čo existuje (D-098), overené 2026-10-19 vo forku `Menezeris/ifc-lite`:**
originál full-text, ktorý by sa dal použiť na serveri, nemá. Prejdené miesta:
- viewer `apps/viewer/src/lib/search/tier0-scan.ts` a `tier1-index.ts` (hľadanie v toolbare a
  v `SearchModal`): indexuje len Name, GlobalId, Description, ObjectType a triedu z
  `EntityTable`, bez psetov, Qto, LongName, klasifikácií a materiálov, bez odstránenia
  diakritiky a bez fuzzy; je to kód aplikácie viewera (nie balík), na serveri ho nemáme;
- `@ifc-lite/query` (`filter-predicate.ts`, `property-filter.ts`): operátory `contains` a
  `matches` nad jednou vlastnosťou, nie hľadanie naprieč poľami;
- `@ifc-lite/sdk` (`bim.query`): rovnaké filtre ako `@ifc-lite/query`; `search` má len
  namespace bSDD;
- `@ifc-lite/mcp` 0.27.0: `query_entities`, `ids_schema_search`, `bsdd_search`;
- embed protokol: hľadanie nemá.
Vlastný index v `search.ts` preto ostáva; z viewera preberá len princíp (index raz po
načítaní, tokeny slov) a pridáva polia, ktoré viewer nehľadá.

**Overené (2026-10-19, lokálne nad ASR v71 a VZT z verejného bucketu):** prvé volanie nad
oboma modelmi 4,8 s vrátane sťahovania a parsovania (index ~2 s), ďalšie 3-320 ms.
"karuselové" -> IfcDoor `DD01.08.0001`, IfcDoorType `DD01.08` (Description) a krytina
`PD02.11` (materiál); "prenajímateľné" -> IfcZone "Nájomné priestory" (LongName); preklep
"karuzelove" nájde to isté ako fuzzy; "protipožiarne" 0 (v súboroch naozaj nie je). Vitest
`lib/engine/search.test.ts` nad mini modelom. Evaly `/ask` motor neobsahujú (ifc_* sú len v
MCP), otázky z issue sú v `eval/questions.json` ako neoverené.

---

### D-099 - BCF témy nad modelmi federácie; téma pre Claude spustí session
**Status:** rozhodnuté (2026-10-19, Samuel: "súhlasím, začni" na tri body nižšie), fázy A, B a C
implementované na vetve `claude/serene-ptolemy-r16t1s` (AIMviewer aj OCB). **Mení D-086 body 3, 8 a 9 a fázy 3-4;
rieši issue #78** (`create_bcf_topic`). Nadväzuje na D-085 (stav viewera), D-087 (tools
originálu), D-090 (routine) a D-098 (najprv existujúce).

**Kontext:** Samuel (19. 10.): keď na našich modeloch (ASR, VZT, neskôr ďalšie) uvidím niečo
chybné, založím BCF tému (sám vo vieweri alebo cez Claude v chate), uvidím ju v zozname BCF a
zároveň vznikne Claude session, ktorá ju vyrieši, tak ako pri aplikácii (D-090). Dnes existuje
len `model_tasks` v tvare BCF témy (D-086 fáza 1), ktorý nič nezapisuje; F13 fázy 2-4 sa
nezačali (overené v histórii sessions a v repách). Konektor nemá žiadny BCF tool.

**Rozhodnutie:**
1. **Nositeľ témy je riadok `model_tasks`, nie GitHub issue.** Jedna tabuľka pre všetky BCF
   témy nad modelmi federácie; úprava modelu je len téma priradená Claudovi. Pri aplikácii je
   nositeľom issue (D-090), tu nie: téma nesie pohľad a výber prvkov a musí byť v BCF zozname
   viewera. Session, PR a revízia sú v téme len odkazy (`session_url`, `run_url`,
   `result_revision`). Tabuľka sa nepremenúva (`etl/model_publish.py --task` ju už uzatvára).
2. **Polia podľa BCF API 2.1 topic** (migrácia `20261019120000`, SCHEMA §2.14): `number`
   (poradové číslo, BCF `index`), `topic_type` (predvolene `Issue`), `status` (`open`,
   `in_progress`, `resolved`, `closed`, `conflict`, `failed`; BCF Title Case sa mapuje bez
   ohľadu na veľkosť písmen), `priority`, `assigned_to`, `due_date`, `labels`, `stage`,
   `modified_by`, `session_url`; `model` môže byť prázdny (téma nad celou federáciou).
   Komentár sa pridáva atomicky funkciou `model_task_add_comment` (session a človek píšu naraz).
   `viewpoint` = BCF pohľad z viewera: kamera (IFC svet, Z hore, m), rez, režim, podlažie a
   výber (`components` = IFC GlobalId).
3. **MCP tools 1:1 z `@ifc-lite/mcp` 0.27 (D-087):** `bcf_topic_create`, `bcf_topic_list`,
   `bcf_topic_update`, `bcf_topic_close`, `bcf_viewpoint_create` s menami a parametrami originálu
   (`title`, `description`, `author`, `type`, `status`, `priority`, `assigned_to`, `labels`,
   `guid`, `comment`, `modified_by`, `selection_global_ids`). Originál drží témy v pamäti jednej
   MCP session; náš konektor je bezstavový, preto rovnaké tools ukladajú do DB (`lib/bcf/`).
   AIM rozšírenia: `model`, `target_ids_or_refs` / `global_ids` (prvky ako vo view tools),
   `capture_view` (pohľad a výber z otvoreného viewera cez `view_state`, D-085), `due_date`,
   `start_session`; `bcf_topic_list` filtruje aj `model`, `assigned_to`, `guid` a vráti detail
   s komentármi. `bcf_export` a `bcf_publication_*` sa zatiaľ nepreberajú (súbor a externé CDE,
   fáza D).
4. **Session len pre tému priradenú Claudovi** (`assigned_to` = `claude`, bez ohľadu na veľkosť
   písmen). Témy pre ľudí ("priraď projektantovi VZT") session nespúšťajú. Server zavolá routine
   **"AIM: BCF téma"** cez API trigger (vzor D-090, env `CLAUDE_BCF_ROUTINE_FIRE_URL`,
   `CLAUDE_BCF_ROUTINE_TOKEN`), zapíše `session_url`, komentár a stav `in_progress`. Strop
   súbežných sessions `BCF_MAX_SESSIONS` (predvolene 3; počítajú sa témy `in_progress` so
   session, ktoré sa hýbali za 24 h); nad stropom téma čaká ako `open` priradená Claudovi a
   spustí ju `bcf_topic_update` so `start_session=true`. Bez routine téma tiež čaká, nič sa
   nestratí.
5. **Riešenie beží v Claude session, nie v GitHub Actions** (mení D-086 bod 3, Samuel 19. 10.):
   session sa dá otvoriť a môže sa pýtať. Pracovisko je repo OCB (recept, zoznam zmien);
   zverejnenie revízie ostáva workflow s technickou poistkou a compare-and-swap (D-086 body
   4-7 platia). Session píše do témy komentáre a stav cez `bcf_topic_update` konektora a
   revíziu s `--task` (téma -> `resolved`, `result_revision`).
6. **BCF tools sú na hlavnom konektore, nie pod `MCP_WRITE_TOKEN`** (mení D-086 bod 9):
   téma nemení model ani graf AIM, mení ho až session cez revíziu s poistkou; potreba vzniká
   počas bežnej práce (rovnaký dôvod ako D-090 bod 6). Zápisové tools majú
   `readOnlyHint:false`, klient si pýta súhlas.

**Najprv to, čo existuje (D-098), overené 2026-10-19 vo forku `Menezeris/ifc-lite` (`e4508ef0`):**
- `@ifc-lite/mcp` 0.27 má BCF tools (vyššie) nad `@ifc-lite/bcf`; preberáme ich tvar.
- BCF panel viewera (`apps/viewer/src/components/viewer/bcf/`) vie zoznam, detail, pohľady,
  koncepty a **pripojenie na BCF API 2.1 server** (`BCFServerConnectForm`, autentifikácia aj
  vloženým tokenom, `bcf-server-presets.ts`) cez `packages/bcf-api`. Témy z DB sa teda do
  zoznamu viewera dostanú BCF API serverom v AIMvieweri (fáza B) bez zmeny upstream súborov
  forku; most v `aim/` ho môže neskôr pripojiť sám.

**Fázy:**
- **A (táto vetva):** migrácia, `lib/bcf/` (tools, uloženie, spustenie routine), registrácia
  v MCP, pravidlo v inštrukciách konektora.
- **B:** BCF API 2.1 v AIMvieweri nad `model_tasks` (`app/api/bcf/[...path]`, `lib/bcf/api.ts`),
  báza `<site>/api/bcf`. **Jeden projekt `aim` = celá federácia** (téma nemusí mať model; projekt
  na model by tému nad ASR aj VZT nemal kam dať). `/versions` a `/2.1/auth` bez tokenu, ostatné s
  `Authorization: Bearer <BCF_API_TOKEN>`; používateľ tokenu (`BCF_API_USER`, predvolene `aim`) je
  current-user a autor zápisov. Témy (`$top`/`$skip`, `$filter` a `$orderby` sa nevyhodnocujú),
  téma GET/POST/PUT, komentáre GET/POST, pohľady GET/POST + `selection`/`coloring`/`visibility`.
  Stav ide v BCF tvare (`Open`, `In Progress`...); slovník projektu (`extensions`) = predvolené
  hodnoty + hodnoty, ktoré témy už používajú, `user_id_type` vždy obsahuje `claude` (outbox panela
  inak zápis odmietne). Pohľad z viewera sa prevádza na BCF kameru a rovinu rezu (IFC svet, Z hore,
  normála ako `sectionPlaneToClippingPlane` v `@ifc-lite/bcf`); pohľad z panela sa ukladá v tvare
  BCF, bez snímky. Téma založená alebo priradená Claudovi cez API spustí session rovnako ako z MCP.
  Zhoda overená testom so skutočným `@ifc-lite/bcf-api` (`resolveBcfServiceBaseUrl`,
  `fetchProjectAsBCF`, zápisy outboxu). Panel sa pripojí ručne ("Pripojiť server" -> vlastná
  adresa + token); automatické pripojenie z mostu `aim/` je neskorší krok.
- **C:** pracovisko v OCB: `CLAUDE.md` (princípy), skill `.claude/skills/bcf-tema` (postup session od
  témy po revíziu), `recepty/_vzor.py` (deterministický recept nad `ifcopenshell.api`) a workflow
  **`uloha.yml`**: recept nad aktuálnou revíziou (súbor overený voči `model_revisions.sha256`) ->
  `model_publish publish` s poistkou, `--task` a `--recipe cesta@commit` (najprv `dry_run`) ->
  re-ETL (`--federate` okrem ASR) -> `etl.derive run` nad všetkými modelmi -> `announce`. Vstupy
  len cez env a s kontrolou tvaru ciest. Session recept overí lokálne nad verejným súborom, workflow
  spúšťa cez GitHub MCP. Routine "AIM: BCF téma" sa zakladá vo webe (prompt v README AIMviewer).
  Balík `pipeline/` (v29-v73) ešte nie je v OCB - čaká na Samuela.
- **D:** snímka pohľadu (`get_viewer_snapshot`, D-083 fáza 2), export `.bcfzip`
  (`@ifc-lite/bcf` `writeBCF`), prípadne publikácia do CDE (`bcf_publication_*`).

**Zavrhnuté:**
- *GitHub issue ako nositeľ témy:* nevie pohľad ani výber, viewer ho v BCF zozname neukáže,
  a vedľa `model_tasks` by to bol druhý nositeľ tej istej témy.
- *Nová tabuľka `bcf_topics` vedľa `model_tasks`:* úloha úpravy by bola na dvoch miestach a
  `model_publish --task` by uzatváral inú tabuľku než tú, ktorú vidí používateľ.
- *Upstream tools tak, ako sú (pamäť session):* bezstavový konektor by tému zabudol hneď po
  volaní.
- *Session pre každú tému:* väčšina tém je pre ľudí; míňalo by to predplatné a strop sessions.
- *GitHub Actions bez rozhovoru (D-086 bod 3):* session sa nedá dopytovať; Samuel chce rovnaký
  zážitok ako pri issues aplikácie.

**Vedomé limity:** autora témy konektor nepozná (MCP nenesie identitu), preto `author` /
`modified_by` zadá Claude (predvolene "Claude (MCP)"). Snímka obrazovky zatiaľ nie je. Témy
v DB anon kľúč nevidí (D-079), BCF panel ich uvidí až s fázou B. Routine "AIM: BCF téma" a jej
env treba založiť vo webe (claude.ai/code/routines), ako pri D-090.

**Dodatok D-099 (2026-10-19) - témy vo vieweri bez tokenu.** Samuel: "nechcem nikam dávať tokeny";
témy zakladá a mení v chate (MCP), vo vieweri ich chce len vidieť, automaticky.
1. **BCF API číta bez tokenu.** `GET` na `/api/bcf` je verejný ako ostatné dáta AIM (viewer bez
   prihlásenia); zápis (`POST`/`PUT`) len s `BCF_API_TOKEN`, bez neho 403 "zakladaj v chate". Bez
   tokenu API v oprávneniach (`project_actions`, `topic_actions`) neponúka nič, takže BCF panel
   zápis ani neukáže. `current-user` ostáva len s tokenom (prihlásenie panela tokenom).
2. **Viewer si témy načíta sám:** host po `MODELS_LOADED` pošle mostu `AIM_BCF_LOAD { baseUrl:
   <origin>/api/bcf, projectId: aim }`; fork (`aim/bcf-protocol.ts`, lenivé `aim/aimBcf.ts`,
   Menezeris/ifc-lite#66) témy stiahne upstream klientom `fetchProjectAsBCF` bez tokenu a dá ich BCF
   panelu. Adresa musí byť na origine hosta; vlastný projekt používateľa (súbor, server) sa neprepíše.
3. **Obnova po zmene z chatu:** každý zápis témy (MCP tools aj BCF API) pošle na `LIVE_CHANNEL`
   udalosť `bcf_topics` (`lib/live/bcf-event.ts`); `components/live-channel.tsx` ju prepošle oknu
   a `components/ifc-viewer.tsx` pošle `AIM_BCF_LOAD` znova. Bez `?live=` sa témy obnovia pri
   ďalšom otvorení viewera.
- *Zavrhnuté:* token na zápis vložený do stránky (b) - ktokoľvek s odkazom by zakladal témy a
  spúšťal sessions; čakať na prihlásenie (c) - Samuel zápis z panela nepotrebuje.


---

### D-100 - Latencia MCP konektora: meranie, región, predčítanie motora
**Status:** rozhodnuté (2026-10-19, Samuel: cieľ "5 sekúnd max na úkony, ktoré aj nemajú trvať
dlhšie", plán po kolách schválený), kolo 1 na vetve `claude/loving-sagan-nw4ma8`. Rámec je
issue #97; rieši #96. Nadväzuje na D-057 (evaly), D-079 (konektor), D-084 (IFC motor), D-085
(spätný kanál viewera).

**Kontext:** Bežné úkony cez konektor v claude.ai trvajú desiatky sekúnd a 4 až 9 volaní (#97).
Prieskum kódu a nastavení 19. 10.:
- funkcie Vercelu bežia v `iad1` (Washington), Supabase v `eu-north-1` (Štokholm), takže každý
  DB dotaz aj Realtime spojenie ide cez Atlantik;
- UI príkaz prejde 350 ms dávkou, `router.push` a celým serverovým renderom `/ifc` (7 DB
  dotazov); potvrdenie z viewera čaká pevným limitom (4 s rez, 10 s Lens) a pri každom volaní
  otvára nový websocket;
- IFC motor pri studenom štarte načítava 7,4 s a dve volania po sebe môžu trafiť dve inštancie,
  každá načíta model znova;
- konektor ponúka 49 toolov (asi 51 tis. znakov definícií, 17,7 tis. znakov inštrukcií);
- časy volaní sa nemerali vôbec, evaly (D-057) testujú len in-app chat `/api/ask`.

**Rozhodnutie:**
1. **Cieľ a rozpočet:** bežný úkon = 1 až 2 volania toolu a do 5 s v claude.ai. Kolá modelu
   neovplyvníme, iba ich počet, preto server: DB tool p50 pod 300 ms, UI úkon s potvrdením pod
   1 s, IFC tool teplý pod 0,5 s.
2. **Meria sa každé volanie:** tabuľka `mcp_call_log` (migrácia `20261019140000`, SCHEMA §2.16):
   tool, `action`, ms, fázy (`exec`, `broadcast`, `lens`, `readback`, `engine_load`), `ok`,
   `cold` (prvé volanie inštancie), región. Zápis cez `after()` po odpovedi, chyba zápisu tool
   nezhodí. Argumenty sa neukladajú.
3. **Úlohy konektora sa merajú agentom:** `eval/mcp-tasks.json` (E1 až E4 z #97 a typické
   úlohy so stropom volaní a rozpočtom času), postup v `eval/MCP-EVAL.md`: čerstvý Claude agent
   v Claude Code s konektorom aim-viewer, bez API kľúča (Samuel, 19. 10.). Výsledky
   `eval/results/mcp-*.json` a súhrn do #97 (`eval_round`).
4. **Región funkcií `arn1`** (Štokholm, pri databáze) - samostatným PR po baseline, aby sa dal
   zmerať rozdiel (Samuel súhlasil 19. 10.).
5. **Predčítanie motora:** po `initialize` / `tools/list` route cez `after()` načíta modely
   federácie do cache, prvé `ifc_*` volanie nečaká.
6. **Panel chatu vo vieweri je predvolene skrytý** (`NEXT_PUBLIC_ASK_PANEL=1` ho zapne): Claude
   pracuje cez konektor; `/api/ask` ostáva.
7. **#96:** `ifc_property_values` pri hodnote, ktorá v psetoch chýba všade, prečíta množstvá
   (Qto) cez `get_entities_bulk`; výsledok nesie `source` (`pset` | `qto`) a pri hodnote, ktorá
   nie je nikde, poznámku "over cez ifc_get" namiesto tichého `(missing)`.

**Ďalšie kolá (plán, nie ešte rozhodnutie):** kolo 2 = cesta príkazu do viewera (potvrdenie
`APPLIED` s `cmd_id`, fronta počas načítania, `isolate_add`/`isolate_remove`, widget rezu,
zrušenie zvýraznenia; fork aj host, #95, #63, #94); kolo 3 = zlúčenie toolov a skrátenie
inštrukcií podľa `mcp_call_log` (vlastné D-0xx).

**Zavrhnuté:**
- *Najprv zlučovať tooly:* bez merania by sa nedalo povedať, čo pomohlo, a zmena API konektora
  je najdrahšia.
- *Log do konzoly Vercelu namiesto tabuľky:* krátka retencia a p50/p95 by sa nedali počítať SQL.
- *Evaly cez Claude API:* potrebujú kľúč a platia sa; agent v Claude Code ide z predplatného.
- *Cron na zahrievanie inštancie:* Fluid compute inštancie zdieľa; predčítanie pri pripojení
  konektora stačí a nestojí nič, keď sa konektor nepoužíva.

**Dodatok D-100 (2026-10-19) - meranie v iad1 a presun do `arn1`.** Po zlúčení kola 1 zmerané
12 úloh (`eval/results/mcp-2026-10-19-iad1.json`, headless viewer v session): všetky správne,
ale 6 nad stropom volaní (E1 14 volaní a 55 s, E3 6 volaní a 38 s). Server väčšinou pod 1 s
(`count_objects` 0,58 s, `set_section` 0,32 s, `style_in_3d` 1,44 s, z toho 1,35 s čakanie na
počty z Lens); pomalé sú dotazy s viacerými kolami do DB (`get_spatial_path` 2,5 s,
`get_model_stats` 1,3 s). Čas teda tvoria hlavne počty volaní (kolo 2 a 3), región skráti každé
kolo do DB: funkcie idú do `arn1` (`vercel.json`), pri Supabase `eu-north-1`.

---

### D-101 - Potvrdenie príkazov viewera, fronta počas načítania, príkaz bez renderu /ifc
**Status:** rozhodnuté (2026-10-19, kolo 2 plánu D-100, Samuel: zlučovať po zelenom CI a živom
overení), vetva `claude/loving-sagan-nw4ma8` v AIMvieweri aj vo forku Menezeris/ifc-lite.
Rieši #95, #94 a #63 (zastaraný readback, widget); súčasť #97. Nadväzuje na D-085, D-092, D-096.

**Kontext:** meranie D-100 (iad1, headless viewer) ukázalo, že server je väčšinou pod 1 s, ale
úlohy vo vieweri stoja 3 až 14 volaní: readback rezu vrátil stav spred príkazu (E1 zopakoval rez),
Lens `mode: add` izoláciu nahradil namiesto rozšírenia (E2 ju skladal znova), viewer zahodil
príkazy počas načítania a oranžové zvýraznenie sa nedalo zrušiť. Každý UI úkon navyše prešiel
350 ms dávkou, `router.push` a serverovým renderom `/ifc` (7 DB dotazov), a server pri každom
čítaní otváral nový websocket a čakal pevným limitom (4 s rez, 10 s Lens).

**Rozhodnutie:**
1. **Potvrdenie príkazu:** server pošle príkaz s `cmdId`, host za jeho bridge správy pridá
   `ACK_REQUEST {cmdId}` a fork po ich vykonaní (aj asynchrónnych krokov: rez cez prvok, kamera,
   Lens) odpovie `APPLIED {cmdId, ok, issues, state}` so stavom po príkaze. Host ho pošle späť
   udalosťou `applied`; MCP tool vráti potvrdený stav (rez, izolácia, zvýraznenie, súhrn Lens)
   namiesto "odoslané". Bez potvrdenia do 3 s tool povie, že viewer nepočúva, a netvrdí výsledok.
   Čo sa nevykonalo (prvok sa nenašiel, neznáme podlažie), je v `issues` a `ok: false`.
2. **Fronta vo forku:** príkazy pred načítaním modelov a dotečením geometrie sa radia a vykonajú
   potom v poradí (`aim/command-gate.ts`); rez nad podlažím sa tak počíta voči finálnej obálke.
3. **Izolácia:** `ISOLATE` nastaví presnú množinu (nie prepínač), `ISOLATE_ADD` / `ISOLATE_REMOVE`
   ju menia, Lens z chatu s `mode: add` izoláciu rozšíri; `style_in_3d(isolate, mode=add)` je teda
   "pridaj aj schodiská" jedným volaním (#95).
4. **Zvýraznenie:** `CLEAR_FOCUS` (tool `show_in_3d clear=true`, op `clear_focus`) a prázdny
   `FOCUS` zrušia oranžovú bez ostatných farieb; `view_state` hlási `focus` (#94).
5. **Widget rezu:** voľba `show_widget` platí aj pre ďalší rez; AIM-FORK v `SectionHint` a
   `SectionVisualization` skryje nápovedu aj rukoväť (#63).
6. **Príkaz na mieste:** `components/live-channel.tsx` na `/ifc` príkaz vykoná cez
   `lib/live/viewer-apply-bus.ts` priamo vo vieweri a URL len prepíše (`history.replaceState`),
   dávka 50 ms namiesto 350 ms; z inej stránky naviguje ako doteraz a potvrdí po načítaní.
7. **Teplý kanál:** server drží jeden prihlásený Realtime kanál na inštanciu
   (`lib/live/warm-channel.ts`, nečinný 60 s sa otvorí nanovo), otázky aj potvrdenia sa párujú
   podľa id. Predčítanie IFC motora beží aj na prvej požiadavke studenej inštancie.

**Zavrhnuté:** potvrdenie v každej vetve príkazu (veľa zásahov do forku, jedno `ACK_REQUEST` za
príkazmi stačí, lebo most ich vybavuje v poradí); vlastná fronta v hostovi (fork vie, kedy je
geometria hotová, host nie); nový tool na pridanie k izolácii (existujúci `mode: add` stačil,
chyba bola vo forku).

**Overenie:** fork - 94 AIM testov, `tsc`, kontroly zdrojov, revert oracle 8/8 `OBSERVED`
(`docs/architecture/evidence/aim-d101-command-ack/`), živo v iframe s AC20-FZK-Haus (fronta,
izolácia 13/13/14/13, focus, widget, Lens add 13 -> 14), vstupný balík +1 429 B voči main
(predschválené). AIMviewer - vitest, `tsc`, eslint.

### D-102 - Hľadanie prvku podľa kódu, predčítané indexy motora, rez pod podhľadom, zrušenie výberu
**Status:** rozhodnuté (2026-10-19, kolo 3 plánu D-100, Samuel schválil plán), vetva
`claude/loving-sagan-nw4ma8` v AIMvieweri aj vo forku Menezeris/ifc-lite (PR #68). Súčasť #97.
Nadväzuje na D-095 (`ifc_search`), D-100 (predčítanie motora), D-101 (potvrdenie príkazov).

**Kontext:** meranie po D-101 (`eval/results/mcp-2026-10-19-arn1-d101.json`) ukázalo:
- úkony vo vieweri sú pod 2 s;
- E1 však míňa 8 z 12 volaní na nájdenie ramena SD04.0001 (IfcStairFlight len v IFC, bez `object_ref`);
- D5 potrebuje 3 volania, lebo VV.03.01.040 je meno, nie `object_ref`;
- `ifc_search` stojí 4,4 s aj na teplej inštancii, lebo index sa stavia až pri prvom volaní;
- studené `ifc_*` volania trvajú 4,5 až 6 s;
- "ukáž miestnosť" kamerou nepohne (IfcSpace je vo forku skrytý) a agent tvrdí opak;
- zrušiť výber sa nedá;
- výšky agent vykladá zle: odčítal `FinishFloorHeight` a rez "pod podhľadom na 3NP" spravil pod
  IfcCovering priradenými k 3NP, ktoré visia pod doskou 3NP a patria miestnostiam 2NP.

Samuel potvrdil:
- `FinishCeilingHeight` sa meria od hotovej podlahy (IFC), 3.02 má 3,05 m;
- "podhľad na 3NP" je podhľad miestností 3NP.

**Rozhodnutie:**
1. **Kód prvku ako cieľ:** `resolveTargetsToGuids` (set_section, set_camera, get_bounds, ifc_get,
   ifc_relations), `show_in_3d`, `select_in_3d` a `get_object` po neúspechu `object_ref` skúsia
   presné `objects.name` a potom IFC Name/Tag v motore (`lib/engine/names.ts`, index mien na
   indexe `ifc_search`). Viacznačný kód je chyba so zoznamom kandidátov (GUID), nevyberá sa
   potichu. `get_object` vráti aj podlažie (1 až 2 dotazy) a prvok len v IFC označí `in_aim:false`.
2. **Predčítanie indexov:** `preloadEngineModels` po parsovaní postaví aj index GUID a index
   `ifc_search` (s menami), takže prvé hľadanie ani `ifc_get` na čerstvej inštancii nečakajú.
   Lokálne nad ASR+VZT: index 2,5 s v `after()`, potom `ifc_search` 2 až 90 ms, kód 1 ms.
3. **`ifc_search`:**
   - kód (SD04.0001) ide najprv presne podľa mena alebo Tagu;
   - token s číslicou sa nehľadá s preklepom (SD04 už nenájde SD03);
   - Levenshtein bez alokácie;
   - triedy (`ifc_types`) sa cachujú na store.
4. **Rez pod podhľadom:** `set_section(floor, relative_to="ceiling", offset_m=-0.05)`. Server vezme
   `FinishCeilingHeight` miestností podlažia (`lib/engine/ceiling.ts`), medián vážený plochou
   (openspace prehlasuje WC), v jednotke modelu (`lengthUnitScale`), a vráti aj rozsah. Pre 3NP
   vychádza 3,05 m (miestnosti 2,6 až 3,05 m).
5. **Kamera a výber (fork):**
   - FOCUS a SELECT na miestnosť alebo zónu najprv zapnú ich skrytú triedu, počkajú na geometriu,
     zarámujú a počkajú na koniec animácie, takže `APPLIED` nesie novú polohu kamery;
   - bez geometrie je to problém v `APPLIED`;
   - `CLEAR_SELECTION` (op `clear_selection`, `select_in_3d clear=true`, súčasť
     `set_view_mode reset`) zruší výber.

**Zavrhnuté:**
- **Nový tool "find_element":** agent by mal o krok viac a ostatné tooly by kód aj tak nepoznali.
- **Fuzzy pre kódy:** našla SD03 namiesto SD04.
- **IfcCovering podlažia pre výšku podhľadu:** v modeli patria podhľady k podlažiu nad miestnosťou.
- **Obyčajný medián výšky:** WC a chodby ho stiahli na 2,6 m.

**Overenie:**
- **AIMviewer:** vitest (nové `lib/engine/names.test.ts`: kód bez preklepu, index mien a Tagu,
  viacznačnosť, výška podhľadu), `tsc`, eslint; lokálne meranie nad ASR+VZT.
- **Fork:** 97 AIM testov, revert oracle 3/3 `OBSERVED`
  (`docs/architecture/evidence/aim-d102-frame-clear/`); balík vstup +19 B a eager +41 B.
  Naživo v iframe s AC20-FZK-Haus: SELECT miestnosti pohne kamerou, CLEAR_SELECTION zruší výber.

**Dodatok (2026-10-19, opisy a inštrukcie):** inštrukcie MCP (`mcpInstructions`) majú namiesto
odsekov o UI akciách z promptu chatu (opakovali opisy toolov) krátke pravidlá `MCP_UI_RULES`.
- **Kód prvku** daj priamo ako cieľ.
- **"Ukáž X"** = `show_in_3d`, `select_in_3d` len na výber a vlastnosti.
- **Potvrdenie viewera:** potvrdiť len to, čo viewer potvrdil.
- **Výšky:** `FinishCeilingHeight` od hotovej podlahy, podhľad podlažia z miestností.

Prompt in-app chatu (`SYSTEM_PROMPT`, `/api/ask`) sa nemení. Inštrukcie MCP majú 14 032 znakov
namiesto 17 656, aj s novými pravidlami. Cieľ 10 000 by vyžadoval škrtať doménové pravidlá
(IDS, systémy, psety), ktoré opisy toolov nenesú.

Evaly: D4 (3,05 m, nie 2,90), E3 (12,20 m, strop 2), D5 (strop 1), V1 (kamera sa pohne), nové
D7 (kód len v IFC) a V4 (zruš výber).

---

### D-103 - Rýchle CI forku aj pre malé AIM-FORK úpravy; nočné plné CI; review neblokuje

**Dátum:** 2026-10-19 · **Stav:** prijaté (Samuel) · **Súvisí:** D-098 (predchodca, rozširuje ho), D-101 · **PR:** Menezeris/ifc-lite#69

**Kontext:** podľa D-098 išiel rýchlou cestou len PR výhradne v `apps/viewer/src/aim/`. PR #67
vo forku (D-101) menil navyše len dva malé AIM-FORK bloky (`SectionHint.tsx`,
`SectionVisualization.tsx`). Každá oprava po review preto spustila plné CI (asi 64 kontrol,
16 shardov viewer testov, E2E, WASM; s frontou runnerov 30 až 40 min) a 6 kôl trvalo spolu skoro
3 hodiny. Merge neblokoval žiadny check, ale pravidlo agentov opraviť každý nález review bota pred
mergom. Fork sa po merge hneď nasadzuje do produkcie, preto rýchlosť potrebuje poistky.

**Rozhodnutie:**
1. **Rýchla cesta aj pre malé AIM-FORK úpravy.** Skript `scripts/check-aim-fork-only.mjs` vo forku
   rozhodne na merge commite PR medzi `aim-only`, `fork-blocks` a `full`. `fork-blocks` znamená,
   že existujúce súbory `apps/viewer/` sa menia len vnútri AIM-FORK blokov (overené po hunkoch
   voči base), prípadne predschválené zvýšenie stropov viewer bundlu. Rýchla cesta
   (`aim-fast.yml`) navyše spustí build viewera, perf ratchet viewer JS z toho istého buildu a
   viewer testy, ktoré importujú zmenený súbor. Cieľ je 10 až 15 min na kolo. Synchronizácia
   s originálom, workflow, skript, balík, nový pôvodný súbor a zmena mimo markerov idú vždy plným CI.
2. **Nočné plné CI na `main`.** `test.yml` vo forku beží každú noc (00:41 UTC) so všetkými
   lanes; červený beh hlási `aim-nightly-report.yml` cez `report-scheduled-failure.yml` (issue po
   zapnutí Issues a nastavení `AIM_SCHEDULED_ISSUES=true`, dovtedy mail od GitHubu).
3. **Nález review bota neblokuje merge, ak je CI zelené**, okrem bezpečnostných. Nález nesie
   štítok **minor** alebo **blocker (security)**; minor nálezy sa zbierajú a riešia v ďalšom PR
   (skill `steward` vo forku).
4. Bundle perf ratchet ostáva; rýchla cesta meria viewer JS z buildu, lokálne meranie podľa
   skillu `aim-feature` slúži na prípravu predschváleného zvýšenia.

**Zavrhnuté:**
- *Plné CI pri každej zmene pôvodného súboru (stav D-098):* 30 až 40 min na každý push aj pri
  dvoch riadkoch v bloku.
- *Rýchla cesta bez nočného behu:* merge z rýchlej cesty na `main` len prehrá verdikt PR, takže
  ťažké lanes by na `main` nebežali nikdy.

**Detail:** `docs/FORK_MAINTENANCE.md` vo forku, sekcia "Fast CI for AIM pull requests".

---

### D-104 - Dokumenty z IFC: jedna sada, dedenie cez vzťahy, prehliadanie vo vieweri
> **Číslo:** rezervované v #60 ako D-101, ale D-101 do `main` skôr zapísalo potvrdenie príkazov
> viewera (D-101 vyššie); D-102 a D-103 sú obsadené, preto D-104. Commity, PR #105 a OCB PR #4/#5
> z 19. 10. ho ešte volajú D-101.
**Status:** rozhodnuté smerovanie (2026-10-19, Samuel), implementácia po krokoch nižšie; PDF
súbory dodá Samuel. Nadväzuje na D-014, D-032, D-036, D-046, D-063, D-075, D-076, D-077, D-088,
D-089, D-091, D-098.

**Kontext (stav 19. 10., ASR v73/v74, overené v súbore, v prod DB aj naživo vo vieweri):**
- ASR nesie dokumentáciu DSP ako strom IfcDocumentInformation (54: koreň `OCB_SO01_PD`, 9 častí
  SPR, STU, SIT, ASR, STA, PBR, FYZ, TZB, BIM cez IfcDocumentInformationRelationship
  `SUBDOCUMENT`, 44 súborov s `Location = ../Dokumentacia/<Identification>.pdf`) a 8
  IfcDocumentReference na strany 3 až 10 výkresu D.1.1.09 Výpis skladieb (`#page=N`).
- 163 IfcRelAssociatesDocument: IfcProject 44, IfcSpatialZone 93 (PBR na požiarne úseky, PENB
  a zónovanie na tepelné zóny), IfcZone 15 (pôdorysy ASR na nájomné jednotky a príslušnosť),
  IfcGroup S1 až S9 8 (strana výpisu skladieb), IfcCurtainWallType PL01 3. **Žiadna väzba nejde
  priamo na prvok ani priestor** - k dokumentu sa dostane cez cestu (priestor -> zóna, prvok ->
  skupina S1.01 -> rodič S1 -> strana, panel LOP -> typ PL01, priestor -> priestorová zóna).
- ETL (`etl/transform.py` `_collect_documents`) dokumenty nahrá, ale: `object_ref` = Name
  namiesto Identification, IfcDocumentReference berie ako dokument (8 uzlov
  `IfcDocumentReference-N` bez názvu, strany aj rodiča), strom dokumentov a 10 priečinkových
  dokumentov vynechá, súbory nemajú (`storage_type = unresolved`).
- Popri tom žije stará sada E3 (13 PDF z `podklady/docs.csv`, D-036) s iným pomenovaním, súbormi
  v buckete, textom strán, 198 väzbami prvok -> výkres (E4) a kalibráciou podkladov; ten istý
  výkres je tak v DB dvakrát.
- Viewer aj tooly berú len priame väzby: stránky zóny, priestorovej zóny, skupiny, projektu a
  typu dokumenty nemajú, AIM karta v 3D ukáže len priame (dvere DD01.07.01 = starý "Pudorys 1NP",
  priestor 3.01 = nič) a klik na dokument odíde z 3D na `/drawing/[id]`. Knižnica dokumentov vo
  vieweri (D-075) ukazuje len súbory z bucketu; otvorenie na strane funguje (op
  `doc:<strana>:<id>` -> `DOCUMENT_OPEN`). `list_relations` mieša väzby z modelu s výkresmi E4,
  `get_asset_details` dokumenty nevracia.

**Rozhodnutie:**
1. **Jedna sada dokumentov = dokumenty z IFC.** Stará sada E3 sa odstráni (Samuel 19. 10.):
   uzly zaniknú (`valid_until`), väzby E4, oblasti `_drawing_links`, text strán a kalibrácia
   podkladov sa neprenášajú; súbory z bucketu sa zmažú až po nahradení. Väzby z obsahu výkresov
   a kalibrácia sa, ak budú treba, urobia znova nad IFC dokumentmi vo vrstve viewera (bod 4).
2. **ETL číta dokumenty podľa IFC:** identita = `Identification`; atribúty IfcDocumentInformation
   vrátane dnes chýbajúcich (`creation_time`, `last_revision_time`, `electronic_format`, vlastník)
   aditívnou migráciou; strom dokumentov z IfcDocumentInformationRelationship; IfcDocumentReference
   ako odkaz na časť dokumentu (stranu) s vlastným názvom ("S1 - Skladba..."), nie ako samostatný
   dokument. Názvy hrany a tvar odkazu (uzol alebo hrana so stranou) podľa IFC-first (D-046,
   D-048) rozhodne dodatok spolu so `SCHEMA.md` pri implementácii.
3. **Dokumenty objektu sa hľadajú cez vzťahy, nie len priamo.** Efektívne dokumenty počíta DB
   (pohľad, obdoba `v_asset_effective`): objekt -> dokument -> cesta (priamo, cez typ, cez
   skupinu a jej rodičov, cez zónu, cez priestorovú zónu, cez odvodené vzťahy D-089) + strana;
   dokumentácia projektu sa ukazuje raz, nie pri každom prvku. Do modelu sa budú dopĺňať ďalšie
   väzby (Samuel) a pohľad ich zoberie bez zmeny kódu. **Tooly (MCP aj `/ask`) idú cez tie isté
   cesty:** dokumenty objektu s cestou a odkazom na otvorenie na strane, objekty dokumentu aj
   zdedené (napr. "ktoré priestory pokrýva PBR pôdorys 2NP"), dokumenty v `get_asset_details`,
   výkresy z obsahu PDF oddelené od väzieb z modelu. Evaly podľa D-057.
4. **Prehliadanie dokumentov patrí do viewera** (fork ifc-lite a vrstva AIM nad ním), nie na
   stránky AIMviewera: otvorenie PDF v karte viewera aj na strane, preklik z prvku na dokument a z
   dokumentu späť na prvky (D-076), knižnica ako strom IFC dokumentácie, AIM karta otvára dokument
   vo vieweri. `/drawing/[id]` a karty dokumentov na `/node` sa ďalej nerozvíjajú a ostanú, kým
   ich vrstva vo vieweri nenahradí. Je to dlhší program; ide podľa D-091 a D-098 (fork len
   zobrazuje, dáta a výpočty dodá AIMviewer, najprv to, čo fork má: `documentsSlice`,
   `DocumentsPanel`, `PdfDocumentView`, `DOCUMENT_OPEN` so stranou).
5. **Súbory:** PDF v buckete `documents`, názov súboru = `Identification` (tak ako ho nesie
   `Location` v IFC). ETL preloží relatívnu `Location` na URL v buckete, ak súbor existuje
   (`storage_type = supabase`); inak `unresolved` a UI ukáže "súbor chýba", nie rozbitý odkaz.
   Text strán (`document_pages`) sa extrahuje zo súborov v buckete, nie z lokálneho priečinka.

**Kroky:** (1) ETL a migrácia podľa bodu 2, (2) pohľad efektívnych dokumentov a tooly, (3)
viewer: AIM karta a knižnica nad efektívnymi dokumentmi, otvorenie vo vieweri na strane, (4)
súbory a text strán, keď ich Samuel dodá, (5) odstránenie starej sady. Bod 4 rozhodnutia ako
celok (preklik z dokumentu na prvky, kalibrácia nad IFC výkresmi) je ďalší program s vlastným
dodatkom.

**Zavrhnuté:**
- *Nechať obe sady a prepojiť ich:* dvaja nositelia tej istej informácie (AGENTS, D-017).
- *Rozkopírovať väzby dokumentov na každý prvok v modeli alebo v ETL:* model aj DB by niesli
  duplicitu a každá nová väzba v modeli by znamenala znova kopírovať; dedenie počíta pohľad.
- *Rozvíjať `/drawing/[id]` ako hlavné miesto dokumentov:* cieľ je jedno rozhranie vo vieweri
  (D-075), dve miesta by sa rozchádzali.

**Dodatok 2026-10-19 (Samuel): skupina AIM v pravej lište viewera, dokumenty so zoskupením a
vyhľadávaním.** Ľavý panel ostáva stromu modelu, aby nestratil prehľadnosť. AIM panely sa otvárajú
vpravo ako dnes dokumenty: v pravej lište (rail) pribudne **vlastná skupina "AIM" úplne hore**,
nad skupinami originálu (Coordinate, Check, Quantify, Automate, Site, Author). Patria do nej
**Dokumenty** (panel `documents`, D-075, dnes v Coordinate), **AIM vrstvy** (D-089, dnes sekcia v
ľavom paneli cez `aim/hierarchyPanel.ts`, presunie sa do vlastného pravého panela, čím zmizne aj
jeden zásah do upstream `HierarchyPanel`) a **Podklady výkresov** (`drawing-underlay`, D-072, dnes
v Author); ďalšie AIM panely sa pridávajú sem. Skupina sa pridá do `PANEL_GROUPS` v
`lib/panels/registry.ts` medzi existujúce sentinely `AIM-FORK` (D-098: rail, ribbon a príkazy
už skupiny čítajú odtiaľ). Stav panela dokumentov vo forku 19. 10.: zoskupuje len podľa `folder`
od hostiteľa a filtruje len podľa názvu. Doplní sa:
- **Zoskupenie** podľa poľa zo záznamu dokumentu, ktoré pošle hostiteľ: strom dokumentácie
  (PD › časť › dokument), časť/profesia, druh (výkres, správa, posudok), nositeľ väzby (projekt,
  zóna, priestorová zóna, skupina, typ), podlažie (cez zónu a jej priestory), dátum revízie,
  formát. Viewer zoskupuje genericky podľa kľúčov `meta`, zoznam polí neobsahuje.
- **Vyhľadávanie v metadátach** (identifikácia, názov, popis, časť, vlastník, dátum) beží v
  prehliadači nad poslaným zoznamom.
- **Vyhľadávanie v obsahu** počíta AIMviewer (`document_pages`, `search_documents`, krok 4) a
  vracia dokument, stranu a úryvok; klik otvorí PDF na strane. Viewer výsledok len zobrazí
  (D-091, D-098), most dostane dvojicu žiadosť a odpoveď.
- **Dokumenty výberu:** prepínač "len pre vybraný prvok" ukáže efektívne dokumenty výberu s
  cestou (krok 2), ten istý zdroj ako AIM karta.
Krok 3 tým znamená: skupina AIM v lište, panel dokumentov so zoskupením, hľadaním v metadátach a
prepínačom výberu, AIM vrstvy vpravo, AIM karta nad efektívnymi dokumentmi; hľadanie v obsahu je
až po kroku 4.

**Dodatok 2026-10-19 - krok 1 urobený (ETL podľa IFC).** Tvar dát (Samuel nenamietal):
- `IfcDocumentInformation` = `document`, `object_ref` = `Identification`, `ifc_type`
  `IfcDocumentInformation`; aj 10 priečinkových častí bez súboru (PD, SPR, ASR, PBR...).
- Strom = `rel_document_information_relationship` (resource ako `rel_member_of`, D-048): časť ->
  nadradený, `role` = `RelationshipType`. Meno podľa IFC entity, lebo IFC tu koncept má.
- `IfcDocumentReference` = `document_reference` s príponou `documents` a stĺpcom
  `referenced_document_id` (IFC atribút `ReferencedDocument` je stĺpec, nie hrana - AGENTS);
  `object_ref` = `<Identification dokumentu>#page=N`, meno z `Description` (ASR nesie popis
  strany tam). `/drawing/<odkaz>` presmeruje na dokument na strane.
- Nové stĺpce `documents`: `creation_time`, `last_revision_time`, `electronic_format`,
  `referenced_document_id` (migrácia `20261019160000`); `document_owner` = text "Osoba
  (Organizácia)" ako doteraz.
- Súbor: load hľadá v `storage.objects` bucketu `documents` súbor s menom z `Location`; nájdený =
  verejná URL (`storage_type='supabase'`), pôvodná `Location` v `properties._ifc_location`.
- Dokumenty nemajú GUID, preto `_RETIRE_OBJECTS` (D-088) na ne nedosiahne: nesú
  `properties._model` a beh `--model` ukončí tie, ktoré model už nevydáva. Starú sadu E3 a
  dokumenty ETL pred D-104 (bez `_model`) ukončí jednorazovo `python -m etl.documents
  close-legacy` aj s ich väzbami (E3 na podlažia, E4 na prvky); text strán ostáva v
  `document_pages`, `search_documents` zaniknuté dokumenty nevidí.
- Produkcia: re-ETL bez novej revízie robí nový workflow `reetl` v OCB (aktuálna revízia
  overená cez sha256, `dry_run`, `close_legacy_documents`).
- Knižnica dokumentov vo vieweri berie priečinok zo stromu dokumentácie (koreň PD sa vynecháva).

---

### D-105 - X-ray context z chatu: `style_in_3d action=xray`, drôtový model zatiaľ nie
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #106).
Nadväzuje na D-096 (Lens z chatu), D-101 (izolácia z chatu, `mode: add`), D-087 a D-098 (najprv
existujúce funkcie viewera).

**Kontext:** viewer má X-ray context: tlačidlo "duch" v paneli prvku, panel kolízií aj zoznamy
ho píšu do kanála `ghostExceptEntities` a vo vieweri ho ukazuje čip "X-ray context · N".
Konektor ho nevedel spustiť. Náhrada cez Lens (zvyšok `transparent`, vybrané `colorize`) vybrané
prvky prefarbí, takže stratia pôvodný vzhľad (#106: SDK priečky a podhľady na 2NP plne, zvyšok
duchovo).

**Rozhodnutie:**
1. `style_in_3d` dostane `action=xray` s rovnakými filtrami a `groups` ako `isolate` (farba
   voliteľná). Server zostaví tú istú AIM chat lens ako pri izolácii, len s príznakom `x: 1`
   (most `APPLY_LENS xray: true`).
2. Fork (Menezeris/ifc-lite, `aim/aimLens.ts`) vyhodnotí pravidlá tým istým federovaným filtrom
   ako izoláciu z chatu a zjednotenie (cez `resolvePresentationIds`) dá do kanála ghost
   (`setGhostExceptEntities`). Žiadna nová vizualizácia: je to ten istý kanál ako tlačidlo
   "duch". Farebné skupiny sa navyše ofarbia v lens.
3. `mode=add` rozšíri doterajší X-ray z chatu, ak ho kanál stále drží. `show_all` (Lens
   `unisolate` aj `SHOW_ALL`) ho zruší. Izolácia a X-ray sú vo vieweri vzájomne výlučné; prechod
   z jedného na druhý uvoľní kanál chatu, správa s oboma príznakmi sa odmietne.
4. Odpoveď toolu a súhrn `APPLIED` nesú počty ako pri izolácii, navyše `isolation.xray: true`.

**Zavrhnuté:**
- *Ghost cez SDK (`bim.viewer`):* SDK kanál ghost nemá; nový SDK namespace by bol zásah do
  upstream balíka kvôli jednej správe.
- *Samostatný bridge príkaz `XRAY` s GUIDmi:* stratil by filtre vyhodnocované vo vieweri (typ,
  podlažie, vlastnosť, model) a počty, ktoré už Lens dáva.

**Otvorené:** drôtový model (wireframe) pre množinu prvkov. Renderer forku ani upstreamu taký režim
nemá (hrany kreslí len pri kolíziách a zónach); bol by to nový renderovací režim v upstream kóde.
Necháva sa, kým ho nebude mať upstream alebo kým Samuel nerozhodne o vlastnej vrstve.
### D-106 - Odvodené záznamy v paneli vlastností ako strom
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #93).
Nadväzuje na D-089 (vrstva odvodení, AIM záznamy v Relationship records).

**Kontext:** sekcia "Odvodené záznamy" (fork, záložka IFC, Relationship records) mala AIM badge
pri každom riadku a jeden plochý zoznam (priestor, priestorové zóny, zóny cez priestor). Pri viac
ako pár záznamoch sa v ňom ťažko orientovalo a badge na každom riadku zahlcoval.

**Rozhodnutie:**
1. Jeden AIM badge pri nadpise sekcie a odlíšený rám celej sekcie, aby bolo jasné, že ide o
   dáta AIM, nie o IFC súbor.
2. Strom s počtami: vzťah a smer (`IfcRelReferencedInSpatialStructure`, `IfcZone cez priestor`)
   > IFC trieda / PredefinedType (`IfcSpatialZone / THERMAL`) > inštancie s rolou inside/partial.
   Prvé dve úrovne otvorené, trieda nad 20 riadkov zbalená. Klik na inštanciu vyberie prvok ako
   doteraz.
3. Host posiela `other.predefinedType` (z `objects.predefined_type`, `NOTDEFINED` = null); pole je
   voliteľné, starší viewer ho ignoruje.

**Zavrhnuté:**
- *Zoskupenie podľa pravidla odvodenia:* priestor a priestorová zóna idú tým istým IFC vzťahom;
  pravidlo je v tooltipe skupiny.
### D-111 - Zoznam z chatu: `open_list` otvorí builder panela Lists
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #70).
Nadväzuje na D-087 a D-098 (najprv existujúce funkcie viewera), D-096 (filtre Lens z chatu).

**Kontext:** "Exportuj všetky dvere na 1NP ako tabuľku" konektor nevedel: prvky nájde
(`ifc_query`), ale panel Lists viewera neotvorí. Upstream panel Lists vie zoznam podľa filtrov a
stĺpcov aj export (CSV, XLSX, PDF) a návrh zoznamu (`pendingListDraft`) mu už odovzdáva "Create
list" z vyhľadávania. `ListDefinition.groups` sú tie isté `FilterGroup` ako pravidlá Lens.

**Rozhodnutie:**
1. Nový tool `open_list` (`lib/llm/list-tool.ts`, stĺpce `lib/llm/list-columns.ts`): filtre ako
   `style_in_3d` (zostavia sa tou istou cestou ako skupina Lens, vrátane systému, zóny, podlažia
   a vlastnosti), aspoň jeden povinný; `columns` slovami (atribúty, storey/space/building,
   material, classification, model, `Pset.Vlastnosť`, `Qto_X.Množstvo`), default Name, GlobalId,
   ObjectType, podlažie.
2. Op `list` (`lib/viewer-list.ts`) -> most `OPEN_LIST`; zónu doplní klient GUIDmi ako pri Lens.
   Fork (Menezeris/ifc-lite#74, `aim/aimList.ts`) zostaví `ListDefinition`, odovzdá ho ako návrh a
   otvorí panel Lists v builderi.
3. Spustenie a export robí používateľ tlačidlom (Run, Export): stiahnutie súboru z iframe bez
   kliku používateľa prehliadač nemá dovoliť. Tool to v odpovedi povie.

**Zavrhnuté:**
- *Export na serveri (CSV z DB alebo IFC motora s odkazom na stiahnutie):* nový zápis do úložiska a
  druhá implementácia stĺpcov a jednotiek popri upstream exporte.
- *Uložené zoznamy (`list_presets` z issue):* žijú v localStorage prehliadača, server ich nevidí.
### D-113 - Panel vlastností z chatu: záložka, sekcia a zvýraznená vlastnosť
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #71).
Nadväzuje na D-077 (AIM | IFC inspektor), D-082 (výber ako klik), D-098 (najprv existujúce funkcie viewera).

**Kontext:** `select_in_3d` otvoril panel vlastností vždy na záložke AIM. "Ukáž IFC údaje miestnosti
4.01" alebo "zvýrazni čistú podlahovú plochu" Claude nevedel: nevedel prepnúť na IFC, otvoriť sekciu
Quantities ani ukázať konkrétnu vlastnosť. Viewer to všetko má: prepínač AIM | IFC vo forku, sekcie
upstream panela (`propertiesActiveTab`) a skok na vlastnosť (`pendingPropertyFocus`, ktorým bSDD
karta otvára "Edit in Properties": rozbalí pset, posunie a zvýrazní riadok).

**Rozhodnutie:**
1. `select_in_3d` má `panel_tab` (aim | ifc), `panel_section` (properties | quantities) a
   `highlight` (`Pset.Vlastnosť`, delí sa na prvej bodke). Chybný vstup je chyba toolu. `highlight` na
   `Qto_*` otvorí sekciu Quantities (tam upstream focus riadok nezvýrazní) a výsledok to povie.
2. Op `select:~t=..~s=..~p=..~v=..:<guid>` (`selectOp`, mená psetu a vlastnosti zakódované, aby
   oddeľovače ops neprešli) -> `SELECT { guid, panel: { tab, section, focus } }`. Bez panela ostáva
   `select::<guid>` a správa ako doteraz.
3. Fork (Menezeris/ifc-lite#75): lenivý `SELECT` panel overí (neplatný = nič sa nevyberie), po výbere
   prepne záložku a sekciu a vlastnosť zvýrazní cez `pendingPropertyFocus`. Focus vždy prepne na IFC /
   Properties. Upstream focus zapína režim úprav (pracovný priestor Model); focus z chatu ho
   nezapína (jednoriadkový blok AIM-FORK v `PropertiesPanel.tsx`).
4. Obsah panelu sa Claudovi nevracia: hodnoty berie z `ifc_get` (tie isté dáta zo súboru), panel ich
   ukazuje používateľovi.

**Zavrhnuté:**
- *Samostatný tool `set_properties_panel`:* panel patrí k vybranému prvku; jedna správa po výbere
  nemá preteky medzi výberom a prepnutím, ktoré panel pri zmene výberu resetuje.
- *Vrátiť obsah panelu cez live kanál:* duplikát `ifc_get`.

**Otvorené:** zvýraznenie vlastnosti typu (zdedenej) a vlastnosti v Quantities upstream focus nevie.
### D-108 - Materiálové vrstvy z IFC: `ifc_get` s materiálmi, `ifc_material_layers`
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #69).
Nadväzuje na D-084 (IFC motor), D-087 (najprv tools balíka). D-107 je ponechané pre D-104 krok 2.

**Kontext:** "Ukáž všetky vrstvy izolácie" a "Aké vrstvy má skladba FS01.10?" konektor nevedel:
`ifc_get` vrstvy nevracal a `ifc_count group_by=material` dáva len názov skladby, takže Claude
hádal podľa názvu (asi 10 z 90+ prvkov). Upstream `get_entity` materiály vie (IfcMaterialLayerSet
s poradím, materiálom, hrúbkou a kategóriou, constituent a profile sety, aj zdedené z typu cez
IfcRelDefinesByType), ale náš `ifc_get` ich z `include` vynechal. Filter podľa materiálu balík
nemá (`material=` v selektore `query_entities` odmietne).

**Rozhodnutie:**
1. `ifc_get` vracia aj `materials` (pole balíka bez zmeny).
2. Nový `ifc_material_layers` (`lib/engine/materials.ts`, adaptér nad upstream `query_entities` a
   `get_entities_bulk` s `include: ["materials"]`): prvky triedy (default `IfcElement` s podtriedami),
   ktorých materiál obsahuje hľadaný text v názve materiálu, vrstvy alebo kategórie (vrstvy aj
   materiálu), bez diakritiky a veľkosti písmen. Zhoda na názve celej skladby vráti všetky jej vrstvy.
   Výstup: `total`, súhrn podľa skladby s nájdenými vrstvami a hrúbkou, prvky (strop `limit`) s
   prepojením na AIM a `show_in_3d` za všetky nájdené prvky.
3. Kategórie materiálov sa nemapujú na vlastný číselník: hľadá sa v tom, čo nesie súbor (názov a
   kategória), aby výsledok šiel overiť v IFC.

**Zavrhnuté:**
- *Filter materiálu v selektore balíka:* balík ho zámerne odmieta ako nestratovo nepodporovaný.
- *Mapovanie na kategórie (tepelná izolácia = EPS, XPS, MW...):* bez číselníka v knižnici by bolo
  domnienkou; ak bude treba, patrí do knižnice požiadaviek, nie do toolu.
### D-109 - Verzia modelu v `ifc_models`: revízia z `model_revisions`, história
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #73).
Nadväzuje na D-084 (IFC motor), D-086 (revízie modelov), D-087, D-102 (menej toolov).

**Kontext:** "Je toto najnovšie VZT?" konektor nevedel: `ifc_models` vracal len kód, štítok a
`loaded`, ktoré Claude čítal ako "viewer model nemá" (v skutočnosti cache motora na serveri).
Revízie modelov (číslo, základ, autor, dátum, sha256, recept, súhrn, výsledok poistky) sú od D-086
v `model_revisions`, žiaden tool ich nečítal. Hlavičku súboru, jednotky a súradnicový systém už
dáva `ifc_model_info` (prevzatý z balíka, D-087).

**Rozhodnutie:**
1. Bez nového toolu: `ifc_models` pri každom modeli vracia aktuálnu revíziu (`v075`, základ,
   `published_at`, autor, súhrn, sha256, veľkosť, recept, poistka: počet objektov, pridané a
   odobraté GUIDy s počtom, zmena počtu podľa tried) a cestu k úplnému zoznamu zmien v OCB
   (`zmeny/<MODEL>/vNNN.json`, v DB nie je). `history: N` pridá posledných N revízií.
2. Kľúč revízie je meno súboru v buckete (`ASR.ifc` -> `ASR`), nie id modelu. Aktuálna revízia sa
   dočíta zvlášť, ak nie je medzi najnovšími (návrat cez `model_publish revert`).
3. `loaded_means` v odpovedi vysvetľuje, že `loaded` je cache motora, nie stav viewera. Chyba DB
   zoznam modelov nezhodí (`revision_error`).
4. "Aký súradnicový systém / jednotky / kto súbor vytvoril" ostáva na `ifc_model_info` (veta v
   inštrukciách).

**Zavrhnuté:**
- *Nový tool `get_model_info`:* zdvojil by `ifc_models` aj `ifc_model_info` a pridal definíciu, ktorú
  D-102 škrtá.
- *Diff prvkov medzi revíziami v tooli:* zmenené prvky (modify) nesie len zoznam zmien v OCB;
  pridané a odobraté dáva poistka.
### D-110 - Prechod VZT sieťou cez porty: `ifc_relations` s `recursive` a `stop_at`
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #75).
Nadväzuje na D-097 (`ifc_relations`, `through_ports` o jeden krok), D-087, D-102 (menej toolov).

**Kontext:** "Ktorá VZT jednotka zásobuje túto miestnosť?" a "Ktorá požiarna klapka ju uzatvára?"
konektor nevedel: `through_ports` ide len k susedom a priradenie k systémom je v modeli neúplné
(Prívod-1NP má 8 prvkov, jednotky nie sú v priestoroch). Sieť cez porty (IfcRelNests ->
IfcRelConnectsPorts) je v súbore celá.

**Rozhodnutie:**
1. Bez nového toolu: `ifc_relations(through_ports=true, recursive=true)` prejde sieť do šírky
   cez porty, každý prvok raz, s `depth` a predchodcom `via`.
2. `stop_at` = IFC triedy, voliteľne `Trieda.PREDEFINED` (`IfcDamper.FIREDAMPER`); PredefinedType
   sa číta len pri kandidátoch tej triedy. Za zastavením sa nejde. `reached` dá zastavenia s počtom
   krokov a cestou (GUIDy od štartu), najbližšie prvé; `path_show_in_3d` = cesta k najbližšiemu.
3. `max_steps` (default 50, max 200); `cut_off` povie, že sieť pokračuje, prázdne `reached` bez
   `cut_off` = sieť je prerušená alebo bez portov.
4. Smer toku (FlowDirection portov) sa zatiaľ nesleduje: prechod ide oboma smermi a najbližšia
   jednotka je zvyčajne tá, ktorá vetvu zásobuje. Štart z miestnosti = koncový prvok v miestnosti
   (`v_space_elements`), potom trace (veta v inštrukciách).

**Zavrhnuté:**
- *Nový tool `trace_network`:* zdvojil by prechod portov z `ifc_relations` a pridal definíciu.
- *Prechod cez priradenie systému:* systémy sú v modeli neúplné; porty sú zdroj pravdy siete.
### D-112 - Meranie z geometrie: `ifc_measure` (vzdialenosť, výška, výmery z meshu)
**Status:** rozhodnuté (2026-10-19, strážna session na základe Samuelovho poverenia, issue #74).
Nadväzuje na D-084 (motor v procese), D-087 (najprv upstream tool), D-097 (vlastný tool motora).

**Kontext:** "Aká je vzdialenosť medzi týmito stenami?" a "ako vysoko nad podlahou je klapka?" konektor
nevedel. `ifc_geometry_area` / `ifc_geometry_volume` a upstream `geometry_bbox` čítajú len Qto,
`get_bounds` dáva obálky z DB. Skutočnú geometriu má `@ifc-lite/mcp` iba v `clash_check` (headless
tesselácia `@ifc-lite/geometry`, na Verceli zmeraná v D-084: kolízie VZT 4,1 s studené); upstream
tool na meranie nemá (`geometry_get` a `raycast` hlásia UNSUPPORTED).

**Rozhodnutie:**
1. Nový tool motora `ifc_measure` (`lib/engine/measure.ts`). Model sa tesseluje rovnako ako v
   `clash_check` (`GeometryProcessor`, bez inštancovania), raz na zdieľaný store (cache inštancie);
   prvky sa zostavia vlastne, lebo upstream adaptér clash vynecháva priestorové prvky (IfcSpace).
2. `a` + `b`: svetlá vzdialenosť povrchov upstream clash enginom (režim clearance s explicitnými
   členmi `membersA/B`, `distanceKind: mesh`, záporná = prienik), najbližší bod, vzdialenosť stredov,
   medzera obálok po osiach IFC a vodorovne, `a_above_b_m` (spodok a mínus vrch b: klapka nad doskou).
3. `a` alebo `items` (max 50): rozmery obálky, povrch, pôdorys (priemet plôch s normálou hore) a
   objem z meshu (len pri uzavretom meshi), vedľa Qto zo súboru (`Qto_*BaseQuantities` pred inými,
   Net pred Gross) s príznakom nezhody nad 5 %; pri viacerých aj súčet. Množina podľa filtra =
   GUIDy z `ifc_query`.
4. Modely federácie sú v jednom rámci súradníc (overené na ASR a VZT: bez posunu, `origin` +
   pozícia), takže dvojica môže byť z rôznych modelov. Výstup v osiach IFC (Z hore), metre.
5. `@ifc-lite/clash`, `@ifc-lite/geometry` a `@ifc-lite/query` sú priame závislosti (MPL-2.0, tie isté
   verzie, ktoré už ťahá `@ifc-lite/mcp`) a `serverExternalPackages`.

**Overenie na aktuálnych modeloch:** stena ASR SN07.04.0005 - potrubie VZT PO.02 1,433 m
(`mesh`); vyústka VV.02.01.006 2,727 m nad doskou SD02.03.0001; objem steny z meshu 5,283 m³ =
Qto; pôdorys miestnosti 2.01 230,947 m² oproti NetFloorArea 230,954 m². Studené volanie (parsovanie
a tesselácia ASR aj VZT) 6,7 s lokálne, ďalšie 9-340 ms.

**Zavrhnuté:**
- *`clash_check` s veľkou clearance:* selektory sú len triedy, nie konkrétne prvky, a IfcSpace vynechá.
- *Meranie vo vieweri (upstream nástroj Measure):* výsledok by sa Claudovi nevrátil a fungoval by len
  s otvoreným viewerom.

**Otvorené:** kreslená kóta vo vieweri potrebuje správu mosta vo forku (bod a, bod b, popis); tool
zatiaľ vracia `show_in_3d` na oba prvky. Objem neuzavretého meshu (časť miestností) sa nehlási.

### D-114 - Najprv napasuj, až potom nový tool: inventár a register toolov konektora
**Status:** rozhodnuté (2026-10-20, Samuel v #97). Nadväzuje na D-087 (najprv originál), D-090
(požiadavky z konektora) a D-098 (najprv to, čo už existuje); D-102 už raz zamietol nový tool
(`find_element`) v prospech rozšírenia.

**Kontext:** konektor má 52 toolov (s motorom), `tools/list` okolo 64 000 znakov a inštrukcie ďalších
15 000, teda 20-25 tisíc tokenov pred prvou otázkou. 19 toolov nebolo nikdy zavolaných. Merania
D-101 a D-102 ukázali, že agent si medzi podobnými toolmi vyberá zle (`select_in_3d` namiesto
`show_in_3d`, séria `search_*` namiesto `get_object`). Väčšina rozhodnutí D-105 až D-113 rozšírila
existujúci tool, ale D-108, D-111 a D-112 pridali nové a žiadne pravidlo to neriadilo: skill
`mcp-poziadavka` v kroku 2 poznal len "ide to existujúcimi tools" a "treba nový tool" a jeho zoznam
súborov s definíciami bol neúplný.

**Rozhodnutie:**
1. **Zoznam toolov na jednom mieste:** `lib/mcp/tool-list.ts` (`mcpToolGroups`, `mcpToolDefinitions`);
   číta ho MCP route, register aj inventár.
2. **Inventár `MCP-TOOLS.md`** generovaný z definícií (skupina, zdroj, súbory, prvá veta opisu,
   parametre s hodnotami enumu, rozhodnutie, čítanie/zápis). Test ho porovná s kódom
   (`toMatchFileSnapshot`), obnova `npx vitest run lib/mcp/tool-registry.test.ts -u`.
3. **Register `lib/mcp/tool-registry.json`** (meno -> rozhodnutie, ktoré tool zaviedlo). Test
   `lib/mcp/tool-registry.test.ts` pustí len tooly, ktoré v ňom sú, a overí, že rozhodnutie existuje v
   `DECISIONS.md`. **Pevný strop počtu nie je** (Samuel: počet sa môže meniť, keď je na to dôvod);
   test len vypíše počet a znaky definícií a inštrukcií.
4. **Poradie pri novej schopnosti** (`AGENTS.md`, skill `mcp-poziadavka` krok 2): najbližšie 2-3 tooly
   z inventára -> lepší opis alebo inštrukcia -> nový parameter alebo hodnota enumu -> pole vo
   výsledku -> nový tool. Nový tool má v zázname sekciu "Zavrhnuté rozšírenie: `<tool>` - prečo nie"
   a riadok v registri schvaľuje Samuel v issue.
5. **Konektor:** `request_tool` má `proposal.extend` (ktorý existujúci tool rozšíriť) a v opise
   prednosť rozšírenia; poznámka pre session v issue odkazuje na inventár a D-114.
6. `vitest.config.mts` s aliasom `@/`, aby testy mohli importovať moduly toolov, ktoré ho používajú.

**Zavrhnuté:**
- *Strop počtu toolov v teste (ratchet):* počet nie je cieľ; cieľ je rýchle načítanie, dobrý výber
  toolu a rozširovanie namiesto pridávania. Register stačí na to, aby bol nový tool v review vidieť.
- *Nový tool `get_capabilities` (#80) ako inventár za behu:* klient už zoznam toolov má; inventár je
  pre session, ktorá kód mení, nie pre agenta v rozhovore.

**Ďalej:** D-115 zlúči tooly s rovnakým zdrojom do toolov s rozlišovacím parametrom.

### D-115 - Zlúčenie MCP toolov do toolov s rozlišovacím parametrom
**Status:** rozhodnuté (2026-10-20, Samuel v #97), zavádza sa po skupinách. Nadväzuje na D-114
(najprv napasuj) a mení D-087 (prevzaté tools balíka už nie sú v zozname pod vlastným menom) a
D-099 (BCF mená, krok 2).

**Kontext:** 52 toolov, okolo 79 000 znakov pred prvou otázkou a agent si medzi podobnými toolmi
vyberá zle. Základ pred zlúčením (`eval/results/mcp-2026-10-20-arn1-pred-d115.json`): 30/30
správne, 6 úloh nad stropom volaní, všetky preto, že agent nevie, čo jeden tool už vie (D7, C8:
`get_object` bez podlažia prvku len v IFC a bez Qto; C1, D3: overovanie podobnými toolmi; V3, V6).
Samuel: počet toolov nie je cieľ, cieľ je rýchle načítanie, dobrý výber toolu a rozširovanie
namiesto pridávania.

**Rozhodnutie:**
1. Zlučujú sa tooly s rovnakým zdrojom do jedného s rozlišovacím parametrom (`action`, `mode`,
   `source`). Handlery ostávajú, mení sa dispatch a schéma. Čítanie a zápis sa nemiešajú (anotácie).
   Mená sa zachovávajú, kde sa dá (telemetria a evaly ostanú porovnateľné).
2. **Prechod:** staré mená sa nevypisujú, ale volanie nimi prejde (`legacyTools` v MCP serveri,
   `LEGACY_ENGINE_TOOL_NAMES`); `mcp_call_log.tool` nesie volané meno, takže sa dá zistiť, kedy ich
   už nikto nevolá. Zmažú sa po dvoch týždňoch bez volania. `callAction` loguje prvý z parametrov
   `action`, `mode`, `source`.
3. **Krok 1 - IFC motor (18 -> 7 toolov):**
   - `ifc_query` + `mode` list | count | values a filter `material` (bývalé `ifc_count`,
     `ifc_property_values`, `ifc_material_layers`);
   - `ifc_models` + `action` revisions | info | materials | classifications | audit | schema
     (bývalé `ifc_model_info`, `ifc_materials_list`, `ifc_classifications_list`, `ifc_model_audit`,
     `ifc_schema_describe`; parametre idú do balíka 1:1, test parity schém ostáva);
   - `ifc_measure` + `qto` (bývalé `ifc_geometry_area`, `ifc_geometry_volume`: plocha a objem z Qto
     bez tesselácie);
   - `search_all` + `source` all | ifc | aim, `fields`, `fuzzy`, `offset` (bývalé `ifc_search`).
4. **Krok 2 - BCF, pripomienky a dotazy viewera (11 -> 5 toolov):**
   - `bcf_topic` + `action` create | update | close | viewpoint (zápis, bývalé `bcf_topic_create`,
     `bcf_topic_update`, `bcf_topic_close`, `bcf_viewpoint_create`); `bcf_topic_list` ostáva na čítanie;
   - `feedback` + `action` report | request_tool | comment | start_session (zápis, bývalé
     `report_feedback`, `request_tool`, `feedback_comment`, `start_queued_session`); `feedback_status`
     ostáva na čítanie;
   - `get_viewer_state` + `bounds` alebo cieľ = obálky (bývalé `get_bounds`).
5. **Eval kroku 1 (lekcia):** schopnosť schovaná v opise iného toolu sa hľadá horšie - C2 materiál 1 -> 11
   volaní (agent išiel do `search_everything`), C7 schéma triedy z pamäti. Pravidlo: zlúčená schopnosť
   stojí na začiatku opisu veľkými písmenami (MATERIÁL, SPOČÍTA, VYBER...) a inštrukcie ju menujú pri
   type otázky. Zlučuje sa len tam, kde agent dnes preukázateľne blúdi.
6. **Krok 3 - zdieľané tooly AIM (aj `/api/ask`, 22 -> 16 toolov):**
   - `search_objects` + `mode` list | count | locate (bývalé `count_objects`, `locate_objects`);
   - `get_object` + `include` details | path | drawings (bývalé `get_asset_details`,
     `get_spatial_path`, `find_in_drawings`; D7, C8 až C10 potrebovali reťaz volaní);
   - `show_in_3d` + `select` (bývalé `select_in_3d`; V1 voľba medzi nimi);
   - reset (`set_view_mode reset`) zruší aj zvýraznenie (V3 potreboval 3 volania).
   - **Nezlúčené:** `set_view_mode` a `set_camera`, `open_node` a `open_drawing` - schémy sa neprekrývajú,
     úspora je malá a režim "2D pôdorys" pod menom kamery by sa hľadal horšie (lekcia z bodu 5).
     `query_view` a `aggregate_objects` ostávajú oddelené (rozdielna sémantika porovnaní).
   - **Eval kroku 2** (`eval/results/mcp-2026-10-20-arn1-po-d115-krok2.json`): C2 11 -> 2 volania po oprave
     opisov, C3, C6, C13 a V7 jedným volaním; agenti ale obchádzali `search_all` cez `search_everything`
     (C11, C1), lebo zdieľané inštrukcie chatu posielajú hľadanie v psetoch tam. Preto v MCP s motorom
     `search_all` nahrádza `search_everything` v zozname, opisoch aj inštrukciách (`withSearchAll`; staré
     meno ostáva ako `legacyTools`, `/api/ask` bez motora ho má ďalej), `ifc_query(mode=count)` prijme
     `material` a `ifc_models` má schému triedy na začiatku opisu (C7: jeden z dvoch behov odpovedal z pamäti).

**Zavrhnuté:**
- *Jeden veľký PR:* regresiu vo výbere toolu by nebolo vidieť po skupinách.
- *Premenovať všetko na nové mená (`ifc_model`, `find_objects`...):* rozbije porovnanie s
  predchádzajúcimi kolami v `mcp_call_log` a evaloch bez úžitku pre agenta.
- *Okamžite zmazať staré mená:* claude.ai drží zoznam toolov počas konverzácie, rozpracované
  rozhovory by padali na "Neznámy tool".

---

### D-116 - Release train: rýchle PR, plné CI raz na balík, výber viewera na skúšanie pred zlúčením

**Dátum:** 2026-10-20 · **Stav:** prijaté (Samuel) · **Súvisí:** D-103 (predchodca, rozširuje ho), D-098, D-090 · **PR:** Menezeris/ifc-lite#77, AIMviewer (tento)

**Kontext:** aplikáciu zatiaľ používa len Samuel. Chce nové funkcie vyskúšať naživo vrátane MCP
skôr, ako idú do produkcie, a zlučovať ich po 3 až 4 naraz, aby plné CI forku (asi 64 kontrol,
30 až 40 min) bežalo raz za balík, nie za každý PR a každú opravu. Produkcia sa nasadzuje hneď po
zlúčení a ostáva tak (rýchla spätná väzba je cennejšia než staging, kým nie sú verejní používatelia).

**Rozhodnutie:**
1. **Feature PR forku ide vždy rýchlou cestou** (`aim-fast.yml`, asi 10 min: AIM testy, typecheck,
   build viewera, súvisiace viewer testy, bundle). Plné `test.yml` beží len na balíku
   `release/aim-*`, synchronizácii s originálom a so štítkom `ci:full`.
2. **Feature PR sa nezlučuje samostatne.** Je pripravený, keď je rýchla cesta zelená a v PR je sekcia
   "Ako vyskúšať" s odkazom `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>`.
3. **Výber viewera v AIMvieweri:** `?viewer=pr-N` (alebo čip nad 3D so zoznamom otvorených PR forku)
   vloží namiesto produkčného viewera náhľad PR. Zoznam a URL náhľadov idú z GitHub Deployments
   (`/api/viewer-previews`). Povolené sú len produkčný viewer a náhľady projektu `ifc-lite-viewer`.
   Voľba sa pamätá v karte (sessionStorage), takže navigácie AI docku a MCP ju nezrušia; MCP
   príkazy idú do otvorenej stránky AIMviewera, teda do vybraného viewera.
4. **Balík:** na Samuelov pokyn ("zlúč 73, 74, 76") agent vytvorí `release/aim-<dátum>`, zlúči PR
   merge commitmi, vyrieši konflikty, otvorí balíkový PR s plným CI a vlastným náhľadom. Do `main`
   ide na Samuelov pokyn. Postup: skill `release-train` vo forku.
5. **Po zlúčení:** tag `aim-release-<dátum>-<sha>`, smoke test produkcie po nasadení (most `READY`
   a `QUERY view_state`), červený smoke založí issue; návrat cez Vercel Instant Rollback.
6. Nové MCP tooly v AIMvieweri sa naďalej zlučujú rovno (testovací konektor na náhľad by bol
   zložitý); toto rozhodnutie sa týka zmien vo vieweri.

**Zavrhnuté:**
- *Nasadzovať produkciu len zo zeleného nočného behu:* Samuel by novú funkciu nevidel hneď;
  verejnosť zatiaľ nie je.
- *Merge queue GitHubu:* na osobnom účte nie je dostupná; balík robí to isté ručne.

**Potrebné nastavenie:** vo Verceli projekt `ifc-lite-viewer`, Deployment Protection, Vercel
Authentication vypnúť pre Preview, inak sa náhľad v iframe nenačíta. Pre zoznam náhľadov stačí
`FEEDBACK_GITHUB_TOKEN` (alebo vlastný `GITHUB_PREVIEWS_TOKEN`).

**Detail:** `docs/FORK_MAINTENANCE.md` vo forku, sekcia "Release train".


### D-119 - Miestnosti a farby z chatu: zapnutie IfcSpace, výplň v 2D, rozsah a veľká legenda Color by

**Dátum:** 2026-10-20 · **Stav:** navrhnuté (čaká na Samuela) · **Súvisí:** D-096, D-102, D-105, D-114, D-116, D-098 · **Issues:** #135, #136, #137 · **PR:** AIMviewer (tento), Menezeris/ifc-lite (fork)

**Kontext:** tri pripomienky Samuela z 20. 10. (konektor MCP): (1) `style_in_3d` isolate/colorize
na IfcSpace vráti 32 prvkov, ale nič nevidno, lebo miestnosti sú vo vieweri predvolene vypnutá
trieda a žiadny tool ju nezapne (#136); (2) v 2D pôdoryse s rezom sú ofarbené miestnosti takmer
neviditeľné (#137); (3) `color_by` ignoruje filter volania, legenda má 49 materiálov celého modelu
namiesto 55 izolovaných stien a nedá sa zväčšiť (#135).

**Overenie (D-114, D-098):** `show_in_3d` miestnosť zapne (D-102), ale Lens z chatu nie;
`set_view_mode` a `set_section` robia, čo majú. Diagnostika naživo (fork, FZK-Haus): spodná plocha
IfcSpace leží na hornej ploche dosky a v hĺbke sa s ňou bije, výplň rezu má jednu farbu pre všetky
prvky. Server pri `color_by` zahadzoval filtre (`style-lens.ts`). Upstream má `Lens.capturedScope`
(UI "Population") a plávajúce panely (`floatPanel`), most ich nepoužíval.

**Rozhodnutie (rozšírenie existujúcich toolov, žiadny nový tool):**
1. **Zapnutie miestností a zón (#136):** fork zapne skrytú triedu IfcSpace / IfcSpatialZone, keď ju
   zasiahne Lens z chatu (colorize, transparent, isolate, xray, aj `color_by` s filtrom) alebo
   `SHOW` / `ISOLATE`. Ručne: `style_in_3d action=show ifc_type=IfcSpace`. Rovnaký prepínač ako
   pri FOCUS (`frame-gates.ts`); preferencia sa ukladá ako pri ručnom prepnutí.
2. **Výplň miestností v 2D (#137):** vrstva forku `AimRoomFillLayer` nad scénou (ako piny a
   `ZoneOverlay`) v režime 2D bez výkresu nakreslí pôdorys každej miestnosti ofarbenej aktívnou
   Lens: polopriehľadná výplň, obrys a názov (LongName, inak Name), len podlažie pôdorysu. Pôdorys
   je spodná plocha geometrie miestnosti. Renderer ani upstream súbory sa nemenia (okrem riadku
   montáže v bloku AIM-FORK).
3. **Rozsah `color_by` (#135):** filtre volania (`ifc_type`, `storey`, `zone`...) idú vo wire ako
   `s` a v moste ako `autoColorScope`; fork z nich spraví `capturedScope`, takže farby, legenda a
   počty sú len za tieto prvky. Bez filtra pri zúženom pohľade (izolácia, skrytie, X-ray, sólo
   podlažie) vezme viditeľné prvky, inak celý model ako doteraz. Výsledok toolu nesie
   `scope` a legenda od viewera je za rovnaké prvky.
4. **Veľká legenda (#135):** `style_in_3d action=legend` s `legend_size=large|normal` (aj spolu s
   colorize): panel Lens ako veľké plávajúce okno cez takmer celý viewer, posunutý na legendu, bez
   stropu 220 px (pravidlo v `assetin-theme.css`); `normal` ho vráti do lišty.

**Zavrhnuté rozšírenie a nové tooly:**
- *Nový tool `set_space_visibility`:* zapnutie triedy patrí k akcii, ktorá miestnosti cieli; ručne
  ho pokryje existujúce `show`.
- *`set_view_mode` s parametrom legendy:* legenda patrí k Lens, ktorú ovláda `style_in_3d`.
- *Výplň rezu (cap) farbou Lens alebo posun hĺbky v rendereri:* zmena balíka `renderer` = plné CI
  originálu a údržba pri synchronizácii; vrstva AIM to rieši bez neho.
- *Výplň aj v 3D:* zatiaľ len 2D, aby v 3D neprekrývala model (otázka pre Samuela v #137).

**Evaly (D-057):** v cloud session bez kľúčov Supabase nepobežali; do `eval/questions.json`
pribudli otázky z issues.
