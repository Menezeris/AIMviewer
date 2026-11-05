# Decision records (D-xxx)

> One file per record, split mechanically from the old single `DECISIONS.md` (D-197, lean docs). Record text is
> unchanged (Slovak until the phase 5 translation of D-194; titles and one-liners below are the first line of
> each record). Non-record text of the old file (section headings and their intro text) is in
> [`sections.md`](sections.md).
>
> **New record:** create `decisions/D-nnn.md` (number reserved in issue #60) starting with `### D-nnn - Title`,
> and add one row to the index below. Status comes from the record's `**Status:` line, otherwise "decided".
> D-136 exists twice in the old file, the second copy is `D-136-dup.md`.

### 1. Produkt a stratégia

| No. | Title | Status | One line |
|---|---|---|---|
| [D-001](D-001.md) | Biznis model | decided | Primárna aktivita je BIM konzultácia. Nástroj vzniká paralelne ako vedľajší... |
| [D-002](D-002.md) | Demo projekt | decided | Administratívna budova z diplomovej práce ako verejný sandbox. |
| [D-003](D-003.md) | Prvý use case: AIM Viewer | decided | Prvý cieľ je ukážka konečného stavu - správne previazané dáta a možnosti práce... |
| [D-004](D-004.md) | Vibecoding prístup | decided | Claude Code (primárne) + Cursor ako hlavné vývojové nástroje. |

### 2. Technický stack

| No. | Title | Status | One line |
|---|---|---|---|
| [D-005](D-005.md) | Databáza: Supabase / Postgres | decided | Supabase ako primárne úložisko (Postgres pod kapotou). |
| [D-006](D-006.md) | Frontend: Next.js + Vercel | decided | Next.js na Vercel, vlastná doména cez Websupport DNS. |
| [D-007](D-007.md) | IFC Parser: ifcopenshell (Python) | decided | ifcopenshell ako ETL nástroj pre import z IFC do Supabase. |
| [D-008](D-008.md) | RDF / ICDD ako export formát | decided | RDF nie je interná databáza - je to výstupný formát pre handover a archiváciu. |

### 3. Databázová architektúra

| No. | Title | Status | One line |
|---|---|---|---|
| [D-009](D-009.md) | Schéma navrhnutá ako graph v relačnej DB | decided | Tabuľky sú uzly, rel_ tabuľky sú hrany s atribútmi. Myslíme v trojiciach. |
| [D-010](D-010.md) | Trojvrstvová identita objektu | decided | Každý objekt má tri vrstvy identity: |
| [D-011](D-011.md) | Klasifikačný systém: flexibilný | decided | Žiadny pevne daný klasifikačný systém. IFC entity IfcClassification a... |
| [D-012](D-012.md) | IFC-aligned schéma, nie priama IFC implementácia | decided | Schéma je inšpirovaná IFC 4.3 ale nie je priama implementácia. Vlastné tabuľky... |

### 4. Ontológia a štandardy

| No. | Title | Status | One line |
|---|---|---|---|
| [D-013](D-013.md) | Priestorová hierarchia podľa IFC | decided | Site → Building → Floor → Space → Asset. Priamo z IFC priestorovej hierarchie. |
| [D-014](D-014.md) | Dokumenty podľa IfcDocumentInformation logiky | decided | Dokumenty majú: Identification, Name, Location (URL), Purpose, Revision,... |
| [D-015](D-015.md) | ICDD (ISO 21597) ako export štandard | decided | Keď zákazník chce dáta odniesť - generujeme ICDD kontajner s RDF prepojeniami. |

### 5. Vývojový proces

| No. | Title | Status | One line |
|---|---|---|---|
| [D-016](D-016.md) | Typy chatov | decided | Striktné oddelenie typov konverzácií: |
| [D-017](D-017.md) | Dokumentačná štruktúra projektu | decided | projekt/ |

### 6. Schéma AIM Viewer (návrh dátového modelu)

| No. | Title | Status | One line |
|---|---|---|---|
| [D-018](D-018.md) | Objektový model: centrálna objects + typové prípony | decided | Všetky uzly (site, building, floor, space, asset, asset_type, document, person,... |
| [D-019](D-019.md) | Klasifikácia: dvojúrovňová, referenčné dáta | decided | classification_systems (IfcClassification) a classification_references... |
| [D-020](D-020.md) | Zodpovednosti od v1 | decided | Aktori sú typ objektu; zodpovednosť cez hranu rel_responsible_for s role... |
| [D-021](D-021.md) | Type-Occurrence vzor | decided | Type aj occurrence sú uzly v objects. Occurrence (object_type='asset') má... |
| [D-022](D-022.md) | Properties: tri vrstvy, rozlíšené názvom | decided | (1) IFC atribúty → stĺpce na objects; (2) štandardné psety (buildingSMART,... |
| [D-023](D-023.md) | Klasifikácia na type aj occurrence (union faset) | decided | rel_has_classification povolená na type aj occurrence. Efektívna klasifikácia... |
| [D-024](D-024.md) | Actor model: B teraz, C plánované | decided | Aktori na úrovni B: person (prípona persons: given_name, family_name, email,... |
| [D-025](D-025.md) | Iniciálna migrácia: rozsah a implementačné rozhodnutia | decided | SCHEMA.md §2 je implementovaná ako jediná aditívna migrácia |
| [D-026](D-026.md) | AIM Viewer: stack a dátový prístup | decided | Viewer je Next.js (App Router) + TypeScript + Tailwind + shadcn/ui |
| [D-027](D-027.md) | Viewer navigácia: route per uzol | decided | Priestorová hierarchia (S1) je route-first: perzistentný sidebar |
| [D-028](D-028.md) | AIM Viewer S2: asset karta (dedičnosť, provenance, type route) | decided | Asset karta žije vo vetve existujúcej route /node/[id] |
| [D-029](D-029.md) | AIM Viewer S3: dokumenty, zodpovednosti, GUID história + generický object route | decided | S3 pridáva tri generické sekcie nad ľubovoľný objects uzol: |
| [D-030](D-030.md) | Viewer výkon (ISR cache) + navigácia ne-priestorových uzlov | decided | (1) Sidebar navigácia: pod priestorovým stromom (D-027) pribudli |
| [D-031](D-031.md) | ETL pipeline: architektúra a idempotencia | decided | ETL žije v podadresári etl/ tohto repa (zdieľa SCHEMA/DECISIONS |
| [D-032](D-032.md) | PDF dokumenty: úložisko, model, prepojenie, export | decided | Kontext: documents.location je zatiaľ len textová URL. Treba uchopiť reálne PDF |
| [D-033](D-033.md) | Coding scheme: field-source resolver, object_ref a prepojenie dokumentov | decided | Kontext: dokument a prvok sa musia stretnúť na rovnakom kľúči = object_ref. ETL... |
| [D-034](D-034.md) | Rozsah importu = informačné požiadavky (čo je „asset") | decided | Kontext: ETL dnes berie ako asset každý IfcElement (mínus otvory) a ako |
| [D-035](D-035.md) | Konsolidácia podlaží: pomocné Revit úrovne → reálne podlažie | decided | Kontext: ASR.ifc má 18 IfcBuildingStorey, ale len 5 sú reálne podlažia |

### 7. Otvorené otázky (ešte neriešené)

| No. | Title | Status | One line |
|---|---|---|---|

### 7b. Dokumentová identita (E3)

| No. | Title | Status | One line |
|---|---|---|---|
| [D-036](D-036.md) | Dokumentová naming convention = CDE štandard (ISO 19650) | revízia (mimo názvu) | Kontext: D-032/D-033 odložili „naming convention finálny tvar" ako otvorený bod. |
| [D-040](D-040.md) | Priestory: zachytenie IfcSpace.LongName (prípona spaces) | decided | Kontext: Vo Vieweri sa priestory (miestnosti) zobrazovali len ako číslo (2.04) |
| [D-041](D-041.md) | PDF výkres auto-linking: dôverové vrstvy matchu + element-väzby (E4) | decided | Kontext: dokončenie D-032/D-033 pipeline (etl/pdf_link.py): PyMuPDF vytiahne... |
| [D-042](D-042.md) | Interaktívna prehliadačka výkresov (klikateľné SNIM kódy) - *plánované* | decided | implementačné detaily sa doladia počas sprintu (pracovne sprint „DV", ROADMAP). |
| [D-043](D-043.md) | Skladby (kompozičné značky S1-S9) ako vlastný systém značenia | decided | diagnostikou pokrytia odkazov vo výkresoch (Rez-A). Možnosť A (skladba ako... |
| [D-044](D-044.md) | IFC 3D viewer (IFClite): geometria ako ephemerálny kontajner viazaný cez GUID | decided | Do AIM Viewer sa integruje IFC 3D prehliadačka cez IFClite |
| [D-046](D-046.md) | IFC alignment stratégia: IFC4.3 slovník teraz, pripravenosť na IFC5/IFCX | decided | Platforma sa sémanticky aj terminologicky zarovnáva na IFC4.3 |
| [D-047](D-047.md) | Demo north-star: LLM nad grafom + trust loop; ETL na distribučné systémy | decided | Ťažiskom dema (wow efekt) je prirodzený jazyk nad naším grafom - |
| [D-048](D-048.md) | IFC-kanonická vrstva vzťahov (rozseknutie rel_located_in, plné zarovnanie) | decided | Vrstva hrán sa prestaví na IFC-kanonickú identitu - každá hrana = |
| [D-049](D-049.md) | Federácia disciplinárnych modelov (VZT) + reframe D-047 north-star | decided | Kontext: D-047 určil headline dotaz „uzatvárací IfcValve na... |
| [D-050](D-050.md) | 3D vrstva federácie: multi-model render s identitou cez IFC GUID | decided | Kontext: D-049 federoval VZT do grafu (DB); 3D viewer (D-044) však stále... |

### 7c. Meta-model vzťahov a program dema (D-051+)

| No. | Title | Status | One line |
|---|---|---|---|
| [D-051](D-051.md) | Meta-model vzťahov = generická relationships (B): jedna tabuľka + kanonické views + manifest | decided | Kontext: Cieľom je naplno využiť IFC ako sémantiku/ontológiu (nie ako STEP... |
| [D-052](D-052.md) | Geometrický cross-file containment (element → IfcSpace) + IDS verifikácia | decided | Kontext: MEP prvky (napr. IfcAirTerminal z VZT.ifc) aj časť ASR prvkov visia... |
| [D-053](D-053.md) | Live upload + verifikácia proti požiadavkám (SharePoint-like, IDS-driven) | decided | Rozhodnutie (smer): Umožniť nahranie ľubovoľného súboru (predstava:... |
| [D-054](D-054.md) | PDF prehliadačka rework | decided | Kontext: Prepojenie prvok↔PDF funguje princiálne dobre (E4/DV,... |
| [D-055](D-055.md) | 3D / IFClite feature port | decided | Rozhodnutie (smer): Postupne prebrať ďalšie vhodné IFClite moduly do 3D vrstvy |
| [D-056](D-056.md) | LLM rozhranie nad grafom | decided | Rozhodnutie (smer): Konkretizácia D-047. API-pluggable model (vieme pripojiť |
| [D-057](D-057.md) | Eval harness pre LLM rozhranie (zlaté otázky) | decided | Presnosť /api/ask sa meria deterministickou eval sadou, nie pocitom - |
| [D-058](D-058.md) | Runtime slovník psetov (v_property_dictionary) | decided | LLM nemá hádať JSONB cesty do properties - grounding slovník sa |
| [D-059](D-059.md) | Fulltext nad všetkým (search_text + search_everything) | decided | Cieľ = parita s človekom skenujúcim panel vlastností: LLM musí nájsť |
| [D-060](D-060.md) | Agregácie + numericky bezpečné filtre (aggregate_objects) | decided | Súčty/priemery/min/max a každé číselné porovnanie hodnoty psetu počíta |
| [D-061](D-061.md) | Statický IFC slovník psetov (ifc_property_definitions) | decided | Definície štandardných psetov (Pset_/Qto_) žijú v DB ako referenčná |
| [D-062](D-062.md) | Výber produkčného modelu (eval-driven) | decided | Rozhodnutie (procedúra): Produkčný model pre /api/ask sa vyberá meraním na eval |
| [D-063](D-063.md) | Obsah dokumentov (document_pages + search_documents) | decided | Otázky na obsah dokumentov („v ktorom dokumente sa píše o X") boli |

### 8. Budúce rozhodnutia (D-037+)

| No. | Title | Status | One line |
|---|---|---|---|
| [D-037](D-037.md) | 3D IFC Viewer integrácia *(→ rozhodnuté ako D-044)* | supercedovaný D-044 | paralelná vetva, obojsmerná selekcia cez IFC GUID). Predpoklad ETL (S4) splnený... |
| [D-038](D-038.md) | PDF / DWG výkres vedľa IFC viewera (split-screen) *(→ rozhodnuté ako D-072)* | supercedovaný D-072 | PDF podkladov (D-072); DWG/DXF vektorová cesta ostáva ako neskoršia fáza tam. |
| [D-039](D-039.md) | Georeferencing PDF/DWG výkresov do IFC priestoru *(→ rozhodnuté ako D-072)* | supercedovaný D-072 | prevzaté do D-072; IfcGridAxis/AI auto-kalibrácia ostáva ako neskoršia fáza tam. |
| [D-064](D-064.md) | Multi-projekt / multi-model pripravenosť LLM vrstvy *(kandidát)* | decided | (línia D-033: multi-projekt = aditívne, keď príde). |
| [D-065](D-065.md) | Pasportizácia existujúcej budovy *(kandidát)* | decided | Kontext: Nový use-case - pasportizácia existujúcej budovy pre prevádzku a údržbu |
| [D-066](D-066.md) | AI chat ovláda 3D scénu (ofarbenie / skrytie / izolácia) | decided | Kontext: LLM rozhranie (D-056) vedelo prvky v 3D len zvýrazniť a priblížiť |
| [D-067](D-067.md) | AIM karta v natívnom paneli embed viewera | decided | Kontext: po migrácii 3D na embednutý IFClite fork (iframe wrapper, PR #17-22 + |
| [D-068](D-068.md) | Ochrana /api/ask: per-IP rate limit + origin guard | decided | Kontext: /api/ask je verejný endpoint bez auth (línia D-025/D-026 - auth zatiaľ |
| [D-069](D-069.md) | Hlasový vstup pokynov (STT) do LLM rozhrania | decided | Kontext: pokyny pre /api/ask sa písali len na klávesnici - v teréne/na mobile |
| [D-070](D-070.md) | Assetin design kit (zdieľané brand tokeny naprieč appkami) | decided | Kontext: brand assetin žije de facto len v ArchiveApp |
| [D-071](D-071.md) | Stratégia forku IFClite (upstream sync + vlastná AIM vrstva) | decided | Kontext: 3D vrstvu embedujeme cez fork AssetinSpace/ifc-lite originálu |
| [D-072](D-072.md) | Georeferencované PDF podklady (drawing underlay) v 3D viewri | decided | > D-161 (2026-10-23): split (2D panel vedľa voľnej 3D) a Drawing view ako režim... |
| [D-073](D-073.md) | Reality Capture v1 (fotky + statické 360° panorámy) | decided | body D-065 (metóda zamerania, granularita provenance, povrchy vs samostatné... |
| [D-074](D-074.md) | Zoskupenie prvkov v strome podľa IFC triedy | decided | Kontext: priestorový strom (S1, D-018/D-021) vysypal pod podlažie všetkých... |
| [D-075](D-075.md) | Projektová dokumentácia v jednom rozhraní (2D/3D prepínač, dokumenty v kartách) | decided | > D-161 (2026-10-23): prepínač 3D / 2D / Split a 2D na celú plochu vypadávajú;... |
| [D-076](D-076.md) | Identifikátorové hyperlinky v 2D IFC-lite prehliadači | decided | claude/ifc-identifier-hyperlinks-jzd5p5 (fork ifc-lite; AIMviewer len docs). |
| [D-077](D-077.md) | AIM inspector: viewer-first konsolidácia info vrstvy | decided | Kontext: audit (AUDIT-KONSOLIDACIA-2026-07-17.md) potvrdil zvyškové duplicity po |
| [D-078](D-078.md) | Detekcia nového deployu → ponuka obnovy ("staré UI po deployi") | decided | Kontext: po nasadení nového buildu používateľ v už otvorenom tabe stále videl... |
| [D-079](D-079.md) | Claude cez MCP konektor + živý príkazový kanál do viewera (Realtime) | decided | Kontext: demo má ukázať, že kvalitný IFC model (správne triedy, vzťahy,... |
| [D-080](D-080.md) | Odvodzovače nad federáciou; prvok → priestor ako rel_referenced_in_spatial_structure | decided | Kontext: demo potrebuje odpoveď „ktoré VZT prvky sú v miestnosti X". VZT.ifc... |
| [D-081](D-081.md) | Kontrola modelu voči IDS z knižnice požiadaviek (etl.ids_check) | decided | Kontext: posolstvo dema je „správne zadanie → overený model → AI, ktorej môžeš... |
| [D-082](D-082.md) | Výber prvku v 3D ako klik: tool select_in_3d a op select | decided | Kontext: Claude cez konektor (D-079) vedel prvok v 3D len zvýrazniť a priblížiť |
| [D-083](D-083.md) | Claude ovláda viewer cez MCP (F12): pohľad, rez, režim, potom spätný kanál a zápis | decided | schválení. Rozširuje D-066, D-079, D-082; fáza 1 realizuje VIEW_SET z D-075 M4. |
| [D-084](D-084.md) | IFC motor @ifc-lite/mcp ako knižnica v MCP konektore AIM | decided | Kontext: cieľ (Samuel, 17. 10.) je, aby Claude cez konektor vedel vo vieweri... |
| [D-085](D-085.md) | Spätný kanál viewer -> Claude: obálky, stav pohľadu, rez cez prvok | decided | snímky obrazovky); rozširuje D-079. |
| [D-087](D-087.md) | Pravidlo pre nové nástroje: najprv originál, adaptér v aim/, vlastné len tam, kde originál nič nemá | decided | rezervované pre zápis, D-084.) |
| [D-086](D-086.md) | Úpravy IFC modelu cez agentov: revízie, úlohy z chatu, GitHub Actions (F13) | decided | motor @ifc-lite/mcp v MCP route, ale cez ifcopenshell v GitHub Actions) a... |
| [D-088](D-088.md) | Platnosť objektov a projekt, zóny, skupiny ako uzly AIM | decided | vôbec sa s nimi nezapodievať"; Q9 "áno, IfcProject, IfcSite, zóny,... |
| [D-089](D-089.md) | Register pravidiel odvodení a vrstva AIM nad modelmi | decided | claude/epic-tesla-06p2q4. Rozširuje D-080, D-086, D-088. |
| [D-090](D-090.md) | Pripomienky a požiadavky na nové tools z konektora; issue spustí Claude session | decided | čo môžeš"), implementované na vetve claude/mcp-tools-comments-tw8wl5. Mení... |
| [D-091](D-091.md) | Kde žije AIM funkcia: predvolene AIMviewer, vo forku len zobrazenie vnútri panelov viewera | decided | Dátum: 2026-10-18 · Stav: prijaté (Samuel) · Súvisí: D-071, D-072, D-087, D-089 |
| [D-092](D-092.md) | set_section vracia polohu roviny z viewera; opravy rezu vo forku | decided | Dátum: 2026-10-19 · Stav: prijaté (výška, orezanie, widget a potvrdenie hotové;... |
| [D-093](D-093.md) | get_viewer_state: súhrn výberu, príznak orezania a identita položiek | decided | Dátum: 2026-10-19 · Stav: navrhnuté (kontrakt forku podľa dodatku, schváli... |
| [D-096](D-096.md) | style_in_3d nad Lens: systém, zóna a podlažie ako filtre, AND kritériá, skupiny s farbou a počty z viewera | decided | Dátum: 2026-10-19 · Stav: navrhnuté (požiadavka z konektora, issue #68), PR... |
| [D-094](D-094.md) | set_camera: relatívny pohyb, fit na viditeľné, cieľ filtrom, pohľad kolmo na rez | decided | Dátum: 2026-10-19 · Stav: implementované (revízia podľa D-098), fork PR... |
| [D-098](D-098.md) | Najprv to, čo viewer a originál už majú; fork len sprístupní | decided | Dátum: 2026-10-19 · Stav: prijaté (Samuel) · Súvisí: D-087, D-091, D-094, D-090... |
| [D-097](D-097.md) | ifc_relations: všetky IFC vzťahy entity zo súboru, so smerom, rekurziou a stránkovaním | decided | Dátum: 2026-10-19 · Stav: implementované (PR, čaká na merge) · Súvisí: D-084,... |
| [D-095](D-095.md) | ifc_search: full-text priamo v IFC súbore, zdroj pri každom výsledku | decided | Rozširuje D-059, D-084, D-087. |
| [D-099](D-099.md) | BCF témy nad modelmi federácie; téma pre Claude spustí session | decided | implementované na vetve claude/serene-ptolemy-r16t1s (AIMviewer aj OCB). Mení... |
| [D-100](D-100.md) | Latencia MCP konektora: meranie, región, predčítanie motora | decided | dlhšie", plán po kolách schválený), kolo 1 na vetve claude/loving-sagan-nw4ma8.... |
| [D-101](D-101.md) | Potvrdenie príkazov viewera, fronta počas načítania, príkaz bez renderu /ifc | decided | overení), vetva claude/loving-sagan-nw4ma8 v AIMvieweri aj vo forku... |
| [D-102](D-102.md) | Hľadanie prvku podľa kódu, predčítané indexy motora, rez pod podhľadom, zrušenie výberu | decided | claude/loving-sagan-nw4ma8 v AIMvieweri aj vo forku Menezeris/ifc-lite (PR... |
| [D-103](D-103.md) | Rýchle CI forku aj pre malé AIM-FORK úpravy; nočné plné CI; review neblokuje | decided | Dátum: 2026-10-19 · Stav: prijaté (Samuel) · Súvisí: D-098 (predchodca,... |
| [D-104](D-104.md) | Dokumenty z IFC: jedna sada, dedenie cez vzťahy, prehliadanie vo vieweri | decided | > Číslo: rezervované v #60 ako D-101, ale D-101 do main skôr zapísalo... |
| [D-105](D-105.md) | X-ray context z chatu: style_in_3d action=xray, drôtový model zatiaľ nie | decided | Nadväzuje na D-096 (Lens z chatu), D-101 (izolácia z chatu, mode: add), D-087 a... |
| [D-106](D-106.md) | Odvodené záznamy v paneli vlastností ako strom | decided | Nadväzuje na D-089 (vrstva odvodení, AIM záznamy v Relationship records). |
| [D-111](D-111.md) | Zoznam z chatu: open_list otvorí builder panela Lists | decided | Nadväzuje na D-087 a D-098 (najprv existujúce funkcie viewera), D-096 (filtre... |
| [D-113](D-113.md) | Panel vlastností z chatu: záložka, sekcia a zvýraznená vlastnosť | decided | Nadväzuje na D-077 (AIM / IFC inspektor), D-082 (výber ako klik), D-098 (najprv... |
| [D-108](D-108.md) | Materiálové vrstvy z IFC: ifc_get s materiálmi, ifc_material_layers | decided | Nadväzuje na D-084 (IFC motor), D-087 (najprv tools balíka). D-107 je ponechané... |
| [D-109](D-109.md) | Verzia modelu v ifc_models: revízia z model_revisions, história | decided | Nadväzuje na D-084 (IFC motor), D-086 (revízie modelov), D-087, D-102 (menej... |
| [D-110](D-110.md) | Prechod VZT sieťou cez porty: ifc_relations s recursive a stop_at | decided | Nadväzuje na D-097 (ifc_relations, through_ports o jeden krok), D-087, D-102... |
| [D-112](D-112.md) | Meranie z geometrie: ifc_measure (vzdialenosť, výška, výmery z meshu) | decided | Nadväzuje na D-084 (motor v procese), D-087 (najprv upstream tool), D-097... |
| [D-114](D-114.md) | Najprv napasuj, až potom nový tool: inventár a register toolov konektora | decided | (požiadavky z konektora) a D-098 (najprv to, čo už existuje); D-102 už raz... |
| [D-115](D-115.md) | Zlúčenie MCP toolov do toolov s rozlišovacím parametrom | decided | (najprv napasuj) a mení D-087 (prevzaté tools balíka už nie sú v zozname pod... |
| [D-116](D-116.md) | Release train: rýchle PR, plné CI raz na balík, výber viewera na skúšanie pred zlúčením | decided | Dátum: 2026-10-20 · Stav: prijaté (Samuel) · Súvisí: D-103 (predchodca,... |
| [D-118](D-118.md) | Rýchle kontroly nad modelom: atribúty v ifc_query.where a postup kontroly | decided | Dátum: 2026-10-20 · Stav: rozhodnuté (orchestrátor na Samuelov pokyn, rýchla... |
| [D-121](D-121.md) | Najkratšia a úniková cesta: ifc_measure route nad hranicami priestorov zo súboru | decided | z geometrie), D-114 (najprv napasuj) a D-086 (úprava IFC receptom v OCB). |
| [D-124](D-124.md) | Kóta vo vieweri: ifc_measure show cez nástroj Measure forku | decided | D-112 (meranie z geometrie), D-098 (most volá existujúce funkcie viewera) a... |
| [D-120](D-120.md) | Rez: vzhľad reznej plochy z chatu (šrafa, výplň) a vynechanie prvkov z rezu | decided | Dátum: 2026-10-20 · Stav: časť 1 prijatá (implementovaná), časť 2 čaká na... |
| [D-123](D-123.md) | Text dokumentov z textovej vrstvy PDF: naplnenie zo storage, riadky s polohou, čítanie strany v search_documents | decided | Dátum: 2026-10-20 · Stav: prijaté (Samuel cez orchestrátora: rámik áno, OCR... |
| [D-117](D-117.md) | Výrez strany výkresu z chatu: open_drawing region | decided | Dátum: 2026-10-20 · Stav: navrhnuté (čaká na Samuela, #129) · Súvisí: D-114... |
| [D-119](D-119.md) | Miestnosti a farby z chatu: zapnutie IfcSpace, výplň v 2D, rozsah a veľká legenda Color by | decided | Dátum: 2026-10-20 · Stav: navrhnuté (čaká na Samuela) · Súvisí: D-096, D-102,... |
| [D-122](D-122.md) | Uložené pohľady viewera: saved_view, zoznam v get_viewer_state, obnova v set_view_mode | decided | > D-161 (2026-10-23): nositeľom pohľadu vo vieweri je upstream Presentation,... |
| [D-125](D-125.md) | Živý stav viewera v odpovediach: identita viewera, zmeny mimo príkazov, priestory v Lens, výplň v reze a malá legenda | decided | Dátum: 2026-10-21 · Stav: navrhnuté (čaká na Samuela) · Súvisí: D-085, D-096,... |
| [D-126](D-126.md) | Úplné a stránkované výsledky DB tools, hľadanie cez vzťahy, overenie zatvorených issues | decided | D-056 (query_view), D-060 (aggregate_objects), D-090 (feedback), D-095... |
| [D-127](D-127.md) | Panel vlastností len IFC, lepivé zvýraznenie vlastnosti, panely z chatu, výrez dokumentu podľa karty | decided | Nadväzuje na D-077 (AIM karta v paneli), D-113 (panel vlastností pri výbere),... |
| [D-129](D-129.md) | Viewer je jediné rozhranie: údaj buď v IFC, alebo AIM vrstva s odznakom | decided | D-077 (AIM inspector), D-086 (IFC je master, revízie), D-089 (odvodenia ako AIM... |
| [D-128](D-128.md) | Kamera na cieľ v reze s okrajom a časťou cieľa, vzor šrafy reznej plochy | decided | Dátum: 2026-10-21 · Stav: prijaté (implementované) · Súvisí: D-083, D-094,... |
| [D-131](D-131.md) | Reality Capture v paneli Documents, druh média ako druhá os klasifikácie, export AIM vrstiev do IFC | decided | implementované, bod 3 navrhnutý a zaparkovaný (#202). Nadväzuje na D-073... |
| [D-130](D-130.md) | Popisky na výkrese ako odkazy na prvok: párovanie z textovej vrstvy ako AIM vrstva | decided | D-076 (identifikátorové odkazy vo forku), D-082 (výber ako klik), D-123 (riadky... |
| [D-133](D-133.md) | Automatická kalibrácia podkladov výkresov: pohľad + strana PDF, rez modelu a čiary výkresu | decided | Dátum: 2026-10-21 · Stav: prijaté (Samuel cez orchestrátora, #170),... |
| [D-132](D-132.md) | Záložky vo vieweri: pohľad je orez, záložka je otvorený pohľad | decided | > D-161 (2026-10-23): záložky druhu plan a view, menu "+ Pôdorys" a zámok... |
| [D-134](D-134.md) | Náročnosť požiadavky z konektora: routines STANDARD (Sonnet) a HARD (Opus) | decided | D-090 (požiadavky z konektora, routine), D-099 (BCF routine). |
| [D-135](D-135.md) | Egress Supabase: viewer a IFC motor čítajú nemenný archív revízie, sessions testujú na malom modeli | decided | (geometria v prehliadači), D-084 (IFC motor), D-086 (revízie a archív),... |
| [D-136](D-136.md) | Dlaždicové rozloženie viewera: krok 1 je pôvodný 2D výkres rezu, viac 3D pohľadov je otázka renderera | decided | (dlaždice s viacerými 3D pohľadmi) čaká na Samuela. Issue #210. Nadväzuje na... |
| [D-138](D-138.md) | style_in_3d: priorita prekrytých pravidiel a hlasné varovanie pri pravidle bez zásahu | decided | D-096 (Lens z chatu), D-125 (inactive) a #219 (varovania pri mode=replace). |
| [D-139](D-139.md) | style_in_3d colorize: priesvitnosť farby (opacity) a predvolene priesvitné priestory a zóny | decided | bod 4 (priesvitná varianta farby priestoru), D-138 (priorita pravidiel), #175... |
| [D-140](D-140.md) | set_section relative_to=ceiling: výška podhľadu z geometrie IfcCovering CEILING, Qto len záloha | decided | (rez pod podhľadom), D-092 (rez nad podlažím, elevácia z DB), D-112... |
| [D-141](D-141.md) | Spodná stavová lišta hostu pod viewerom: výber viewera a Live neprekrývajú panely | decided | (výber viewera), D-079 (živý kanál), D-091 (AIM funkcia predvolene v hoste),... |
| [D-142](D-142.md) | get_object include=quantities: Qto výmery a psety jedného prvku z IFC jedným volaním | decided | Dátum: 2026-10-22 · Issue: #184 · Nadväzuje na: D-021, D-084, D-114, D-115 |
| [D-137](D-137.md) | Čiara trasy vo vieweri: ifc_measure route + show kreslí únikovú cestu 1,6 m nad podlahou | decided | v registri #60. Nadväzuje na D-121 (trasa z grafu zo súboru), D-124 (kóta cez... |
| [D-145](D-145.md) | "Ukázať v 3D" pri PDF s podlažím: Solo podlažia a rezové nástroje namiesto samotného X-ray | decided | Dátum: 2026-10-22 · Issue: #214 · Fork PR: Menezeris/ifc-lite#116 · Nadväzuje... |
| [D-151](D-151.md) | Výber z filtra (show_in_3d select) a skrytie s výnimkou (style_in_3d hide), len v hoste | decided | Dátum: 2026-10-22 · Issue: #242, #246 · Nadväzuje na: D-066, D-096, D-098,... |
| [D-146](D-146.md) | Posun panela vlastností z chatu (set_view_mode panel_scroll) a opravená cesta k riadku Qto (#183) | decided | Dátum: 2026-10-22 · Issue: #183 · Nadväzuje na: D-113, D-114, D-127, D-098 |
| [D-148](D-148.md) | open_list run=true: zoznam sa po otvorení rovno spustí a odpoveď toolu povie, či beží | decided | Dátum: 2026-10-22 · Issue: #248 (nadväzuje na #185) · Fork PR:... |
| [D-153](D-153.md) | Načítanie toolov konektora v klientovi: blok v inštrukciách, anthropic/alwaysLoad, nastavenie Tool access | decided | Dátum: 2026-10-22 · Issue: #237 · Nadväzuje na: D-079, D-102, D-114, D-115 |
| [D-155](D-155.md) | ifc_measure: jedna os, kresba svetlého otvoru a vzdialenosť dvoch plôch | decided | Dátum: 2026-10-22 · Issue: #236 · Nadväzuje na: D-084, D-112, D-114, D-118,... |
| [D-156](D-156.md) | Hranice priestorov (IfcRelSpaceBoundary): rel_space_boundary a v_space_elements s relation = 'boundary' | decided | Dátum: 2026-10-22 · Issue: #245 · Nadväzuje na: D-080, D-098, D-114, D-126 |
| [D-136-dup](D-136-dup.md) | Dlaždicové rozloženie viewera: krok 1 je pôvodný 2D výkres rezu, viac 3D pohľadov je otázka renderera | decided | (dlaždice s viacerými 3D pohľadmi) čaká na Samuela. Issue #210. Nadväzuje na... |
| [D-157](D-157.md) | Dlaždice vo vieweri: jedno živé 3D, ostatné 3D dlaždice ako snímka, set_view_mode layout | decided | > D-161 (2026-10-23): dlaždica ukazuje aj pohľad z Presentation (výber v... |
| [D-158](D-158.md) | Pripomienky na dokumentoch: BCF téma s odkazom na dokument, stranu a oblasť strany | decided | > D-161 (2026-10-23): pre uložené pohľady sa "zápis do DB len z chatu" mení:... |
| [D-150](D-150.md) | Všetky panely UI v set_view_mode panels, zoznam odvodený z forku, posun na položku a zoom panelu (#179) | decided | Dátum: 2026-10-22 · Issue: #179 (overenie "vrátené" z 22. 10. 05:44 UTC) ·... |
| [D-149](D-149.md) | "Excel hlasom" nad panelom Lists: open_list action=update, maximalizácia, filter, zoradenie, súčet a stav zoznamu | decided | Dátum: 2026-10-22 · Issue: #250 (z #179 doplnenia 21. 10. 07:41 a 07:42, #185)... |
| [D-152](D-152.md) | Zmazanie kót od Claude: ifc_measure clear=true a reset_colors vo vieweri | decided | Dátum: 2026-10-22 · Issue: #235 · Nadväzuje na: D-098, D-114, D-124, D-137 |
| [D-154](D-154.md) | Plynulé otáčanie modelu dokola (set_camera auto_rotate), zastaví sa pri zásahu používateľa (#247) | decided | Dátum: 2026-10-22 · Issue: #247 · Fork PR: Menezeris/ifc-lite (patch... |
| [D-159](D-159.md) | Živý viewer patrí chatu používateľa: testovací kanál pre pracovné sessions, vlastník okna a prostredie v lište | decided | Dátum: 2026-10-23 · Stav: rozhodnuté (plán schválený Samuelom cez... |
| [D-160](D-160.md) | Názvy zón vo výkresoch ako odkazy a ručné priradenie a zrušenie odkazu popisku (#268) | decided | Dátum: 2026-10-23 · Stav: schválené (orchestrátor, plán bodov 1 až 6),... |
| [D-161](D-161.md) | Bez režimu 2D: pohľady nesie upstream Presentation (basket views), mode=2d je len kamera zhora a rez (#188) | decided | Dátum: 2026-10-23 · Stav: rozhodnuté (Samuel cez orchestrátora 23. 10., "áno";... |
| [D-162](D-162.md) | IDS z chatu a z viewera: tvorba, úprava, verzie v DB, validácia a upstream IDS modul (#285) | decided | Dátum: 2026-10-23 · Stav: schválené (Samuel cez orchestrátora 23. 10., odpovede... |
| [D-163](D-163.md) | Načítavanie viewera: biele pozadie a animované logo z design-kitu (#290) | decided | Rozhodnutie (Samuel, 23. 10. 2026): pri načítavaní AIM Viewera je biele pozadie... |
| [D-164](D-164.md) | Clash detection z chatu a z viewera: testy, behy, porovnanie, stav kolízie a BCF nad upstream @ifc-lite/clash (#292) | decided | Dátum: 2026-10-23 · Stav: schválené (Samuel cez orchestrátora 23. 10., "áno" na... |
| [D-166](D-166.md) | Označenie a štandardné psety klapiek IfcDamper vo VZT (BCF #17, aj #14 a #15) | decided | Dátum: 2026-10-28 · Stav: rozhodnuté (Samuel cez orchestrátora 28. 10., variant... |
| [D-165](D-165.md) | ifc_relations: stop_at Trieda.PREDEFINED berie PredefinedType aj z typu prvku (#300) | decided | Dátum: 2026-10-23 · Stav: implementované · Issue: #300 · Nadväzuje na: D-110... |
| [D-168](D-168.md) | Podklady PDF z chatu: ovládanie v calibrate_underlay a stav podkladov v uloženom pohľade (#323, #325) | decided | Dátum: 2026-10-29 · Stav: implementované v hoste (PR #333 zlúčený; história... |
| [D-167](D-167.md) | ifc_relations vracia aj odvodené IfcRelReferencedInSpatialStructure z grafu AIM, s kind (#297) | decided | Dátum: 2026-10-29 · Stav: rozhodnuté (Samuel cez orchestrátora 29. 10.),... |
| [D-169](D-169.md) | OCR pre strany PDF bez textovej vrstvy: záchrana, nie náhrada textu z PDF (#279) | decided | Dátum: 2026-10-29 · Stav: rozhodnuté (Samuel cez orchestrátora 29. 10.: "zatiaľ... |
| [D-170](D-170.md) | ifc_measure: kóty sa hromadia (keep), clear ich maže, host počíta kóty na plátne (#278) | decided | Dátum: 2026-10-29 · Issue: #278 · Nadväzuje na: D-114, D-124, D-152 |
| [D-171](D-171.md) | open_list: zvýraznenie, šírky stĺpcov, filter viditeľnosti a stĺpce zo vzťahov (#274, #275, #276, #277) | decided | Dátum: 2026-10-29 · Issues: #274, #275, #276, #277 · Nadväzuje na: D-111,... |
| [D-172](D-172.md) | set_view_mode: pomer dlaždíc (ratio, sizes) a šírka a strana panela (panel_layout) (#299, #320, Refs #298) | decided | Dátum: 2026-10-29 · Issue: #299, #320 (a zvyšok #298) · Nadväzuje na: D-114,... |
| [D-173](D-173.md) | IfcSpace sa nikdy nefarbí plnou farbou, len priesvitne (#298) | decided | Dátum: 2026-10-29 · Issue: #298 · Nadväzuje na: D-096, D-114, D-139, D-172 |
| [D-174](D-174.md) | open_list: odvodené väzby z DB ako stĺpec source: "host" (Refs #277) | decided | Dátum: 2026-10-29 · Issue: #277 · Nadväzuje na: D-111, D-114, D-167, D-171 ·... |
| [D-175](D-175.md) | Zvýraznenie vlastnosti počká na panel (#168), pohľad a výber berú viditeľné prvky z izolácie (#315) | decided | Dátum: 2026-10-29 · Issue: #168, #315 · Nadväzuje na: D-113, D-114, D-127,... |
| [D-177](D-177.md) | clash action=matrix: matica modelov (disciplín) federácie (Closes #302) | decided | Dátum: 2026-10-29 · Issue: #302 · Nadväzuje na: D-114, D-164 · Fork:... |
| [D-176](D-176.md) | calibrate_underlay: remove, object_ref v manual, výkres podlažia v set_view_mode(split) (#284, #316) | decided | Dátum: 2026-10-29 · Issue: #284 (d, e), #316 (bod 3) · Nadväzuje na: D-133,... |
| [D-178](D-178.md) | Načítanie viewera: priebeh po modeloch a dokresľovanie (LOAD_PROGRESS, FIRST_GEOMETRY; mení D-163, Refs #308) | decided | Dátum: 2026-10-30 · Stav: host PR (Refs #308), čaká na fork... |
| [D-179](D-179.md) | calibrate_underlay: rovina rezu zo značky na kalibrovanom pôdoryse, kóty na podlažia, osi z pôdorysu (#284) | decided | Dátum: 2026-10-30 · Issue: #284 (f) · Nadväzuje na: D-133 (bod 3 a 5), D-168,... |
| [D-180](D-180.md) | calibrate_underlay: pôdorys bez popiskov miestností, podlažie bez IfcSpace, výrez strany a kontrola rozumnosti (#170) | decided | Dátum: 2026-10-30 · Issue: #170 (návrh doplnenia z 22. 10.) · Nadväzuje na:... |
| [D-183](D-183.md) | Zdroj pravdy: kontajner revízie je pravda, DB je úplná kópia informácií každej revízie (#220) | decided | Dátum: 2026-10-30 · Issue: #220 (plán a tri analýzy z 30. 10.) · Nadväzuje na:... |
| [D-184](D-184.md) | calibrate_underlay: osi (gridy) z iných výkresov ako štart a kontrola, sken pri nízkom pokrytí, uzamknutie natočenia (#170) | decided | Dátum: 2026-10-30 · Issue: #170 (tabuľky dry_run 30. 10.), #316 · Nadväzuje na:... |
| [D-181](D-181.md) | Export ICDD (ISO 21597-1/-2): kontajner revízií s väzbami AIM, skladaný v prehliadači, roundtrip (#350) | decided | Dátum: 2026-10-31 · Issue: #350 (plán 30. 10. a odpovede Samuela v komentároch)... |
| [D-185](D-185.md) | Overovač výmer voči geometrii: ifc_measure verify=true pre miestnosti, register metód, uložené behy k revízii | decided | debnenie, objem nad podhľadom a ďalšie triedy neskôr. Nadväzuje na D-112,... |
| [D-182](D-182.md) | Knižnica požiadaviek v AIM: hotové IDS z repa knižnice, vedomé priradenie k projektu, výsledok kontroly z viewera s pečiatkou (#351) | decided | Dátum: 2026-11-02 · Stav: schválené (Samuel cez orchestrátora 30. 10. odpovede... |
| [D-186](D-186.md) | Port knižnice požiadaviek z Pythonu do TypeScriptu v AIMviewer; krok 1: korpus zhody, parser blokov, prehliadač hlavy | decided | Dátum: 2026-11-02 · Stav: schválené (Samuel: assetin-library DECISIONS V30,... |
| [D-187](D-187.md) | Náklady Vercelu: kontrola pred zlúčením v GitHub Actions, náhľady len na požiadanie | decided | Dátum: 2026-11-03 · Stav: schválené (Samuel 3. 11. cez orchestrátora: "nastav... |
| [D-188](D-188.md) | Schéma platform v zdieľanej DB pre platformu Assetin (AIMforked), rola platform_app so stropom pripojení, pgvector | decided | Dátum: 2026-11-04 · Stav: schválené (Samuel 4. 11.: "krok 1, stropy pripojení,... |
| [D-189](D-189.md) | AIMviewer becomes multi-project: project_id on project-bound tables, models identified by UUID, per-project codes, one project resolver | decided | Date: 2026-11-04 · Status: approved (Samuel 4 Nov, round 1 answers below;... |
| [D-190](D-190.md) | Projects other than OCB: CDE file names, archive by model UUID, <code>: refs (D-189 PR 3) | decided | Date: 2026-11-05 · Status: approved (Samuel 5 Nov, plan rounds of D-189 PR 3;... |
| [D-191](D-191.md) | Orchestration model for the platform work lives in AIMforked | decided | Date: 2026-11-05 · Status: approved (Samuel 5 Nov) · Builds on: D-090... |
| [D-192](D-192.md) | AIMforked e2e runs in GitHub Actions | decided | Date: 2026-11-05 · Status: approved (Samuel 5 Nov, option A; number from the... |
| [D-193](D-193.md) | Samuel's decisions relayed by the orchestrator | decided | Date: 2026-11-05 · Status: approved (Samuel 5 Nov; number from the... |
| [D-194](D-194.md) | The project in English | decided | Date: 2026-11-05 · Status: approved (Samuel 5 Nov; scope widened the same day;... |
| [D-195](D-195.md) | IFC 4.3 schema in the repo, entity manifest entity_types, properties._attributes | decided | Date: 2026-11-05 · Status: approved (Samuel 5 Nov, plan round of platform step... |
