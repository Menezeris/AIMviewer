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

- **2026-10-22** - **D-157 (dlaždice vo vieweri, #210, krok 2):** `set_view_mode layout` (single, split_h, split_v, štyri varianty troch okien s veľkou dlaždicou, three_h, three_v, grid4) a `tiles`; jedna živá 3D dlaždica (jeden WebGPU canvas sa presúva), ostatné 3D dlaždice snímka do kliknutia, dokumenty a pôdorysy bez podkladu v dlaždiciach, `view_state.layout`.
- **2026-10-22** - **D-136 (dlaždice vo vieweri, #210, krok 1):** `set_view_mode panels.drawing` otvorí pôvodný 2D výkres rezu z modelu (bez podkladu) pod 3D; pôdorys bez podkladu pri 3D = `set_section(floor)` + `panels={drawing: open}`. Viac 3D pohľadov naraz (dlaždice) čaká na Samuela.
- **2026-10-21** - **D-132 (záložky vo vieweri, #165):** pohľad = orez (kamera zamknutá kolmo + rovina alebo box), záložka = otvorený pohľad na celú plochu (3D, pôdorys podlažia za behu, uložený pohľad, dokument), Vedľa medzi záložkami, `open_drawing target`, `set_view_mode view/tab/beside/close_tab`, `set_section box`, `view_state.tabs`.
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

**Dodatok 2026-10-20 - krok 2 (dokumenty objektu cez vzťahy, Samuel potvrdil).**
- Pohľad `v_object_documents` (migrácia `20261020090000`): objekt -> dokument (alebo strana pri
  `document_reference`) a cez čo: `direct`, `type`, `zone` / `group` / `system` (členstvo, prvok
  aj cez miestnosť v zóne z `v_zone_elements`), `spatial_zone` (aj odvodené
  `element_in_spatial_zone`), a cez nadradené zóny a skupiny (`rel_assigns_to_group`,
  `rel_aggregates`). Ide sa od nositeľov dokumentov nadol, nie od všetkých objektov: na prod 14 769
  riadkov pre 1 543 objektov, celý pohľad 85 ms, jeden objekt 60 ms. Projekt sa nededí.
- Tooly (MCP aj `/ask`): podľa D-114 a D-115 rozšírenie, nie nový tool. `get_object` dostane
  `include=documents` (namiesto `drawings`): pri objekte jeden riadok na dokument a stranu s
  najbližšou cestou (`via_name`, `through`, `also_via`) a odkazom na otvorenie na strane, plus počet
  dokumentov stavby; pri dokumente alebo odkaze na stranu opačne objekty, ktorých sa týka (počty
  podľa typu a nositeľa, vzorka). `query_view` pozná `v_object_documents` a strom dokumentácie.
- Výkresové väzby z obsahu PDF (E4), ktoré čítali `include=drawings` a `find_in_drawings`, krok 1
  ukončil, takže vždy vracali prázdno. Staré `include=drawings` vedie na dokumenty z modelu;
  staré meno `find_in_drawings` `main` medzitým zrušil spolu s ostatnými menami D-115.
- Čo z modelu vychádza: zóny cez viac podlaží (Spoločné priestory, Nájomné priestory) nesú pôdorysy
  všetkých podlaží, takže dvere na 1NP dostanú aj pôdorys 3NP a strechy. Pohľad to nefiltruje (je to
  väzba v modeli); presnejšie by bolo viazať pôdorys na zónu podlažia alebo na podlažie (otázka na
  Samuela v PR).
- Poučenie z kroku 1: úloha z BCF témy #3 (ASR v75, 19. 10. 17:07) bežala s ETL z `main` ešte pred
  merge #105 a starý ETL vrátil starú sadu dokumentov a uzavrel strom; náprava = `reetl` po merge.
  Kým zmena ETL nie je v `main`, každé re-ETL z iných workflowov ju prepíše.

**Dodatok 2026-10-20 - nositelia dokumentov podľa praxe (Samuel).** Model sa upraví receptom OCB
`recepty/ASR/v076-dokumenty-nositelia.py` (revízia ASR v76):
- podlažie (IfcBuildingStorey) nesie pôdorysy všetkých profesií svojho podlažia (1NP: ASR, PBR,
  základy, strop nad 1NP; 2NP a 3NP: ASR, PBR; 4NP: strecha, PBR; 5NP: strecha - jeden výkres pre
  4NP a 5NP);
- miestnosť (IfcSpace) nesie len ASR pôdorys svojho podlažia;
- zóna (IfcZone) nesie len zónové dokumenty: ASR pôdorysy zo zón (15 väzieb) sa odoberú; požiarne
  úseky (PBR pôdorysy, technická správa, výpočet rizika) a tepelné zóny (PENB, SF.02) ostávajú;
- budova (IfcBuilding) nesie výkresy pre všetky podlažia (TP.01, SF.01), pozemok (IfcSite) situácie
  (C.01 až C.03, D.1.3.01); projekt ostáva nositeľom celej dokumentácie.
Pohľad `v_object_documents` (migrácia `20261020120000`): prvok dedí dokumenty podlažia a miestnosti,
v ktorých je; miestnosť od podlažia nededí (ostane pri ASR pôdoryse, PBR dostane cez požiarny
úsek), budova, pozemok a projekt sa nededia. Výsledok: dvere na 1NP majú pôdorysy 1NP všetkých
profesií, nie pôdorys 3NP a strechy ako pri zónach cez viac podlaží.

**Dodatok 2026-10-20 - plán kroku 3 (viewer).** Zistený stav pred krokom 3:
- Zoznam dokumentov pre viewer (`DOCUMENTS_LOAD`, `lib/data/documents.ts`) posiela len súbory a v
  `meta` len `revision`, `status`, `purpose` (v ASR prázdne); nové stĺpce kroku 1 (`identification`,
  `last_revision_time`, `electronic_format`, `document_owner`) a nositeľov neposiela. Vetva
  `kind = drawing` čaká na rolu `drawing` (E3), ktorú IFC dokumenty nemajú.
- AIM karta (`/api/element`, `lib/data/object.ts`) berie len priame väzby (po v76 len miestnosť a
  jej ASR pôdorys), bez strany a cesty; klik pošle `AIM_NAVIGATE` na `/drawing/[id]` a odíde z 3D.
- Podklady výkresov (`fetchUnderlayDrawings`) hľadajú väzbu podlažie -> dokument s rolou `drawing`,
  takže sú od kroku 1 prázdne. Kalibrácia sa píše do `objects.properties._georef`, ktoré každé
  re-ETL prepíše (upsert `properties = excluded.properties`).
- Vo forku: skupiny lišty sú zoznam `PANEL_GROUPS` v `lib/panels/registry.ts` bez sentinelu,
  `DocumentsPanel` zoskupuje len podľa `folder` a filtruje len názov, `AimCard` dokumentu pozná len
  `href`. `bridge-protocol.ts`, `HierarchyPanel.tsx` a `PdfDocumentView.tsx` sú na limite veľkosti.

Postup (D-087: najprv fork, potom AIMviewer; každá časť je spätne kompatibilná, nové polia sú
voliteľné a starší viewer ich ignoruje):
1. **Fork, lišta:** skupina `aim` prvá v `PANEL_GROUPS` (popisky v `i18n/catalogues/aim-fork.en.ts`),
   do nej `documents` (z Coordinate), `drawing-underlay` (z Author) a nový panel `aim-layers`
   (`aim/AimLayersPanel.tsx` nad existujúcim `AimLayersSectionBody`, na celú výšku); sekcia AIM
   VRSTVY z ľavého stromu zmizne (dva riadky v `HierarchyPanel` preč, menej zásahov do upstreamu).
   Ribbon AIM otvára panel vrstiev namiesto ľavého stromu. Upstream testy, ktoré čakajú `hierarchy`
   ako prvý panel lišty, sa upravia v sentineloch. Uložené rozloženie lišty si poradie nechá
   (migrácia rozloženia forku mení len nedotknuté predvolené poradie): nová skupina sa ukáže po
   "Reset layout"; vlastná migrácia sa nerobí.
2. **Fork, panel Dokumenty:** logika v `aim/documentsQuery.ts` (čisté funkcie, testy `node:test`),
   `DocumentsPanel` ju len volá. Zoskupenie "podľa" = priečinok (strom dokumentácie) alebo
   ľubovoľný kľúč `meta`, ktorý majú poslané dokumenty (zoznam kľúčov viewer nedrží); hľadanie
   v názve a všetkých hodnotách `meta` bez ohľadu na diakritiku; prepínač "len pre výber" ukáže
   dokumenty z AIM karty aktuálneho výberu (ten istý zdroj, žiadna nová správa) s cestou "cez
   N3.01" a klik otvorí PDF na strane (`openDocument(id, {page})`). Texty cez katalóg forku.
3. **Fork, AIM karta:** položka dokumentu dostane voliteľné `documentId`, `page`, `via`; ak ich
   má a viewer dokument pozná, klik otvorí PDF vo vieweri na strane, inak ako doteraz `href`.
4. **AIMviewer, dáta:** `objectDocuments` z `lib/llm/tools.ts` sa presunie do
   `lib/data/object-documents.ts` (jeden kód pre tooly, AIM kartu aj panel; doplní sa filter
   `valid_until`). `/api/element` dá do karty efektívne dokumenty z `v_object_documents` (bez
   dokumentácie projektu, tá je v paneli) s `documentId`, `page`, `via` a `href` ako zálohou.
   `DOCUMENTS_LOAD` pošle v `meta` kľúče `Identifikácia`, `Časť` (časť stromu, napr. D.1.1),
   `Nositeľ` (typy nositeľov dokumentu: podlažie, miestnosť, zóna, požiarny úsek...), `Podlažie`
   (podlažia, ktoré dokument nesú), `Revízia` (dátum `last_revision_time`), `Formát`, `Vlastník`;
   mŕtva vetva E3 (`kind = drawing` z roly, priečinok "Výkresy") zmizne.
5. **AIMviewer, podklady:** zdroj podkladov = dokumenty, ktoré nesie podlažie (po v76 pôdorysy
   všetkých profesií), nie rola `drawing`. ETL pri upserte zachová kľúče, ktoré píše host
   (`_georef`), aby re-ETL kalibráciu nezmazal. Kalibrácia sa robí znova nad IFC pôdorysmi.
6. **Overenie:** testy forku (`aim-feature` skill: tsc, `node:test`, kontroly veľkosti, i18n a
   fast lane), vitest AIMviewera, naživo Playwright nad preview: lišta s AIM navrchu, zoskupenie
   podľa časti a podlažia, "len pre výber" na 3.01 a DD01.07.01, otvorenie D.1.1.09 na strane 3
   z karty podlahy ST01.20.0012.

Mimo kroku 3: hľadanie v obsahu PDF (krok 4, `document_pages` je na prod prázdna) a preklik z
dokumentu na prvky v 3D (ďalší program bodu 4).

Otvorené pre Samuela: **druh dokumentu** (výkres, technická správa, výpočet, posudok) model
nenesie (`Purpose`, `IntendedUse`, `Scope`, `Status` sú v ASR prázdne), takže zoskupenie podľa
druhu a rozlíšenie výkresu pre podklady z dát nejde. Návrh: doplniť ho receptom do
`IfcDocumentInformation.Purpose` (model je nositeľ), nie odvodzovať z mena súboru vo vieweri.

**Dodatok 2026-10-20 - druh dokumentu = typ informácie ISO 19650 (Samuel).** IFC nemá na
IfcDocumentInformation atribút pre druh (overené v schéme IFC4X3_ADD2: `Purpose`, `IntendedUse`,
`Scope` sú voľný text, `Status` a `Confidentiality` iné číselníky). Druh sa zapíše ako
klasifikácia dokumentu, nie ako text v `Purpose`:
- Číselník = pole Type (typ informácie) v názve kontajnera z **národnej prílohy UK k ISO 19650-2**
  (BS EN ISO 19650-2:2018 NA); samotné medzinárodné časti ISO 19650 kódy neurčujú. V IFC
  `IfcClassification` "ISO 19650 typ informácie" (Source BSI), referencia = kód s menom po
  slovensky a `Description` po anglicky. Použité kódy: DR výkres, CA výpočty, RP správa, SH výpis,
  SP špecifikácia; ďalšie kódy prílohy sa pridajú, keď ich bude treba.
- Väzba = `IfcExternalReferenceRelationship` (referencia -> dokumenty), lebo dokument nie je
  IfcRoot a IfcRelAssociatesClassification naň nedosiahne. V DB nový rel_type
  `rel_external_reference_relationship` (resource, `to_id` -> `classification_references` ako
  pri `rel_associates_classification`), migrácia `20261020150000`. Meno referencie ETL už ukladá.
- ASR v77 (recept OCB `recepty/ASR/v077-typy-dokumentov-iso19650.py`): 44 dokumentov so súborom,
  DR 26, CA 10, RP 5, SH 2, SP 1, podľa obsahu PDF (A4 výpočtové prílohy TZB a fyziky = CA,
  výkresové listy vrátane štúdie S.01 a tepelných záťaží TP.02 = DR, výpisy skladieb = SH,
  hierarchia SNIM = SP). Priečinkové časti stromu typ nemajú.
- Krok 3 (plán vyššie) tým dostáva: `meta` kľúč `Druh` v zozname dokumentov, druh v AIM karte a v
  `get_object(include=documents)`; podklady výkresov = dokumenty typu DR, ktoré nesie podlažie.

**Dodatok 2026-10-20 - krok 3 urobený (viewer a dáta pre neho).** Fork Menezeris/ifc-lite#81,
AIMviewer vetva `claude/lucid-wright-g4qmwq-krok3` (stavia na #121):
- Lišta viewera: skupina `aim` prvá v `PANEL_GROUPS` s panelmi Documents, AIM layers (sekcia zo
  stromu je vlastný panel `aim-layers`) a Drawing underlays. Uložené rozloženie si poradie nechá,
  skupina sa ukáže po "Reset layout" (vlastná migrácia rozloženia sa nerobí).
- Panel dokumentov zoskupuje podľa priečinka alebo kľúča `meta`, filter hľadá v názve, priečinku
  aj `meta` bez diakritiky; "Len pre výber" berie dokumenty z AIM karty výberu (žiadna nová
  správa mosta). Viac hodnôt v jednom kľúči oddeľuje `; ` (pôdorys strechy 4NP aj 5NP).
- `DOCUMENTS_LOAD.meta` (`lib/data/document-meta.ts`): Identifikácia, Časť, Druh, Nositeľ,
  Podlažie, Revízia, Formát, Vlastník; kľúč je rovno slovenský popisok, viewer ich nepozná
  vopred. Projekt je nositeľom len pri dokumente, ktorý nič iné nenesie. Pôdorys podlažia
  (dokument na podlaží, druh DR alebo neznámy) je `kind = drawing`, `storeyGuid` len pri jednom
  podlaží. Stará vetva E3 (rola `drawing`, priečinok "Výkresy") zmizla.
- AIM karta (`/api/element`) nesie dokumenty prvku z `v_object_documents` (najviac 40) s
  `documentId`, stranou, cestou (`priamo`, `cez priestorovú zónu N3.01`) a kódom druhu; klik
  ich otvorí vo vieweri na strane. Tooly aj karta čítajú z `lib/data/object-documents.ts`.
- Podklady výkresov: dokumenty, ktoré nesie podlažie (rola sa nefiltruje). ETL pri upserte
  objektu zachová kľúče hostiteľa (`HOST_PROPERTY_KEYS = ("_georef",)` v `etl/db.py`), takže
  re-ETL kalibráciu nezmaže.

**Dodatok 2026-10-20 - krok 4: z dokumentu na prvky v 3D (Samuel, bez nového D).** Samuel
pomenoval krokom 4 preklik "ukáž, čoho sa týka tento výkres / táto strana" (bod 4 rozhodnutia);
text strán a odstránenie starej sady zo zoznamu krokov vyššie idú po ňom. Podľa D-114 bez
nového toolu:
- Tooly: `style_in_3d` a `open_list` dostali filter `document` (id, object_ref alebo názov, napr.
  `D.1.1.03`; odkaz na časť dokumentu len podľa id alebo presného object_ref) a `page`. Prvky sú
  tie isté ako v `get_object(include=documents)` pri dokumente: `v_object_documents` aj zdedené cez
  podlažie, zónu, skupinu a typ, do 3D len uzly s geometriou (asset, space, spatial_zone).
  Kombinuje sa s ostatnými filtrami (AND). `show_in_3d` sa nemení (strop 100 prvkov na
  zvýraznenie), jeho popis posiela na `style_in_3d`.
- Veľký dokument necestuje v URL: lens nesie symbolické pravidlo `aim_document {id, page}` ako
  zónu `aim_zone` (D-096) a klient si GUIDy stiahne z `/api/style-scope?document=<id>[&page=N]`
  (strop mosta 5000). Skrytie a zobrazenie (`hide`/`show`) idú starou cestou s GUIDmi (strop 500).
- `get_object` pri dokumente stránkuje `v_object_documents` (predtým `.limit(5000)` ticho orezal
  na 1000 riadkov PostgREST, pôdorys podlažia ich má viac), vracia `by_page` (počet objektov na
  stranu) a `in_3d` s presným volaním `style_in_3d`.
- Fork: tlačidlo "Ukázať v 3D" v lište otvoreného PDF pošle `DOCUMENT_SHOW_3D {documentId, page}`
  s čítanou stranou; host odpovie `APPLY_LENS` (replace, X-ray podľa D-105, štítok = meno
  dokumentu). Strana bez vlastných prvkov (titulná strana, pôdorys bez odkazov na strany) ukáže
  celý dokument. Viewer väzby dokumentov nedrží, rozhoduje graf AIM.

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
   **Dodatok 2026-10-20 (Samuel):** staré mená sú zmazané hneď, nečaká sa do 3. 11. Konektor
   používa len Samuel, staré konverzácie s uloženým zoznamom toolov nepoužije a `mcp_call_log` od
   06:17 UTC staré mená neukazuje. Zrušené: `legacyTools` v MCP serveri, `mcpLegacyToolNames`,
   `LEGACY_*_TOOL_NAMES` a vetvy dispatchu, ktoré vykonali staré meno; volanie starým menom vráti
   "Neznámy tool". `search_everything` ostáva riadnym toolom bez motora (aj `/api/ask`), s motorom ho
   v MCP nahrádza `search_all` bez aliasu.
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

7. **Zvyšky po záverečnom evale** (pridelené orchestrátorom so súhlasom Samuela, bez nového toolu): D7 -
   `get_object` pre prvok len v IFC vráti `storey` (podlažie nahor cez IfcRelAggregates /
   IfcRelContainedInSpatialStructure, `lib/engine/names.ts`); V6 - opis výberu neradí `ifc_get`, keď panel
   hodnoty ukáže sám.

**Zavrhnuté:**
- *Jeden veľký PR:* regresiu vo výbere toolu by nebolo vidieť po skupinách.
- *Premenovať všetko na nové mená (`ifc_model`, `find_objects`...):* rozbije porovnanie s
  predchádzajúcimi kolami v `mcp_call_log` a evaloch bez úžitku pre agenta.
- *Okamžite zmazať staré mená:* claude.ai drží zoznam toolov počas konverzácie, rozpracované
  rozhovory by padali na "Neznámy tool". (Prehodnotené v ten istý deň, dodatok k bodu 2.)

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


### D-118 - Rýchle kontroly nad modelom: atribúty v `ifc_query.where` a postup kontroly
**Dátum:** 2026-10-20 · **Stav:** rozhodnuté (orchestrátor na Samuelov pokyn, rýchla časť issue #77) · **Súvisí:** D-084, D-112, D-111, D-099, D-114

**Kontext:** issue #77 žiada `run_rule_check` (sada pravidiel STN/ČSN, meranie, pass/fail, tabuľka, BCF).
Samuel chce hneď rýchlu časť nad tým, čo už je. Limity noriem patria do knižnice požiadaviek (IDS,
`ifc_ids_validate`), nie do konektora. Chýbalo: `ifc_query.where` nevidel IFC atribúty
(`OverallWidth`, `OverallHeight`), len psety a Qto; upstream selektor atribúty tiež nevie.

**Rozhodnutie (D-114, rozšírenie, nie nový tool):**
1. `ifc_query.where` prijme podmienku `{attribute, op, value}` namiesto `pset` + `name`. Kandidáti
   (triedy, podlažie, podmienky na psety) idú z `query_entities` ako doteraz, atribúty sa dofiltrujú
   z `get_entities_bulk(include=attributes)` po stránkach 1000. Čísla sa porovnávajú číselne, text bez
   ohľadu na veľkosť písmen; `matches` atribút nevie. Podmienka na atribút potrebuje `ifc_types`,
   strop 20 000 kandidátov. Platí pre `mode=list` aj `count`.
2. `ifc_measure` bez zmeny kódu: opis hovorí, že "od steny k stene" je jedno volanie `a` + `b`
   a šírka obdĺžnikovej miestnosti či chodby je `bbox_m` miestnosti (`a` = IfcSpace).
3. Inštrukcie MCP: rýchla kontrola = `ifc_query` / `ifc_measure` -> `style_in_3d` (pass zelená,
   fail červená) -> `open_list` -> pri zlyhaní ponúknuť `bcf_topic`. Limit dáva používateľ alebo IDS,
   model si ho nevymýšľa. Nahrádza recept "ofarbi miestnosti podľa plochy" (ten istý postup).

**Overenie nad ASR (konektor):** `ifc_measure(SN05.01.0001, SN05.01.0002)` jedným volaním 9,3 m;
miestnosť 1.10 = 6,796 x 3,221 m, pôdorys z meshu = Qto 21,699 m². DD02.05.04 má `OverallWidth`
900 (so zárubňou) a zároveň pset `AIM_Door.ClearWidth` 800; `where AIM_Door.ClearWidth < 900` = 40 dverí.

**Zavrhnuté:**
- *Nový tool `run_rule_check` so sadou limitov:* duplikát IDS bez citácie normy (komentár v #77).
- *Upstream `check_rules` (`@ifc-lite/rules`) 1:1:* formát je ťažký na ručné písanie a dubluje IDS.

**Otvorené:**
- Steny ohraničujúce miestnosť sa dnes nedajú zistiť (model nemá `IfcRelSpaceBoundary`,
  `v_space_elements` steny nepriraďuje), steny určí používateľ alebo výber vo vieweri.
- Kóta merania vo vieweri: `ifc_measure` vracia jeden najbližší bod, kóta potrebuje oba body
  dvojice, prevod osí IFC (Z hore) do rámca renderera a novú správu mosta vo forku, ktorá zapíše
  meranie do upstream `measurementSlice`. Väčší kus, návrh v #77.
- ~~Nositeľ svetlej šírky dverí (`AIM_Door.ClearWidth`?) potvrdí Samuel.~~ Rozhodnuté dodatkom nižšie:
  svetlosť dverí sa meria z geometrie, psety sú len kontrola.

**Dodatok (2026-10-20, druhá časť #77): svetlá šírka a výška dverí z geometrie.** Samuel (cez
orchestrátora): svetlosť sa MERIA, `AIM_Door.ClearWidth` ani `OverallWidth` nie sú zdroj pravdy.
- *Rozšírenie (D-114):* `ifc_measure` dostal `clear_opening=true` (a alebo `items`, max 50, napr. GUIDy
  dverí z `ifc_query storey=1NP`) a voliteľné limity `min_width_m` / `min_height_m` od používateľa.
  Výsledok na dvere: `width_m`, `height_m`, `width_min_m`, obálka so zárubňou, `result` pass/fail/unknown
  s dôvodom; súhrn `check` s `style_pass` / `style_fail` rovno pre `style_in_3d`. Limity noriem v tooli nie sú.
- *Algoritmus (`lib/engine/door-clear.ts`):* mesher dáva každé teleso reprezentácie zvlášť (zárubňa,
  krídlo, sklo, kovanie, prah), `MeshElement.parts` si ich pamätá. Osi dverí z pôdorysu (obdĺžnik
  s najmenšou plochou), z telies sa odstráni výplň otvoru: teleso zasiahnuté lúčom po hĺbke v strednej
  časti otvoru (krídlo, sklo, posuvné panely), vnútorné nízke teleso (kľučka, madlo, paniková tyč) a
  vnútorný prstenec okolo stredu (rám krídla so sklom). Ostane zárubňa, nadpražie, prah, prípadne portál
  v tvare U (výťah). Šírka = lúče po šírke v mriežke výšok x hĺbok, najužšie miesto cez hĺbku (doraz),
  medián výšok; výška = od prahu alebo spodku dverí po nadpražie. Karuselové dvere a dvere bez zárubne
  vrátia dôvod namiesto čísla.
- *Overenie na ASR* (súbor z verejného bucketu, etag `5bf4ca79...-2`, ten istý, ktorý číta konektor):
  97 dverí za ~5 s vrátane tesselácie. Všetkých 90 dverí s `AIM_Door` má šírku zhodnú na mm. Výška:
  53 zhodne, 29 o 3-4 mm nižšia (prah 4 mm, pset ho ignoruje), 8 výťahových o 50 mm vyššia (portál
  2,15 m nad posuvnými panelmi 2,10 m). 6 presklených dverí (DD02.04.*, DD03.04.*) má v modeli len
  kovanie, bez rámu a krídla, a nemá ani `AIM_Door` -> unknown s dôvodom; karuselové DD01.08.0001
  -> unknown. Konektorom: `ifc_query storey=1NP where AIM_Door.ClearWidth < 800` = 12 dverí.
- *Zavrhnuté:* svetlosť z `IfcOpeningElement` (to je stavebný otvor 900 x 2300 pre DD02.05.04, nie
  svetlosť zárubne 800 x 2100); svetlosť z krídla (pri dorazovej zárubni je krídlo širšie ako
  priechod, výťah má viac panelov); nový tool (D-114, ide to parametrom `ifc_measure`).
- *Hranice:* krídlo otvorené o 90° a kľučka sa od šírky neodpočítavajú; dvere z jedného telesa
  (zárubňa aj krídlo v jednom telese) sa nedajú rozdeliť a vrátia dôvod.

### D-121 - Najkratšia a úniková cesta: `ifc_measure route` nad hranicami priestorov zo súboru
**Status:** rozhodnuté (2026-10-20, Samuel v #76), číslo pridelené v registri #60. Nadväzuje na D-112 (meranie
z geometrie), D-114 (najprv napasuj) a D-086 (úprava IFC receptom v OCB).

**Kontext:** "Aká je najkratšia pochôdzna cesta z týchto dverí k tamtým?" a "aká dlhá je úniková cesta z
miestnosti?" konektor nevedel. Triáž v #76 navrhla graf miestností a dverí a postavila dve otázky: dolný
odhad alebo pochôdzna sieť (navmesh) a odkiaľ vziať väzbu dvere - miestnosť.

**Rozhodnutie (Samuel, 20. 10.):**
1. **Dĺžka = DOLNÝ ODHAD:** priamky v pôdoryse cez miestnosti medzi dverami (štart a cieľ v strede prvku,
   miestnosti alebo dverí), schodisko = dĺžka ramien (priemet dlhšej strany a prevýšenie). Nábytok, tvar L,
   šírku priechodu ani zámky nezohľadní a výstup to hovorí (`length_kind`, `note`). Navmesh nie.
2. **Graf zo súboru, štandardne IFC:** dvere a miestnosť spája `IfcRelSpaceBoundary` (RelatingSpace =
   IfcSpace, RelatedBuildingElement = IfcDoor; dvere medzi dvoma miestnosťami = dve väzby). Chýbajúce väzby
   doplní recept v OCB (`recepty/ASR/v078-hranice-priestorov.py`, revízia v078 nad v077), nie tool.
3. **Tool:** `ifc_measure` dostane `route` = `shortest` (a -> b) | `escape` (a -> najbližší východ). Výstup:
   `length_m`, poradie miestností, dverí a schodísk (`steps` so `segment_m`), `storey_changes`, ďalšie
   východy (`other_exits`), `show_in_3d` trasy a súhrn grafu. Modul `lib/engine/route.ts`.
4. **Východ** = dvere s `Pset_DoorCommon.IsExternal` alebo s jedinou hranicou `EXTERNAL`, len na najnižšom
   podlaží, ktoré také dvere má (terén). Vonkajšie dvere vyššie (strecha, terasa ASR DD04.06.01) sa vypíšu
   (`upper_external_doors_not_exits`), za cieľ úniku sa neberú.
5. **Podlažia spája schodisko** (`IfcStair`, nie rebrík): spodok = miestnosť jeho podlažia, v ktorej pôdoryse
   leží stred schodiska, vrch = taká miestnosť na podlaží nad ním (inak najväčší prekryv obálok). Výťahy v
   grafe nie sú (pri úniku sa nepoužívajú).
6. **Limity dĺžok podľa noriem (STN 73 0802) tool neposudzuje**, patria do knižnice IDS s klauzulou.

**Zistenie na ASR v76 (zverejnená):** hranice 1. úrovne v súbore už sú (720, 151 pri 93 dverách z 97, Revit
export); triáž v #76 robila staršiu revíziu. Schodiskový priestor 2NP (2.20) existuje, IfcSpace netreba
dopĺňať. Chýba ale 12 väzieb, hlavne CHÚC 1.06 - vonkajšie dvere DD01.06.08 a 1.06 - lobby (DD01.02.03),
takže z 2NP až 4NP na v76 **nevedie úniková cesta** (tool vráti chybu s počtom dosiahnuteľných miestností).
Recept v078 z geometrie (bod 0,6 m pred a za krídlom) pridá 12 väzieb a opraví 12 príznakov
`InternalOrExternalBoundary` (dvere medzi dvoma miestnosťami označené EXTERNAL, vonkajšie DD04.06.01 INTERNAL);
druhý beh nič nemení, GlobalId existujúcich sa nemenia, počty tried +12 `IfcRelSpaceBoundary1stLevel`.

**Overenie na lokálnom v078:** úniková cesta z 2.01 33,0 m (2.13, 2.20, schodisko SC01.0001, 1.23, CHÚC 1.06,
DD01.06.08), z 4.01 52,8 m (tri schodiská), z 1.05 11,9 m; najkratšia 2.01 -> 1.05 29,7 m. Prvé volanie
s tesseláciou ASR 4,8 s, ďalšie okolo 30 ms.

**Zavrhnuté rozšírenie: nový tool `shortest_path` - prečo nie:** štart a cieľ sa zadávajú ako pri meraní
(a, b), výsledok je dĺžka z geometrie a tool zdieľa tesseláciu modelu s `ifc_measure`; rozlišovací parameter
`route` stačí (D-114, D-115). `ifc_relations` s `recursive` (D-110) prechádza vzťahy bez dĺžok a jeho výstup
sú riadky vzťahov, nie trasa.

**Zavrhnuté:**
- *Väzby dvere - miestnosť len z geometrie v toole:* výsledok by nebol v súbore, viewer ani IDS by ho nevideli;
  Samuel chce štandardné IFC väzby (geometriu používa len recept, raz).
- *Výťah v únikovej ceste:* pri požiari sa nepoužíva; najkratšia cesta výťahom by potrebovala väzbu kabíny
  na podlažia, ktorú model nemá.

**Otvorené:** dvere DD02.05.14 majú navyše hranicu s 2.02 (geometria vidí len 2.01 | 2.10), recept ju nemaže;
DD04.07.02 (vstup do akustickej zásteny na streche) nemá miestnosť ani z jednej strany. Čiara trasy vo vieweri
(nie len zvýraznenie prvkov) potrebuje správu mosta vo forku.

**Dodatok 2026-10-20 (Samuel cez orchestrátora):** 12 opráv `InternalOrExternalBoundary` áno; navyše hranica
DD02.05.14 - 2.02 sa v receptoch odoberá (pravidlo: väzba dverí s miestnosťou, ktorú geometria nevidí na žiadnej
strane, keď dvere majú obe strany v iných miestnostiach; viac ako 1 prípad = len výpis); dvere na strechu nie sú
východ. **Otočné (karuselové) dvere nie sú únikový východ:** tool vylúči dvere s `OperationType` REVOLVING*
(výskyt, inak typ) a vypíše ich v `revolving_doors_not_exits`; priechodné ostávajú. V ASR v76 má typ DD01.08
"Karuselové dvere" chybne DOUBLE_SWING_RIGHT, recept v078 ho opraví na REVOLVING.

---

### D-124 - Kóta vo vieweri: `ifc_measure show` cez nástroj Measure forku
**Status:** rozhodnuté (2026-10-20, Samuel cez orchestrátora), číslo pridelené v registri #60. Nadväzuje na
D-112 (meranie z geometrie), D-098 (most volá existujúce funkcie viewera) a D-114 (najprv napasuj).

**Kontext:** `ifc_measure` vracal svetlú vzdialenosť a rozmery len ako čísla; vo vieweri sa dali ukázať len
prvky, nie čiara, medzi ktorou sa meralo.

**Rozhodnutie:**
1. **Fork nekreslí nič nové.** Nový príkaz mosta `MEASURE_SHOW { segments: [{ a, b }], keep? }` (body
   v IFC svete, Z hore, m; najviac 12) vloží úseky do upstream nástroja Measure ako hotové merania, tou istou
   cestou ako dva kliky (`addMeasurePoint` + `completeMeasurement`). Kreslí ich `MeasurementSceneLayer`
   s jednotkami viewera aj bez otvoreného nástroja a používateľ ich vymaže ako vlastné. Prevod IFC svet ->
   render rámec je ten istý ako pri póze kamery od hosta (`ifcPointToRender`, `bcfWorldOffset`). Kóty od
   hosta si fork pamätá: ďalší príkaz bez `keep` ich nahradí, merania používateľa nechá.
2. **`ifc_measure` (`lib/engine/measure-dimension.ts`):** pri a + b vracia `closest_points` (konce najkratšej
   úsečky v IFC svete). Clash engine dáva len stred úsečky, konce sú najbližšie body každého meshu k nemu (pre
   dvojicu s minimom presne tie isté body). `show=true` pošle kótu do živého viewera: a + b = táto úsečka,
   len a = tri hrany obálky X, Y, Z. Pri prieniku a dotyku nie je čo kótovať.
3. **Rámec meshu:** headless tesselácia si pamätá posun do IFC sveta z `coordinateInfo`
   (`renderFrameWorldOffset`), aby body sedeli aj pri modeli s RTC posunom (ASR v76 má posun 0).
4. Akcie z nástrojov motora idú do viewera tou istou cestou ako akcie DB tools (`deliverActions` v MCP route,
   s potvrdením `APPLIED`).

**Zavrhnuté rozšírenie: nový tool `show_dimension` - prečo nie:** body počíta `ifc_measure` z tých istých
meshov a jeho výsledok je to, čo sa má ukázať; rozlišovací parameter `show` stačí (D-114).

**Zavrhnuté:**
- *Vlastný renderer kót vo forku:* upstream Measure už kreslí, popisuje a maže merania (D-098).
- *Úsečka zo stredu `closest_point` a obálky clash výsledku:* obálka úsečky neurčuje, ktorá uhlopriečka je
  úsečka.
### D-120 - Rez: vzhľad reznej plochy z chatu (šrafa, výplň) a vynechanie prvkov z rezu

**Dátum:** 2026-10-20 · **Stav:** časť 1 prijatá (implementovaná), časť 2 čaká na Samuela · **Súvisí:** D-083, D-085, D-092, D-094, D-098, D-114 · **Issues:** #138, #139 · **PR:** Menezeris/ifc-lite (fork), AIMviewer (tento)

**Kontext:** pri reze nad podlažím viewer kreslí rezné plochy so šrafou a žiadny tool ju nevie
vypnúť; šrafa prekrýva ofarbenie Lens (miestnosti Retail 1/2) a znižuje čitateľnosť (#138).
Druhá potreba (#139): ukázať celý objem ofarbených miestností (IfcSpace), kým ostatné konštrukcie
ostanú prerezané.

**Najbližšie tooly (D-114):** `set_section` (rez, widget; vzhľad plochy neovláda), `style_in_3d`
(farba prvkov, nie rezná plocha, ktorú kreslí renderer rezu), `set_view_mode` (len režim).
Obe potreby sú parameter `set_section`, nie nový tool.

**Rozhodnutie:**
1. **Vzhľad reznej plochy (#138):** `set_section` dostane `cap_style` = `hatch | solid | none` a
   `cap_color` (`#rrggbb`, samotná farba = plná výplň). Platí pri `action=set` aj pri
   `action=widget` (aktívny rez bez zmeny polohy). Op `section_cap:<cap>[~c=<hex>]:`
   (`lib/viewer-section-cap.ts`), bridge `SET_SECTION_CAP` vo forku (`aim/sectionCap.ts`).
   Podľa D-098 nič nové: fork volá tie isté setery store ako tlačidlo Fill slice a popover Cap
   (`setSectionShowCap`, `setSectionCapStyle`). Preto voľba platí pre všetky roviny a viewer si ju
   pamätá v prehliadači ako po kliknutí; `hatch` vráti šrafu, ktorá bola pred plnou výplňou.
   `none` skryje plochy, obrysové čiary rezu ostávajú.
2. **Vynechanie prvkov z rezu (#139):** fork ani upstream ifc-lite to nevedia. Rovina rezu sa v
   shaderi uplatňuje pre celé dávky geometrie (bit `flags.y` v uniformách, `packages/renderer`),
   nie po prvkoch, takže to nejde mostom ani v `apps/viewer/src/aim/`. Riešenie by bolo per-entity
   tabuľka "nereže sa" v rendereri (vzor: tabuľka farieb #6076) s testom v hlavnom shaderi, v
   tieňoch a pri výpočte rezných plôch, a parameter `set_section` (napr. `exclude_ids_or_refs`,
   `exclude_ifc_types`). To je zmena upstream balíka forku (plné CI, odchýlka pri každej
   synchronizácii, ponuka upstreamu). Čaká na Samuelovo rozhodnutie v #139.

**Zavrhnuté:**
- *Nový tool `set_section_style`:* to isté ako parameter `set_section` (D-114).
- *Vzhľad plochy len pre jeden rez:* store forku ho drží ako jednu voľbu pre všetky roviny
  (#7545 upstream); vlastná per-rez kópia by bola nová funkcia nad rámec D-098.
- *Ukladanie vzhľadu do uloženého pohľadu (D-117):* zatiaľ nie; dá sa doplniť, keď sa D-117 zlúči.

**Poradie zlúčenia:** najprv fork, potom AIMviewer. Starší viewer `SET_SECTION_CAP` ticho ignoruje.
- Nositeľ svetlej šírky dverí (`AIM_Door.ClearWidth`?) potvrdí Samuel.

---

### D-123 - Text dokumentov z textovej vrstvy PDF: naplnenie zo storage, riadky s polohou, čítanie strany v `search_documents`

**Dátum:** 2026-10-20 · **Stav:** prijaté (Samuel cez orchestrátora: rámik áno, OCR nie, výmery z výkresu len na žiadosť); produkcia naplnená · **Súvisí:** D-063 (rozširuje), D-104, D-117, D-114, D-090 · **Issue:** #149

**Kontext:** požiadavka z konektora (#149): spočítať murivo na 1NP z PDF výkresu D.1.1.01 a vedieť
čítať, hľadať a ukazovať text vo všetkých výkresoch a technických správach. Návrh z konverzácie bol
nový tool `read_document` s OCR. Overenie nad produkciou ukázalo, že tool nechýba, chýbajú dáta:
- `document_pages` bolo prázdne (0 strán), preto `search_documents` nevrátil nič ani pre "stavba".
  `etl/pdf_text.py` čítal len starý manifest E3 (`podklady/docs.csv`, mená `OCB_DPS_...`) a lokálne PDF;
  dokumenty z IFC (D-104, `OCB_SO01_...`, PDF v buckete `documents`) doňho nikdy nevošli.
- Všetkých 44 živých PDF v storage má textovú vrstvu (spolu okolo 900 tis. znakov). Pôdorys 1NP má
  11 tis. znakov: čísla a názvy miestností, kóty, hrúbky, označenia dverí, legendy. OCR netreba.
- RPC hľadalo celé slová bez stemmingu, takže "požiarna odolnosť" nenašla "požiarnej odolnosti".

**Rozhodnutie (D-114 bod 2 a 3, žiadny nový tool):**
1. **Dáta:** `python -m etl.pdf_text --from-db` vezme živé dokumenty z DB (`valid_until is null`,
   `documents.location` = URL PDF), stiahne ich a zapíše text strán. Manifestový beh ostáva.
2. **Poloha textu:** nový stĺpec `document_pages.blocks` = riadky textu strany `{t, x, y, w, h}` v % strany
   (počiatok vľavo hore, `page.get_text("dict")`), aby sa dalo povedať, KDE na strane text je.
3. **`search_documents` rozšírený** (nie nový `read_document`): `document_id` (UUID alebo object_ref),
   `page`, `include_blocks`; `q` už nie je povinné.
   - `q` = fulltext ako doteraz, každá zhoda má navyše `regions` (riadky so zhodou: text, presný `bbox` a
     `region` najmenej 15 % na os okolo neho);
   - `q` + `document_id` = hľadanie len v tom dokumente (RPC `doc_id`);
   - `document_id` bez `q` = čítanie strany: celý text (strop 20 000 znakov), `pages_with_text`, s
     `include_blocks` riadky s polohou (strop 1 500).
   `region` má tvar parametra `open_drawing region` (D-117), takže "ukáž vo výkrese X" = `search_documents`
   a potom `open_drawing` s výrezom. Zvýraznenie je zatiaľ priblíženie na výrez.
4. **Skloňovanie:** RPC hľadá slová dopytu ako prefixy; slovo z písmen od 6 znakov stratí posledné 2 znaky
   (hrubá náhrada stemmingu), kódy a čísla (`dd01`, `ei30`, `1.05`) ostávajú celé. Tú istú logiku má
   `queryStems` v `lib/llm/document-text.ts` pre výber riadkov.
5. **Výpočty z výkresu** (objem muriva z kót) sú odhad z textu a polohy kót; prompt to žiada povedať a
   presnejšie čísla odkazuje na IFC (`ifc_measure`, Qto).

**Zavrhnuté rozšírenie:**
- *Nový tool `read_document`:* robí to isté nad tými istými dátami (`document_pages`) s tou istou
  anotáciou (čítanie); `search_documents` s `document_id` to pokryje bez ďalšieho toolu v zozname.
- *`open_drawing highlight_text`:* `open_drawing` je UI akcia bez prístupu k textu; vyhľadanie patrí do
  čítacieho toolu a výsledok (výrez) sa mu podá cez `region` z D-117.
- *`get_object include=text`:* `get_object` je o prvku a jeho väzbách, text dokumentu je iný zdroj
  a strany by zahltili výsledok.
- *OCR:* žiadny dnešný dokument ho nepotrebuje; pridá sa, keď príde sken bez textovej vrstvy.

**Dodatok 2026-10-20 (Samuelove odpovede cez orchestrátora):**
6. **Rámik okolo textu áno:** `open_drawing highlights=[{x, y, width, height}]` (v %, najviac 20, typicky
   `regions[].bbox` zo `search_documents`), op `doc:<strana>[~r=...][~h=x_y_w_h_...]:<id>` a `DOCUMENT_OPEN
   highlights` (zlomky strany). Bez `region` sa karta priblíži na obal rámikov (najmenej 15 % na os). Rámik
   nemá 1 % minimum výrezu, aby tenký riadok ostal tenký. Kreslí ho fork (Menezeris/ifc-lite#86, nadväzuje na
   D-117 #80) ako vrstvu nad stranou v `aim/docRegion.ts`; ďalší `DOCUMENT_OPEN` rámiky nahradí alebo zruší.
7. **OCR mimo rozsahu.**
8. **Výmery z výkresu len na výslovnú žiadosť:** objem muriva, plochy a podobne z kót PDF počíta agent len na
   žiadosť "z výkresu" a ako hrubý odhad; inak vždy z modelu (`ifc_measure`, Qto). Pravidlo je v opise
   `search_documents` a v inštrukciách.
9. **Prečo text v DB (otázka Samuela) a variant bez DB:** hľadanie naprieč všetkými dokumentmi ("v ktorom
   dokumente sa píše o X") potrebuje index; prehľadať 44 PDF (okolo 900 tis. znakov, desiatky MB) pri každej
   otázke by trvalo sekundy až desiatky sekúnd a záviselo by od storage. Čítanie jednej strany
   (`document_id` + `page`) ale index nepotrebuje: **variant B** = server pri čítaní strany stiahne PDF zo
   `documents.location` a vytiahne text a riadky s polohou za behu (pdf.js v Node, rovnaký výstup ako
   `blocks`), s krátkou cache. Výhoda: funguje hneď a pre nový dokument bez ETL; nevýhoda: nová závislosť
   servera (pdf.js), sekundy na prvé čítanie veľkého PDF a dva kódy extrakcie (Python v ETL, JS na serveri),
   ktoré sa môžu rozísť. Odporúčanie: DB ostáva zdrojom pre hľadanie aj čítanie (jeden extraktor, rýchle),
   variant B len ako záloha, keď dokument v `document_pages` chýba. Rozhodne Samuel (#149).

**Stav produkcie (2026-10-20):** Samuel zvolil variant s DB (variant B sa nerobí). Migráciu `20261020160000`
a naplnenie `document_pages` spustil orchestrátor cez Management API tou istou extrakciou ako
`etl/pdf_text.py`: 44 dokumentov, 553 strán, všetky s `blocks`; `search_documents("požiarna odolnosť")` na
produkcii vracia pôdorysy PBR. Nový alebo zmenený dokument: `python -m etl.pdf_text --from-db --only <ref>`.

### D-117 - Výrez strany výkresu z chatu: `open_drawing region`

**Dátum:** 2026-10-20 · **Stav:** navrhnuté (čaká na Samuela, #129) · **Súvisí:** D-114 (rozšírenie namiesto nového toolu), D-104 (dokumenty vo vieweri), D-075, D-083, D-087 · **PR:** Menezeris/ifc-lite#80, AIMviewer (tento)

**Kontext:** #129: používateľ má v 3D narezanú atiku (`SN02.01.0001`, IfcWall PARAPET) a vedľa
otvorí rez A (`open_drawing in_viewer=true`). Karta sa otvorí len celá; `focus_id` funguje len v
`/drawing/[id]` a len cez oblasti E4, ktoré atika nemá (sada E3/E4 sa podľa D-104 ruší). Zoom ani
výrez strany nevie žiadny tool. Najbližšie tooly: `open_drawing` (otvorí kartu so stranou),
`get_object include=drawings` (výkresy prvku z E4, pre atiku prázdne), `set_camera`/`set_section`
(len 3D).

**Rozhodnutie:**
1. **Rozšírenie `open_drawing` o `region`** (D-114, bod 3): výrez strany v % (`x`, `y`, `width`,
   `height`, počiatok vľavo hore). Karta vo vieweri sa priblíži, aby výrez vyplnil plochu, a
   vycentruje ho, aj keď je už otvorená. S `region` ide výkres vždy do viewera (`/drawing/[id]` sa
   podľa D-104 nerozvíja). Výrez mimo strany sa oreže, celý mimo strany = chyba toolu.
2. **Drôt:** op `doc:<strana>~r=<x>_<y>_<w>_<h>:<id>` (percentá), most `DOCUMENT_OPEN` s
   voliteľným `region` v zlomkoch 0-1. Starší viewer pole ignoruje a otvorí stranu celú.
3. **Fork (D-087):** logika v `apps/viewer/src/aim/docRegion.ts` (overenie, zoom, posun, store
   požiadavky), `PdfDocumentView` len volá hook (jednoriadkové bloky AIM-FORK, súbor je na strope
   veľkosti).
4. **Polohu prvku vo výkrese tool nepozná.** Výrez určí používateľ slovne ("vpravo hore", "stred")
   a model ho prevedie na %. Výsledok s `focus_id` vo vieweri to povie v `note`.

**Otvorené (otázka na Samuela v #129):** automatické priblíženie "na to isté miesto ako 3D"
potrebuje kalibráciu rezu (2 body na strane = 2 body v rovine rezu IFC, obdoba D-072 pre
pôdorysy). Žiadny výkres ju dnes nemá a D-104 ju odkladá do programu dokumentov vo vieweri; s ňou
by `open_drawing` vedel výrez dopočítať z obálky prvku (`get_viewer_state bounds`) a aktívneho rezu.

**Zavrhnuté:**
- *Nový tool `zoom_drawing`:* ten istý zdroj (karta dokumentu) aj anotácie ako `open_drawing`;
  rozšírenie stačí (D-114).
- *`focus_id` vo vieweri cez oblasti E4:* sada E3/E4 sa ruší (D-104) a atika v nej nie je.
- *Zoom + stred namiesto výrezu:* výrez priamo zodpovedá vete "priblíž pravý horný roh" a nezávisí
  od veľkosti plochy karty.

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

### D-122 - Uložené pohľady viewera: `saved_view`, zoznam v `get_viewer_state`, obnova v `set_view_mode`
**Status:** rozhodnuté (2026-10-20, pôvodne D-117, prečíslované pre kolíziu v registri #60; Samuel cez orchestrátora: pohľady sú spoločné pre stavbu a žijú
samostatne, nie pri BCF témach; riadok registra `saved_view` čaká na súhlas v #72). Nadväzuje na D-085
(`view_state`), D-098 (presná póza `SET_CAMERA {viewpoint}`), D-099 (tvar viewpointu), D-114 (najprv
napasuj) a D-115 (čítanie a zápis sa nemiešajú). Issue #72, fork PR Menezeris/ifc-lite#79.

**Kontext:** "Ulož to ako Pôdorys technickej miestnosti 3.14" a "rež to ako minule, ale o meter nižšie"
konektor nevedel. Upstream viewer má dve knižnice pohľadov (uložené rezy s kamerou, "basket views"), obe
len v pamäti prehliadača: po obnovení stránky sú preč a server ich nevidí. `bcf_topic(action=viewpoint)`
vie zachytiť kameru, rez a režim, ale pohľady sa nemajú miešať so zoznamom tém. `view_state` vracal
skryté a izolované prvky len ako počty.

**Rozhodnutie:**
1. **Tabuľka `saved_views`** (migrácia `20261020170000`, `SCHEMA.md` 2.17): meno (jedinečné bez ohľadu na
   veľkosť písmen), popis, `viewpoint` v tvare `model_tasks.viewpoint` (kamera v IFC svete s projekciou,
   rez, režim, podlažie a jeho label), výber, skryté a izolované GlobalId (strop 600 ako HIDE/ISOLATE
   mosta), revízie modelov v čase uloženia, autor. Spoločné pre stavbu, bez vlastníka.
2. **"Posledný pohľad"** = jediný riadok `kind = 'last'`, prepíše ho každé uloženie a obnova (nie pohyb
   kamery). Obnova podľa mena ho nájde ako `Posledný pohľad` ("ako minule").
3. **Jeden nový zápisový tool `saved_view`**, action save | rename | delete. Save číta `view_state` z
   otvoreného viewera; existujúce meno prepíše len s `overwrite=true`.
4. **Zoznam** = `get_viewer_state(saved_views=true)`: opis pohľadov (rez, režim, podlažie, kamera, počty
   prvkov, revízie) bez zoznamov GUID, aj bez otvoreného viewera.
5. **Obnova** = `set_view_mode(saved_view, section_offset_m)`: existujúce ops (čistý stav ako `reset`,
   režim s podlažím, rez na súradnici posunutej po jeho osi, izolácia, skrytie, výber jedného prvku) a
   nová op `pose` (presná póza kamery -> `SET_CAMERA {viewpoint, projection}`, fork ju vie od D-098)
   ako posledná, aby ju režim ani rez neprepísali. Zápis `last_used_at` a "Posledný pohľad" je
   evidencia ako `mcp_call_log`, nie dáta používateľa, preto tool ostáva na čítanie.
6. **Fork** (`apps/viewer/src/aim/`, rýchla cesta D-116): `view_state` vracia aj `hidden_guids` a
   `isolated_guids` (strop 600); `APPLIED` nesie ďalej len počty a `get_viewer_state` ich Claudovi
   nevypisuje. So starším viewerom sa skrytie a izolácia neuložia a výsledok to povie.

**Zavrhnuté rozšírenie:**
- *`bcf_topic` (action=viewpoint, téma typu Pohľad):* Samuel - pohľady samostatne, zoznam tém by sa
  zmiešal s pohľadmi; téma má stav, priradenie a session, pohľad nič z toho.
- *`set_view_mode` / `set_camera` aj na uloženie:* sú to tooly na čítanie (UI akcie bez súhlasu);
  uloženie, premenovanie a zmazanie mení zdieľané dáta a v claude.ai má pýtať súhlas (D-115 bod 1).
  Obnovu do `set_view_mode` dať ide, preto tam je.
- *`get_viewer_state` na uloženie:* to isté, čítanie; zoznam do neho patrí (pole stavu, D-114).

**Zavrhnuté:**
- *Uložené rezy a basket views z upstream viewera:* žijú v pamäti prehliadača, server ich nevidí a
  po obnovení stránky zmiznú.
- *Selektor namiesto GUID (izolácia "celé VZT"):* viewer nevracia, akým filtrom izolácia vznikla.
- *Pamätať každý pohyb kamery:* zbytočné zápisy; "ako minule" znamená posledný použitý pohľad.

**Otvorené:** farby z `style_in_3d colorize` a AIM chat Lens sa neukladajú (viewer nevracia, čo je
ofarbené); výber viac prvkov sa uloží, ale obnoví len jeden (viewer vyberá jeden prvok, D-082);
izolácia nad 600 prvkov sa oreže a výsledok to povie.

### D-125 - Živý stav viewera v odpovediach: identita viewera, zmeny mimo príkazov, priestory v Lens, výplň v reze a malá legenda

**Dátum:** 2026-10-21 · **Stav:** navrhnuté (čaká na Samuela) · **Súvisí:** D-085, D-096, D-101, D-105, D-114, D-116, D-119 · **Issues:** #182, #180, #177, #178, #175 · **PR:** AIMviewer (tento), Menezeris/ifc-lite (fork)

**Kontext:** päť pripomienok z konektora z 21. 10. k jednej úlohe (izolácia miestnosti 2.01 s
vyústkami, farby VZT): priestor sa po farbení vykreslil plný alebo zmizol, stav v odpovedi a v
`get_viewer_state` sa striedal medzi dvoma verziami a nezhodoval sa s obrazovkou, izoláciu vypnutú
používateľom nič nehlásilo, farbenie podľa `system_type` zobralo aj systémy, ktoré nepatrili, a
zabudnutý rez skryl väčšinu výsledku; `action=legend` otvoril celý panel Lens s predvolenými
lenses a ofarbená miestnosť nebola v pôdoryse vidno.

**Overenie (D-114, reprodukcia vo forku v iframe, FZK-Haus):**
- colorize na IfcSpace = Lens alfa 1, miestnosť je nepriehľadný kváder a prvky vnútri nevidno;
- pravidlo prekryté novším ostane v súhrne s `count 0` ako platné;
- izolácia z chatu zrušená používateľom (kláves A) sa v súhrne lens hlási ďalej, aj po ďalšej lens;
- výplň miestností (D-119) sa kreslí len v režime 2D, nie v 3D s rezom a pohľadom zhora;
- na živý kanál odpovedá každý otvorený viewer a vyhrá prvá odpoveď; stav a lens v
  `get_viewer_state` sú dve otázky, ktoré mohli zodpovedať dve rôzne karty alebo zariadenia, a
  odpovede nemali identitu viewera. Jediná cesta k "striedaniu dvoch verzií".
Existujúce tooly to nepokryjú: chyba je v obsahu odpovedí a vo vykreslení, nie v postupe modelu.

**Rozhodnutie (rozšírenie existujúcich toolov, žiadny nový tool):**
1. **Identita viewera (AIMviewer):** okno s `?live=` posiela v `reply` a `applied` náhodné `viewer`
   id (na načítanie stránky). `get_viewer_state` zbiera odpovede ešte chvíľu po prvej, stav aj lens
   berie z toho istého viewera a pri viac ako jednom vráti `viewers` s varovaním (zavrieť ostatné
   okná). Potvrdenie príkazu nesie to isté varovanie, ak teplý kanál nedávno videl viac viewerov.
2. **Zmeny mimo príkazov (fork):** viewer si pamätá stav po poslednom potvrdenom príkaze
   (`APPLIED`): izolácia a X-ray, rez, skryté, výber, režim a podlažie, AIM chat lens. Pri ďalšom
   príkaze vráti `changed_outside_commands` (čo sa zmenilo pred ním, napr. "izoláciu vypol
   používateľ"), `view_state` vráti `changed_since_last_command`. Kamera sa neporovnáva (mení sa
   stále).
3. **Súhrn lens (fork):** pravidlo bez zhody má `matched: false` (prekryté novším alebo nič
   nenašlo); izolácia a X-ray z chatu `active: false` s dôvodom, keď ich kanál už nedrží; AIM chat
   lens vypnutá v paneli vráti `stored_rules`.
4. **Priestory v Lens (fork):** farebné pravidlo z chatu dostane pre IfcSpace a IfcSpatialZone
   priesvitnú variantu (rovnaká farba, alfa 0,3 ako `transparent`), takže miestnosť ostane
   priehľadná a prvky v nej vidno. Počty sa spočítajú pod pôvodné pravidlo.
5. **Výplň miestností v reze (fork):** `AimRoomFillLayer` kreslí aj v 3D, keď je aktívny vodorovný
   rez a kamera hľadí zhora (pôdorys bez režimu 2D); len miestnosti preťaté rezom. Vyplní aj vybranú
   miestnosť (farbou výberu), nielen ofarbenú.
6. **Malá legenda (fork + AIMviewer):** `legend: compact` = plávajúca karta len s AIM chat lens
   (farba, názov pravidla alebo hodnoty, počet), panel Lens sa neotvára a veľké okno sa zavrie.
   `style_in_3d action=legend` je predvolene `compact`; `large` a `normal` ostávajú.
7. **`style_in_3d` (AIMviewer):** `clear_section=true` zruší rez v tom istom volaní; pri isolate,
   xray a colorize s aktívnym rezom odpoveď varuje a navrhne `set_section action=clear`; pri
   `system_type` (alebo `system`), ktorý zobral viac systémov, vráti zoznam systémov s typom a
   počtom členov a upozorní, že niektorý nemusí patrieť. Opis: `mode=replace` pri isolate a xray
   nahradí aj farby z predošlých volaní, na IfcSpace netreba ďalšie pravidlo `transparent`.

**Zavrhnuté rozšírenie a nové tooly:**
- *Nový tool na živý stav:* stav ide v odpovedi príkazu (D-101) a v `get_viewer_state`; chýbala len
  jeho pravdivosť a rozdiel.
- *Parameter `expect_state`:* zmeny mimo príkazov sa vrátia samé, model ich vidí v ďalšej odpovedi.
- *Adresovanie otázky konkrétnemu vieweru:* príkazy majú ísť do všetkých okien (zrkadlo na
  telefóne); stačí párovať odpovede a varovať.
- *`space_display=floor|volume|outline` a objem v perspektíve:* výplň nad scénou by v perspektíve
  prekrývala model; ostáva otvorená otázka pre Samuela (#175).
- *Zmena farby priestorov v balíku `lens` alebo v rendereri:* upstream súbory = plné CI a údržba;
  pravidlo navyše v AIM vrstve stačí.

**Evaly (D-057):** v cloud session bez kľúčov Supabase nepobežia; do `eval/questions.json` pribudnú
otázky z issues.

**Doplnok (2026-10-22, #175 vrátené): podstava miestnosti v 3D perspektíve.** Samuel 21. 10. rozhodol: ofarbená alebo
vybraná miestnosť sa v perspektíve nezobrazuje ako objem, stačí vyplnená podstava. Overenie 22. 10.: v pohľade zhora
výplň sedí, v perspektíve je podstava viditeľná len pri skrytej podlahovej krytine (IfcCovering FLOORING) a miestnosti sú
bledo azúrové bez farieb z Lens. Rozhranie toolov sa nemení, len fork (patch na vetve `claude/aim-175-fork-patch`).
- *Príčina farby:* bod 4 dáva IfcSpace z AIM chat lens akciu `transparent` (alfa 0,3). Renderer override s alfou aspoň
  0,2 presunie do nepriehľadnej pipeline a farbu zmieša ako 30 % Lens a 70 % pôvodnej azúrovej farby miestnosti, takže
  miestnosti vyzerali rovnako a tvorili nepriehľadnú hmotu (komentár z #76). D-139 rátal so skutočnou priesvitnosťou.
- *Príčina krytiny:* `AimRoomFillLayer` kreslí len v 2D a v 3D zhora s vodorovným rezom (bod 5); v perspektíve bola
  "výplňou" len spodná stena objemu, ktorá leží na doske pod krytinou.
- *Rozhodnutie:* (1) prvky priesvitnej varianty AIM chat lens (IfcSpace, IfcSpatialZone) sa do renderera neposielajú,
  ostanú natívne priesvitné; súhrn, počty a farby v Lens a pôdoryse sa nemenia. (2) Podstavu ofarbených (aj inou lens) a
  vybraných miestností kreslí fork v 3D mimo pôdorysu cez existujúce výplne renderera (kanál IfcAnnotation, hĺbkový test,
  steny pred ňou ju zakryjú), vo farbe Lens s priehľadnosťou ako v pôdoryse, 3 cm nad vrchom krytiny, ktorá prekrýva
  miestnosť a leží do 0,25 m nad jej spodkom (bez krytiny nad spodkom miestnosti). Nie nad vodorovným rezom, nie pri
  skrytej miestnosti a nie spolu so SVG pôdorysom (farba by sa zdvojila). Upstream len dva bloky AIM-FORK (`useLens.ts`,
  `useViewportSymbolicUploads.ts`).
- *Dôsledok:* zóna (IfcSpatialZone) z AIM chat lens v 3D farbu objemu stratí (predtým len bledá zmes), podstavu nemá.
- *Zavrhnuté:* krytina polopriehľadná pri ofarbenej miestnosti (mení vzhľad iného prvku, ťažko ohraničiť, ktorej
  krytiny sa týka); obrys alebo šrafa (podstava stačila); zmena miešania farby v rendereri (upstream, plné CI); SVG výplň v
  perspektíve (bez hĺbkového testu by prekrývala model, preto ju bod 5 obmedzil na pohľad zhora).
- *Vedľajšie zistenie z #175* (`show_in_3d` s viacerými `ids_or_refs` vybral len prvý): opravené v #217 (22. 10.), po
  Samuelovom overení; netýka sa D-151.

### D-126 - Úplné a stránkované výsledky DB tools, hľadanie cez vzťahy, overenie zatvorených issues

**Status:** rozhodnuté (2026-10-21, číslo pridelil orchestrátor). Issues #181, #174, #171, #176. Nadväzuje na
D-056 (`query_view`), D-060 (`aggregate_objects`), D-090 (feedback), D-095 (`search_all`) a D-114.

**Kontext (reprodukcia na produkcii):**
- `query_view` nemal parameter `offset`; server neznámy parameter ticho zahodil, takže "druhá strana"
  vrátila prvú. Bez `order` nebolo poradie stabilné a výsledok nehlásil, že je orezaný (100 zo 139).
- `aggregate_objects(ifc_type=...)` navrchu, nie vo `filters`, vrátil počet všetkých objektov (2221):
  ten istý problém, neznámy parameter sa ignoruje.
- `search_all(lobby)` priestor 1.01 nájde (LongName), ale `search_all(prenajímateľné)` nájde len zónu
  "Nájomné priestory", nie jej priestory; model musel ďalej cez vzťahy.
- `feedback_status` ukazoval len otvorené issues; nebolo vidieť, čo je zatvorené a ešte neoverené.
- 403 pri komentári do zatvoreného #137 prišiel z GitHub konektora claude.ai (token GitHub App),
  `feedback action=comment` konektora AIM do zatvoreného issue zapíše (overené na #137).

**Rozhodnutie (všetko rozšírenie existujúcich toolov, D-114; bez migrácie):**
1. **Neznámy parameter = chyba** pre každý tool MCP servera: výsledok `isError` so zoznamom povolených
   parametrov. Nepodporovaný filter sa tak nikdy neignoruje ticho.
2. **`query_view`**: parameter `offset`, vo výsledku `total` (presný počet), `returned`, `truncated`,
   `offset` a `next_offset`. Poradie je vždy stabilné: za voliteľný `order` sa pridá kľúč relácie
   (`id`, pri pohľadoch bez `id` ich prirodzený kľúč), takže strany sa neprekrývajú.
3. **`query_view related`** = `{relation: rel_*, node: id alebo object_ref, direction: to|from}` nad
   reláciami uzlov (`objects`, `v_asset_effective`, ...): len riadky so vzťahom na daný uzol, spolu s
   filtrami a stránkovaním (napr. IfcAirTerminal s `rel_referenced_in_spatial_structure` na 2.01).
   Ide v TS dvoma dopytmi (hrany, potom `id in`), strop 500 susedov, nad ním chyba s radou zúžiť.
   Obsah miestnosti ostáva `v_space_elements` (contained aj referenced naraz).
4. **`search_all related`** (predvolene true): pre zhody, ktoré sú zónou, priestorovou zónou, skupinou
   (`rel_assigns_to_group`, člen -> skupina) alebo aktérom (`rel_assigns_to_actor`, aktér -> objekt),
   pridá blok `related` s členmi z grafu AIM (vzťah, cez ktorý uzol, strop 50 na skupinu) a členov dá
   do `show_in_3d.ids_or_refs`. Systémy sa nerozbaľujú (stovky prvkov; na to je `ifc_relations`).
5. **`feedback_status state=open|closed|all`**, `verified`, `limit`: zatvorené issues s `closed_at`,
   PR z časovej osi a `verification` = `overene` | `vratene` (štítky) | `neoverene`.
   **`feedback action=comment verification=overene|vratene`** zapíše komentár a nastaví štítok
   (druhý odoberie), aj na zatvorenom issue.
6. Prompt: priestor podľa mena alebo účelu cez `search_all`, `truncated` = stránkuj `next_offset`,
   overenie zatvoreného issue cez `feedback`, nie GitHub konektor.

**Zavrhnuté:**
- *Nový tool na join alebo stránkovanie:* `query_view` už je generický dopyt, `related` je jeho filter.
- *RPC s joinom v SQL:* migrácia a ďalšia SQL funkcia kvôli tomu, čo zvládnu dva dopyty so stropom.
- *`where` na psety v `search_all` (#174):* zdvojilo by `ifc_query` a `aggregate_objects` (tie berú
  `ids` zo search_all).
- *Nastavenie práv GitHub App z kódu:* je to nastavenie účtu (Samuel), postup je v #176.

### D-127 - Panel vlastností len IFC, lepivé zvýraznenie vlastnosti, panely z chatu, výrez dokumentu podľa karty
**Status:** rozhodnuté (2026-10-21, číslo pridelil orchestrátor, register #60). Issues #168, #169, #179, #166.
Nadväzuje na D-077 (AIM karta v paneli), D-113 (panel vlastností pri výbere), D-114 (najprv napasuj),
D-117 (výrez strany), D-101 (`APPLIED` so stavom), D-085 (`view_state`), D-098 (najprv existujúce) a D-104
(skupina AIM v lište).

**Kontext:** `show_in_3d(select, highlight)` zvýraznil riadok len na 2,4 s (upstream skok z bSDD karty
zvýraznenie zhasne), výmery (Qto) a psety zdedené z typu nezvýraznil vôbec a výsledok nepovedal, či
vlastnosť na prvku je (#168). Samuel pracuje už len vo vieweri a prepínač AIM | IFC v paneli nechce (#169;
zadanie spresnilo D-129: AIM karta tiež preč, údaje len AIM ako vrstva s odznakom). Panely (Lens, vlastnosti, podklady,
zoznamy, strom modelu) sa z chatu nedali zavrieť ani prepnúť (#179). Výrez strany v úzkej karte nebolo
možné overiť, či je celý v zábere (#166).

**Rozhodnutie:**
1. **#168, fork:** zvýraznenie z chatu ide vlastnou cestou nad DOM panela (`aimPanelView.ts`): nájde riadok
   v Properties (`data-prop-key`, výskyt aj typ) alebo v Quantities (sada a meno), zbalenú sadu rozbalí jej
   vlastným tlačidlom, riadok vycentruje a označí `data-aim-focus` (štýl v `assetin-theme.css`). Označenie
   drží MutationObserver do ďalšieho výberu. Upstream `pendingPropertyFocus` sa už nepoužíva.
   `view_state` a `APPLIED` nesú `property_focus` {found, section, from_type}; nenájdená vlastnosť je
   problém v `APPLIED`.
2. **#168, AIMviewer:** `selectIn3d` hneď povie, či vlastnosť je v dátach AIM prvku (`property.in_aim`,
   hodnota, presné mená; pri chýbajúcej zoznam psetov), z `v_asset_effective` (dedičnosť z typu, D-021).
   `highlight` na Qto už neotvára len sekciu, zvýrazní riadok ako ostatné.
3. **#169 (podľa D-129):** záložka AIM aj AIM karta z panela vypadli, panel je čisto IFC. Vrstva AIM:
   posledná zmena prvku receptom (revízia vNNN, model a BCF téma z `model_tasks` s prvkom vo výbere,
   `fetchLastElementChange`) a história GUID sú riadky s odznakom AIM nad IFC obsahom (vzor D-089);
   dokumenty zdedené cez zónu, podlažie, skupinu, systém alebo miestnosť majú v paneli Documents
   ("Len pre výber") odznak AIM (`aim: true`, priamo a cez typ sú v IFC). Zodpovednosti, odkaz
   Reality Capture a "Otvoriť celý detail" z panela vypadli (D-129 body 2, 4, 6). `panel_tab` vypadol
   zo schémy `show_in_3d`; starý vstup sa ticho ignoruje (staršie odkazy `t=` fork prijme a nič nenastaví).
4. **#179 - rozšírenie `set_view_mode` o `panels`** (D-114 bod 2): {lens | properties | underlays |
   documents | lists | model_tree: open | close | toggle, all: close}, aj bez `mode`. Nová op
   `panels:~<panel>=<akcia>...:` -> bridge `SET_PANELS`; fork volá existujúce akcie store (lišta, rail,
   krížik panela, `aimPanels.ts`). `all=close` zavrie všetko okrem panelov, ktoré správa otvára ("zavri
   všetko okrem vlastností"). Stav všetkých panelov (open, where left/right/bottom/floating/window, snap a
   veľkosť plávajúceho, šírka pravého stĺpca) je v `view_state`, teda v `get_viewer_state` aj v stave po
   každom príkaze.
5. **#166, fork:** zoom výrezu sa počítal z plochy karty už v D-117; nové je, že sa prepočíta, keď sa
   plocha karty po otvorení zmení (split, ukotvenie, šírka stĺpca) alebo príde skutočný pomer strany,
   kým kartou nepohne používateľ. `APPLIED` počká na vykonanie výrezu a `view_state.document` nesie
   viditeľnú časť strany v %, veľkosť karty, zoom a `region_fully_visible`.

**Zavrhnuté rozšírenie:**
- *Nový tool `set_panel`:* panely sú súčasť pohľadu; `set_view_mode` je UI akcia pohľadu na čítanie a
  stav vracia `view_state` (D-114).
- *`get_viewer_state` na ovládanie panelov:* tool je čítanie, zmena patrí do UI akcie.
- *Poloha a veľkosť panelov z chatu (`position`, `size`):* fork ich vie len ako plávajúce okno; pevné
  rozloženie mení používateľ, chat ho len číta. Panel `legend`: legenda je časť Lens (`style_in_3d
  legend_size`, D-119), zavrie sa s ním.
- *Opraviť upstream fade v `PropertiesPanel` (blok AIM-FORK):* stále by chýbali výmery a psety typu.
- *Zbalený blok "AIM platforma" v paneli (prvý návrh v #169):* zamietnuté v D-129, vlastné rozhranie
  popri IFC.

**Otvorené:** pôvodných 779 % z #166 sa lokálne nezopakovalo (úzka karta 264-378 px výrez umiestnila
správne); výsledok teraz hlási viditeľný rozsah, takže ďalší výskyt sa dá overiť priamo. Na mobile
je jeden panel naraz, `SET_PANELS` vtedy nesplnené kroky vráti ako problém.

**Evaly (D-057):** v cloud session bez kľúčov Supabase nepobežali; do `eval/questions.json` pribudli otázky z issues.

### D-129 - Viewer je jediné rozhranie: údaj buď v IFC, alebo AIM vrstva s odznakom
**Status:** rozhodnuté (2026-10-21, Samuel cez orchestrátora), číslo pridelené v registri #60. Nadväzuje na
D-077 (AIM inspector), D-086 (IFC je master, revízie), D-089 (odvodenia ako AIM vrstva), D-073 (Reality
Capture), D-104 (dokumenty z IFC) a #169.

**Kontext:** panel vlastností vo vieweri mal dve záložky, AIM a IFC. AIM karta niesla zodpovednosti,
dokumenty zdedené cez zónu, typ a podlažie, Reality Capture, históriu GUID a odkaz na detail v AIMvieweri.
Samuel pracuje už len vo vieweri a vlastné rozhranie popri IFC nechce.

**Rozhodnutie:**
1. **Žiadna samostatná AIM karta ani záložka.** Panel vlastností ukazuje IFC. Údaj má jedno z dvoch miest:
   - **patrí do modelu**: dostane sa do IFC receptom v OCB (D-086) a viewer ho ukáže natívne ako každý
     IFC údaj;
   - **vzniká len v AIM** (odvodený, historický, prevádzkový): je to **AIM vrstva** v existujúcich paneloch
     vieweru, riadok s odznakom AIM, vzorom sú odvodené vzťahy v Relationship records (D-089).
2. **Zodpovednosti (zámer, zatiaľ bez implementácie):** v IFC cez `IfcRelAssignsToActor` na prvku,
   priestore alebo type (`IfcActor`, pri nájomcovi `IfcOccupant`, s `IfcPerson`, `IfcOrganization` a rolou
   `IfcActorRole`). Na produkcii dnes nie je ani jeden záznam; keď budú dáta (správca, prevádzkovateľ,
   nájomca), pôjdu receptom.
3. **Dokumenty:** priame väzby sú v IFC (`IfcRelAssociatesDocument`, od ASR v076), dokument na type platí
   pre výskyty. Zdedené cez zónu a podlažie (D-104, `v_object_documents`) sú AIM vrstva: v paneli Documents
   ("Len pre výber") s odznakom AIM. Triedenie dokumentov ide cez klasifikáciu na `IfcDocumentInformation`
   (`IfcExternalReferenceRelationship`, ako typ informácie ISO 19650 vo v077). Ďalšie osi (napr. druh média)
   sú ďalší klasifikačný systém, atribúty `ElectronicFormat`, `CreationTime`, `Purpose`, `ValidFrom`/`ValidUntil`.
4. **Reality Capture ostáva AIM vrstva** (D-073: body a médiá v DB, `aim_` hrany), nie revízia IFC pri
   každej fotke. Vo vieweri: piny ako dnes a médiá v paneli Documents pri priestore s odznakom AIM.
   Pri exporte IFC sa export opýta, či zahrnúť aj AIM vrstvy; vtedy sa bod zapíše ako `IfcAnnotation`
   (`USERDEFINED`, `ObjectType` RealityCapture, `ObjectPlacement` nesie polohu a smer pohľadu, bod ako
   `IfcCartesianPoint`, v priestore cez `IfcRelContainedInSpatialStructure`) a médiá ako dokumenty
   priradené k anotácii. Rovnaká voľba platí pre ostatné AIM vrstvy (odvodené vzťahy D-089).
5. **História GUID a revízia prvku:** AIM vrstva v IFC paneli, riadky s odznakom AIM (platí od revízie,
   posledná zmena v revízii vNNN, recept alebo BCF téma). IFC revízie naprieč verziami nenesie.
6. **Odkaz na celý detail v AIMvieweri** z panela vypadáva.

**Zavrhnuté:**
- *Zbalený blok "AIM platforma" v paneli* (prvý návrh v #169): vlastné rozhranie popri IFC, presne to, čo
  Samuel nechce.
- *Reality Capture priamo v IFC pri každej fotke:* každá fotka by bola revízia modelu (recept, poistka,
  re-ETL), pri prevádzkových dátach zbytočne ťažké. IFC zápis až pri exporte.

**Dôsledky:** #169 rieši session D-127 podľa tohto zápisu (záložka a karta preč, história ako AIM riadky,
zdedené dokumenty s odznakom). Reality Capture v paneli Documents a voľba exportu AIM vrstiev sú samostatná
úloha vo fronte.

---

### D-128 - Kamera na cieľ v reze s okrajom a časťou cieľa, vzor šrafy reznej plochy

**Dátum:** 2026-10-21 · **Stav:** prijaté (implementované) · **Súvisí:** D-083, D-094, D-098, D-101, D-114, D-120 · **Issues:** #172, #173, #97 · **PR:** Menezeris/ifc-lite (fork), AIMviewer (tento)

**Kontext:** "priblíž atiku na ľavej strane v reze" stálo asi 8 volaní (#172): `set_camera` s cieľom
a `preset=section` hlásilo pózu presetu (stred budovy), záber tenkého prvku bol príliš tesný a ľavú
stranu musel model hľadať cez `get_viewer_state(bounds)` a posúvať kameru. Pri reze sa šrafa
kreslila zvislo a vzor sa nedal zvoliť (#173).

**Reprodukcia:** fork pri `preset=section` s cieľom nastaví smer kolmo na rez a po jeho animácii
zarámuje cieľ (`aim/viewCamera.ts`, AIMviewer #65), ale rámovanie trvá ďalších 300 ms a `APPLIED`
(D-101) čítal kameru hneď po jeho spustení. Rámovanie išlo cez `flyTo` s predvoleným okrajom upstreamu.
Šrafa: `cap_style=hatch` (D-120) vracia vzor a uhol uložené v prehliadači; vzor `diagonal` s
uhlom 0° kreslí zvislé čiary.

**Najbližšie tooly (D-114):** `set_camera` (smer, cieľ, fit; chýba okraj, časť cieľa a koncová
póza), `get_viewer_state` (len čítanie), `show_in_3d select` (smer nerieši), `set_section` (vzhľad
plochy len `cap_style`/`cap_color`). Obe potreby sú parametre existujúcich toolov.

**Rozhodnutie:**
1. **`set_camera margin_percent`** (0 až 300, s cieľom predvolene 40): okraj okolo cieľa. Fork
   rámuje existujúcim `cameraCallbacks.frameBounds(min, max, {padding: 1 + m/100})` (D-098), smer
   kamery ostáva. Wire `~m=<%>`, bridge `SET_CAMERA.padding`.
2. **`set_camera area`** = `left | right | top | bottom | front | back` (wire `~a=<l|r|t|b|f|k>`,
   bridge `SET_CAMERA.area`): z cieľových prvkov alebo výberu (`fit=selection`) fork po nastavení
   smeru vyberie tie, ktorých stred leží v krajnej tretine ich spoločnej obálky v smere obrazu
   (left/right po šírke, top/bottom po výške, front/back bližšie/ďalej od kamery); keď v tretine
   nič nie je, vezme prvok najbližšie k okraju. Čistá funkcia `aim/cameraArea.ts` s testom. Bez
   cieľa a výberu `area` nejde (chyba s radou).
3. **Koncová póza:** fork počká na koniec rámovania, `APPLIED` nesie koncovú kameru. Host pri
   `set_camera` dopočíta `visible` (stred, šírka a výška viditeľnej oblasti v metroch v rovine
   cieľa; `visibleArea` v `lib/viewer-camera.ts`), takže `get_viewer_state` netreba.
4. **`set_section` vzor šrafy:** `hatch_pattern` = `diagonal | diagonal_reverse | cross |
   crosshatch | horizontal | vertical | dots | brick | insulation`, `hatch_angle_deg`,
   `hatch_spacing_px` (2 až 64), `hatch_line_width_px` (1 až 16), rozsahy ako popover Cap. Mapovanie
   na vzory renderera (`dots` = `concrete`, `cross` = `crossHatch` 0°/90°, `crosshatch` = 45°/-45°,
   `diagonal_reverse` = -45°) robí host (`lib/viewer-section-cap.ts`); bridge `SET_SECTION_CAP`
   nesie `pattern`, `angleDeg`, `secondaryAngleDeg`, `spacingPx`, `widthPx` a fork ich zapíše setterom
   `setSectionCapStyle` (ten istý ako popover Cap). `cap_style=hatch` bez vzoru = diagonálna 45°,
   8 px, 1 px (predvolené upstreamu), výsledok teda nezávisí od uloženej voľby. Parametre šrafy bez
   `cap_style` znamenajú `hatch`; výsledok vráti použitý vzor, uhol, rozstup a hrúbku.
5. Recept v opise `set_camera`: atika vľavo v reze = `set_section` + `search_objects(PARAPET)` +
   `set_camera(preset=section, cieľ, area=left)`. Prompt sa nezväčšuje (limit MCP inštrukcií).

**Zavrhnuté:**
- *Nový tool na "zarámuj časť budovy":* to isté ako parameter `set_camera` (D-114).
- *Relatívny krok v tom istom volaní ako cieľ:* krok sa počíta z koncovej pózy, ktorú host pred
  volaním nepozná (D-098); okraj `margin_percent` nahrádza následný `zoom_percent`.
- *Rozstup šrafy v mm:* renderer kreslí šrafu v pixeloch obrazovky; mm by boli zmena
  `packages/renderer`.
- *Vzor podľa materiálu rezaného prvku:* renderer nemá materiál pri reznej ploche; neskôr.

**Poradie zlúčenia:** najprv fork, potom AIMviewer. Starší viewer nové polia `SET_CAMERA` a
`SET_SECTION_CAP` ignoruje (rámuje ako doteraz, šrafa ostane uložená).

---

### D-131 - Reality Capture v paneli Documents, druh média ako druhá os klasifikácie, export AIM vrstiev do IFC
**Status:** rozhodnuté (2026-10-21, session pre #192 podľa D-129), číslo pridelené v registri #60. Body 1 a 2
implementované, bod 3 navrhnutý a zaparkovaný (#202). Nadväzuje na D-073 (Reality Capture), D-089 (odvodené
vzťahy), D-104 (dokumenty, klasifikácia dokumentu), D-127 (odznak AIM v paneli Documents), D-129.

**Kontext:** D-129 nechal Reality Capture ako AIM vrstvu (body a médiá v DB, `aim_` hrany), ale vo vieweri
boli len piny a odkaz z AIM karty, ktorá s D-127 vypadla. Dokumenty sa triedia len podľa typu informácie
ISO 19650 (ASR v077) a `fetchDocumentTypes` berie prvú klasifikáciu dokumentu bez ohľadu na systém, takže
druhá os by typ prepísala náhodne. Export IFC existuje len vo forku (upstream `@ifc-lite/export`,
`StepExporter`, dialógy exportu vo vieweri); AIMviewer ani ETL IFC nezapisujú.

**Rozhodnutie:**
1. **Médiá Reality Capture v paneli Documents.** `GET /api/element/[id]` pri priestore vráti aktívne médiá
   jeho bodov (`aim_rel_capture_located` -> `aim_rel_capture_media`), pri prvku v priestore médiá toho
   priestoru s cestou "cez miestnosť X" (ako zdedené dokumenty D-104). Render schéma `AimPanelData` dostane
   vlastné pole `captureMedia` (nie riadky v `documents`: médiá nie sú v knižnici `DOCUMENTS_LOAD` a nemajú
   IFC dokument). Fork v režime "Len pre výber" ukáže pod dokumentmi skupiny podľa druhu média, riadok má
   odznak AIM, náhľad, dátum snímky a cestu; klik otvorí galériu priestoru v hostovi (`/ifc?captures=<id>`,
   ktorá vie aj 360°). Hľadanie panela filtruje aj médiá. Piny bez zmeny. Strop 40 médií ako pri dokumentoch.
2. **Druhá os klasifikácie dokumentov: systém `Druh média`** s kódmi `FOTO` (Fotografia), `PANO360`
   (360° panoráma), `SKEN` (Sken). Rovnaký mechanizmus ako typ informácie (D-104): `IfcClassification` +
   `IfcClassificationReference` na `IfcDocumentInformation` cez `IfcExternalReferenceRelationship`.
   - **Dokumenty v IFC:** recept v OCB (D-086) priradí referenciu systému `Druh média`; ETL ju načíta bez
     zmeny (`document_classification`, `rel_external_reference_relationship`).
   - **Médiá v DB:** **odvodenie** z `captures.kind` (`photo` -> `FOTO`, `pano360` -> `PANO360`), žiadny
     nový stĺpec ani migrácia; druh je vlastnosť bodu (jeden bod = jeden druh snímok). Sken pribudne ako nová
     hodnota `captures.kind` (`scan`) spolu s jeho uploadom.
   - **Host:** klasifikácie dokumentu sa čítajú po systémoch. Systém `Druh média` dáva kľúč `meta` "Druh
     média", všetky ostatné ostávajú v "Druh" (typ informácie), takže "Zoskupiť" vo vieweri ponúkne novú os
     bez zmeny forku. Atribúty `ElectronicFormat` (kľúč "Formát") a `LastRevisionTime` ("Revízia") už `meta`
     nesie; `CreationTime`, `Purpose`, `ValidFrom`/`ValidUntil` dopĺňa recept, `meta` ich ukáže, keď ich
     ETL začne ukladať (dnes ich `documents` nemá, samostatný krok).
3. **Export IFC s AIM vrstvami (návrh; zaparkované, #202).** Samuel 21. 10.: export ostáva ako doteraz, návrh
   nižšie je podklad pre #202.
   - **Miesto:** export vo forku (jediný zápis IFC v platforme). Dialóg exportu dostane v bloku `AIM-FORK`
     voľbu "Zahrnúť AIM vrstvy" (len vo vložení v AIMvieweri, predvolene vypnutá). Zápis AIM entít je čistý
     modul `apps/viewer/src/aim/aimIfcExport.ts`, ktorý doplní riadky STEP k výstupu `StepExporter`
     (pred `ENDSEC`), s testom a overením súboru cez ifcopenshell.
   - **Dáta:** viewer si ich pri exporte vypýta od hosta (bridge `AIM_EXPORT_LAYERS_REQUEST` ->
     `AIM_EXPORT_LAYERS`): body (GUID odvodený z `objects.id`, meno, GUID priestoru, poloha a `yaw`), médiá
     (názov, URL, formát, `captured_at`, kód druhu) a odvodené vzťahy ako páry GUID. Polohu z rámca viewera
     do súradníc IFC prepočíta fork (pozná posun a os Y-up modelu).
   - **Mapovanie (overené v IFC4X3_ADD2, ifcopenshell 2026-10-21):** bod = `IfcAnnotation`
     (`PredefinedType=USERDEFINED`, `ObjectType='RealityCapture'`; enum má aj `SURVEY`, ten je pre geodetické
     body, nie snímky), `ObjectPlacement` = `IfcLocalPlacement` s `IfcAxis2Placement3D` (`Location`
     `IfcCartesianPoint`, `Axis` (0,0,1), `RefDirection` (cos yaw, sin yaw, 0) = smer pohľadu); `IfcAnnotation`
     je `IfcProduct`, do priestoru ide cez `IfcRelContainedInSpatialStructure` (`RelatingStructure` =
     `IfcSpace`). Médium = `IfcDocumentInformation` (`Identification` id média, `Location` URL,
     `ElectronicFormat` MIME, `CreationTime` = `captured_at`, `Purpose` 'Reality Capture') +
     `IfcRelAssociatesDocument` na anotáciu + referencia `Druh média` cez `IfcExternalReferenceRelationship`.
     Odvodené vzťahy (D-089) = `IfcRelReferencedInSpatialStructure`, len keď oba konce sú v exportovanom
     súbore (vzťahy medzi súbormi ostávajú vo vrstve, D-089 bod 7).
   - **Rozsah:** jedna voľba pre všetky AIM vrstvy (Reality Capture aj odvodené vzťahy), bez výberu
     jednotlivých bodov. Export je jednorazový výstup, revíziu modelu nezakladá (D-129 bod 4).

**Zavrhnuté:**
- *Médiá ako riadky `documents` v AIM karte:* fork ich otváral ako PDF z knižnice, médiá v knižnici nie sú
  a zoskupenie podľa druhu by sa miešalo s cestou "cez zónu".
- *Nový stĺpec `capture_media.media_kind` (migrácia):* druh je daný bodom (`captures.kind`); stĺpec by
  duplikoval údaj a mohol sa s bodom rozísť.
- *Druh média ako pset alebo `meta` bez klasifikácie:* D-011/D-104 triedia dokumenty klasifikáciou, nie
  vlastným poľom; recept v OCB by inak nemal IFC nositeľa.
- *Export AIM vrstiev v ETL alebo v AIMvieweri (ifcopenshell na serveri):* Samuel pracuje len vo vieweri
  (D-129) a export tam už je; druhý zapisovač IFC by sa rozišiel s exportom forku.
- *Implementácia exportu v tomto kroku:* zmena upstream dialógu exportu (plné CI, D-116) a nový bridge
  kontrakt s prepočtom súradníc sú samostatná práca; body 1 a 2 ju nepotrebujú.

**Dôsledky:** bez migrácie a bez nového env. Fork (vetva D-127): skupiny médií v "Len pre výber". Pre
OCB: recept na klasifikáciu `Druh média` pre obrázky v IFC (dnes žiadne, takže až s prvým fotodokumentom
v modeli). Export AIM vrstiev je zaparkovaný v #202.

---

### D-130 - Popisky na výkrese ako odkazy na prvok: párovanie z textovej vrstvy ako AIM vrstva
**Status:** rozhodnuté (2026-10-21), číslo pridelil orchestrátor (register #60). **Issue:** #167. Nadväzuje na
D-076 (identifikátorové odkazy vo forku), D-082 (výber ako klik), D-123 (riadky textu s polohou), D-114,
D-129 (údaj v IFC alebo AIM vrstva s odznakom), D-087/D-091 (čo patrí do forku).

**Kontext:** Samuel chce, aby bubliny na výkrese (napr. `08 DD01`) boli odkazy ako v jeho pôvodnom PDF
prehliadači: klik otvorí panel vlastností zodpovedajúceho IFC prvku (DD01.08.0001). Fork to od D-076 vie
len čiastočne: `PageIdentifierLinks` je predvolene vypnutý (nastavenie v localStorage), kód hľadá regexom a
typový kód otvorí typ, nie výskyt. Na pôdoryse 1NP je bublina dvojriadková: hlava `DD01` (typ prvku) a pod
ňou buď `05.04` (plný kód DD01.05.04), alebo len `08` (typ DD01.08, číslo výskytu `.0001` na výkrese nie je).
Na rozhodnutie, ktoré dvere to sú, treba podlažie výkresu a výskyty typu na ňom, čo má host v DB, nie fork.

**Rozhodnutie:**
1. **Párovanie robí host** (`lib/data/drawing-labels.ts`, čistá funkcia nad `document_pages.blocks`):
   - **popisok prvku** = riadok `[A-Z]{2}\d{2}` a číslo tesne pod ním (rovnaký stred na osi x, do 1,2 % strany
     nižšie): `NN.NN` = plný kód, `NN` = typový kód;
   - **kód miestnosti** = riadok `\d\.\d{2}`, len ak taká miestnosť (`object_ref`) je na podlaží výkresu;
   - **priradenie:** plný kód = prvok s tým `object_ref`; typový kód = výskyty typu (`object_ref` začína kódom a
     bodkou) na podlaží výkresu: jeden = jednoznačné, viac = kandidáti, žiadny = nespárované;
   - podlažie výkresu = nositeľ dokumentu typu `floor` (to isté ako `storeyGuid` v `DOCUMENTS_LOAD`, D-104).
   Výsledok je **AIM vrstva** (odvodenie, D-089/D-129): nič sa nezapisuje do IFC ani do DB.
2. **Konektor:** `search_documents include_links` (D-114 bod 3, žiadny nový tool) pri čítaní strany vráti
   `links` = popisok, `bbox` v %, `object_ref`, GUID a stav (`unique` / `candidates` / `none`).
3. **Viewer:** host po `DOCUMENTS_LOAD` pošle `DOCUMENT_LINKS` pre pôdorysy podlaží (dokument, strana, oblasti v
   zlomkoch strany, ciele s GUID). Fork (`apps/viewer/src/aim/docLinks.ts`) nakreslí nad stranou klikateľné
   oblasti (imperatívna vrstva ako rámiky D-123) a klik vyberie prvok ako klik do modelu (`selectPickedGlobalId`,
   D-082) a otvorí panel vlastností; pri kandidátoch ukáže malý výber. Oblasť aj výber nesú odznak AIM
   (odvodené z popisku, nie z IFC). Fork nič nepočíta (D-091, D-098).
4. **Stav dát (1NP, strana 1):** 52 bubliniek prvkov: 38 plných kódov presne, 4 typové kódy s jediným výskytom
   na 1NP (aj `08 DD01` -> DD01.08.0001), 9 typových kódov s viacerými výskytmi (kandidáti), 1 nespárovaný
   (`OV01` nad výškovou kótou `00.00`). Kódy miestností: 46 popiskov, 23 miestností 1NP, všetky jednoznačné.

5. **Doplnenie 2026-10-22 (#167, Samuel po teste):** značka typu s viac výskytmi (modrá, `candidates`) otvorí v paneli
   vlastností **IFC typ** (`asset_type` s presným `object_ref`, napr. SN05.01 = IfcWallType), nie zoznam výskytov. Wire
   `DOCUMENT_LINKS` dostal voliteľné `type {guid, ref, name?}` na odkaze so stavom `candidates`; výskyty ostávajú v
   `targets` ako vedľajšia voľba (výber sa ukáže len keď typ vo vieweri nie je). Zelené popisky (`unique`) sa nemenia.
   Izolácia výskytov typu v 3D nie je súčasťou požiadavky. Bez nového čísla D (úprava D-130).

**Zavrhnuté:**
- *Zapnúť a doladiť D-076 vo forku:* fork nepozná podlažie výskytov z DB ani konvenciu `.0001` a výber výskytu
  podľa podlažia by bol druhý výpočet popri AIMvieweri; D-076 ostáva ako všeobecná funkcia originálu.
- *Kandidátov rozlíšiť polohou na výkrese:* potrebuje kalibráciu výkresu k modelu (D-072, D-117 otvorené); keď
  bude, host môže z kandidátov vybrať najbližší a stav `candidates` zmizne bez zmeny drôtu.
- *Nový tool `drawing_links`:* ten istý zdroj (`document_pages`) a tá istá anotácia ako `search_documents`.

---

### D-133 - Automatická kalibrácia podkladov výkresov: pohľad + strana PDF, rez modelu a čiary výkresu

**Dátum:** 2026-10-21 · **Stav:** prijaté (Samuel cez orchestrátora, #170), implementácia po krokoch · **Súvisí:**
D-072 (podklady, `_georef`), D-104, D-123 (text s polohou), D-124 (rámec motora), D-129 (AIM vrstva), D-132
(pohľady a záložky, #165), D-114 · **Issue:** #170

**Kontext:** podklady (panel Underlays, D-072) sa kalibrujú ručne dvoma bodmi a od D-104 (pôdorysy z IFC)
nemá `_georef` ani jeden výkres. Konektor nevie podklad nastaviť. Prototyp nad produkčnými dátami (ASR v077,
`document_pages.blocks`, PDF zo storage):
- **len text** (popisky miestností `1.01` proti ťažiskám IfcSpace): chyba na kontrolnom bode okolo 1 m, popisky
  nie sú v ťažiskách; osi `IfcGrid` model nemá, dvere majú vo výkrese len typový kód (`DD01`);
- **text ako štart + doladenie na geometriu** (hrubé čiary PDF proti rezu modelu, trimmed ICP s podobnosťou):
  pôdorys 1NP medián 15 mm, p90 30 mm, 2NP 16 a 36 mm; zvislé rezy A a B medián 8 mm, p90 13 až 14 mm, mierka
  1:49,92 až 1:49,96 pri výkrese 1:50. Krížová validácia (fit na polovici, test na druhej) do 19 mm, pri rezoch
  do 9 mm; kontrolné body rezu (osi z pôdorysu, výškové kóty) medián 6 až 12 mm.

**Rozhodnutie:**
1. **Kalibrácia žije v `_georef` dokumentu, v2 = zoznam kalibrácií** (Samuel, #165 a #170; prvý návrh
   "v pohľade" padol). Je to vlastnosť dvojice strana PDF a rovina modelu, nie pohľadu: ručný pohľad D-132 nesie
   len `{document_id, page}`, automatické pôdorysy sa odvodia za behu z podlažia. Položka v2: `page`,
   `page_size`, `storey_guid`/`storey_z`, `plane` (null = vodorovne vo výške podlažia, presne v1; inak
   `{origin, u, v}` v IFC svete, `u × v` = normála ku kamere, affine nie je zrkadlový), `affine` z bodov strany
   PDF (vľavo dole) do metrov (u, v), `calibration`, `region` (výrez strany pri viac výkresoch), `source`
   (`manual` z panela Underlays, `auto` z toolu), `quality` (metóda, medián, p90, krížová validácia).
   Automatická neprepíše ručnú bez `force`: ručné dorovnanie je posledné slovo. Prechod bez migrácie: PATCH
   zlúči v1 z panela ako `manual`, host posiela forku v1 (pôdorysná položka) a popri tom `georefV2`
   (`lib/data/georef.ts`).
2. **Čiary výkresu z ETL:** `document_pages.lines` = `{size: [W, H], segs}`, hrubé úsečky strany `[x1, y1, x2, y2, w]` v bodoch strany
   (počiatok vľavo dole ako `_georef`), hrúbka čiary aspoň 0,99 pt, len vektorové výkresy (aspoň 200 takých
   úsečiek na strane). Ten istý extraktor ako `blocks` (`etl/pdf_text.py`, pymupdf); server parser PDF nemá
   (D-123).
3. **Výpočet v IFC motore** (`lib/engine/underlay-calibrate.ts`): rez meshov rovinou pohľadu v tom istom rámci
   ako viewer (D-124; pôdorys len konštrukcie, rez všetko okrem priestorov a nábytku), hrubý štart z textu
   (pôdorys: popisky miestností proti IfcSpace; rez: výškové kóty na mierku a výšku, vodorovný posun a smer
   pohľadu z popiskov osí, alebo bez nich skenovaním s rovnakým výsledkom), trimmed ICP s podobnosťou a
   pevným smerom pohľadu, kvalita s krížovou validáciou. Nad meshami motora: 1NP medián 10 mm, p90 20 mm,
   rezy 8 mm.
4. **Nový tool `calibrate_underlay` (zápis):** `document_id`, `page`, `floor` (pôdorys) alebo
   `section_plane` (rez), `mode=dry_run|auto|manual`, `pairs`, `force`. `dry_run` (predvolené) nič neuloží a ukáže náhľad; zápis za bránou `UNDERLAY_WRITE_ENABLED` a len
   pod prahom chyby (medián 50 mm). Na produkciu až po tabuľke skúšobného behu so Samuelovým slovom.
5. **Viewer:** zvislý podklad (rovina s u, v) je rozšírenie balíka `@ifc-lite/drawing-underlay` vo forku.

**Zavrhnuté rozšírenie:**
- *`open_drawing`:* UI akcia bez prístupu k dátam a čítacia anotácia (ako v D-123); kalibrácia zapisuje.
- *`set_view_mode calibrate=...`:* prepína zobrazenie a je čítací; kalibrácia je trvalý zápis dát (Samuel, #170).
- *`ifc_measure`:* meria prvky, čítací; podklad nie je prvok modelu a výsledok sa ukladá.

**Zavrhnuté:** len popisky bez doladenia (chyba okolo 1 m); parser PDF na serveri (D-123, dva extraktory);
kalibrácia viazaná na podlažie (nepokryje rezy a detaily).

**Doplnok 2026-10-22 (#170, Samuel): vypnúť PDF podklady v 3D.** Podklad ostane kalibrovaný a uložený, len sa v 3D
nekreslí; pôdorys v 2D a split ostáva. Má to ísť aj z chatu.
- *Overené (D-098):* `visible` v kalibrácii (`_georef`, oko pri výkrese v paneli Underlays) už existuje, ale je to
  niečo iné: `setUnderlayVisible` ho **ukladá do DB** (`UNDERLAY_SAVE`) a skrýva podklad **aj v 2D paneli pôdorysu**
  (`DrawingPlanPane`, `storeyHasDrawing` filtrujú na `visible`). 3D plochu kreslí len `useDrawingUnderlay`
  (externý overlay renderera), 2D pane je samostatné DOM plátno.
- *Rozhodnutie:* dve oddelené veci. `visible` kalibrácie ostáva, ako je (trvalé, per výkres). Nový **stav viewera
  "podklady v 3D"**: globálny, per relácia, do DB sa nezapisuje (po obnove stránky sú podklady v 3D zapnuté).
  Vypnuté = uložené podklady sa v 3D plátne nekreslia; ghost náhľad počas kalibrácie a zamknutý pôdorysný pohľad
  (`underlayViewLocked`, kamera zhora) ostávajú, lebo to je 2D. Per výkres nerobím (oko to pokrýva, Samuel hovorí
  o podkladoch všeobecne).
- *Chat (D-114, nový tool netreba):* parameter `underlays_3d` (boolean) existujúceho `set_view_mode`, op
  `underlays3d:<0|1>:`, bridge správa `SET_UNDERLAYS_3D {show}` (vo `view-protocol.ts`, nie v `bridge-protocol.ts`).
  Stav: `view_state.underlays_3d` (`get_viewer_state` aj `APPLIED`). Panel Underlays má prepínač "Show in 3D".
- *Zavrhnuté rozšírenie:* `calibrate_underlay` (zapisuje kalibráciu do DB, toto je zobrazenie; nový parameter by
  tool miešal s dvoma druhmi anotácie); `visible` v `_georef` (ukladá sa a skrýva aj 2D); `panels` (otvára okná, nie
  vrstvy scény); `style_in_3d` (mení prvky modelu, podklad nie je prvok).
- *Fork:* patch (format-patch) s logikou a store v `apps/viewer/src/aim/`, upstream len v `AIM-FORK` blokoch
  (`useDrawingUnderlay.ts`, `DrawingUnderlayPanel.tsx`). Poradie: najprv fork, potom host; bez forku host správu
  pošle a starší fork ju zahodí (podklady ostanú v 3D).
- Kalibrácie strechy, základov, statiky a hárkov s viac pôdorysmi sa podľa Samuela zatiaľ nerobia.

---

### D-132 - Záložky vo vieweri: pohľad je orez, záložka je otvorený pohľad
**Status:** rozhodnuté (2026-10-21, Samuel cez orchestrátora; číslo pridelené v registri #60). Issue #165,
fork patch nad `claude/aim-d127-panely` (fork #97). Nadväzuje na D-072 (pôdorys s podkladom, zámok
kamery), D-075 (karty dokumentov, režim 2D na celú plochu), D-098 (najprv existujúce funkcie), D-114 (najprv
napasuj), D-122 (uložené pohľady), D-127 (panely z chatu), D-129 (AIM vrstva). Kalibráciu podkladu k pohľadu
rieši D-133 (#170).

**Kontext:** Samuel chce prepínať medzi pohľadmi na celú obrazovku ako v Revite (3D, pôdorys, rez, PDF), nie
mať výkres ako kartu vedľa 3D. `open_drawing(in_viewer)` otvoril dokument vždy vedľa 3D; `set_view_mode`
poznal len 3D, 2D a Split.

**Rozhodnutie:**
1. **Pohľad je orez nad tým istým modelom:** kamera zamknutá kolmo (ortografická, zhora alebo zboku) a rezná
   rovina alebo rezný box. 2D nie je režim ani prepínač, ale typ pohľadu. Filter a grafika rezu sú samostatná
   funkcia neskôr.
2. **Pôdorysy podlaží sú automatické pohľady za behu** z IfcBuildingStorey (fork, dnešné `enterDrawingView`
   D-072: zhora, zamknuté, rez 1,2 m nad podlahou); v DB sa neukladajú. Podklad je dokument s `_georef` na
   podlažie ako dnes; kalibrácia ostáva v `_georef` dokumentu (D-133 ho rozšíri o rovinu).
3. **Ručný pohľad = riadok `saved_views` (D-122), bez migrácie:** do `viewpoint` pribudne `view_type`
   (3d | plan | section | detail), `camera.locked`, `section.box` (obálka v IFC svete) a `underlay`
   (`document_id`, `page`, len väzba). Riadok vzniká pri ručnom pohľade alebo uložení upraveného pôdorysu.
4. **Záložka = otvorený pohľad, len počas relácie** (fork, `apps/viewer/src/aim/viewTabs*`): 3D (vždy prvá),
   pôdorysy, uložené pohľady a dokumenty D-075. Aktívna záložka má celú plochu; dokument zbalí 3D panel tým
   istým spôsobom ako režim 2D (canvas sa neremountuje). Pri prepnutí sa stav canvasu záložky (kamera, celá
   sada rovín alebo box, zámok, rez podlažia) odloží a pri návrate vráti. Prepínač 3D | 2D | Split zmizol z
   pásu AIM.
5. **"Vedľa" medzi záložkami:** viewer má jeden 3D canvas, preto vedľa seba ide 3D alebo pohľad + dokument,
   3D + pôdorys ako 2D plán (panel D-072, zatiaľ len s kalibrovaným podkladom), nie dva 3D pohľady.
6. **Chat bez nového toolu (D-114):**
   - `open_drawing target=tab|split` (predvolené `tab`, `in_viewer` ostáva);
   - `set_view_mode`: `view` (alias `saved_view`) otvorí uložený pohľad do záložky, `mode=2d floor` = pôdorys
     v záložke, `mode=split` = pôdorys vedľa 3D, `mode=3d` = záložka 3D, `tab` prepne, `beside` dá vedľa
     (`none` zruší), `close_tab` zavrie (`all`);
   - `set_section box=true` + cieľ (+ `margin_m`) = rezný box okolo prvkov;
   - `saved_view save` s `view_type`, `locked`, `underlay_document_id`, `underlay_page`; box a rovinu vezme z viewera;
   - `get_viewer_state` vráti `tabs` (druh, menovka, aktívna, vedľa) a `section.box`.
7. **Most:** `VIEW_TABS` (open | activate | beside | unbeside | close), `SET_SECTION_BOX`, `DOCUMENT_OPEN layout`,
   `view_state.tabs`; `SET_VIEW_MODE` ide cez záložky. Op `tab:` a `section_box:` v `lib/viewer-tabs.ts`.

**Zavrhnuté rozšírenie:**
- *Nový tool `view_tabs` (návrh z issue):* záložky sú prepnutie zobrazenia, to robí `set_view_mode`
  (čítanie, UI akcia); dokument otvára `open_drawing`. Nový tool by len zdvojil ich vstupy.
- *Záložky ako trvalé dáta:* Samuel, záložky sú len počas relácie; trvalý je uložený pohľad.

**Zavrhnuté:**
- *Prepínač 3D | 2D | Split ako hlavné rozhranie:* 2D je typ pohľadu (Samuel).
- *Automatické pôdorysy ako riadky v DB:* Samuel, za behu z modelu; kalibrácia ostáva na dokumente.
- *Filter viditeľnosti v pohľade (pravidlo):* neskôr, samostatná funkcia (Samuel).
- *Dve 3D záložky vedľa seba:* druhý renderer (WebGPU) je iný rozsah.

**Otvorené:** pôdorys vedľa 3D bez kalibrovaného podkladu (vektorový plán upstreamu žije v režime úprav
modelu, nie na čítanie); zvislý podklad pre rezy po D-133; zoznam uložených pohľadov v lište forku (dnes z chatu);
mobil má zatiaľ starý prepínač.

---

### D-134 - Náročnosť požiadavky z konektora: routines STANDARD (Sonnet) a HARD (Opus)
**Status:** rozhodnuté (2026-10-21, Samuel cez orchestrátora), číslo pridelené v registri #60. Nadväzuje na
D-090 (požiadavky z konektora, routine), D-099 (BCF routine).

**Kontext:** každá požiadavka z konektora spúšťala routine s Opusom, aj keď išlo o jasnú malú zmenu. Cieľ je
šetriť tokeny: jasné a lokálne zadania rieši Sonnet, náročné Opus.

**Rozhodnutie:**
1. **Dve routines.** Model je vlastnosť routine, `/fire` ho nezmení. HARD (Opus) je doterajšia routine,
   premenovaná na "AIM: Hard Issues" (env `CLAUDE_ROUTINE_FIRE_URL`, `CLAUDE_ROUTINE_TOKEN`). STANDARD
   (Sonnet) je "AIM: Standard Issues" (env `CLAUDE_ROUTINE_STANDARD_FIRE_URL`, `CLAUDE_ROUTINE_STANDARD_TOKEN`).
   Server má `standardRoutine()` vedľa `feedbackRoutine()` v `lib/feedback/routine.ts`.
2. **O náročnosti rozhoduje Claude v konektore** pri zakladaní issue, lebo má kontext rozhovoru so Samuelom.
   `feedback` (report, request_tool) a `start_session` dostanú `narocnost: standard | hard` a krátky
   `narocnost_dovod`. Pravidlo je v opise toolu: STANDARD = jasné a lokálne (reprodukovateľná chyba, malá
   zmena, test, opis toolu); HARD = nejasné zadanie, architektúra, naprieč modulmi, DB schéma alebo migrácia,
   fork (ifc-lite), nový tool. Pri pochybnosti: nejasné zadanie -> HARD, inak STANDARD.
3. **Spätná kompatibilita:** chýbajúci parameter alebo nenastavená STANDARD routine = HARD ako doteraz.
4. **Záznam triedenia:** komentár k odkazu na session nesie riadok `triedenie: STANDARD - <dôvod>` a skrytú
   značku `aim-mcp-triage {level, requested}`; `level` je skutočne použitá routine, `requested` návrh
   (rozdiel = fallback, v riadku poznámka). Štatistika sa počíta z týchto komentárov (komentáre s
   `aim-mcp-session`; komentár fronty má predponu "Fronta:" a štatistiku nezvyšuje). Štítky session/fronta/pr
   sa nemenia.
5. **Fronta:** issue vo fronte si náročnosť pamätá v komentári "Fronta: triedenie: ..." so značkou;
   `start_queued_session` ju prečíta (výslovný `narocnost` pri start_session ju prebije). Zvolené pred štítkom:
   komentár nesie aj dôvod, štítky `narocnost:*` by rozšírili sadu štítkov, ktorú dnes nikto nečíta okrem
   servera, a značky v komentároch server už používa (`aim-mcp-session`, `aim-mcp-comment`).
6. **Dôvera značke a dôvodu (review):** `start_queued_session` číta značku `aim-mcp-triage` len z komentárov
   účtu, ktorému patrí `FEEDBACK_GITHUB_TOKEN` (`GET /user`, login účtu servera); cudzí komentár by inak vedel
   prepnúť routine. Ak sa login nedá zistiť, značky sa ignorujú a ide HARD. `narocnost_dovod` sa pred zápisom
   zbaví `<`, `>` a zlomov riadkov a skráti na 200 znakov, aby nevložil falošnú značku pred pravú.
7. **Eskalácia:** STANDARD session pri náročnej úlohe napíše do issue "Eskalácia na HARD: <dôvod>" a skončí;
   orchestrátor po 2 neúspechoch alebo pri eskalácii spustí HARD. Postup je v `docs/orchestration.md`.

**Zavrhnuté:**
- *Routine na triedenie, ktorá spúšťa iné routines:* routine nemá `fire_trigger` a potrebovala by tokeny
  oboch routines v environmente.
- *GitHub Actions na triedenie:* beh nie je session, v ktorej Samuel odpovedá.
- *Prepínanie modelu jednej routine:* stav a súbeh sessions (model je vlastnosť routine).

**Dôsledky:** zmena opisu a parametrov toolu `feedback` (inventár `MCP-TOOLS.md`), evaly D-057 zatiaľ bez
behu (v cloude chýbajú Supabase kľúče), na Verceli treba obe dvojice env (STANDARD už nastavená).

### D-135 - Egress Supabase: viewer a IFC motor čítajú nemenný archív revízie, sessions testujú na malom modeli
**Status:** rozhodnuté (2026-10-22, Samuel v #207, číslo pridelené v registri #60). Nadväzuje na D-044
(geometria v prehliadači), D-084 (IFC motor), D-086 (revízie a archív), D-087/D-098 (fork len tenko).

**Kontext:** bezplatný plán Supabase prekročil kvótu cached egress (cca 5,5 GB za obdobie), od 21. 11. 2026
platí Fair Use Policy. Hlavný zdroj sú IFC federácie: `ifc/ASR.ifc` (24,7 MB) a `ifc/VZT.ifc` (9,8 MB) s
`Cache-Control: max-age=60`, bez kompresie (`content-encoding` chýba). Zistenia (22. 10., len čítanie):
- Host dáva viewerovi `?models=<url>,<url>` s `?rev=N` (D-086); fork ich sťahuje obyčajným `fetch(url)`
  (`hooks/useModelUrlAutoload.ts`), takže platí len HTTP cache prehliadača: po 60 s podmienená požiadavka,
  v novom profile (Playwright v sessions, iný náhľad Vercelu = iná partícia cache) celých 34,5 MB.
- Cache modelov vo forku (`services/ifc-cache.ts`, IndexedDB) má kľúč z obsahu súboru: šetrí parsovanie,
  nie sťahovanie, súbor sa musí stiahnuť, aby sa kľúč vôbec spočítal. Egress neznižuje.
- IFC motor (D-084) sťahuje oba modely pri každej studenej inštancii funkcie (MCP `initialize`/`tools/list`
  ich načíta vopred, D-100/D-101), `cache: "no-store"`, teda 34,5 MB na inštanciu.
- Archív revízií z D-086 už existuje: `ifc/archive/<MODEL>/vNNN.ifc.gz`, gzip, `upsert=false`,
  `Cache-Control: max-age=31536000, immutable`. Aktuálne `v078` ASR 4,49 MB a `v004` VZT 2,69 MB, spolu
  7,18 MB proti 34,47 MB (-79 %). Obsah kľúča sa nikdy nemení (nová revízia = nový kľúč, návrat = nová
  revízia), preto je dlhá cache bezpečná.

**Rozhodnutie:**
1. **Viewer načíta archív aktuálnej revízie.** `withRevisions` (`lib/data/ifc-models.ts`) pre model so
   známou revíziou dá namiesto `.../ifc/ASR.ifc?rev=78` adresu `.../ifc/archive/ASR/v078.ifc.gz` (v tom
   istom adresári ako pôvodný súbor, takže funguje aj pre `NEXT_PUBLIC_IFC_URLS`). Nová revízia = nová URL,
   iframe sa obnoví ako doteraz cez `?rev=`. Model bez revízie (DB nedostupná, migrácia chýba) ostáva na
   pôvodnom kľúči. **Predvolene vypnuté:** archív platí len pri `NEXT_PUBLIC_IFC_ARCHIVE=1`, ktoré Samuel
   zapne na Verceli až po nasadení forku z bodu 2 (inak by viewer dostal gzip, ktorý nevie načítať).
   `modelKey` pozná oba tvary URL. URL sa skladá z mena modelu rovnako ako `archive_key` v
   `etl/model_publish.py`; `model_revisions.archive_path` nesie ten istý kľúč, prechod naň má zmysel až
   keby sa schéma archívu menila.
2. **Fork rozbalí gzip a zachová meno modelu.** Autoload (`useModelUrlAutoload`, blok AIM-FORK) pošle
   stiahnuté bajty cez `aim/modelFile.ts`: začiatok `1f 8b` = `DecompressionStream('gzip')`; meno súboru z
   `archive/<MODEL>/vNNN.ifc.gz` je `<MODEL>.ifc`, lebo most, revízie a filtre (`"VZT" ~ "VZT.ifc"`,
   `aim/derivations.ts`) párujú model podľa mena. Bez zmeny parsera a upstream loadera. Zlučuje sa pred
   AIMviewerom (D-116); host je bezpečný aj skôr, lebo archív zapína až `NEXT_PUBLIC_IFC_ARCHIVE=1`.
3. **IFC motor sťahuje archív.** `getStore` (`lib/engine/cache.ts`) zistí aktuálnu revíziu modelu
   (`model_revisions`, server) a stiahne archív, rozbalí ho (`zlib`, strop 512 MB). ETag na kontrolu zmeny
   berie z HEAD pôvodného kľúča **pred** čítaním revízie: publikácia zapíše DB skôr než kľúč, takže súbeh dá
   najviac jedno načítanie navyše, nikdy nový ETag pri starej revízii. Bez revízie alebo pri chybe archívu
   stiahne pôvodný kľúč. Motor nepotrebuje fork, platí hneď po nasadení hosta.
4. **Nahrávanie sa nemení.** `etl.model_publish` už archív píše nemenne s dlhou cache; aktuálny kľúč
   `ifc/<MODEL>.ifc` ostáva s `max-age=60`, lebo ho prepisuje každá revízia (ETL, OCB recept, `sync`,
   staré odkazy) a CDN bezplatného plánu by pri dlhej cache vracala starý súbor. OCB (workflow `uloha`) a
   ETL sa tým nedotýkajú; nič sa nenahráva, nastavenie bucketu netreba.
5. **Sessions a testy nesťahujú produkčné modely.** Živé overovanie viewera aj motora beží na malom
   testovacom modeli (`AC20-FZK-Haus.ifc` z fixtures forku, lokálny server), nie na `ifc/*.ifc` z bucketu.
   Hlavičky sa overujú `curl -I` alebo `-r 0-0`, nikdy celým stiahnutím. Pravidlo je v `AGENTS.md`, v
   skilloch `verify` a `mcp-poziadavka` a vo forku v `aim-feature`. "Ako vyskúšať" pre Samuela ostáva na
   produkcii (jeden prehliadač, po bode 1 z cache).

**Úspora (odhad z veľkostí, rozpis z logov Supabase nebol dostupný, API logov vracalo 429):**
| Prípad | Doteraz | Po D-135 |
|---|---|---|
| prvé otvorenie viewera v prehliadači / novom profile / náhľade | 34,5 MB | 7,2 MB |
| ďalšie otvorenie v tom istom prehliadači, tá istá revízia | podmienená požiadavka každých 60 s | 0 (bez požiadavky) |
| studená inštancia IFC motora (MCP) | 34,5 MB | 7,2 MB (+ 2 HEAD) |
| živé overenie v session | 34,5 MB na beh | 0 (testovací model) |

Kvóta 5,5 GB = cca 160 plných načítaní federácie; po zmene to isté stojí cca 1,15 GB.

**Odkiaľ sa sťahuje (Supabase Usage od Samuela + `mcp_call_log`, 22. 10.):** cached egress 14,66 GB z 5 GB
od 17. 10. (19. 10. cca 2,5 GB, 20. 10. cca 6,2 GB, 21. 10. cca 3,3 GB), bežný egress 0,99 GB. Cieľ od 17. 11.:
5 GB za mesiac, teda cca 160 MB za deň. Zdroje:
| Zdroj | Cesta v kóde / skille | 19. / 20. / 21. 10. |
|---|---|---|
| IFC motor: každá studená inštancia MCP predčíta oba modely (D-100/D-101, `preloadEngineModels`) | `app/api/mcp/[token]/route.ts`, evaly `eval/MCP-EVAL.md`, sessions a routines volajúce konektor | 38 / 105 / 39 studených inštancií = aspoň 1,3 / 3,6 / 1,35 GB |
| prehliadač v novom profile (Playwright v sessions, náhľady Vercelu) | fork `steward` "Try them yourself first, live" s odkazom `ai-mviewer.vercel.app/ifc?viewer=pr-N`, `release-train` test link, živý viewer pri evale (`/ifc?live=`) | zvyšok, cca 1,2 / 2,6 / 1,9 GB = 35 / 75 / 55 načítaní |
Studené inštancie bez tool callu (len `initialize`) v logu nie sú, motor je teda skôr väčší podiel.
Archív samotný 20. 10. zníži z 6,2 GB na cca 1,3 GB; na 160 MB za deň treba aj pravidlo 5 a jeden z návrhov nižšie.
Skilly forku `steward` a `release-train` preto hovoria, že odkaz "Ako vyskúšať" je len pre Samuela a session
skúša na lokálnom vieweri s testovacím modelom.

**Otvorené pre Samuela (nie je v prvom PR):**
- *Predčítanie motora len pri pripojení (schválené, dodatok nižšie):* `preloadEngineModels` len pri `initialize`/`tools/list`, nie pri prvej
  požiadavke na studenú inštanciu (časť D-101). Inštancia, ktorá obslúži len DB tools (78 až 90 % volaní),
  potom nič nesťahuje; cena je dlhšie prvé `ifc_*` volanie na novej inštancii.
- *Modely cez CDN Vercelu:* host servíruje `/models/archive/...` ako rewrite na archív s dlhou cache, prehliadače
  aj motor čítajú z CDN Vercelu a Supabase vidí stiahnutie raz na revíziu a región. Treba overiť, či Vercel
  (Hobby) cachuje externý rewrite, a pridať origin hosta do `VITE_AIM_MODEL_ORIGINS` forku (aj náhľady).

**Zavrhnuté:**
- *Dlhá cache na aktuálnom kľúči:* kľúč sa prepisuje, prehliadače aj CDN by držali starú revíziu.
- *Spoliehať sa na IndexedDB cache forku:* kľúč z obsahu, súbor sa aj tak sťahuje.
- *Kompresia `Content-Encoding` na aktuálnom kľúči:* Supabase Storage ju nenastavuje; gzip archív už je.
- *Presun úložiska alebo Pro plán:* Pro ostáva záloha (#207), presun je zbytočne veľký krok.

**Dôsledky:** fork patch (gzip + meno) ide pred AIMviewerom; po nasadení forku Samuel nastaví na Verceli
`NEXT_PUBLIC_IFC_ARCHIVE=1` (Production aj Preview) a redeploy, potom v DevTools uvidí `v078.ifc.gz`
(cca 4,5 MB) a pri ďalšom otvorení "(disk cache)". Live kanál, uložené pohľady (`model_revisions`
podľa kľúča) a `ifc_models` sa nemenia.

**Dodatok (2026-10-22, Samuel schválil návrh a s podmienkou "zahriatie motora smie spomaliť najviac jeden
prompt v rozhovore"): predčítanie motora len v rozhovore, ktorý motor používa.**
- *Meranie (`mcp_call_log` 19. až 21. 10., 1 278 volaní, rozhovor = volania s medzerou do 15 min):* 26
  rozhovorov, 182 studených inštancií (1 na 7 volaní, pri evaloch s paralelnými subagentmi až 51 v jednom
  rozhovore), 18 rozhovorov použilo motor, 209 volaní motora. 48 studených inštancií začalo rovno volaním
  motora a 45 volaní motora čakalo na načítanie aj s dnešným predčítaním, takže "každá inštancia predčíta"
  nespĺňala podmienku ani dnes; predčítanie pomáha len inštanciám, ktoré začnú DB toolom.
- *Varianty na tých istých dátach (stiahnutie = oba modely):*
  | Variant | Stiahnutí 19./20./21. 10. | Pomalé prompty |
  |---|---|---|
  | doteraz: každá studená inštancia | 38 / 105 / 39 = 182 | ako dnes |
  | pri `initialize`/`tools/list` | nerieši recykláciu, ďalšie inštancie rozhovoru by čakali | viac |
  | len pri volaní motora (čisto lenivo) | 14 / 55 / 14 = 83 (odhad: teplé volanie ide na poslednú inštanciu) | 83, každá nová inštancia s motorom |
  | **motor použitý v posledných 30 min (zvolené)** | 25 / 81 / 29 = 135 | 17 = prvé volanie motora po pauze (18 rozhovorov s motorom) |
- *Rozhodnutie:* `lib/mcp/engine-warm.ts`. Volanie toolu motora (`ifc_*`, `search_all`, `calibrate_underlay`)
  predčíta hneď. Iná požiadavka (DB tool, `initialize`, `tools/list`) na nezahriatej inštancii v `after()`
  overí v `mcp_call_log` (index `tool, created_at`), či niekto volal motor za posledných 30 min, najviac raz
  za minútu na inštanciu. Ak áno, predčíta ako doteraz, inak nič. DB tools na motor nečakajú (kontrola aj
  predčítanie bežia po odpovedi). Chyba kontroly = nepredčítať. Okno 30 min, nie 15: pauza v rozhovore
  dlhšia než 15 min by spomalila druhý prompt (15 min: 130 stiahnutí a 20 pomalých, 60 min: 149 a 11).
  Signál je spoločný pre všetkých (demo má jedného používateľa a evaly).
- *Úspora:* 182 -> 135 stiahnutí (-26 %), s archívom 6,3 GB -> cca 0,97 GB za 3 dni (-85 %). Na deň cca
  180 / 580 / 210 MB; nad cieľom 160 MB je hlavne 20. 10. s celým kolom evalu (pravidlo 5, `eval/MCP-EVAL.md`).
  DB tools s motorom ako záložnou cestou (`get_object` kód len v IFC, `set_section relative_to=ceiling`,
  mená v tooloch viewera) načítajú motor až pri potrebe a nie sú v signáli.
- *Evaly D-057 nepobežali* (cloud session nemá Supabase kľúče; LLM vrstva, tooly ani prompt sa nemenia).

---

### D-136 - Dlaždicové rozloženie viewera: krok 1 je pôvodný 2D výkres rezu, viac 3D pohľadov je otázka renderera
**Status:** krok 1 rozhodnutý (2026-10-22, session z konektora, číslo rezervované v registri #60); krok 2
(dlaždice s viacerými 3D pohľadmi) čaká na Samuela. Issue #210. Nadväzuje na D-072 (pôdorys s podkladom),
D-087 (most forku), D-098 (najprv existujúce funkcie), D-114 (najprv napasuj), D-127 (panely z chatu),
D-132 (záložky; bod "Otvorené" o pôdoryse bez podkladu).

**Kontext:** Samuel chcel v rozhovore "vľavo 3D, vpravo pôdorys 1NP" a ako v Revite (Tile Windows) až štyri
pohľady naraz. `set_view_mode(beside=1NP)` bez kalibrovaného podkladu vráti odmietnutie, dva 3D pohľady
nejdú a viac než dve dlaždice tiež nie. Príčina je vo vieweri: má jeden 3D canvas (WebGPU, nikdy sa
neremountuje) a jednu kameru; 3D, pôdorys bez podkladu (model zhora s rezom) a uložený pohľad sa v ňom len
striedajú. Vedľa 3D dnes môže stáť len niečo, čo nie je 3D: PDF dokument alebo PDF podklad (D-072 split).

**Rozhodnutie (krok 1):**
1. Originál ifc-lite má panel **Drawing** (`section2d`, upstream #5493): 2D výkres aktuálneho rezu
   generovaný z modelu (vektor, šrafy, bez podkladu), domov v spodnom páse, dá sa nechať plávať alebo
   vytiahnuť do okna. Je na čítanie (generovanie beží v `DrawingRuntimeHost`), nie v režime úprav modelu,
   takže rieši bod "Otvorené" z D-132.
2. **Bez nového toolu (D-114):** `set_view_mode panels` otvorí `drawing` (open | close | toggle); od D-150 host
   púšťa ľubovoľné meno panela z registra forku, takže v hoste pribudol len recept v opise toolu. Pôdorys
   podlažia bez podkladu pri 3D = `set_section(action=set, floor)` + `set_view_mode(panels={drawing: 'open'})`:
   hore voľné 3D (rezané na tom podlaží), dole pôdorys z modelu. Stav panela (`open`, `where`) vráti výsledok
   aj `get_viewer_state` ako pri ostatných paneloch.
3. **Most (fork, len `apps/viewer/src/aim/`):** `PANEL_KEYS` + `drawing`, mapovanie na upstream panel
   `drawing`, zatvorenie cez `setDrawing2DPanelVisible(false)`, stav zo `drawing2DPanelVisible`. Odmietnutie
   `VIEW_TABS beside` pôdorysu bez podkladu ukáže túto cestu.

**Zavrhnuté rozšírenie:**
- *Nový tool na rozloženie (návrh z issue):* rozloženie plochy je zobrazenie, to robí `set_view_mode`;
  `layout`/`tiles` by dnes nemali čo zobraziť, kým viewer nemá viac 3D pohľadov.
- *`set_view_mode layout=split_h|split_v|grid4, tiles=[...]` hneď:* parameter bez schopnosti vo vieweri by
  vracal chyby; pribudne až s krokom 2.
- *`set_camera` alebo `set_section` s dlaždicou:* majú jeden canvas, dlaždica by bola len predstieraná.

**Krok 2 (otvorené, otázka v #210):** skutočné dlaždice (2 vedľa seba, 2 nad sebou, 2x2) s viacerými 3D
pohľadmi, každý s vlastnou kamerou, rezom a farbením. Možnosti: (a) viac viewportov v jednom canvase
(scissor, jedna GPU scéna, stav kamery, rezu a farieb na dlaždicu; veľký zásah do upstream renderera a
store, vlastný kód forku pri každom sync), (b) dlaždice ako snímky (živá je jedna, ostatné obrázok
posledného stavu, klik ju urobí živou; malý zásah, záložky D-132 už stav dlaždice ukladajú), (c) návrh
upstream ifc-lite. Odporúčanie: (b) ako medzikrok, (a) len ak je pre demo nutné. `layout`/`tiles` v
`set_view_mode` pribudnú až s krokom 2.

**Evaly D-057 nepobežali** (cloud session nemá Supabase kľúče); otázka `view-3d-and-plan-no-underlay` pridaná
bez overenej hodnoty.

---

---

### D-138 - style_in_3d: priorita prekrytých pravidiel a hlasné varovanie pri pravidle bez zásahu
**Status:** rozhodnuté (2026-10-22, issue #221; číslo D-138 navrhnuté orchestrátorovi, potvrdenie čaká). Nadväzuje na
D-096 (Lens z chatu), D-125 (`inactive`) a #219 (varovania pri mode=replace).

**Kontext:** engine Lens vo forku farbí **prvou zhodou** (`packages/lens/src/engine.ts`). Nové volanie (mode=add)
dáva svoje pravidlá pred staršie, takže novšie prebije staršie. V rámci jedného volania ale host posielal skupiny v
poradí `groups`, takže PRVÁ skupina vyhrala a posledná ("trasa navrch") dostala 0 prvkov; v odpovedi to bolo len
pole `inactive` v stave Lens. Preto trasa fungovala až ako druhé volanie.

**Rozhodnutie:**
- *Priorita:* pri prekrytí vyhráva **neskoršia skupina v `groups`**, rovnako ako novšie volanie. Rovnako v mode
  add aj replace. Host (`lib/llm/style-overlap.ts`, `lensPriorityOrder`) posiela pravidlá volania vo wire v opačnom
  poradí. Fork ani wire formát sa nemenia (patch nie je), v paneli Lens je navrchu pravidlo s najvyššou prioritou.
- *Varovanie:* pravidlo s 0 prvkami nahlási text s počtami (`lens-counts.ts`) aj potvrdenie vo vieweri
  (`applied-text.ts`) ako `POZOR: ...` s názvom pravidla. Dôvod: pod ním je pravidlo so zásahom -> "prekryté
  pravidlami X, Y alebo filter nič nenašiel" (host nevie rozlíšiť, počty sú z viewera); inak -> "filter nič nenašiel".
  Pri colorize s viac skupinami odpoveď hneď pripomenie pravidlo priority (`warnings`).
- *Zavrhnuté:* parameter `overlay=true` / `priority` na skupine: "posledná skupina navrchu" dáva to isté bez
  nového parametra (D-114, rozšírenie len opisom). Nový tool netreba.
- Opis `style_in_3d` pravidlo uvádza; inventár `MCP-TOOLS.md` sa nezmenil (test registra prešiel).
- *Evaly D-057 nepobežali* (cloud bez Supabase kľúčov); otázka `style-overlay-path-on-top` je v `eval/questions.json`.

### D-139 - style_in_3d colorize: priesvitnosť farby (`opacity`) a predvolene priesvitné priestory a zóny
**Status:** rozhodnuté (2026-10-22, issue #222; číslo D-139 navrhnuté orchestrátorovi, potvrdenie čaká). Nadväzuje na D-125
bod 4 (priesvitná varianta farby priestoru), D-138 (priorita pravidiel), #175 (priestor = vyplnená podstava, Samuelovo rozhodnutie).

**Kontext:** colorize IfcSpace (izby 2.01 s 3 dverami, schodom a východom) dal nepriehľadnú hmotu, prvky vnútri nebolo vidno.
D-125 bod 4 rieši priesvitnosť vo forku pre pravidlo podľa triedy; farba cez `ids_or_refs` (miestnosti z `ifc_query`) ju
nedostala a model nemal spôsob, ako priesvitnosť žiadať pre iné veľké prvky (dosky, steny).

**Overenie existujúceho (D-098, D-114):** Lens už pozná akciu `transparent` (farba + priesvitnosť), `xray` a `isolate`; wire
formát nenesie hodnotu alfa. Chýba teda len host: kedy akciu `transparent` poslať. Fork netreba meniť, patch nie je.

**Rozhodnutie (host, `lib/llm/style-lens.ts`, `style-plan.ts`):**
1. Nový voliteľný parameter `opacity` (0.05 až 1, na úrovni volania aj skupiny v `groups`). `opacity < 1` pri colorize pošle
   pravidlo ako `transparent` (rovnaká farba, priesvitná). `opacity = 1` vynúti plnú farbu.
2. Bez `opacity` sú priesvitné skupiny, ktoré sú len z IfcSpace / IfcSpatialZone / IfcZone: podľa tried filtra, pri
   konkrétnych prvkoch (`ids_or_refs`, `global_ids`) podľa tried prvkov v DB. Skupina sa v odpovedi označí `opacity` a
   `opacity_default`.
3. Priesvitnosť má jednu úroveň (fork alfa 0,3): hodnota `opacity` rozhoduje len medzi plnou a priesvitnou farbou, odpoveď to
   neskrýva. Presný stupeň by vyžadoval pole alfa vo wire a patch forku; otvorené, kým to nikto nepotrebuje.
4. Varovanie v odpovedi: plne ofarbené veľké prvky (steny, dosky, strecha, krytina) v colorize s viac skupinami môžu zakryť
   ostatné farby, odpoveď navrhne `opacity=0.3`.
5. Duplicitné pravidlá pre priestory z issue (obyčajné a "miestnosti"): host posiela jedno pravidlo na skupinu; druhé pravidlo
   v súhrne Lens pochádza z lens viewera (výplň miestností, D-119/D-125), host ho nevytvára. Nezmenené, vysvetlené tu.

**Zavrhnuté:** nový tool alebo `space_display` (D-114); zmena renderera (upstream); `opacity` v pôvodnej hodnote ako alfa
vo wire (fork patch bez využitia).
**Evaly (D-057):** v cloud session nepobežali (bez Supabase kľúčov); otázka `style-colorize-space-translucent` je v
`eval/questions.json`.

### D-140 - set_section relative_to=ceiling: výška podhľadu z geometrie IfcCovering CEILING, Qto len záloha
**Status:** rozhodnuté (2026-10-22, issue #230; číslo D-140 pridelil orchestrátor (D-141 má #185); zápis do registra čaká). Nadväzuje na D-102
(rez pod podhľadom), D-092 (rez nad podlažím, elevácia z DB), D-112 (`ifc_measure`, mesh), D-114 (bez nového toolu).

**Kontext:** `relative_to=ceiling` bral výšku z Qto `FinishCeilingHeight` miestností. Na 2NP sa Qto (3,05 m od hotovej podlahy)
líši od skutočného podhľadu (PH01.10.0010 na z = 8,05 až 8,063 m), rez ho umiestnil mimo podhľadu a podhľad nebolo vidno.

**Rozhodnutie (host, `lib/engine/ceiling.ts`, `lib/llm/view-tools.ts`):**
1. Výška podhľadu podlažia = z geometrie prvkov `IfcCovering` s `PredefinedType = CEILING` priradených k podlažiu (mesh
   motora z D-112, svetové Z vrátane posunu rámca D-124, mínus `IfcBuildingStorey.Elevation`). Spodný a horný okraj je
   vážený medián okrajov krytín (váha = pôdorys), aby osamelá krytina inej výšky nerozhodla.
2. Referencia rezu: záporný `offset_m` ráta od **spodku** podhľadu (pod ním), nezáporný od **horného okraja** (nad ním).
3. Qto `FinishCeilingHeight` je záloha, keď podlažie nemá krytinu CEILING s geometriou (alebo sa mesh nedá načítať).
4. Odpoveď nesie `ceiling.source` (`geometry` | `qto`), `bottom_m`, `top_m`, `coverings`, `qto` a `warning`: pri nezhode nad 2 cm
   "Qto ... sa líši od geometrie ... použitá je geometria", pri zálohe "Výška je len z Qto ...". Prompt a opis toolu model
   vedú, aby zdroj a upozornenie povedal používateľovi.
- *Zavrhnuté:* nový tool alebo parameter (D-114, ide o opravu zdroja výšky v existujúcom `relative_to=ceiling`); samostatné
  volanie `ifc_measure` v postupe modelu (host to robí sám v jednom volaní `set_section`).
- *Otvorené:* záporný offset -0,05 od spodku podhľadu stále podhľad (nad rezom) skryje, tak ako každý rez; ak ho má rez
  ukázať, treba kladný offset (nad horným okrajom ho zvýrazní `style_in_3d`) alebo ho po rezaní zobraziť cez xray.
- **Evaly (D-057):** v cloud session nepobežali (bez Supabase kľúčov); otázka `section-below-ceiling-geometry` je v
  `eval/questions.json`. **Testy:** `lib/engine/names.test.ts` (mini model `__fixtures__/mini-ceiling.ts`).

**Doplnok (2026-10-22, #187): X-ray kontext len pre zvolené podlažie, `style_in_3d action=xray context_storey`.** Zvyšok issue #187
(hlavná chyba: `xray` so `storey` nechal kontext celú budovu, pôdorys 1NP zhora bol nečitateľný). Samuel 22. 10.: plné riešenie vo forku.
*Najprv to, čo existuje (D-098, D-114):* fork robí X-ray ako zjednotenie pravidiel `APPLY_LENS xray: true` v kanáli `ghostExceptEntities`
(`aim/aimLens.ts`, D-105): zvyšok modelu je priesvitný, na podlažia nemá žiadny pojem. Host nemôže ostatné podlažia skryť sám v jednom príkaze
(`hide storey` po podlažiach sú stovky GUIDov nad stropom `LENS_GUID_CAP`; lens pravidlo `hide` v tej istej správe by fork zjednotil do X-ray
množiny a pri `clear_isolation` by ostalo v lens). Najbližšie tooly: `style_in_3d` (xray, hide, clear_isolation), `set_section`
(relative_to=ceiling, D-140 hore). Rozšírenie existujúcej správy, nový tool ani nová bridge správa netreba (D-114).
*Rozhodnutie:* (1) `style_in_3d` dostane parameter `context_storey` (podlažie ako `storey`: 1NP, 2.NP, object_ref, názov), platí len s
`action=xray`, inak chyba. Host ho preloží na normalizovaný štítok z grafu AIM (`normalizeStoreyLabel`, `1.NP_VZT` = `1NP`) a pošle ho v op `lens`
ako `cs`, na moste ako `APPLY_LENS xrayStoreys`. (2) Fork (`aim/aimXrayStoreys*.ts`, patch `aim-187-xray-kontext-podlazia`): pri `xrayStoreys`
skryje kanálom `hiddenEntities` prvky ostatných podlaží všetkých modelov (porovnanie podľa štítku, aby ASR a VZT podlažie toho istého poschodia
ostali spolu), okrem plných prvkov X-ray; prvky mimo podlaží (terén, budova) ostanú v ghost kontexte. Čo skryl chat, si pamätá a vráti pri zrušení
X-ray: `clear_isolation` (D-151, `APPLY_LENS unisolate`), `show_all`, `clear` alebo nový X-ray vrátia len tieto prvky, ručné skrytie používateľa ostane.
`mode=add` kontext rozšíri. (3) Bez `context_storey` ostáva doterajšie správanie; `xray` so `storey` bez neho vráti varovanie, že kontext je celý model,
s radou zopakovať volanie s `context_storey=<podlažie>` a rezom tesne nad horný okraj stropov (D-140). Odpoveď nesie `xray` text a `context_storey`;
`LENS_QUERY` vo `isolation` aj `storeys` a `hidden` (počet skrytých). Starší fork pole ignoruje (varovanie ostáva pravdivé, kontext je celý model).
*Zavrhnuté:* nová akcia `ceiling_plan` (štyri kroky naraz, návrh z komentára k issue): `xray` + `context_storey` + `set_section` + `set_camera` sú existujúce
tooly a rez z D-140 už ide z geometrie, balík by zakryl, čo sa ktorým krokom stalo; `hide` ostatných podlaží po jednom (obchádzka, desiatky volaní a GUIDov);
lens pravidlo `hide` s `storey notIn` (neprenáša sa medzi modelmi s iným menom podlažia a `clear_isolation` by ho nezrušil).
*Dôsledky:* fork PR len v `aim/` (rýchle CI, D-103), poradie zlúčenia fork, potom AIMviewer. Bez migrácie a env. Prompt sa nemení (MCP inštrukcie
pri strope), pokyn je v opise toolu a vo varovaní. **Evaly (D-057):** v cloud session nepobežali (bez Supabase kľúčov); otázka `style-xray-storey-context`
je v `eval/questions.json` (upravená). **Testy:** vitest (`style-lens`, `viewer-lens`), fork `aimXrayStoreysPlan.test.ts` s mutačnými skúškami. Neoverené živo
(bez modelu v cloud session, D-135): skrývanie vo viewere stojí na typoch a čistej logike.

### D-141 - Spodná stavová lišta hostu pod viewerom: výber viewera a Live neprekrývajú panely
**Status:** rozhodnuté (2026-10-22, issue #185; číslo D-141 navrhnuté orchestrátorovi, potvrdenie čaká). Nadväzuje na D-116
(výber viewera), D-079 (živý kanál), D-091 (AIM funkcia predvolene v hoste), D-127 (panely z chatu, #179), D-111 (`open_list`).

**Kontext:** po `open_list` sa otvoril builder panela Lists, ale tlačidlo Run bolo pri spodku viewera a prekrývali ho dva overlaye
hostu vľavo dole: čip "Viewer: Produkcia" (`viewer-picker.tsx`, absolútne nad iframe) a indikátor Live (`live-channel.tsx`,
fixed). Tabuľka sa nedala spustiť. Označenie "batch" v kóde nie je (`BATCH_MS` je len zlučovanie príkazov kanála).

**Overenie existujúceho (D-098, D-114):** D-127 rieši len otváranie, zatváranie a stav panelov (`set_view_mode panels`), prekrytie
nemení. `open_list` parameter `run` nemá (`lib/llm/list-tool.ts`, `MCP-TOOLS.md`). Pruh nie je vo forku, je to vrstva hostu.

**Rozhodnutie (host, fork bez zmeny):**
1. `ifc-workspace.tsx` je stĺpec: viewer (iframe s vlastnou stavovou lištou s počtami prvkov) a pod ním 28 px vysoká stavová
   lišta hostu. Overlaye už nelezú nad viewer, takže neprekrývajú žiadny panel ani jeho Run, nech je panel ukotvený kdekoľvek.
2. Lišta nesie `ViewerPicker` (ponuka a chyba sa otvárajú nahor nad lištu) a indikátor Live. Indikátor sa vloží portálom do
   slotu `aim-live-slot`; mimo `/ifc` ostáva fixed vľavo dole ako doteraz. Toast Live ostáva fixed, je `pointer-events-none`.
3. Prekrytie je tým odstránené len v hoste. Veľkosť a maximalizácia panela Lists (bod 2 zo zadania) je vec forku a rozloženia
   panelov (#211).

**Zavrhnuté / odložené:**
- *`open_list run=true`* (bod 3 zo zadania): spustenie je `handleExecuteList` lokálne v upstream `ListPanel.tsx`; hotový zoznam
  by vyžadoval zásah do upstream súboru (plné CI forku, kolízia s #211). Builder s Run po oprave prekrytia funguje, tak sa
  nerobí; ak ho Samuel chce, je to samostatná úloha (parameter `run` + správa `OPEN_LIST`, D-114).
- *Presunúť čipy do vlastnej lišty viewera (fork)*: upstream `StatusBar` by sa menil kvôli čipu hostu; zbytočné, host má vlastnú.
**Evaly (D-057):** LLM vrstva sa nemení.

---

---

### D-142 - `get_object include=quantities`: Qto výmery a psety jedného prvku z IFC jedným volaním

**Dátum:** 2026-10-22 · **Issue:** #184 · **Nadväzuje na:** D-021, D-084, D-114, D-115

**Kontext:** Používateľ chcel objem (NetVolume) jedného stĺpca. `get_object` vracal len identitu a psety
z grafu AIM (DB, s dedením z typu cez `v_asset_effective`, D-021), nie Qto z IFC. `ifc_get` Qto vracia, ale
v session sa nenačítal (ide o tool IFC motora, ktorý nemusí byť vždy v zozname) a model skončil pri štyroch
volaniach `ifc_query` s odvodzovaním.

**Rozhodnutie (rozšírenie existujúceho toolu, D-114 bod 3, žiadny nový tool):**
1. `get_object` dostane hodnotu `include=quantities`. Pole `ifc` vo výsledku nesie `quantities`
   `[{qto, name, value, source}]` a `properties` `[{pset, name, value, source}]`, `source` = `occurrence` |
   `type`; ďalej `model`, `global_id`, `ifc_type`, `type_name` a `note`.
2. Dáta berie `ifc_get` (IFC motor), tvarovanie je v `lib/engine/element-data.ts`. DB sa nemení: Qto v grafe
   AIM nie sú, takže hodnota je vždy zo súboru (aktuálna revízia modelu).
3. Prvok len v IFC (D-102, `in_aim:false`) dostane `ifc` tiež, podľa `global_id`.
4. Chyba motora, vypnutý motor alebo chýbajúci GUID sa vráti ako `ifc.error`, ostatné `include` ostávajú
   použiteľné. `ifc_get` ostáva na viac prvkov naraz a na materiály, klasifikácie a dokumenty.
5. Prompt (`system-prompt.ts`) sa nemení, je na hranici rozpočtu 15000 znakov (test); pravidlo nesie opis toolu.

**Zavrhnuté rozšírenie:**
- *Nový tool na výmery:* `get_object` už je tool "čo je X", výmery sú len ďalšie `include`.
- *`ifc_get`:* funguje, ale nie je spoľahlivo načítaný, vráti sa celý záznam (atribúty, dokumenty) a bez `ifc` cesty
  sa model musí učiť dva nástroje na jednu otázku.
- *`show_in_3d select panel_section=quantities`:* UI akcia (zvýraznenie riadku vo viewer paneli, #183), hodnotu
  Claudovi nevracia.

**Otvorené:** jednotky veličín sa nevypisujú (hodnoty sú v jednotkách IFC súboru, `note` to hovorí); ak má model
nemetrické jednotky, treba doplniť z `ifc_models`. Evaly (D-057) v cloud session nepobežali, pridaná otázka
`object-quantities-one-call` (neoverená).

---

---

### D-137 - Čiara trasy vo vieweri: `ifc_measure route` + `show` kreslí únikovú cestu 1,6 m nad podlahou
**Status:** rozhodnuté (2026-10-22, issue #223 zo Samuelovho rozhovoru cez konektor), číslo pridelené orchestrátorom
v registri #60. Nadväzuje na D-121 (trasa z grafu zo súboru), D-124 (kóta cez most forku), D-087/D-091/D-098
(fork len tenko kreslí, výpočet robí host) a D-114 (najprv napasuj).

**Kontext:** `ifc_measure route=escape` vracia kroky a dĺžku, `show=true` pri trase nekreslil nič a `show_in_3d`
len izoluje prvky; ofarbené miestnosti zakryjú vnútro (#222). Samuel chce trasu vidieť ako **červenú plnú čiaru
vo výške 1,6 m nad pochôdznou plochou** (nad podlahovou krytinou a nad každým stupňom schodiska), **stredom
každých dverí**. D-121 to nechal otvorené ("čiara trasy potrebuje správu mosta vo forku").

**Najbližšie tooly (D-114):** `ifc_measure show` (kóty cez upstream Measure, úsečky po 12, prerušovaná čiara
v ink farbe s popisom vzdialenosti), `ifc_measure route` (body trasy nevracia), `show_in_3d` (prvky, nie čiara).
Riešenie = `show=true` aj pri `route`, nie nový tool.

**Rozhodnutie:**
1. **Host počíta body (`lib/engine/route-line.ts`).** Z krokov trasy D-121: štart (stred miestnosti alebo prvku),
   stred každých dverí, os každého ramena schodiska, cieľ. Výška = pochôdzna plocha + 1,6 m. Plocha v miestnosti
   a pri dverách = najvyšší povrch IfcSlab / IfcCovering / IfcRamp(Flight) pod bodom (zvislý lúč v okne -0,6 až
   +0,4 m okolo spodku IfcSpace, pri dverách okolo spodku dverí), bez zásahu spodok IfcSpace. Stropná krytina je
   pod doskou podlažia a nevyhrá. Priamka v miestnosti má vzorky každých 0,5 m (zmena úrovne podlahy, krytina).
2. **Schodisko plynulo šikmo (rozhodnutie Samuela v #223, 22. 10.):** na ramene je referenčná čiara, ktorá spája
   nábehové hrany stupňov (sklon ramena); úniková čiara ide rovnobežne s ňou 1,6 m nad ňou, merané zvislo nad
   hranou každého stupňa; na podestách a podlahe vodorovne. Stupne = horné vodorovné plochy ramena (IfcStairFlight;
   bez ramien časti schodiska), nad ktorými z prvku už nič nie je, zoskupené podľa výšky; plochy pod 50 % mediánu
   (vrch stredového stĺpa, madlo) sa vynechajú. Nábeh = ťažisko stupňa posunuté proti smeru chôdze o polovicu
   hĺbky (hĺbka = plocha / šírka ramena), takže to platí aj pre točité ramená. Čiara začína pätou o stupeň pred
   prvým nábehom (úroveň podlahy); keď sú dva nábehy ďalej ako 1,5 stupňa (podesta), ide vodorovne k päte
   ďalšieho ramena; horná podesta v prvku vodorovne do jej stredu. Ramená podľa výšky, pri zostupe obrátene;
   prvok bez vodorovných plôch = os obálky v smere stúpania. Schodisko sa v úseku miestnosti neráta (priamka od
   dverí k ramenu ide v pôdoryse aj nad otvorom schodiska a nesmie klesnúť na stupne).
3. **Zjednodušenie a limit:** Douglas-Peucker 2 cm, najviac 400 bodov (tolerancia sa zdvojnásobí, kým sa
   nevojdú); drôt na cm, aby URL ostala krátka. Posun rámca do IFC sveta ako pri kótach (`worldOffset`, D-124).
4. **Most:** op `route:<hex>:<x,y,z|...>` (`lib/viewer-route.ts`) -> správa `ROUTE_SHOW { points, color }`,
   prázdne body = zmazať. Nová čiara nahradí predošlú; `reset_colors` (reset farieb) ju zmaže. Výsledok toolu
   má `line` (počet bodov, výška, farba).
5. **Fork (`apps/viewer/src/aim/`):** `AimRouteLayer` kreslí SVG lomenú čiaru (`#dc2626`, plná, 3 px) cez
   `projectToScreen` ako `AimRoomFillLayer` (D-119), pripojená v `CapturePinLayer`; body prevedie do render rámca
   `ifcPointToRender` + `bcfWorldOffset` ako kóty. Čiara je vrstva nad scénou (bez hĺbky), takže je vidieť aj
   cez steny a dosky; to je pri trase cez viac podlaží žiadané.

**Zavrhnuté rozšírenie: nový tool `show_route` - prečo nie:** body vznikajú z tej istej trasy a tesselácie ako
`ifc_measure route`; rozlišovací parameter `show` už existuje (D-124, D-114).

**Zavrhnuté:**
- *Upstream polyline meranie forku (`polylineMeasurements`):* nemá farbu ani plnú čiaru a pridá popis dĺžky
  meranej po lomenej čiare (pri schodoch iná ako dĺžka D-121); upravovať upstream komponent = plné CI.
- *Kóty `MEASURE_SHOW` po úsekoch:* limit 12 úsekov, prerušované s popisom pri každom úseku.
- *3D čiara v rendereri (hĺbkový test):* zmena `packages/renderer` (plné CI, odchýlka od upstreamu) bez
  potreby; trasa má byť vidieť aj cez dosky.
- *Schodovito (vodorovne nad každým stupňom, zvislý skok pri podstupnici):* prvá verzia podľa znenia issue;
  Samuel v #223 chce plynulú čiaru rovnobežnú s čiarou nábehov.
- *Os obálky ramena:* na točitom schodisku trafí stupne z rôznych výšok (overené na FZK-Haus).

**Overenie:** vitest na mini budove (doska, krytina 1,65 m, 10 stupňov dole aj hore presne 1,6 m nad každým
nábehom, podesta vodorovne, stredy dverí) a lokálne na `AC20-FZK-Haus.ifc` (fixture forku): úniková cesta z Galerie
cez točité schodisko k Terrassentuer, plynulo z 4,25 na 2,13 m, 17 bodov; fork čiaru nakreslil a prázdna správa ju
zmazala. Prvý pokus po osi obálky na točitom schodisku skákal hore-dole (os trafí stupne z rôznych výšok), preto
stupne z horných plôch.

**Hranice:** dĺžka a poradie ostávajú dolným odhadom D-121 (priamky v pôdoryse), čiara len kreslí tú istú trasu
cez skutočné výšky; priamka v miestnosti tvaru L môže ísť cez stenu; schodisko bez vodorovných plôch (napr. len
šikmá doska) ide šikmo po osi obálky; ramená s viacerými stupňami v tej istej výške (vedľa seba) sa zlúčia do
jedného stredu; hĺbka podesty je odhad z plochy (pri tvare L nepresná, čiara ostáva vodorovná).

---

### D-145 - "Ukázať v 3D" pri PDF s podlažím: Solo podlažia a rezové nástroje namiesto samotného X-ray

**Dátum:** 2026-10-22 · **Issue:** #214 · **Fork PR:** Menezeris/ifc-lite#116 · **Nadväzuje na:** D-072, D-098, D-104 (krok 4), D-105, D-114

**Kontext:** Tlačidlo "Ukázať v 3D" pri otvorenom PDF poslalo `DOCUMENT_SHOW_3D` a host odpovedal X-ray lens (D-105). Používateľ videl len X-ray kontext bez izolovaného podlažia a bez možnosti posunúť rez. Viewer pritom Solo podlažia aj panel Add a plane (Down, Front, Side, Face) má, len sa po kliku nepoužili.

**Rozhodnutie (len sprístupnenie existujúcich funkcií viewera, D-098; žiadny nový tool, host sa nemení):**
1. Fork (`AimDocumentShow3d.tsx`, nový čistý modul `show3dSoloPlan.ts`): dokument viazaný na podlažie (`storeyGuid` z `DOCUMENTS_LOAD`, D-072) po kliku zavolá existujúce `applyLevelDisplayMode('solo', refs)` (podlažie vo všetkých modeloch federácie) a `setActiveTool('section')`, kde je Add a plane.
2. Dokument bez podlažia alebo s nenačítaným podlažím ostáva pri `DOCUMENT_SHOW_3D` a X-ray lens (D-104, D-105) bez zmeny.
3. Wire protokol sa nemení, AIMviewer nemá kód. `DOCUMENT_SHOW_3D` sa pre dokument s podlažím neposiela.

**Kompromis:** Pri Solo sa X-ray lens hosta nepošle, takže prvky konkrétnej strany PDF sa nezvýraznia, viditeľné je celé podlažie. Dôvod: lens `isolate` by skryl zvyšok podlažia a rušil by Solo; zvýraznenie strany v Solo podlaží je možné doplniť neskôr (napr. farbením cez existujúci lens), ak ho Samuel bude chcieť.

**Poradie nasadenia:** najprv fork (Menezeris/ifc-lite#116), potom AIMviewer (tento záznam); zmena v AIMvieweri je len dokumentácia.

**Otvorené:** živé overenie vo forku (či `setActiveTool('section')` pri prázdnom reze vždy ukáže menu Add a plane) a plný CI forku, ktoré v cloud session nepobežali.

---

### D-151 - Výber z filtra (`show_in_3d select`) a skrytie s výnimkou (`style_in_3d hide`), len v hoste

**Dátum:** 2026-10-22 · **Issue:** #242, #246 · **Nadväzuje na:** D-066, D-096, D-098, D-102, D-114, D-115

**Kontext:** (#242) `show_in_3d(ifc_type=IfcDamper, select=true)` zlyhal, hoci zvýraznenie tým istým filtrom ide; model musel najprv volať `search_objects` a poslať 24 ids. (#246) "vypni ostatné potrubia okrem trasy" vyžadovalo dve volania (hide modelu, potom show trasy); `isolate` by skryl aj ostatné modely.

**Najprv to, čo existuje (D-098, D-114):** ops sú `;`-oddelené a viewer ich aplikuje postupne (`applyOps` v `ifc-viewer.tsx`), `hide_sel`/`show` a viacnásobný `select` bridge už existujú. Najbližšie tooly: `show_in_3d` (filter je už pri zvýraznení), `style_in_3d` (hide, selektor modelu), `ifc_query`. Fork netreba, nový tool netreba.

**Rozhodnutie (parametre existujúcich toolov, žiadny nový tool, žiadna zmena forku):**
1. `show_in_3d select=true` prijme aj `global_ids` a filter `ifc_type`, `predefined_type`, `query`, `object_type` (rovnaké kritériá ako zvýraznenie). Filter rozloží host na GUIDy a pošle jeden viacnásobný `select`. Strop 200 prvkov (ako dnes pri ids); viac zhôd je chyba s radou zúžiť, výber by inak bol ticho neúplný. Prvky bez GUID sa nahlásia (`skipped_without_guid`).
2. `style_in_3d action=hide` prijme `exclude_ids_or_refs` (id, object_ref, kód prvku) a `exclude_global_ids` (spolu najviac 300). Host výnimky rozloží na GUIDy a: pri selektore (model, trieda, doména) a pri systéme/zóne/podlaží pošle za skrytie op `show` výnimiek v tej istej akcii; pri výbere z DB ich odpočíta zo skrývaných GUIDov. Neznáma výnimka sa nahlási (`excluded_skipped`), samé neznáme výnimky skrytie zastavia (inak by sa skrylo všetko).
3. "Izolácia len v rámci jedného modelu" = `hide` + `model` + výnimky; samostatný `scope` pri `isolate` sa nezavádza (isolate ide cez Lens a skrýva všetko mimo pravidla). `exclude_*` s inou akciou ako hide je chyba s touto radou.

**Zavrhnuté:** nový parameter `scope` pri `isolate` (Lens nevie "skry len v modeli", vyžadovalo by to zmenu forku); nový tool na výber.

**Doplnok (2026-10-22, časť 2 z #246): `style_in_3d action=clear_isolation`.** Samostatné zrušenie len X-ray a izolácie z chatu bez rezu, skrytých prvkov a farieb. Najprv to, čo existuje (D-098): fork má bridge správu `APPLY_LENS mode=unisolate` (`aimLens.ts`: `releaseIsolation` uvoľní kanál izolácie alebo ghost, ak ho drží chat; AIM lens s farbami nechá), host ju dnes posielal len spolu so `SHOW_ALL` pri `show_all`. Fork sa preto nemení, patch netreba. Rozhodnutie (D-114, parameter existujúceho toolu): nová hodnota `action=clear_isolation` (bez filtrov) pošle op `clear_isolation::`, ktorý host preloží len na `APPLY_LENS unisolate`. Obmedzenie: ruší izoláciu a X-ray, ktoré nastavil chat (`isolate`, `xray`); ručne zapnutý duch alebo izolácia používateľa ostanú, kanál nepatrí chatu. Zavrhnuté: nová bridge správa vo forku (duplikuje `unisolate`), `scope` pri `show_all` (menil by význam existujúcej akcie).

---

---

### D-146 - Posun panela vlastností z chatu (`set_view_mode panel_scroll`) a opravená cesta k riadku Qto (#183)

**Dátum:** 2026-10-22 · **Issue:** #183 · **Nadväzuje na:** D-113, D-114, D-127, D-098

**Kontext:** Samuel overil naživo (komentáre z 22. 10. 12:14 UTC): `show_in_3d(SL02.01.0044, select=true,
panel_section=quantities, highlight=Qto_ColumnBaseQuantities.NetVolume)` vráti `property_focus.found=true`, ale panel
sa neposunie na riadok NetVolume, ostane pod viditeľnou časťou. Druhá požiadavka: Claude má vedieť panel vlastností
posunúť na pokyn ("posuň dole", "hore", "na začiatok"), aby sa používateľ dostal ku každej sekcii bez myši.

**Overenie existujúceho (D-098, D-114):** `highlight` na `Qto_*` už funguje od D-127 (nie je to chýbajúca schopnosť, ako
tvrdil prvý komentár k issue): fork nájde riadok, rozbalí sadu a označí ho. Chyba bola v posune. Najbližšie tooly:
`show_in_3d` (výber + `highlight`, rieši riadok, nie voľný posun) a `set_view_mode` (panely D-127: otvoriť, zavrieť,
stav; posun nemá). Pole `panels` vo `view_state` stav posunu nenesie.

**Príčina (fork `aim/aimPanelView.ts`):** riadok sa po nájdení posúval jednorazovým plynulým `scrollIntoView`. Panel po
výbere prvku dokresľuje obsah nad riadkom (atribúty, sady zdedené z typu, rozbalenie sady Qto), takže sa riadok po
dopočítaní cieľa posunul pod viditeľnú časť a nikto ho znova nevycentroval. `scrollIntoView` navyše posúva všetkých
skrolovacích predkov, nie len kontajner panela. Živo to nebolo možné reprodukovať (bez produkčných modelov, D-135).

**Rozhodnutie:**
1. **Oprava (fork):** `revealRow` (`aimPanelScroll.ts`) vycentruje riadok v skrolovacom kontajneri panela a 3 s ho
   sleduje: keď po ustálení skrolovania riadok vypadne z výrezu (rezerva 10 %), vycentruje ho znova bez animácie.
   Skončí pri koliesku, dotyku, klávese, kliku alebo novom výbere. `scrollIntoView` zo `aimPanelView.ts` odišiel.
2. **Posun na pokyn = parameter existujúceho toolu (D-114 bod 3), nový tool nie:** `set_view_mode panel_scroll=up|down|
   top|bottom` -> op `panel_scroll:<smer>:` -> správa mosta `SCROLL_PANEL { direction }`. `up` / `down` posunú o 80 %
   výšky okna panela, `top` / `bottom` na začiatok / koniec. Funguje aj bez `mode`; s `panels={properties:'open'}` sa panel
   najprv otvorí (posun ide po paneloch). Posúva sa len panel vlastností (IFC obsah, D-127); iné panely nie.
3. **Hranice:** hodnotu posunu viewer nevracia (host nevie, či je panel na konci); pri zatvorenom paneli príde problém
   `SCROLL_PANEL: panel vlastností nie je otvorený` v `APPLIED`. Pokyn zruší prebiehajúce sledovanie riadka.

**Zavrhnuté rozšírenie: `show_in_3d` - prečo nie:** voľný posun nemá s výberom prvku nič spoločné a `show_in_3d` bez
`ids_or_refs` nedáva zmysel; `highlight` už riadok vycentruje. **Zavrhnutý nový tool `scroll_panel`:** `set_view_mode`
už nesie panely a rozlišovací parameter stačí (D-114).

**Zavrhnuté:** *posun cez `scrollIntoView` na prvý riadok sekcie* (neumožní "o kus ďalej"); *systémový prompt* (MCP
inštrukcie sú tesne pod stropom 15 000 znakov, pokyn je v opise toolu).

**Dôsledky:** bez migrácie a env. Fork vetva (PR do ifc-lite): nový `aimPanelScroll.ts`, `aimPanelScrollPlan.ts`, správa
`SCROLL_PANEL`; poradie zlúčenia fork, potom AIMviewer. Inventár `MCP-TOOLS.md` obnovený. **Evaly (D-057):** v cloud session
nepobežali (bez Supabase kľúčov); otázka `panel-scroll-down` je v `eval/questions.json`. **Testy:** vitest (`view-plan`,
`select-panel`), fork `aimPanelScrollPlan.test.ts` s mutačnými dôkazmi.

---

### D-148 - `open_list run=true`: zoznam sa po otvorení rovno spustí a odpoveď toolu povie, či beží

**Dátum:** 2026-10-22 · **Issue:** #248 (nadväzuje na #185) · **Fork PR:** Menezeris/ifc-lite (balík s #123) · **Nadväzuje na:** D-098, D-101, D-111, D-114, D-141

**Kontext:** `open_list` otvoril panel Lists v builderi a Run musel stlačiť človek. Samuel: zoznamy sú podstatné, výsledok má byť vidieť hneď. Spustenie tabuľky je `handleExecuteList` v upstream `ListPanel.tsx` (lokálny stav panela), zvonka sa nedá zavolať.

**Najbližšie tooly (D-114):** `open_list` (rozšírime), `style_in_3d` (jeho `APPLIED` nesie súhrn Lens, rovnaká cesta potvrdenia), `set_view_mode panels` (len otvára panely, nespúšťa). Nový tool netreba.

**Rozhodnutie:**
1. `open_list` dostane parameter `run` (boolean, default false). Op `list` nesie príznak `r`, bridge správa `OPEN_LIST` pole `run`.
2. Fork: logika v `aim/aimListRun.ts` a hook `useAimListAutoRun`, v upstream `ListPanel.tsx` jediný riadok v AIM-FORK bloku, ktorý hook zavolá s existujúcim `handleExecuteList`. Žiadna kópia upstream kódu.
3. Potvrdenie: `APPLIED.state.list` = `{name, status: running|done|failed|opened|not_started, rows?, error?, reason?}`. `appliedText` z toho pridá vetu: tabuľka beží alebo hotová (počet riadkov), alebo prečo nie (nie je načítaný model, chyba výpočtu, panel sa nezobrazil, výpočet ešte beží).
4. Bez `run` sa správanie nemení; `state.list.status` je vtedy `opened`.

**Zavrhnuté rozšírenie:** nový tool `run_list` - dva volania namiesto jedného a zbytočný ďalší tool v konektore (D-114). `set_view_mode panels` - otvára len panel, nevie spustiť tabuľku.

**Poradie nasadenia:** najprv fork, potom AIMviewer. Starší fork pole `run` ignoruje: `APPLIED` nemá `state.list` a text toolu povie, že spustenie sa nepotvrdilo.

**Otvorené:** živé overenie na teste modeli forku a plné CI forku v cloud session nepobežali; evaly (D-057) tiež nie (opis toolu sa zmenil), otázka je v `eval/questions.json`.

---

### D-153 - Načítanie toolov konektora v klientovi: blok v inštrukciách, `anthropic/alwaysLoad`, nastavenie Tool access

**Dátum:** 2026-10-22 · **Issue:** #237 · **Nadväzuje na:** D-079, D-102, D-114, D-115

**Kontext:** v hlasovej session v Claude (claude.ai, mobil) tooly konektora AIM opakovane vypadávajú z načítanej sady a model ich musí znova načítať cez `tool_search`, často viackrát za úlohu. Konektor má 29 toolov, `tools/list` 69 900 znakov (opisy 28 300, najväčší `style_in_3d` 10 700) a inštrukcie 14 900 znakov. O načítaní toolov inštrukcie nehovorili a mená toolov boli až hlboko v texte.

**Zistenia (zdroje, stav 2026-10-22):**
- claude.ai, Desktop a mobil majú pre konverzáciu nastavenie **Tool access** (`+` alebo `/` -> Connectors -> Tool access): *Auto* (predvolené, Claude sám rozhoduje, ktoré konektory načíta), *On demand* (konektor sa načíta až po vyhľadaní) a *Always available* (všetky konektory sa načítajú na začiatku konverzácie). Prístup sa dá podľa FAQ nastaviť aj pre jeden konektor. Je to jediný zdokumentovaný spôsob, ako vynútiť celú sadu ([support.claude.com 13730515](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access)). Prah režimu Auto zdokumentovaný nie je.
- API tool search (`defer_loading`): nájdený tool ostáva načítaný, kým je v histórii blok s výsledkom vyhľadávania ([tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)). **Hypotéza:** keď klient dlhú históriu zhutní alebo oreže, blok zmizne a tool s ním. To sedí s príznakom. Podobné hlásenia: anthropics/claude-code#77083 (po zhutnení na claude.ai ostanú len tooly z posledného `tool_search`) a #77312 (hlasový režim, "stale tool schema"); bez odpovede Anthropicu.
- Claude Code dokumentuje `_meta["anthropic/alwaysLoad"]: true` na toole (načíta sa hneď) a pri odložených tooloch načíta na začiatku len mená a serverové inštrukcie. Tie oreže na 4096 znakov ([code.claude.com MCP](https://code.claude.com/docs/en/mcp)); orezané inštrukcie AIM sú v Claude Code naozaj vidieť. Pre claude.ai a aplikácie nie je `alwaysLoad` ani orez zdokumentovaný (hypotéza, že platí rovnako).

**Rozhodnutie:**
1. **Platforma (len zistenie):** skutočná oprava je nastavenie Tool access *Always available* (alebo pre konektor AIM) v Claude. Orezávanie po zhutnení a správanie hlasového režimu sú na Anthropicu, konektor ich nezmení.
2. **Blok o načítaní na začiatku inštrukcií** (`lib/mcp/tool-loading.ts`, `mcpServerInstructions`): pokyn načítať na začiatku session celú sadu naraz a pri chýbajúcom toole znova celú sadu, nie po jednom, plus mená všetkých toolov po skupinách (generované z `mcpToolGroups`). Blok má do 1000 znakov (dnes 792). Test overí, že je na začiatku a všetky mená sú v prvých 4096 znakoch. Doménové inštrukcie `mcpInstructions` sa nemenia (rozpočet 15 000 znakov z D-102 platí pre ne, celé inštrukcie majú 15 700).
3. **`_meta: {"anthropic/alwaysLoad": true}`** na 5 malých jadrových tooloch: `get_object`, `search_objects`, `show_in_3d`, `get_viewer_state`, `set_view_mode` (`ALWAYS_LOAD_TOOLS`). `ToolDefinition.meta` posiela len MCP `tools/list`, chat `/api/ask` nie. V `MCP-TOOLS.md` majú značku "vždy načítaný".

**Zavrhnuté / odložené:**
- *Skrátenie opisov toolov teraz:* veľký zásah s rizikom pre výber toolu (D-101, D-102), vyžaduje evaly. Merania vyššie sú baseline; ďalší krok, ak Tool access nestačí.
- *Ďalšie zlučovanie toolov:* D-115 už zlúčilo 52 na 29; menej toolov oneskorenie nevyrieši, kým klient odkladá celé konektory.
- *Viac toolov s `alwaysLoad`:* odporúčanie Anthropicu je 3-5 vždy načítaných; väčšie tooly (`style_in_3d`) by zaťažili každý rozhovor.

**Overenie:** `lib/mcp/tool-loading.test.ts` (blok, orez 4096, opisy pod 4096, `_meta` v `tools/list`). Evaly (D-057) sa na to nehodia, hlasovú session nejde otestovať automaticky. Ručne (Samuel): Tool access *Always available*, hlasová session s viacerými krokmi a sledovať, či treba znova `tool_search`.

### D-155 - `ifc_measure`: jedna os, kresba svetlého otvoru a vzdialenosť dvoch plôch

**Dátum:** 2026-10-22 · **Issue:** #236 · **Nadväzuje na:** D-084, D-112, D-114, D-118, D-124

**Kontext:** používateľ chcel zmerať len šírku dverí medzi lícami zárubne a vidieť jednu kótu. `ifc_measure` s `a` a `show=true` kreslí tri hrany obálky (X, Y, Z), `clear_opening` vráti šírku a výšku, ale nič nenakreslí, a `a + b` meria najbližšie body celých prvkov, nie zvolené plochy.

**Zistenie:** `ifc_measure` počíta celé na hoste (headless tesselácia `@ifc-lite/geometry` z IFC bajtov, `lib/engine/measure.ts`), viewer len kreslí úseky cez wire `measure:` -> `MEASURE_SHOW` (D-124). Všetko ide bez forku (D-087 sa neuplatní, fork sa nemení).

**Rozhodnutie (D-114: parametre existujúceho toolu, nie nový tool):**
1. **`axis`** = `x|y|z` (hrana obálky v osiach IFC sveta) alebo `width|depth|height` (osi prvku): len pri samotnom `a`, `show=true` nakreslí jednu kótu, výsledok `axis.length_m`.
2. **`clear_opening` + `show=true`** nakreslí šírku (vzorka najbližšie k mediánu výšok, na najužšej hĺbke) a výšku (stredný stĺpec) každých dverí, najviac 12 kót = 6 dverí (limit mosta); nad limit to výsledok povie (`view_note`).
3. **`face_a` + `face_b`** = `+x|-x|+y|-y|+z|-z`: kolmá vzdialenosť dvoch rovnobežných plôch na prvku `a` (bez `b`) alebo `a` a `b`, v osiach prvku `a`. Plocha = trojuholníky s normálou do 2° od osi, zlúčené do rovín (1 mm). Plochy oproti sebe (normála a mieri k b a naopak) = najbližšia dvojica s prekrytím v priemete a medzerou aspoň 5 mm (svetlá medzera, líca zárubne, prah k nadpražiu); odvrátené alebo rovnakým smerom = najväčšie plochy (hrúbka steny). Pri `IfcDoor` sa výplň otvoru (krídlo, sklo, kovanie) vynechá pravidlami svetlého otvoru (`doorLayout`), inak by hrana krídla bola falošná plocha. Kóta v strede prekrytia plôch. Nerovnobežné alebo chýbajúce plochy = chyba s návodom, nie odhad.
4. **Osi prvku** = obdĺžnik s najmenšou plochou v pôdoryse (ako D-118): x = dlhšia strana (width) otočená k +X sveta (pri zvislej k +Y), y = x otočené o 90° doľava, z = hore. Pri `b` platia osi `a`, aby "+x" znamenalo pre oba prvky to isté.

**Zavrhnuté:** nový tool (D-114, rozšírenie stačí); výber plochy klikom vo vieweri teraz (potreboval by fork a nový most, D-087; neskôr); osi z `IfcObjectPlacement` teraz (presnejšie pri šikmých a okrúhlych prvkoch, ale pôdorysný obdĺžnik pokrýva steny, dvere, stĺpy a nosníky; neskôr).

**Overenie:** `lib/engine/measure-faces.test.ts` (osi otočenej steny, jedna os, hrúbka steny, líca zárubne v oboch poradiach bez krídla a kľučky, svetlá výška s prahom, dva prvky, chyby vstupu, kóty svetlého otvoru, motor na mini modeli s `show`). Evaly (D-057) v cloud session bez Supabase kľúčov nepobežali; otázka `measure-door-lining-faces` v `eval/questions.json`.

### D-156 - Hranice priestorov (`IfcRelSpaceBoundary`): `rel_space_boundary` a `v_space_elements` s `relation = 'boundary'`

**Dátum:** 2026-10-22 · **Issue:** #245 · **Nadväzuje na:** D-080, D-098, D-114, D-126

**Kontext:** `query_view v_space_elements` pre lobby 1.01 vrátil 5 dverí, ale otáčavé dvere DD01.08.0001 chýbali. V IFC ležia na podlaží 1NP (`IfcRelContainedInSpatialStructure`) a s miestnosťou ich spája len `IfcRelSpaceBoundary1stLevel`. Dotaz "dvere miestnosti" tak mlčky dal nesprávne "nie je spojené" a opis toolu nepovedal, ktoré vzťahy pohľad pokrýva.

**Zistenie (D-098, najprv existujúce):**
- **ETL hranice nikde neukladalo.** V `etl/` ani v migráciách nie je `IfcRelSpaceBoundary` ani tabuľka či view na hranice (`relationship_types` ich nemá). Nejde teda o zlý postup modelu a nestačí zmeniť pohľad: dáta v DB chýbajú (D-114 bod 2, "ETL ich zahadzuje" = malé a jasné, riešime v kóde).
- `ifc_relations` (motor, D-097) hranice číta zo súboru, takže model ich nesie. Je to kontrola úplnosti, nie náhrada pohľadu: nad ním nejde filtrovať ani stránkovať ako nad `v_space_elements`.

**Najbližšie tooly (D-114):** `query_view` (rozširujeme: nová hodnota `relation` v pohľade a nová tabuľka v whiteliste), `list_relations` (dostane `rel_space_boundary` vo whiteliste), `ifc_relations` (zostáva na úplnosť zo súboru). Nový tool netreba.

**Rozhodnutie:**
1. **ETL** (`etl/transform.py` `_collect_space_boundaries`): každá `IfcRelSpaceBoundary` (aj 1st/2nd level) medzi emitnutým prvkom (asset) a emitnutým priestorom je hrana `space_boundary` -> `rel_space_boundary`, smer prvok (from) -> priestor (to). Jedna hrana na pár (prvok, priestor), lebo IFC má na pár často viac hraníc (každá plocha, obe úrovne). `role` = `PhysicalOrVirtualBoundary` malými písmenami (`physical`, `virtual`, `notdefined`); pri viacerých hraniciach jedného páru vyhráva `physical`. Level a Internal/External sa neukladajú (dostupné cez `ifc_relations`). Hrany bez emitnutého konca vypadnú, žiadne dangling hrany. Federate režim priestory neemituje, hranice sa tam preskočia.
2. **DB** (migrácia `20261022180000_space_boundary.sql`, aditívna): nový `rel_type` v `relationship_types` (from `asset`, to `space`, `IfcRelSpaceBoundary`), view `rel_space_boundary`, čiastočné indexy po `to_id` a `from_id`, `revoke` pre anon/authenticated (D-079) a `CREATE OR REPLACE VIEW v_space_elements` s treťou vetvou `relation = 'boundary'` (`role` physical|virtual). Stĺpce a ich poradie sa nemenia, pribúdajú len riadky.
3. **Bez duplicít:** pár (priestor, prvok) sa vypíše raz, s prednosťou `contained` > `referenced` > `boundary`. Hranica sa pridá len vtedy, keď pre ten pár neexistuje aktívny containment ani referencia. Prvok, ktorý je v miestnosti aj ju ohraničuje, ostáva ako doteraz.
4. **Tool:** `query_view` a `list_relations` majú `rel_space_boundary` vo whiteliste (aj pre `related`); opis `query_view` vymenúva `contained|referenced|boundary`, ich význam a vetu, že pohľad nepokrýva všetky vzťahy zo súboru a úplnosť dá `ifc_relations`. Pokyn v `system-prompt.ts` pri otázke "čo je v miestnosti".

**Zavrhnuté:**
- *Len opis toolu bez zmeny dát* (druhá možnosť z issue): dvere by ostali neviditeľné vo filtroch a stránkovaní, opis len prizná chybu.
- *Nový tool* `room_doors` alebo podobný: rozšírenie `query_view` stačí (D-114).
- *Boundary riadky popri contained/referenced pre ten istý pár:* duplicity (rovnaký prvok dvakrát v počte aj zozname), volajúci by ich musel zlučovať.
- *Hrana per plocha so všetkými atribútmi (level, internal/external, geometria hranice):* v IFC býva desiatky na miestnosť, nepoužiteľné pre otázky "ktoré dvere", detail ostáva v `ifc_relations`.

**Poradie nasadenia (produkcia):** 1. migrácia `20261022180000_space_boundary.sql` (pohľad aj bez dát funguje ako doteraz, nič sa nerozbije), 2. re-ETL (workflow `reetl` v Menezeris/OCB, najprv `dry_run`), lebo hrany plní až ETL. Bez re-ETL `boundary` riadky nevzniknú.

**Overenie:** `etl/tests/test_space_boundary.py` (mini IFC: jeden riadok na pár, physical vyhráva, bez emitnutého konca vypadne, manifest), `supabase/tests/space_boundary.sql` (syntetické dáta na lokálnej DB po migráciách: len hranica, contained aj hranica, referenced aj hranica, ukončená hranica, dvere medzi dvoma miestnosťami, odmietnutie hranice na podlažie; pred migráciou zlyhá, po nej prejde), `lib/llm/query-view.test.ts`. Evaly (D-057) v cloud session bez Supabase kľúčov nepobežali; otázka `doors-in-space-101-boundary` je v `eval/questions.json` ako neoverená.

---

### D-136 - Dlaždicové rozloženie viewera: krok 1 je pôvodný 2D výkres rezu, viac 3D pohľadov je otázka renderera
**Status:** krok 1 rozhodnutý (2026-10-22, session z konektora, číslo rezervované v registri #60); krok 2
(dlaždice s viacerými 3D pohľadmi) čaká na Samuela. Issue #210. Nadväzuje na D-072 (pôdorys s podkladom),
D-087 (most forku), D-098 (najprv existujúce funkcie), D-114 (najprv napasuj), D-127 (panely z chatu),
D-132 (záložky; bod "Otvorené" o pôdoryse bez podkladu).

**Kontext:** Samuel chcel v rozhovore "vľavo 3D, vpravo pôdorys 1NP" a ako v Revite (Tile Windows) až štyri
pohľady naraz. `set_view_mode(beside=1NP)` bez kalibrovaného podkladu vráti odmietnutie, dva 3D pohľady
nejdú a viac než dve dlaždice tiež nie. Príčina je vo vieweri: má jeden 3D canvas (WebGPU, nikdy sa
neremountuje) a jednu kameru; 3D, pôdorys bez podkladu (model zhora s rezom) a uložený pohľad sa v ňom len
striedajú. Vedľa 3D dnes môže stáť len niečo, čo nie je 3D: PDF dokument alebo PDF podklad (D-072 split).

**Rozhodnutie (krok 1):**
1. Originál ifc-lite má panel **Drawing** (`section2d`, upstream #5493): 2D výkres aktuálneho rezu
   generovaný z modelu (vektor, šrafy, bez podkladu), domov v spodnom páse, dá sa nechať plávať alebo
   vytiahnuť do okna. Je na čítanie (generovanie beží v `DrawingRuntimeHost`), nie v režime úprav modelu,
   takže rieši bod "Otvorené" z D-132.
2. **Bez nového toolu (D-114):** `set_view_mode panels` pozná `drawing` (open | close | toggle). Pôdorys
   podlažia bez podkladu pri 3D = `set_section(action=set, floor)` + `set_view_mode(panels={drawing: 'open'})`:
   hore voľné 3D (rezané na tom podlaží), dole pôdorys z modelu. Stav panela (`open`, `where`) vráti výsledok
   aj `get_viewer_state` ako pri ostatných paneloch.
3. **Most (fork, len `apps/viewer/src/aim/`):** `PANEL_KEYS` + `drawing`, mapovanie na upstream panel
   `drawing`, zatvorenie cez `setDrawing2DPanelVisible(false)`, stav zo `drawing2DPanelVisible`. Odmietnutie
   `VIEW_TABS beside` pôdorysu bez podkladu ukáže túto cestu.

**Zavrhnuté rozšírenie:**
- *Nový tool na rozloženie (návrh z issue):* rozloženie plochy je zobrazenie, to robí `set_view_mode`;
  `layout`/`tiles` by dnes nemali čo zobraziť, kým viewer nemá viac 3D pohľadov.
- *`set_view_mode layout=split_h|split_v|grid4, tiles=[...]` hneď:* parameter bez schopnosti vo vieweri by
  vracal chyby; pribudne až s krokom 2.
- *`set_camera` alebo `set_section` s dlaždicou:* majú jeden canvas, dlaždica by bola len predstieraná.

**Krok 2 (otvorené, otázka v #210):** skutočné dlaždice (2 vedľa seba, 2 nad sebou, 2x2) s viacerými 3D
pohľadmi, každý s vlastnou kamerou, rezom a farbením. Možnosti: (a) viac viewportov v jednom canvase
(scissor, jedna GPU scéna, stav kamery, rezu a farieb na dlaždicu; veľký zásah do upstream renderera a
store, vlastný kód forku pri každom sync), (b) dlaždice ako snímky (živá je jedna, ostatné obrázok
posledného stavu, klik ju urobí živou; malý zásah, záložky D-132 už stav dlaždice ukladajú), (c) návrh
upstream ifc-lite. Odporúčanie: (b) ako medzikrok, (a) len ak je pre demo nutné. `layout`/`tiles` v
`set_view_mode` pribudnú až s krokom 2.

**Evaly D-057 nepobežali** (cloud session nemá Supabase kľúče); otázka `view-3d-and-plan-no-underlay` pridaná
bez overenej hodnoty.

---

### D-157 - Dlaždice vo vieweri: jedno živé 3D, ostatné 3D dlaždice ako snímka, `set_view_mode layout`
**Status:** rozhodnuté (2026-10-22, plán schválený Samuelom cez orchestrátora; číslo rezervované v registri #60).
Issue #210, krok 2 (krok 1 = D-136). Nadväzuje na D-132 (záložky, "Vedľa"), D-072 (pôdorys s podkladom),
D-087 a D-098 (most forku, najprv existujúce), D-114 (najprv napasuj).

**Kontext:** Samuel chce ako v Revite (Tile Windows) až 4 pohľady naraz, aj len dve okná vedľa seba alebo
pod sebou; pri troch oknách prepínateľne veľké vľavo, hore, dole (a symetricky vpravo), aj 3 vedľa seba alebo
pod sebou. Zistenie vo forku: renderer (`packages/renderer`, `Renderer`) má na canvas jedno zariadenie
GPU, jednu kameru, jeden rez a celý reťazec pasov (AO, EDL, prekrytia, picking) nad celým canvasom.
- *Viac viewportov v jednom canvase* (`setViewport`/`setScissorRect`, kamera, rez a farbenie na dlaždicu)
  = prepis upstream renderera a store, vlastný kód pri každom sync upstreamu.
- *Druhý `Renderer`* = druhé zariadenie a druhé nahratie geometrie (pamäť GPU dvakrát pri produkčnom modeli).
- Záložky D-132 už pri prepnutí ukladajú kameru, rez a zámok každej 3D záložky, takže stačí presúvať jeden
  canvas a ostatným 3D dlaždiciam ukázať posledný obraz.

**Rozhodnutie:**
1. **Rozloženia** (`aim/viewTilesPlan.ts`): `single`, `split_h` (2 vedľa seba), `split_v` (2 pod sebou),
   `three_left` / `three_right` / `three_top` / `three_bottom` (3 okná, dlaždica 0 je veľká na danej strane;
   "2 hore a 1 veľké dole" = `three_bottom`), `three_h`, `three_v` (3 vedľa seba / pod sebou), `grid4` (2x2).
   Každá dlaždica ukazuje jednu otvorenú záložku, záložka je najviac v jednej dlaždici, dlaždica môže byť prázdna.
2. **Jedno živé 3D:** 3D záložka (3D, pôdorys, uložený pohľad) v dlaždici so živým canvasom je živá; jediný
   WebGPU canvas sa nikdy neremountuje, `useAimCenterPanes` ho len posunie do obdĺžnika živej dlaždice (pod jej
   hlavičku). Ostatné 3D dlaždice ukazujú snímku (`aim/tileShots.ts`: synchrónna kópia posledného zobrazeného
   snímku canvasu do 2D canvasu, max 1600 px, pri odchode záložky z canvasu); klik ich urobí živými a
   doterajšia živá si nechá snímku. 3D dlaždica bez snímky (napr. pôdorys, ktorý ešte nebol v canvase) sa po
   nastavení rozloženia raz ukáže v canvase a odfotí (`prerender`, most naň počká pred `APPLIED`); zásah
   používateľa beh preruší.
3. **Dokument** je v dlaždici vždy živý (vlastný `PdfDocumentView`/`ImageDocumentView`, aj dva rôzne naraz).
   **Pôdorys bez podkladu** je 3D záložka (model zhora s rezom 1,2 m), takže v dlaždici ide bez kalibrácie.
4. **Pravidlá:** aktivovaná záložka mimo dlaždíc nahradí prázdnu dlaždicu, potom dlaždicu rovnakého druhu
   (dokument za dokument, 3D za 3D) mimo živej, potom poslednú mimo živej; zavretá záložka uvoľní dlaždicu pre
   neukázanú otvorenú. Pri dlaždiciach nie je "Vedľa". "Vedľa" pre dvojicu, ktorú plocha bez dlaždíc nevie
   (pôdorys bez podkladu vedľa 3D, dve 3D, dva dokumenty), prepne na `split_h`; dvojice D-132 (dokument vedľa
   3D, pôdorys s podkladom D-072) ostávajú ako boli. `close_tab=all` vráti jedno okno.
5. **3D tooly** (`show_in_3d`, `style_in_3d`, `set_section`, `set_camera`) pôsobia na živú 3D dlaždicu; keď v
   rozložení 3D nie je, pôsobia na canvas pod dlaždicami (uvidí sa po prepnutí).
6. **UI:** v lište záložiek prepínač "Rozloženie" (10 možností), v hlavičke každej dlaždice výber záložky
   ("(prázdna)" ju vyprázdni), aktívna dlaždica má zvýraznený okraj, 3D dlaždica hovorí "živé 3D" / "snímka".
7. **Chat (D-114, bez nového toolu):** `set_view_mode layout=<rozloženie>` a `tiles=[...]` (najviac 4, prvá
   je veľká). Podlažie (`1NP`, aj "Pôdorys 1NP") host preloží na GUID a viewer pôdorys otvorí sám; ostatné sú
   menovky otvorených záložiek ('3D', pohľad, dokument), 'none' = prázdna; chýbajúce dlaždice doplní viewer
   (doterajšie, aktívna, ostatné v poradí lišty). Len `tiles` bez `layout` = rozloženie podľa počtu (2 = vedľa
   seba, 3 = veľká vľavo, 4 = 2x2). `layout` sa nekombinuje s `mode`, `view`, `reset`, `tab`, `beside`,
   `close_tab` (panely áno). Wire `tab:layout:<base64url>` -> `VIEW_TABS {action: 'layout', layout, tiles}`
   (`{tab}` | `{plan}` | null), overenie v `aim/tiles-protocol.ts`.
8. **Stav:** `view_state.layout` = `{kind, tiles: [{index, tab, label, kind, live}], live_tab}` (pri jednom
   okne `{kind: 'single'}`), popri `view_state.tabs`.

**Výkon:** snímka je kópia v pamäti (bez ďalšieho renderu, pár MB pri 4 dlaždiciach); menšia živá dlaždica =
menší drawing buffer, render skôr zlacnie; predrenderovanie len pre 3D dlaždice bez snímky (pri pôdoryse
s animáciou kamery cca 0,5 až 1 s na dlaždicu); vstupný chunk viewera nerastie (mriežka, logika a protokol
dlaždíc sú lenivé, v entry len pár riadkov stavu a polohy canvasu).

**Zavrhnuté rozšírenie:**
- *Nový tool `set_layout`:* rozloženie plochy je zobrazenie záložiek, to robí `set_view_mode` (D-114).
- *Viac viewportov alebo druhý renderer:* pozri Kontext; skutočne živé viac 3D naraz je námet pre upstream
  ifc-lite, nie pre fork.
- *Pôdorys v dlaždici ako SVG z generátora `drawing-2d`:* generátor vo vieweri je naviazaný na jeden rez
  (`sectionPlane`, jeden `drawing2D`); pôdorys ako 3D záložka so snímkou je hneď k dispozícii a rovnaký ako
  záložka pôdorysu. SVG dlaždica (živý 2D bez prepnutia) je ďalší krok, ak bude treba.

**Neskôr:** synchronizácia výberu medzi dlaždicami (klik v pôdoryse vyberie prvok v 3D je dnes v živej
dlaždici), vytiahnutie dlaždice na druhý monitor (#210, mimo rozsahu), dlaždice na mobile (lišta záložiek tam
nie je).

**Overenie:** fork `aim/viewTilesPlan.test.ts` (rozloženia, priradenie, pravidlá, stav), host
`lib/viewer-tabs.test.ts` (wire, `planLayout`), inventár `MCP-TOOLS.md`. **Evaly D-057 nepobežali** (cloud
session nemá Supabase kľúče); otázka `view-tiles-four` pridaná a `view-3d-and-plan-no-underlay` (D-136) prepnutá na `layout`, obe bez overenej hodnoty.

---

### D-158 - Pripomienky na dokumentoch: BCF téma s odkazom na dokument, stranu a oblasť strany

**Dátum:** 2026-10-22 · **Stav:** krok 1 schválený (orchestrátor 22. 10., Samuel 22. 10. "áno, riešiť" v #199) · **Issue:** #199 · **Nadväzuje na:** D-099 (BCF témy v `model_tasks`), D-104 (dokumenty z IFC), D-114 (rozšírenie namiesto nového toolu), D-117 (`open_drawing region`), D-123, D-130, D-133

**Kontext:** #199 chce jednotné pripomienky: téma založená nad dokumentom PDF (strana, oblasť), prepojená s IFC entitami až po IfcProject, v jednom zozname s 3D témami, BCF 2.1/3.0 ako export a import, nie zdroj pravdy. Dnes (overené 22. 10.): nositeľ témy je riadok `model_tasks` (D-099) s `components` (IFC GlobalId) a `viewpoint`; tooly `bcf_topic` a `bcf_topic_list`, BCF API `/api/bcf` (čítanie bez tokenu, zápis s tokenom; témy sa podľa dodatku D-099 zakladajú v chate). Väzbu témy na dokument, stranu ani oblasť nemá nič; výrez strany pozná len `open_drawing region` (D-117). Dokument je `objects` + `documents` (D-104), strany v `document_pages`; hash súboru dokumentu sa neukladá.

**Najbližšie tooly (D-114):** `bcf_topic` (rozširujeme: parameter `document`, `remove_document`), `bcf_topic_list` (filter `document` a `page`, odkazy v detaile), `open_drawing` (ukáže miesto, bez zmeny). Nový tool netreba.

**Rozhodnutie:**
1. **Nositeľ ostáva `model_tasks`** (D-099 zavrhol druhú tabuľku tém). Pripomienka na dokumente je BCF téma ako každá iná, v tom istom zozname.
2. **Odkaz na dokument = podriadená tabuľka `model_task_documents`** (migrácia `20261022190000`, SCHEMA §2.14), 1:N k téme, jeden riadok = BCF DocumentReference: `document_id` (objects, `on delete set null`) so snímkou `document_ref`, `document_name`, `document_revision` z času založenia (téma prežije re-ETL a novú revíziu dokumentu sa nepresťahuje potichu), `page`, `region` = výrez v % `{x, y, width, height}` vľavo hore ako `open_drawing region` (null = celá strana), `markup` (tvary, zatiaľ prázdne), `url` (cudzí odkaz z importu), `description`, `author`. Strop 20 odkazov na tému.
3. **IFC entity ostávajú v `components`** (jediný nositeľ väzby na IFC). "Celý projekt" je GlobalId IfcProject, miestnosť a podlažie ich GlobalId; tabuľka `issue_entity` z návrhu v issue by bola druhý nositeľ tej istej väzby.
4. **Chat:** `bcf_topic` `create`/`update` s `document = {id_or_ref, page, region, description}` (objects.id, object_ref alebo jednoznačný kód `documents.identification`; odkaz na časť dokumentu D-104 vedie na jeho dokument a stranu z `Location`). Strana sa overí voči extrahovaným stranám, oblasť bez strany len pri jednostranovom dokumente, chybný dokument tému nezaloží. `remove_document` = guid odkazu alebo `all`. `bcf_topic_list` filtruje `document` (+ `page`), riadok zoznamu má počet odkazov a detail témy `documents` s pripravenými argumentmi `open_drawing`.
5. **Jeden zoznam tém (Samuel 22. 10.):** pripomienka na dokumente je v `bcf_topic_list` aj v BCF paneli viewera spolu s ostatnými témami. Upstream `fetchProjectAsBCF` DocumentReference nesťahuje, preto BCF API pridá do `description` témy blok "Dokumenty (AIM):" s kódom, revíziou, stranou a oblasťou; pri zápise z panela (PUT) sa blok odreže, v DB ostáva opis bez neho.
6. **BCF API 2.1:** `GET /topics/{guid}/document_references` (bez tokenu), `POST` a `PUT .../{guid}` (s tokenom). `url` = `<origin>/drawing/<id>?page=N&region=x_y_w_h#page=N` (`#page` podľa RFC 8118, `region` je náš parameter pre návrat), `description` = "kód (rev. X), strana N, oblasť ...: text". Vlastná adresa sa pri zápise rozloží späť na dokument, stranu a oblasť (opis bez zopakovanej hlavičky), cudzia ostane ako `url`. `document_guid` (dokumenty projektu BCF) zatiaľ nie.

**Kroky:**
- **1 (táto vetva):** migrácia, `lib/bcf/documents.ts`, úložisko, `bcf_topic`/`bcf_topic_list`, BCF API, testy. Bez forku.
- **2 (viewer, fork):** hotové podľa dodatku nižšie (tlačidlo "Pripomienka", upstream "New topic", rámiky, uloženie cez `bcf_topic from_viewer`).
- **3:** export a import `.bcfzip` 2.1 a 3.0 (`@ifc-lite/bcf`), snímka výrezu so zapáleným rámikom (pymupdf v ETL, server parser PDF nemá, D-123), `viewrect` v bodoch strany.
- **4:** s kalibráciou D-133 prepočet oblasti na IFC súradnice: návrh prvkov v oblasti a 3D pohľad nad ňou; filter zoznamu podľa nadradenej entity; sha256 súboru dokumentu v ETL ako kotva revízie.

**Dodatok D-158 (2026-10-22) - krok 2: pripomienka z viewera lokálne, do AIM ju ukladá chat** (Samuel cez orchestrátora: tlačidlo vo vieweri áno, zápis do DB z viewera nie; mení dodatok D-099 "viewer témy len ukazuje" na "viewer zakladá len lokálne, do DB ukladá chat").
1. **Fork, nadväzuje na upstream "New topic":** v lište karty dokumentu tlačidlo "Pripomienka" (`aim/AimDocumentIssue.tsx`, blok AIM-FORK v `DocumentPane.tsx`). Ťah obdĺžnika nad stranou (klik = celá strana, Esc zruší) otvorí panel BCF a stlačí jeho tlačidlo "New topic" (kotva `bcf-new-topic`); téma, ktorú upstream formulár založí (`addTopic`, `addViewpoint`), dostane BCF DocumentReference s adresou v tvare BCF API hosta (`<host>/drawing/<id>?page=N&region=x_y_w_h#page=N`) a opisom (názov, strana, oblasť). Zrušený formulár pripomienku zahodí. Téma je lokálna v pamäti panela ako každá ručne založená téma; upstream súbory BCF panela sa nemenia.
2. **Rámiky:** pripomienky na strane (z odkazov tém, uložené aj lokálne) sú rámiky s číslom (`#N` uložená, `N1...` neuložená, čiarkovaná); klik otvorí tému v paneli BCF.
3. **Chat ich uloží:** `view_state.bcf_local` (fork, lenivý `aim/docIssueModel.ts`) vypíše témy projektu AIM bez čísla z hosta (guid, polia, komentáre, pohľad v tvare BCF API bez snímky, odkazy). `get_viewer_state` z nich ukáže súhrn, `bcf_topic action=from_viewer` (+ `guids`) ich uloží do `model_tasks` s tým istým guid a odkazy do `model_task_documents` (adresa `/drawing/<id>` sa overí voči dokumentom AIM a doplní kód a revíziu, cudzia ostane ako `url`). Uložená téma sa pri ďalšom uložení preskočí ("už je uložená ako #N"). Session pre Claude sa pri uložení z viewera nespúšťa (spustí ju `bcf_topic update start_session=true`); priradenie Claudovi a session ostávajú len v chate. Dáta z viewera sú nedôveryhodné: polia sa overia a orežú (`lib/bcf/viewer-local.ts`).
4. **Obnova bez straty a duplicity:** `AIM_BCF_LOAD` po ručnej téme projekt nenechá ako "vlastný" (doteraz by sa témy z chatu prestali obnovovať): témy hosta sa nahradia, lokálne neuložené ostanú, uložená lokálna sa vráti ako kópia hosta (rovnaký guid). Projekt používateľa (súbor, iný server, iné `projectId`) sa nemení. Témam hosta s blokom "Dokumenty (AIM):" viewer dočíta `document_references`, takže aj uložené pripomienky majú rámiky a export.
5. **Export:** upstream `.bcfzip` (2.1 aj 3.0) nesie DocumentReference (2.1 `ReferencedDocument` externý, 3.0 `Url`) s opisom; test zapíše a znova načíta oba formáty.
- *Zavrhnuté:* zápis z viewera cez novú route hosta (variant A) a prihlásenie (variant B) - Samuel nechce zápis do DB mimo chatu; vlastný formulár pripomienky vo forku - upstream "New topic" už všetko má; úprava `BCFPanel.tsx` (háky) - panel je vo vstupnom chunku a stačí jeho tlačidlo.

**Doplnok D-158 (2026-10-23) - kroky 3 a 4: snímka výrezu, prepočet oblasti na model, filter podľa entity** (plán schválil orchestrátor 23. 10.; krok 3 so zmenou: render na požiadanie v hoste namiesto rastrov v ETL).
1. **Snímka výrezu = render na požiadanie v hoste, nie v ETL ani vo vieweri.** Téma s dokumentom vzniká aj v chate (`bcf_topic create document=...`), kde žiadny okamih vo vieweri nie je, a snímka z viewera by do DB musela ísť mimo chatu. ETL beží len pri re-ETL a rastre všetkých strán (napr. SF-003 má 157 strán) by zbytočne zaťažili úložisko a egress (cieľ pod 5 GB/mesiac). Preto `lib/bcf/snapshot-render.ts`: pdf.js (legacy build, verzia ako vo forku, 6.3.289) do `@napi-rs/canvas` vyrenderuje len danú stranu a výrez (oblasť s okolím 25 %, dlhšia strana 1500 px, strop mierky 8), biele pozadie, červený rámik s jemnou výplňou ako rámiky vo vieweri. Dekodéry a písma ide cez `BinaryDataFactory` zo súborov balíka (bez nich zmiznú CCITT/JBIG2 masky a text, fork #238). Licencie: pdfjs-dist Apache-2.0, @napi-rs/canvas MIT (Skia BSD-3-Clause).
2. **Keš:** bucket `documents` (verejný, tam kde sú PDF) pod `snapshots/<sha256 súboru>/<strana>-<x_y_w_h|full>.png`; ďalšia požiadavka so známym sha256 (z odkazu témy alebo z ETL) číta keš bez sťahovania PDF. Odkaz témy si pamätá `document_sha256` z času založenia: snímka starej témy ostáva pri svojej revízii, kým je v keši; inak sa vyrenderuje z aktuálneho súboru s hlavičkou `X-AIM-Revision-Changed`. PDF sa sťahuje len z verejného úložiska projektu (`isOwnStorageUrl`) a inštancia si drží posledné dva súbory 10 minút (BCF panel pýta snímky všetkých pripomienok naraz; súbežné požiadavky zdieľajú jedno stiahnutie); limit 240 snímok na IP za 10 minút (D-068).
3. **BCF API:** každý odkaz na stranu dokumentu je pohľad témy (guid odkazu) so `snapshot_type: png` a `GET .../viewpoints/<guid>/snapshot`; upstream `fetchProjectAsBCF` ho stiahne sám, takže snímku má BCF panel aj upstream export `.bcfzip` 2.1 a 3.0 (test so skutočným klientom a writerom). BCF 3.0 chce v každom pohľade kameru: s kalibráciou strany je to pohľad nad oblasťou (bod 5), bez nej kamera 3D pohľadu témy, inak náhľad zhora. Odkaz nesie RFC 8118 `#page=N&viewrect=l,t,w,h` v bodoch od ľavého horného rohu, keď je známa veľkosť strany. Detail témy v chate má `snapshot_url`. Pre neuloženú pripomienku: `GET /api/drawing/<id>/snapshot?page&region` (len čítanie, bez tokenu ako PDF).
4. **Fork (patch `aim-199-krok3-snimka.patch`):** lokálna pripomienka si snímku stiahne z tej istej adresy hosta a dostane pohľad s ňou (kamera z 3D pohľadu témy; téma bez kamery snímku nedostane, export by inak zlyhal), témy z hosta sa načítajú s `includeSnapshots: true`. Jeden renderer pre oba prípady.
5. **Prepočet oblasti na model (`lib/bcf/region-model.ts`):** kalibrácia strany z `_georef` v2 (pri viac výkresoch na strane tá, ktorej výrez oblasť obsahuje; ručná pred automatickou), rohy oblasti % -> body strany (vľavo dole) -> `affine` -> rovina (pôdorys: výška podlažia; rez: `origin + u·s + v·t`) -> IFC svet. Návrh prvkov: obálka ako predvýber, rozhodujú trojuholníky meshu IFC motora (`meshModel`, rámec ako viewer a `_georef`): pôdorys = trojuholník v pásme od podlahy po hornú hranu podlažia (dosky hore a dole nie), rez = trojuholník preťatý rovinou (pásmo 5 cm); priemet do oblasti cez SAT. IfcSpace ide medzi nadradené entity spolu s podlažím kalibrácie; otvory, zóny a priestorové uzly nie sú prvky. Pohľad: perspektíva šikmo zhora zo strany dolného okraja výkresu a orezávacia rovina pod hornou hranou podlažia (bez nej 2 m nad podlahou), pri reze kolmo na rovinu z jej prednej strany a rez v rovine.
6. **Chat (D-114, parametre existujúcich toolov):** `bcf_topic action=locate` (guid, `document_guid`) vráti kalibráciu (zdroj, medián), oblasť v IFC, návrh prvkov (počty podľa triedy, vzorka, GlobalId), priestory, podlažie a pohľad; bez `apply` nič nezapíše, `apply=components|viewpoint|all` pridá prvky k `components` (zjednotenie, `include_parents` aj podlažie a priestory) a uloží pohľad (existujúci len s `replace=true`). Bez kalibrácie strany chyba s cestou cez `calibrate_underlay`. `bcf_topic_list entity` = témy nad podlažím, priestorom, budovou, prvkom (objects.id, GlobalId, object_ref, 1NP) vrátane všetkého v ňom (`rel_aggregates`, contained a referenced, D-080) a tém s dokumentom priradeným entite alebo jej priestorom (pôdorys podlažia); `entity='projekt'` = len témy na celý projekt (IfcProject v `components`, inak by to boli všetky). Riadok nesie `match` (self, within, document), počty podľa stavu.
7. **ETL:** `etl/pdf_text.py --from-db` zapíše `document_pages.page_size` a `documents.file_sha256`. Rastre strán sa nerobia.

- *Zavrhnuté:* rastre všetkých strán v ETL (pôvodný návrh a moja prvá verzia plánu; úložisko a egress, orchestrátor 23. 10.); snímka v ETL na tému (ETL nebeží pri založení témy); snímka z canvasu viewera pri založení (téma z chatu ju nemá a do DB by šla mimo chatu); nový tool `document_issue_locate` (D-114, je to akcia nad tou istou témou); RPC na filter entity (tém je málo, filter beží nad témami budovy, strop 1000 s upozornením).
- *Otvorené:* naživo neoverené (cloud session bez produkčného viewera a modelov, D-135): render na Verceli (natívna binárka `@napi-rs/canvas` linux-x64-gnu, funkcia snímky 54 MB, BCF API 131 MB), prvá snímka po nasadení, `locate` nad skutočnými kalibráciami. Evaly (D-057) nepobežali (bez kľúčov Supabase).

**Poradie nasadenia (kroky 3 a 4):** migrácia `20261023140000_document_sha256.sql` (aditívna: dva stĺpce sha256 a `document_pages.page_size`), potom host, potom re-ETL `python -m etl.pdf_text --from-db` (sha256 a veľkosti strán; zapisuje do DB, spúšťa orchestrátor). Bez re-ETL snímka funguje (sha256 sa spočíta zo stiahnutého PDF, keš sa naplní pri prvej požiadavke), len odkaz nemá `viewrect`. Fork patch kroku 3 po kroku 2 (#141); starší fork snímky z hosta len nesťahuje. Zápis v produkcii robí len route snímky do bucketu `documents/snapshots/`.

**Overenie (kroky 3 a 4):** `lib/bcf/snapshot.test.ts` (plán výrezu, kľúč keše, viewrect, render pdf.js v Node nad syntetickým PDF: rámik, text cez štandardné písmo, sivá výplň, keš a revízia, zdroj PDF), `snapshot-api.test.ts` (pohľady dokumentov, kamera, chyba renderu, viewrect tam a späť), `api.client.test.ts` (upstream klient stiahne snímku, writer 2.1 aj 3.0 ju zapíše a reader vráti), `region-model.test.ts` a `locate.test.ts` (affine, rez, výber kalibrácie, výber prvkov vrátane šikmej steny mimo oblasti, pohľad, locate a apply, filter entity), `etl/tests/test_pdf_text_sha.py`, `supabase/tests/document_sha256.sql` (lokálna DB po všetkých migráciách; mutácia kontroly sha256 test chytí). Celá sada vitest 704+, `next build` prejde, trasovanie funkcií obsahuje písma, CMapy, wasm dekodéry a natívny canvas.

**Zavrhnuté:**
- *Stĺpec `documents jsonb` na `model_tasks`:* filter "pripomienky na tomto dokumente a strane" by išiel cez GIN nad poľom a BCF API potrebuje stabilný guid každého odkazu na PUT.
- *Nová tabuľka `issues` podľa návrhu v issue:* druhý nositeľ témy vedľa `model_tasks` (zavrhnuté už v D-099).
- *Nový tool `document_issue`:* tá istá téma a ten istý zápis ako `bcf_topic` (D-114).
- *Pravidlo v inštrukciách konektora:* strop dĺžky inštrukcií (15 000 znakov) je takmer plný; postup nesie opis `bcf_topic`.

**Poradie nasadenia (produkcia):** len migrácia `20261022190000_bcf_topic_documents.sql` (aditívna, nová tabuľka). Bez nej zápis s `document` a `document_references` vráti chybu DB, ostatné BCF tooly fungujú ako doteraz. Re-ETL netreba.

**Overenie:** `lib/bcf/documents.test.ts` (argument, oblasť, strany, DocumentReference tam a späť, chat create/update/remove/list s filtrom, strop, BCF API s tokenom aj bez; mutácie filtra a návratu opisu testy chytia), `supabase/tests/bcf_topic_documents.sql` (lokálna DB po všetkých migráciách: filter dokument a strana, kontroly, zánik dokumentu nechá snímku, zmazanie témy zmaže odkazy, práva anon/authenticated). Evaly (D-057) v cloud session bez Supabase kľúčov nepobežali; zmena je len v opise a parametroch `bcf_topic` a `bcf_topic_list`, inventár `MCP-TOOLS.md` obnovený.

---


---

### D-150 - Všetky panely UI v `set_view_mode panels`, zoznam odvodený z forku, posun na položku a zoom panelu (#179)

**Dátum:** 2026-10-22 · **Issue:** #179 (overenie "vrátené" z 22. 10. 05:44 UTC) · **Nadväzuje na:** D-127 (panely z chatu),
D-146 (posun panela vlastností), D-114, D-098, D-091, D-087 · **Mimo rozsahu:** panel Lists (maximalizácia a úpravy zoznamu rieši D-149)

**Kontext:** D-127 pustil do `panels` šesť panelov (lens, properties, underlays, documents, lists, model_tree). Samuel overil
naživo, že funguje open a close, ale chýba panel BCF topics (v UI Alt+3), v UI sú ďalšie panely, o ktorých chat nevie, a nedá sa
posunúť obsah otvoreného panela ani ho priblížiť, aby chat ukázal konkrétne miesto.

**Overenie existujúceho (D-098, D-114):** najbližšie tooly sú `set_view_mode` (UI akcia pohľadu, nesie `panels` a `panel_scroll`),
`get_viewer_state` (čítanie, nesie `view_state.panels`) a `show_in_3d` (výber a `highlight` riadku vlastnosti). Upstream registra
panelov `WORKSPACE_PANELS` je jediný zdroj panelov rail-u, skratiek Alt+N a hostov (sidebar, plávajúce okno, spodný pás), všetky
cez `renderPanelBody`. `showWorkspacePanel` a príznaky spodného pásu (`bottom-panels.ts`) otvárajú a zatvárajú ľubovoľný z nich.
Nič z toho nebolo treba vymýšľať, fork to len sprístupní.

**Rozhodnutie:**
1. **Zoznam panelov z registra, nie z ručného zoznamu (fork):** `aim/aimPanelList.ts` odvodí mená z `WORKSPACE_PANELS`. Meno na
   drôte je id panela (`bcf`, `compare`, `validation`, `clash`, `script`, `zones`...), výnimky sú dve historické z D-127
   (`underlays` = `drawing-underlay`, `model_tree` = `hierarchy`). Skratka Alt+N je podľa poradia v registri (prvých desať), ako
   v `ActivityBar`. Test `aimPanelList.test.ts` stráži, že každý panel registra má meno, je jedinečné a je vo `view_state`;
   nový panel v UI sa tak objaví sám a ak by sa zoznam rozišiel s registrom, test padne.
2. **`SET_PANELS` pre všetky panely:** otvorenie ide cez `showWorkspacePanel` (ako rail), zatvorenie podľa domova: spodný pás
   vypne svoj príznak, dolná polovica splitu sa uvoľní, panel s príznakom v pravom stĺpci príznak vypne a stĺpec sa vráti na
   ďalší alebo na vlastnosti, panel bez príznaka vráti stĺpec na vlastnosti (ako krížik). Vlastnosti sa pri `all=close`
   zatvárajú ako posledné, inak by ich vrátil zatvorený susedný panel. Neznáme meno už nezahodí celú správu: viewer ho nahlási v
   `APPLIED` so zoznamom platných mien a vykoná ostatné.
3. **Host:** `panels` prijme ľubovoľné meno v tvare identifikátora (existenciu posudzuje viewer, zoznam má jeden zdroj, fork).
   Opis toolu uvádza bežné panely a odkazuje na `get_viewer_state` (panels). `view_state.panels` nesie každý panel registra s
   `open`, `where`, `home` (side, bottom, left) a `shortcut` a výsledok po každom príkaze to isté.
4. **Posun obsahu ľubovoľného panela (zovšeobecnenie D-146, nie duplikát):** `panel_scroll` ostáva reťazec (up, down, top,
   bottom, panel vlastností) a pribudol objekt `{panel?, to | item | percent}`: `item` = text položky (hľadá sa v rozbalenom
   obsahu, bez diakritiky a veľkosti písmen, položku vycentruje rovnaký `revealRow` z D-146), `percent` = poloha 0 až 100. Správa
   `SCROLL_PANEL` dostala `panel`, `item`, `percent` (práve jedno z `direction`, `item`, `percent`). Obsah panela sa nájde cez značku
   `data-aim-panel` na obálke v `renderPanelBody` (blok AIM-FORK, `display: contents`, bez vplyvu na rozloženie).
5. **Zoom panela:** nový parameter `panel_zoom = {panel?, zoom: in | out | reset | 0,5 až 2,5}` -> správa `ZOOM_PANEL`, CSS
   `zoom` na koreňoch obsahu panela (krok 1,25), zabudne sa so zatvorením panela. Je to zväčšenie na ukázanie miesta, nie nastavenie
   používateľa.
6. **Stav posunu:** `view_state.panel_view` {panel, scroll_pct, at_top, at_bottom, zoom, item?} z posledného príkazu na posun alebo
   zoom (D-146 hlásilo, že viewer koniec panela nevracia; teraz ho vracia, pre posledne posúvaný panel).

**Zavrhnuté rozšírenie:**
- *Nový tool `set_panel`:* panely sú súčasť pohľadu (D-127, D-114).
- *`get_viewer_state` na ovládanie:* tool je čítanie, zmena patrí do UI akcie. Zoznam panelov ale vracia on.
- *Ručný zoznam panelov v hoste (enum):* po pridaní panela do UI by chýbal (presne chyba z overenia). Fork je jediný zdroj.
- *Posun cez `scrollIntoView` na sekciu podľa mena:* panely nemajú jednotné sekcie, text položky funguje v každom.
- *Poloha a veľkosť panelov z chatu (`position`, `size`):* zostáva zavrhnuté z D-127.

**Otvorené:** panel Lists sa tu nemení (maximalizácia, Run, filter, export rieši D-149). `item` hľadá len v zobrazenom obsahu
(zbalená sekcia sa neprehľadáva a viewer to nahlási). CSS `zoom` sa nedalo overiť v živom vieweri (cloud session bez zostavených
balíkov forku), preto je v PR "Ako vyskúšať". Mutačné dôkazy forku pre revert oracle chýbajú (plytký klon bez `origin/main`).

**Evaly (D-057):** v cloud session bez kľúčov Supabase nepobežali; do `eval/questions.json` pribudli `panel-bcf-open` a
`panel-scroll-item`. **Testy:** vitest (`view-plan`, `select-panel`), fork `aimPanelList.test.ts`, `aimPanelsPlan.test.ts`,
`aimPanelScrollPlan.test.ts`.

---

### D-149 - "Excel hlasom" nad panelom Lists: `open_list action=update`, maximalizácia, filter, zoradenie, súčet a stav zoznamu

**Dátum:** 2026-10-22 · **Issue:** #250 (z #179 doplnenia 21. 10. 07:41 a 07:42, #185) · **Fork PR:** Menezeris/ifc-lite (patch na vetve `claude/aim-250-fork-patch`) · **Nadväzuje na:** D-098, D-101, D-111, D-114, D-127, D-148

**Kontext:** Samuel: zoznamy sú podstatné. Claude má jeden otvorený zoznam upravovať po krokoch ("otvor stĺpy, zobraz na celú obrazovku, filtruj 3NP, sumarizuj NetVolume"), nie zakladať nový, a vedieť, čo zoznam práve ukazuje (súčet NetVolume na 3NP sa dal zistiť len obchádzkou cez niekoľko `ifc_query` a výpočet mimo viewera). Čo fork už vie (D-098): zoskupenie a súčty sú v upstream `ListDefinition.grouping` (hlavička tabuľky ich mení cez `handleGroupingFromTable`: `summariseListRows` + `carryListRun`), filter builderu je `definition.groups` (ten istý `FilterGroup` ako `open_list`), zoradenie a rýchle hľadanie sú lokálny stav `ListResultsTable`, maximalizácia lokálny stav `BottomStrip` (tlačidlo Maximize v hlavičke pruhu), export je `exportList`, ktorý v iframe bez kliku používateľa nestiahne súbor (D-111).

**Najbližšie tooly (D-114):** `open_list` (rozšírime), `set_view_mode panels` (D-127, otvára a zatvára panely, tabuľku nemení), `get_viewer_state` (len číta, dostane pole `list`). Nový tool netreba.

**Rozhodnutie:**
1. `open_list` dostane `action`: `open` (default, dnešné správanie) alebo `update` (upraví práve otvorený zoznam). Pri `update` filtre (`storey`, `ifc_type`, `property`/`value`...) pribudnú ako AND ku každej skupine filtrov zoznamu a tabuľka sa spustí znova cestou D-148 (nové id definície, podľa neho `APPLIED` pozná zúžený výsledok); zoradenie a hľadanie tabuľky sa prenesú na nový výsledok. `columns` pri `update` je zatiaľ chyba.
2. Pri `open` aj `update`: `maximize` (true/false), `sort_by` + `sort_dir`, `sum` (stĺpce), `group_by` (stĺpce, vonkajšie prvé), `search` (text v riadkoch). Stĺpec sa píše ako v `columns`; viewer ho nájde podľa zdroja a mena (pri psete aj sady), chýbajúci stĺpec je problém v `APPLIED` so zoznamom stĺpcov. Prázdne pole alebo text zruší.
3. Op `list` nesie `u: 1` (úprava) a `v` (pohľad); bridge správa je `OPEN_LIST` s `view` alebo nová `LIST_UPDATE {groups, view}` v `lens-protocol.ts` forku (nie `bridge-protocol.ts`, ten je na hrane veľkosti). `viewer-ops.ts` sa nemení.
4. Fork: logika v `aim/aimListControl.ts` a `aim/aimListViewPlan.ts` (čistá, testy), spojka `aim/aimListViewStore.ts`; zoskupenie a súčty idú do `ListDefinition.grouping` tou istou cestou ako hlavička tabuľky. Upstream len dva AIM-FORK háky: `ListResultsTable.tsx` (`useAimListTable`: zoradenie, hľadanie, hlásenie súčtov v jednotke tabuľky) a `BottomStrip.tsx` (`useAimStripMaximize`: ten istý `isMaximized` ako tlačidlo, čaká, kým je Lists aktívny panel pruhu).
5. Stav zoznamu `list` je v `get_viewer_state` aj v `APPLIED.state.list` po `open_list`: názov, `has_result`, `rows`, `visible_rows`, stĺpce, filtre (krátky opis), zoradenie, hľadanie, `group_by`, `sum_columns`, `sums` (súčty za zobrazené riadky v jednotke tabuľky, tie isté čísla ako päta tabuľky), `maximized`. Platí aj pre zoznam, ktorý zostavil používateľ. `appliedText` súčty povie vetou a nepotvrdí maximalizáciu, zoradenie ani súčet, ktoré sa neprejavili.

**Zavrhnuté rozšírenie:** nový tool `set_list_state` / `update_list` - ďalší tool v konektore na to isté, čo `open_list` už nesie (filtre, stĺpce, D-114). `set_view_mode panels` - otvára panely, obsah a pohľad tabuľky nemení. Súčet cez `aggregate_objects` - počíta nad DB, nie nad tým, čo ukazuje tabuľka (filter, hľadanie, jednotka tabuľky).

**Neskôr (druhý krok #250):** pridať a odobrať stĺpce a triedy entít, odobrať filter, prepnúť model a podlažie (náhrada filtra), export (zvýraznenie tlačidla Export; stiahnutie kliká používateľ), farbenie podľa stĺpca. Maximalizácia funguje pre panel Lists v spodnom pruhu; plávajúci alebo samostatné okno hlási `maximized: false`.

**Poradie nasadenia:** najprv fork, potom AIMviewer. Starší fork `view` a `LIST_UPDATE` ignoruje; `appliedText` vtedy povie, že úpravy nepotvrdzuje.

**Otvorené:** plné CI forku a evaly (D-057) v cloud session nepobežali; otázka je v `eval/questions.json`.

**Doplnok D-149 (2026-10-22, druhý krok #250): obsah zoznamu, prepnutie podlažia a modelu, farby a export.** Rozhranie sa nemení zásadne (D-114: ďalšie parametre `open_list action=update`, žiadny tool), preto doplnok, nie nové číslo.
1. Pri `update`: `add_columns` / `remove_columns` (stĺpce ako v `columns`; nový ide na koniec, existujúci sa nezdvojí, odobratý zmizne aj zo zoskupenia, súčtov a zoradenia), `add_types` / `remove_types` (IFC triedy: pravidlo "IFC trieda je jedna z" sa v každej skupine rozšíri alebo zúži; zoznam bez neho, neznáma alebo posledná trieda je problém v `APPLIED`, nie tiché zúženie), `remove_filter` (storey, model, property, system, zone, document, global_ids, query, predefined_type alebo `all` = všetky okrem tried; zóna, dokument a prvky sú vo vieweri GlobalId, preto sa odoberajú spolu). `columns` pri `update` ostáva chyba s odkazom na `add_columns`. Edit parametre bez `action=update` sú chyba. Oprava popri tom: stĺpce `material`, `classification` a `model` mali prázdne meno (prázdna hlavička v tabuľke aj v exporte); dostanú meno a popis ako v builderi panela Lists (`Material`, `Classification`, `Model`).
2. `storey` a `model` pri `update` PREPNÚ podlažie či model: nové pravidlo nahradí doterajšie toho druhu v každej skupine, ostatné filtre ďalej pribudnú cez AND (AND dvoch podlaží z kroku 1 dával prázdny zoznam). Poradie vo vieweri: odobrať filtre, upraviť triedy, pridať filtre; potom stĺpce a nový beh cestou D-148.
3. `color_by` (stĺpec; prázdny reťazec zruší) volá upstream "Color by" tabuľky (`activateAutoColorFromColumn(columnToAutoColor(col))`), teda tú istú Lens auto-color cestu a slot ako `style_in_3d color_by`; stĺpec sa v tabuľke zvýrazní, legenda je v paneli Lens. Riadky upstream nefarbí a vlastné farbenie riadkov nepridávame (D-098). Stĺpce podlažie, priestor a zóna Lens nevie (upstream by ich ticho preložil na triedu IFC): host ich odmietne, viewer to hlási v `APPLIED`. Zrušenie vypne len "Color by" z tabuľky, Lens "AIM chat" nechá.
4. `export` (csv | xlsx | pdf): upstream `exportList` vie všetky tri, ale stiahnutie bez kliku v iframe nejde (D-111). Viewer pri tlačidle Export ukáže zvýraznené tlačidlo "Download <formát>" (`aim/AimListExportCue.tsx`); klik používateľa zavolá upstream `handleExport(format)` (tie isté stĺpce, zoskupenie, súčty a jednotky ako tlačidlo Export). Odpoveď toolu aj `appliedText` povedia, že klik je na používateľovi.
5. Stav `list` (APPLIED aj `get_viewer_state`) má navyše `color_by` (stĺpec, podľa ktorého sú prvky ofarbené) a `export_ready` (ponúknutý formát). Wire: op `list` nesie `e` (len s `u`) a vo `v` `cb`, `x`; `LIST_UPDATE` dostane `edit`, `view` `colorBy` a `export`.
6. Fork: nový čistý modul `aim/aimListEditPlan.ts` (+ test), lepidlo v `aim/aimListControl.ts`, hák `aim/aimListTable.ts` dostane farby a export; v upstream `ListResultsTable.tsx` sa AIM-FORK blok háku presunie pod `handleExport` a prop `actions` dostane tlačidlo (jednoriadkový AIM-FORK blok). `bridge-protocol.ts` ani `BottomStrip.tsx` sa nemenia.

**Zavrhnuté (krok 2):** automatické stiahnutie z chatu (prehliadač v iframe ho bez kliku zablokuje; zvýraznené tlačidlo je poctivejšie ako tvrdiť, že sa stiahlo). Vlastné farbenie riadkov tabuľky (upstream ho nemá; farby prvkov a legenda stačia). Farbenie podľa podlažia cez Lens (auto-color ho nevie; podlažia ofarbí `style_in_3d` po skupinách).

---

**Otvorené:** časť (2) z #246, samostatné zrušenie len X-ray/izolácie bez rezu a skrytých prvkov (napr. `action=clear_isolation`), tu nie je: vyžaduje bridge správu vo forku (dnes `show_all` zruší aj skrytie), čaká na rozhodnutie Samuela. Evaly (D-057) nepobežali (cloud session bez Supabase kľúčov), otázky sú v `eval/questions.json`.

---

### D-152 - Zmazanie kót od Claude: `ifc_measure clear=true` a `reset_colors` vo vieweri

**Dátum:** 2026-10-22 · **Issue:** #235 · **Nadväzuje na:** D-098, D-114, D-124, D-137

**Kontext:** `ifc_measure show=true` kreslí kóty do nástroja Measure (D-124), ale Claude ich nevedel zmazať: `set_section clear` ani `style_in_3d reset_colors` sa ich netýkali (reset farieb mazal len čiaru trasy, D-137). Používateľ ich musel mazať ručne.

**Overené (D-098):** upstream `clearMeasurements` a `deleteMeasurement` existujú (measurementSlice), fork si id kót od hosta pamätá (`hostMeasurements.ts`) a ďalší `MEASURE_SHOW` bez `keep` ich zmaže, merania používateľa nechá. Chýbala len správa "nahraď ničím": most prázdny zoznam úsekov odmietal. Používateľ má v upstream vieweri chip "Merania" vľavo hore s košom (po zatvorení nástroja Measure) a kôš v paneli Merania; vlastné tlačidlo preto nepridávame.

**Rozhodnutie (parameter existujúceho toolu, D-114, nový tool nie):**
1. `ifc_measure clear=true` zmaže kóty aj čiaru trasy od Claude (op `measure::` a `route:dc2626:`); nič sa nemeria, merania používateľa ostanú.
2. `style_in_3d action=reset_colors` maže vo vieweri aj kóty od Claude, rovnako ako od D-137 čiaru trasy (`components/ifc-viewer.tsx`).
3. Fork (len `apps/viewer/src/aim/view-protocol.ts`): `MEASURE_SHOW` s prázdnym `segments` je platný a zmaže len kóty od hosta. `bridge-protocol.ts` sa nemení.

**Zavrhnuté rozšírenie:** nový tool nie (D-114). `set_section clear` nie, rez a kóty sú dve nezávislé veci. Kôš pre "len moje kóty" pre používateľa nie: chip upstream maže všetky merania, čo používateľ pri "zmaž merania" čaká.

**Poradie nasadenia:** najprv fork (patch `aim-235-clear-measure.patch`), potom tento PR. Starší fork prázdnu správu zahodí (neprejde kontrolou mosta), kóty ostanú a používateľ ich zmaže chipom.

---

### D-154 - Plynulé otáčanie modelu dokola (`set_camera auto_rotate`), zastaví sa pri zásahu používateľa (#247)

**Dátum:** 2026-10-22 · **Issue:** #247 · **Fork PR:** Menezeris/ifc-lite (patch `fork-patch-247/`) · **Nadväzuje na:** D-083, D-087, D-098, D-114

**Kontext:** `set_camera` vie len jednorazový krok `orbit_h_deg`; na pomalé otáčanie pri prezentácii (napr. X-ray so stĺpmi) treba
opakované volania a pohyb je skokový. Treba nepretržité plynulé otáčanie okolo cieľa, zapnúť a vypnúť z chatu.

**Overenie existujúceho (D-098, D-114):** upstream fork (`c988e100`) auto-rotate vo vieweri nemá. `autoRotate` sa nachádza len v
hero scéne landing stránky (`components/mcp/hero-scene.ts`, three.js OrbitControls, iná kamera) a `CameraControls` v rendereri
má `orbit(dx, dy)` bez časovača; `cameraCallbacks` ponúka `getViewpoint` a `applyViewpoint(vp, animate=false)`. Najbližšie tooly:
`set_camera` (rozširujeme: `orbit_h_deg` je jednorazový relatívny krok, host počíta pózu a nie je nepretržitý), `set_view_mode`
(zmena režimu, kamery sa netýka), `get_viewer_state` (len stav). Použitá je existujúca cesta kamery, nový renderer ani ovládač sa nepíše.

**Rozhodnutie:**
1. **Parameter existujúceho toolu, nový tool nie (D-114 bod 3):** `set_camera auto_rotate=start|stop`, `speed_deg_s` (0,5 až 90, default 10 °/s),
   `direction=left|right` (default `left`, rovnaký smer ako kladné `orbit_h_deg`: kamera obieha cieľ doľava).
2. **Wire a most:** op `auto_rotate:<start|stop>[~s=<°/s>][~d=<l|r>]:` -> správa mosta `AUTO_ROTATE { action, speedDegS?, direction? }`
   (vlastný modul `view-protocol.ts` vo forku, `bridge-protocol.ts` je na rozpočte veľkosti). Neplatná rýchlosť vo wire sa zahodí (fork použije default).
3. **Samostatné volanie:** `auto_rotate` sa nekombinuje s presetom, fit, cieľom ani relatívnymi krokmi, lebo každý iný pohyb kamery
   otáčanie zastaví; model najprv nastaví pohľad, potom ho roztočí. Chyba s opravou je v `lib/llm/auto-rotate-plan.ts`.
4. **Fork (`apps/viewer/src/aim/`):** čistá matematika `autoRotatePlan.ts` (otočenie okolo zvislej osi cez `target`, `up` sa otáča s kamerou,
   krok zrezaný na 100 ms, detekcia cudzieho pohybu) s testom a mutačnými dôkazmi; behová slučka `autoRotate.ts` (lenivý modul, `requestAnimationFrame`
   cez `cameraCallbacks`). Zastaví ju `stop`, `pointerdown` / koliesko / dotyk na plátne, Esc, odpojenie mosta a každý iný pohyb kamery (ViewCube,
   ďalší príkaz kamery, ťah): kamera sa porovná s pózou, ktorú slučka zapísala naposledy. Upstream súbory sa nemenia (režim `aim-only`).
5. **`APPLIED`:** počas otáčania stav nesie `auto_rotate: true` a `APPLIED` nečaká na ustálenie kamery (inak by čakalo celý limit 1 s a hlásilo `camera_moving`).

**Zavrhnuté rozšírenie: `set_view_mode` - prečo nie:** je to kamera, nie režim ani záložka. **Nový tool `rotate_model`:** jeden parameter navyše
je lacnejší ako tool navyše (D-114). **Opakované `orbit_h_deg` z hosta časovačom:** host nemá bežať slučku (iframe, latencia MCP, skoky),
plynulosť patrí do snímkovej slučky viewera. **Použiť `controls.autoRotate` z hero scény:** je to iný ovládač (three OrbitControls) na inej stránke.

**Hranice:** `view_state` otáčanie neuvádza (len `APPLIED.state.auto_rotate`); pri zatvorení karty alebo zmene režimu 2D sa slučka zastaví pri prvom kroku bez kamery.
Smer `left` / `right` je podľa pohybu kamery, nie modelu (zhodne s `orbit_h_deg`); model sa pri `left` zdanlivo otáča doprava. Opis toolu to hovorí, správnosť smeru overí Samuel naživo.

**Poradie nasadenia:** najprv fork (patch), potom AIMviewer. Starší fork správu `AUTO_ROTATE` zahodí: tool vráti ok, ale nič sa nezačne točiť.

**Otvorené:** živé overenie vo viewer iframe a plné CI forku v cloud session nepobežali; evaly (D-057) nepobežali (bez Supabase kľúčov), otázka `camera-auto-rotate` je v `eval/questions.json`.

---

### D-159 - Živý viewer patrí chatu používateľa: testovací kanál pre pracovné sessions, vlastník okna a prostredie v lište

**Dátum:** 2026-10-23 · **Stav:** rozhodnuté (plán schválený Samuelom cez orchestrátora: pruh hore len mimo produkcie, prevzatie po 15 min, migrácia `client` áno) · **Issue:** #189 · **Súvisí:** D-079 (živý kanál), D-085 (spätný kanál), D-101 (potvrdenie), D-125 (viac okien), D-116 (výber viewera PR), D-135 (sessions neotvárajú produkciu), D-141 (stavová lišta), D-114, #180

**Kontext:** vo vieweri používateľa sa sami menili rez, izolácia a režim. Príčina: jeden `MCP_TOKEN` a jeden `LIVE_CHANNEL` (na Verceli len Production) pre všetkých klientov konektora: Samuelov chat, ručné aj automatické Claude Code sessions, routines a evaly. Server bol bezstavový a klienta nepoznal (`from` vždy "Claude"), viewer poznal len svoje okno (D-125), takže príkaz session, ktorá testovala svoj tool, prišiel do rozpracovaného pohľadu používateľa. `?viewer=pr-N` (D-116) mení len iframe forku, kanál a dáta ostávajú produkčné. Náhľady hostu nemajú `MCP_TOKEN`, `LIVE_CHANNEL` ani `NEXT_PUBLIC_SUPABASE_URL`, konektor tam nebeží.

**Rozhodnutie (len host, fork bez zmeny, žiadny nový tool podľa D-114):**
1. **Identita rozhovoru bez DB** (`lib/mcp/session-id.ts`): pri `initialize` server vráti hlavičku `Mcp-Session-Id` = `<sid>.<clientInfo.name v base64url>.<HMAC>` (kľúč `MCP_TOKEN`); klient ju podľa MCP Streamable HTTP posiela pri každom volaní a server ju overí bez úložiska. Bez hlavičky (starší klient) platí správanie ako doteraz. Volajúci (`lib/live/caller.ts`, AsyncLocalStorage na celú požiadavku) nesie `sid`, meno klienta a príznak pracovnej session.
2. **Pracovná session ide na testovací kanál:** klient Claude Code (meno klienta alebo User-Agent `claude-code`) dostane od `liveChannel()` kanál `<LIVE_CHANNEL>-test` pre príkazy aj otázky (`get_viewer_state`, uloženie pohľadu, BCF snímka). Odpoveď to povie a odkaz na produkčný viewer nedá; bez viewera na testovacom kanáli povie "overuj lokálne" (D-135). Zmeny dát (BCF, revízie) idú ďalej na produkčný kanál (`liveBaseChannel`).
3. **Okno viewera patrí jednému chatu** (`lib/live/owner.ts`): príkaz nesie `sid`; vlastník okna je rozhovor prvého prijatého príkazu po načítaní. Príkaz z iného rozhovoru viewer nevykoná, vráti `applied` s `rejected: "foreign"` (tool povie "NEVYKONAL, viewer ovláda iný chat") a ukáže "Príkaz z iného chatu neprijatý [Prevziať]". Po 15 min bez príkazu od vlastníka okno prevezme ďalší chat sám. Otázky smie aj cudzí chat; odpoveď nesie `owner` a `get_viewer_state` pridá poznámku `owner.controlled_by = other_chat`. Príkaz bez `sid` sa prijme vždy. Poistka: `LIVE_OWNER_LOCK=0` na Verceli `sid` do príkazov nedá (viazanie sa vypne, testovací kanál ostáva).
4. **Výber prostredia v stavovej lište (D-141):** čip Live je ponuka "Produkcia (príkazy z tvojho chatu)" / "Testy sessions"; výber drží karta (`sessionStorage`), `?live=<kanál>-test` vyberie testy rovno. Výber viewera Produkcia / PR-N (D-116) ostáva vedľa.
5. **Pruh hore len mimo produkcie:** nad viewerom na `/ifc` jantárový pruh "Náhľad viewera PR #N" alebo "Testovací kanál sessions". V produkcii sa nič nepridáva.
6. **Log klienta:** `mcp_call_log.client` (migrácia `20261023120000`, aditívna) = `clientInfo.name#sid`, `(work)` pri pracovnej session, bez hlavičky `ua:<User-Agent>`. Podľa neho sa overí, či sa sessions rozoznajú a či chat drží jeden `sid`. Kým migrácia nie je spustená, riadok sa zapíše bez stĺpca.
7. **Pravidlo pre sessions** (`AGENTS.md`, skilly `mcp-poziadavka` a `verify`, `eval/MCP-EVAL.md`): UI tooly konektora session na overenie nevolá; produkčný živý kanál nikdy, overuje lokálne.

**Zavrhnuté rozšírenie:** nový tool ani parameter (napr. `channel` v každom UI toole) nie: prostredie určuje klient a výber vo vieweri, nie model, a parameter by si model vedel zmeniť sám. Oddelené prostredie s vlastnými dátami (náhľad hostu s vlastným Supabase a konektorom) je zbytočne veľký krok; dáta sú pre testy rovnaké, líši sa len stav viewera, a ten oddeľuje kanál. Vlastník v DB nie: stačí okno a podpísaná hlavička.

**Riziko a overenie po nasadení:** ak by chat v Claude pri každom volaní robil nový `initialize`, mal by zakaždým iný `sid` a viewer by jeho druhý príkaz odmietol. Overenie: dva príkazy z chatu za sebou a v `mcp_call_log.client` rovnaký `#sid`; ak nie, `LIVE_OWNER_LOCK=0` a redeploy. Rovnako z logu: či sessions Claude Code nesú `(work)`.

**Overené:** vitest, `tsc`, eslint zmenených súborov; lokálne `next dev` proti falošnému Realtime serveru: cudzí príkaz odmietnutý s `rejected: "foreign"`, odpovede s `owner` you/other, Prevziať, prepnutie na `demo-test` s pruhom, výber prežije obnovenie; route konektora vydá `Mcp-Session-Id`, `claude-code` sa pýta na `demo-test` a dostane hlášku bez odkazu, `claude-ai` na `demo`. **Evaly (D-057):** nepobežali (cloud session bez Supabase kľúčov); opisy toolov sa nemenia, mení sa len text odpovede pri testovacom kanáli a cudzom okne.

---

---

### D-160 - Názvy zón vo výkresoch ako odkazy a ručné priradenie a zrušenie odkazu popisku (#268)

**Dátum:** 2026-10-23 · **Stav:** schválené (orchestrátor, plán bodov 1 až 6), implementované · **Issue:** #268 · **Nadväzuje na:** D-123 (riadky textu s polohou), D-130 (popisky ako odkazy, AIM vrstva), D-129, D-114 (rozšírenie namiesto nového toolu), D-117, D-158 (revízia dokumentu, uloženie cez chat) · **Fork:** `aim/docLinks*`, `aim/docLinkEdit.ts`

**Kontext:** Samuel chce, aby boli klikateľné aj názvy zón (požiarne úseky a iné IfcSpatialZone a IfcZone), ako sú dnes čísla miestností a značky typov, a aby sa dal odkaz priradiť a zrušiť ručne, keď sa text a meno nezhodujú. Ručná oprava má platiť aj pre existujúce odkazy. Overené: odkazy vznikajú len na hoste (`drawing-labels.ts`, `drawing-links.ts`), ETL ani fork nepárujú; zóny sú v `objects` ako `zone` a `spatial_zone`, členstvo IfcZone cez `rel_assigns_to_group`.

**Rozhodnutie:**
1. **Zóny (host, bez forku):** riadok strany, ktorého normalizovaný text (`normLabel`: bez diakritiky, veľkosti písmen a nadbytočných medzier) sa rovná menu zóny (`objects.name` = IfcRoot.Name), je odkaz druhu `zone`; viac zón s rovnakým menom = `candidates`. Riadok, ktorý je už popiskom (bublina, kód miestnosti), zónou nie je. Cieľ nesie GUID zóny a pri IfcZone aj GUIDy členských miestností (`members`, strop 40), aby klik vybral aspoň priestory, keď zóna nemá geometriu. Meno rozlomené na dva riadky automatika nezachytí; rieši to ručné priradenie.
2. **Nositeľ ručných priradení:** jedna tabuľka `drawing_link_overrides` (SCHEMA §2.14), kľúč dokument + strana + normalizovaný text + voliteľný bbox. `assign` ukazuje na cieľ, `suppress` odkaz zruší, zrušenie ručnej opravy riadok ukončí (`valid_until`). `document_revision` a nullable `document_sha256` sú kotva podľa D-158 (bbox patrí revízii, text-only prežije re-ETL); sha256 sa naplní s D-158 krokom 4.
3. **Prednosť:** `applyOverrides` (čistá funkcia) beží za automatickým párovaním: `assign` nahradí odkaz (`via: manual`, druh podľa cieľa) alebo vytvorí nový na riadku strany s týmto textom (alebo na bbox, keď text vo vrstve nie je), `suppress` ho odstráni; riadok s bbox vyhráva nad riadkom bez bbox. Platí rovnako pre miestnosti, typy aj zóny, takže existujúce odkazy (bod 4 z issue) nepotrebujú nič navyše. Cieľ, ktorý po re-ETL zanikol, sa preskočí a platí automatika.
4. **Chat (D-114, žiadny nový tool):** `open_drawing` dostal parameter `link` = `{text, action: assign|clear|reset, target, scope: page|bbox, bbox, from_draft}`. Cieľ je object_ref, GUID alebo meno zóny či miestnosti (musí byť jednoznačné). Text sa overí voči strane (riadky alebo popisky), cieľ voči DB; chybný vstup nič nezapíše. Dokument sa potom otvorí vo vieweri, ktorý načíta upravené odkazy. `search_documents include_links` ostáva čítanie a vracia `via: manual` a zóny.
5. **Viewer (fork):** lokálne + uloženie cez chat, ako D-158 krok 2: označený text na výkrese a vybraný prvok v 3D dajú návrh (`view_state.link_draft` = `{document_id, page, text, bbox, action, target_guid}`), ktorý uloží `open_drawing link={from_draft:true}`. Viewer nemá token, preto priamy zápis nie je.

**Zavrhnuté:**
- *Parameter v `search_documents`:* čítací tool by zapisoval.
- *Stĺpec `manual_links` na `document_pages`:* ETL ho pri re-ETL prepisuje a jeden riadok na stranu by neniesol históriu ani zrušenie.
- *Ukladať ručné priradenia len vo vieweri (localStorage):* nedeli sa medzi používateľmi ani s chatom.
- *Nový tool `drawing_link`:* ten istý zdroj a tá istá strana ako `open_drawing` (D-114).

**Poradie nasadenia:** najprv migrácia `20261023130000_drawing_link_overrides.sql` (aditívna, nová tabuľka; bez nej `fetchOverrides` zlyhá a odkazy na výkrese sa nenačítajú), potom host; fork patch pridáva `members` a návrh priradenia (starší fork `members` ignoruje). Re-ETL netreba.

**Overenie:** `lib/data/drawing-zones.test.ts`, `drawing-link-overrides.test.ts` (zóny, kandidáti, prednosť bbox, assign mimo vrstvy, chat assign/clear/reset/from_draft, chybné vstupy nič nezapíšu), `supabase/tests/drawing_link_overrides.sql` (lokálna DB: unikát na živý riadok, kontrola cieľa, snímka po zániku objektu). Na produkčných dátach nebežalo.

---

### D-162 - IDS z chatu a z viewera: tvorba, úprava, verzie v DB, validácia a upstream IDS modul (#285)

**Dátum:** 2026-10-23 · **Stav:** schválené (Samuel cez orchestrátora 23. 10., odpovede na 5 otázok nižšie), implementácia nezačatá · **Issue:** #285 · **Nadväzuje na:** D-052, D-053, D-081 (behy ifctesteru v `ids_runs`), D-084 a jeho dodatok 18. 10. (`ifc_ids_validate`, zdroj IDS pre server), D-087, D-098, D-114, D-158 (vzor "modul viewera + chat + DB"), D-159, D-161 (#188, pohľady z panela cez route za env bránou)

**Kontext:** Samuel (23. 10.): "aby LLM vedelo ovládať IDS modul z upstreamu, tvoriť nové, ukladať ich do DB". Stav overený 23. 10.:
- *Fork:* `@ifc-lite/ids` (parser, `writeIdsXml`, `validateIDS`, audit), `@ifc-lite/ids-authoring` (bezhlavý editor: `StudioDocument` so stabilnými id, XML tam a späť, typované vratné operácie `spec.*`, `facet.*`, `requirement.*`, `doc.setInfo`, `bulk.*`, brána voči IFC schéme `checkOps`/`applyOpsGated`, lint, `diffIds`). Viewer má panel `validation` (IDSPanel, `idsSlice`, `loadIdsContent`, beh vo workeri, export správy a BCF; nie je lenivý) a panel `idsStudio` (editor, `idsStudioOpen`, `idsStudioDispatch`, lenivý chunk). Stav Studia je len v pamäti, knižnica definícií validácie v localStorage. AIM časť forku (`apps/viewer/src/aim/`) IDS nepoužíva, most IDS správu nemá.
- *`@ifc-lite/mcp`* (host má 0.27.0) má od 0.25.0 tooly `ids_read`, `ids_apply_ops` (jediný meniaci, s bránou), `ids_write` (audit pred zápisom), `ids_audit`, `ids_lint`, `ids_schema_*`, popri `ids_validate`.
- *Host:* `ifc_ids_validate` (IDS z env `IDS_SOURCES`, prázdny register, nič neukladá); `etl.ids_check` ukladá behy ifctesteru do `ids_runs`/`ids_results` (`v_ids_latest`, `v_ids_summary`). Evaly IDS nemajú.
- *Knižnica `assetin-library`:* MD v `zadanie/` je jediný zdroj pravdy, každá informácia má jedného nositeľa. Generátor IDS (F4) ešte nie je, existuje prototyp `ER-0101_ARCH.ids`.

**Najbližšie tooly (D-114):** `ifc_ids_validate` (rozširujeme), `query_view` (`v_ids_*`, bez zmeny), `bcf_topic` (iný objekt), `set_view_mode panels` (otvorenie panelov `validation`, `idsStudio`).

**Rozhodnutie:**
1. **Dva pôvody IDS v DB, každá požiadavka má jedného nositeľa** (Samuel, otázka 1: áno).
   - `origin = library`: snímka IDS z knižnice (repo@commit:cesta, sha256), v AIM **len na čítanie**. Mení sa v MD knižnice a prichádza novou snímkou (import v ETL). Tým sa uzatvára otázka z dodatku D-084, odkiaľ server berie IDS: z DB, nie z `IDS_SOURCES`.
   - `origin = chat`: pracovné IDS vytvorené v chate alebo vo vieweri; nositeľom je AIM. Úprava knižničného IDS = nové IDS `chat` s väzbou `derived_from` (verzia snímky), snímka sa nikdy neprepíše. Chat aj viewer ho zreteľne označia "nie je z knižnice".
2. **Žiadny beh dnes nie je záväzný** (Samuel, otázka 2: "nie, teraz žiadna nie je záväzná"). Beh z chatu (`@ifc-lite/ids`) aj beh ifctesteru z ETL sa ukladá ako záznam kontroly. `ids_runs.binding` je príznak do budúcnosti (IDS brána, D-086), predvolene `false`. Mení formulácie D-081 bod 1 a dodatku D-084 ("záväzný zaznamenaný beh") a opis toolov a inštrukcií, ktoré ifctester volajú záväzným.
3. **Chat: jeden nový tool `ids_document`** (Samuel, otázka 5: áno; riadok v `lib/mcp/tool-registry.json` -> D-162) s `action`:
   - `list` (kód, názov, pôvod, posledná verzia, posledný beh), `get` (špecifikácie a facety čitateľne, voliteľne XML),
   - `create` (prázdne alebo z XML, alebo `derived_from` = kópia knižničnej snímky),
   - `apply_ops` = upstream `ids_apply_ops` 1:1 (rovnaká schéma operácií, brána voči IFC schéme; odmietnutá dávka vráti kódy, cestu a kandidátov a nič neuloží); úspech uloží novú verziu cez `ids_write` (audit pred zápisom),
   - `versions`, `diff` (`diffIds` medzi verziami), `export` (`.ids` ako odkaz na stiahnutie),
   - `open` (do panela `validation` alebo `idsStudio` vo vieweri, voliteľne spustí beh),
   - `from_viewer` (uloží rozpracovaný dokument z `view_state.ids_local`).
   Server volá tooly balíka cez existujúcu reláciu motora (`lib/engine/session.ts`, whitelist), kód sa načíta lenivo ako motor; nová závislosť netreba. Knižničná snímka odmietne `apply_ops` s radou `create derived_from`.
4. **`ifc_ids_validate` rozšírený:** `ids` = kód IDS v DB (+ `version`, predvolene posledná), `save=true` uloží beh do `ids_runs`/`ids_results` (`engine = ifc-lite`, `trigger = chat`). `IDS_SOURCES` ostáva len ako záložný zdroj, kým DB nemá žiadne IDS.
5. **Viewer ukladá priamo aj cez chat** (Samuel, otázka 3: "ukladanie z viewera tiež, tak isto ako BCF fungujú"):
   - *z panela:* tlačidlo "Uložiť do AIM" v Studiu a v paneli validácie (AIM blok vo forku, lenivý modul `aim/aimIds.ts`) pošle hostovi bridge správu `IDS_SAVE {doc_id?, base_version?, xml, title}`. Host stránka ju zapíše cez route `app/api/ids/...` (`POST` nové, `PUT` nová verzia) s ochranou ako ostatné zápisy z viewera: env brána `IDS_WRITE_ENABLED` (predvolene vypnutá, vtedy 403 "ulož v chate"), origin guard (`isCrossOriginBlocked`) a per-IP rate limit (`lib/api-guard`, vzor D-072/D-068 a route pohľadov D-161). Čítanie (`GET` zoznam, verzia, XML) bez tokenu ako BCF API. Viewer (iná doména) token nemá, preto zápis ide cez hosta, nie priamo z iframe.
   - *z chatu:* `view_state.ids_local` (Studio: XML cez `writeStudioDocument`, `base` = doc_id + verzia, `dirty`; posledný beh: pass/fail po špecifikáciách, nesplnené GUID so stropom) a `ids_document action=from_viewer`.
   - *Konflikt:* oba zápisy pošlú `base_version`; ak nie je posledná, zápis odmietne (409) a chat ponúkne `diff`. Knižničnú snímku z viewera prepísať nejde, uloží sa ako `chat` s `derived_from`.
   - *Načítanie:* host -> viewer `IDS_LOAD {doc_id, version, xml, title, target: validation|studio, run?}`; fork volá `loadIdsContent` (definícia s vlastníkom `aim`, ďalšie načítanie ju nahradí, aby localStorage nedržal starú kópiu) alebo `idsStudioOpen(fromIdsDocument(...))`.
6. **Výsledok vo vieweri:** beh vo vieweri (IDSPanel ofarbí model) alebo uložený beh -> `style_in_3d` cez `v_ids_latest` (existuje).
7. **Model v DB (aditívna migrácia, rezervované `20261023180000_ids_documents.sql`, SCHEMA §2.13 návrh):** `ids_documents`, `ids_document_versions` (XML je nositeľ, verzie nemenné), `ids_runs` + `ids_version_id`, `engine`, `binding`, `trigger`; pohľady `v_ids_latest` / `v_ids_summary` dostanú `ids_code`, `ids_version`, `engine`, `binding` (staré stĺpce ostanú, `query_view` whitelist + nové `ids_documents`). Studio JSON sa neukladá (odvodí sa z XML). IDS nie je dokument z IFC (D-104), preto nie je v `objects`.
8. **Prenos do knižnice odložený** (Samuel, otázka 4) do generátora F4 knižnice; potom návrh MD poznámok (PR do assetin-library), nie kopírovanie XML. Do vtedy `export` `.ids` a ručný prepis.

**Kroky a PR (poradie D-116):**
- **Host PR 1 (bez forku):** migrácia + SCHEMA, `lib/ids/` (úložisko, verzie, diff), `ids_document` bez `open`/`from_viewer`, `ifc_ids_validate` z DB + `save`, opravy textov o záväznosti (bod 2), register a `MCP-TOOLS.md`, testy (vitest nad mini-IDS, SQL test), evaly D-057 (vytvor IDS, pridaj facet, validuj a ulož, ukáž nesplnené).
- **ETL:** `etl.ids_check` zapíše `ids_version_id`, `engine = ifctester`, `trigger = etl`; import snímky knižnice (ER-0101_ARCH) ako `library`. Zápis do DB spúšťa orchestrátor.
- **Fork PR (len `apps/viewer/src/aim/`, rýchle CI, skill `aim-feature`):** `IDS_LOAD`, `IDS_SAVE`, tlačidlo "Uložiť do AIM", `view_state.ids_local`, lenivý `aim/aimIds.ts`; vo vstupnom chunku len smerovanie správ (odhad vstup < +1 kB, eager 0; IDS kód už nesie panel validácie, Studio sa ťahá existujúcim lenivým loaderom). Začne až po zlúčení D-161 Fork A (#188, `claude/d161-fork-a`): obe menia reťaz `onMessage` v `aim/AimBridge.tsx` a skladanie `view_state`.
- **Host PR 2:** route `app/api/ids`, príjem `IDS_SAVE` v host stránke, `open`, `from_viewer`, súhrn `ids_local` v `get_viewer_state` (`lib/live/viewer-query-tools.ts`, rovnaký súbor ako D-161), panely v `set_view_mode panels`.
- **Neskôr:** prenos do knižnice (po F4), BCF témy z nesplnených prvkov, IDS brána pri zverejnení revízie (D-086, `binding`).

**Zavrhnuté:**
- *Upstream IDS tooly 1:1 ako samostatné tooly konektora* (`ids_read`, `ids_apply_ops`, `ids_write`, `ids_audit`, `ids_lint`...): 3 až 8 toolov navyše, model by ich musel reťaziť (D-114); `ids_document` ich volá vnútri.
- *Rozšíriť `ifc_ids_validate` aj o úpravy:* miešal by kontrolu s editáciou a jeho opis by prerástol.
- *Vlastný editor facetov v AIM:* upstream Studio a `ids-authoring` ho majú (D-098).
- *Ukladať IDS z chatu do knižnice priamo (XML do repa):* knižnica nesie MD, nie XML; generátor F4 ešte nie je.
- *Ukladať Studio JSON ako nositeľa:* je odvodený z XML a menil by sa s verziou balíka.
- *Zápis z viewera s tokenom priamo z iframe (ako BCF panel s `BCF_API_TOKEN`):* upstream IDS panely klienta servera nemajú a token by musel byť v prehliadači; host route za env bránou je tá istá ochrana ako pri podkladoch a pohľadoch.

**Riziká:** veľké IDS v `view_state` (strop XML 256 kB, nad ním len `dirty` + sha256 a prenos cez `IDS_SAVE`); motory sa môžu líšiť na psetoch z typu (zhoda 8/8 na ER-0101, D-084; overiť pri prvom IDS s psetmi); knižničné snímky zatiaľ len z prototypu; prienik s D-161 v moste (poradie vyššie).
