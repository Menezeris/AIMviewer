# Inventár toolov MCP konektora

> Generované z definícií toolov (`lib/mcp/tool-list.ts`), needituj ručne. Obnova:
> `npx vitest run lib/mcp/tool-registry.test.ts -u`.

Konektor má 31 toolov (s IFC motorom, `ENGINE_ENABLED=1`).

**Pravidlo D-114 - najprv napasuj, až potom nový tool:**
1. Tu nájdi 2-3 najbližšie tooly k tomu, čo treba.
2. Skús schopnosť dať do nich v tomto poradí: nový parameter alebo hodnota enumu
   (`action`, `mode`, `include`...), pole vo výsledku, lepší opis alebo inštrukcia
   (ak schopnosť už existuje, len ju agent nenašiel).
3. Nový tool len keď nejde ani jedno; záznam rozhodnutia má sekciu
   "Zavrhnuté rozšírenie: `<tool>` - prečo nie" a nový riadok v
   `lib/mcp/tool-registry.json` schvaľuje Samuel v issue.

Legenda: `*` = povinný parameter, `=a|b` = povolené hodnoty, v zátvorke rozhodnutie,
ktoré tool zaviedlo, a či číta alebo zapisuje (zápis si v claude.ai pýta súhlas);
"vždy načítaný" = `_meta` `anthropic/alwaysLoad`, klient ho nemusí hľadať cez tool_search (D-153).

## AIM graf, pohľad a navigácia (15)

Zdroj: DB (AIM graf) -> živý viewer. Definície: lib/llm/tools.ts, lib/llm/view-tools.ts, lib/llm/list-tool.ts. Aj chat `/api/ask`.

- **`get_model_stats`** (D-056, čítanie) - Slovník modelu: počty uzlov podľa object_type, zoznam IFC tried assetov (ifc_type × predefined_type) s počtami, zoznam psetov (názvy + počet properties), podlažia, systémy, klasifikačné systémy a dokumenty.
  Parametre: žiadne
- **`search_objects`** (D-056, čítanie, vždy načítaný) - Nájde, SPOČÍTA alebo LOKALIZUJE uzly grafu AIM podľa identity a IFC typológie. mode=list (default): riadky; count: presný počet ('koľko X je v budove'; z riadkov list nepočítaj, sú orezané); locate: presný počet + rozpad po podlažiach a miestnostiach so vzorkou ('koľko X a kde / na ktorých podlažiach', predvolene object_type asset, alebo ids z predošlého hľadania). `query` hľadá v názve, object_ref, IFC triede aj predefined_type (ilike). ifc_type = IFC trieda (IfcDoor), predefined_type = podtyp (AIRCONDITIONINGUNIT je predefined_type, NIE ifc_type).
  Parametre: `mode=list|count|locate`, `query`, `object_type`, `ifc_type`, `predefined_type`, `ids`, `limit`, `offset`
- **`query_view`** (D-056, čítanie) - Generický read-only dopyt nad ľubovoľnou tabuľkou/view v DB (celá dátová vrstva).
  Parametre: `relation*`, `select`, `filters`, `order`, `count_only`, `limit`, `offset`, `related`
- **`aggregate_objects`** (D-060, čítanie) - Presné agregácie a ČÍSELNÉ porovnania nad hodnotami psetov — počíta databáza, nikdy nepočítaj z orezaných riadkov.
  Parametre: `relation`, `agg`, `prop_path`, `group_by`, `group_by_path`, `filters`, `ids`, `max_groups`, `return_rows`
- **`get_object`** (D-056, čítanie, vždy načítaný) - Detail jedného uzla podľa UUID, object_ref (napr. 'DD01.06.03') alebo kódu prvku (meno ako 'VV.03.01.040'; prvok len v IFC vráti in_aim:false a global_id): identita, IFC trieda, predefined_type, IFC GUID a podlažie (floor). include pridá v tom istom volaní: details = VLASTNOSTI psetov (aj zdedené z typu, napr. výrobný typ) a klasifikácie; path = V KTOREJ MIESTNOSTI a podlaží je (aj odvodené geometriou, napr. VZT prvok v miestnosti z ASR); documents = DOKUMENTY a strany, ktoré k nemu patria, aj zdedené cez typ, zónu, skupinu (skladby), systém, priestorovú zónu (požiarny úsek), podlažie a miestnosť, s cestou (via_name, through) a deep_link na stranu; pri dokumente opačne: ktorých objektov sa týka (počty podľa typu a nositeľa + vzorka); quantities = Qto VÝMERY (objem, plocha, dĺžka...) a psety priamo z IFC súboru, z výskytu aj z typu, ako zoznam {qto, name, value, source} v poli ifc (D-142).
  Parametre: `id_or_ref*`, `include=details|path|documents|quantities`
- **`list_relations`** (D-056, čítanie) - Vzťahy uzla cez kanonické views: rel_aggregates (dekompozícia štruktúry), rel_contained_in_spatial_structure (prvok v priestore/podlaží, natívne zo súboru), rel_referenced_in_spatial_structure (prvok sa nachádza aj v priestore — odvodené geometriou naprieč modelmi, role inside|partial), rel_space_boundary (prvok ohraničuje priestor, IfcRelSpaceBoundary, role physical|virtual), rel_defines_by_type (occurrence→typ), rel_associates_document (uzol→dokument), rel_associates_classification, rel_assigns_to_actor (zodpovednosti, aktor→uzol), rel_assigns_to_group (člen→systém), rel_member_of (osoba→organizácia).
  Parametre: `rel_type*`, `from_id`, `to_id`, `limit`
- **`show_in_3d`** (D-056, čítanie, vždy načítaný) - UI AKCIA: UKÁŽ alebo VYBER prvky v 3D. Predvolene zvýrazní (oranžovo) a priblíži prvky - 'ukáž / zobraz X', aj jednu miestnosť (skrytú viewer zapne).
  Parametre: `ids_or_refs`, `id_or_ref`, `clear`, `global_ids`, `ifc_type`, `predefined_type`, `query`, `object_type`, `select`, `panel_section=properties|quantities`, `highlight`
- **`style_in_3d`** (D-066, čítanie) - UI AKCIA: ofarbí / skryje / znova zobrazí / izoluje prvky v 3D modeli, alebo resetne pohľad.
  Parametre: `action*=colorize|transparent|hide|show|isolate|xray|clear_isolation|show_all|reset_colors|legend`, `opacity`, `mode=add|replace`, `color_by=ifc_type|system|zone|material|model|classification|property|attribute`, `legend_size=compact|large|normal`, `clear_section`, `context_storey`, `color_by_key`, `color`, `ids_or_refs`, `exclude_ids_or_refs`, `exclude_global_ids`, `global_ids`, `ifc_type`, `ifc_types`, `domain=hvac|plumbing|electrical|architecture|structure`, `model`, `predefined_type`, `property`, `value`, `pset`, `query`, `system`, `system_type`, `not_in_system`, `zone`, `storey`, `document`, `page`, `groups`
- **`open_drawing`** (D-056, čítanie) - UI AKCIA: otvorí výkres/dokument v prehliadačke, voliteľne so zvýrazneným prvkom, stranou, výrezom strany (region = priblíženie na časť strany v karte vo vieweri) a rámikmi okolo textu (highlights).
  Parametre: `document_id*`, `focus_id`, `page`, `in_viewer`, `target=tab|split`, `region`, `highlights`, `link`
- **`open_node`** (D-056, čítanie) - UI AKCIA: otvorí detailnú kartu uzla (asset, typ, miestnosť, podlažie, systém, osoba, organizácia…).
  Parametre: `id_or_ref*`
- **`search_documents`** (D-063, čítanie) - OBSAH dokumentov a výkresov (textová vrstva PDF strán, strana bez nej z OCR so source='ocr': popisky a čísla miestností, kóty, hrúbky, legendy, špecifikácie, pečiatky, text technických správ).
  Parametre: `q`, `document_id`, `page`, `include_blocks`, `include_links`, `limit`
- **`set_section`** (D-083, čítanie) - UI AKCIA: rez modelom v 3D. Vodorovný rez nad podlažím = floor + offset_m (výška nad úrovňou podlažia v m, default 1,2 = pôdorysný rez; záporná = pod úrovňou).
  Parametre: `action*=set|clear|widget`, `orientation=horizontal|vertical_x|vertical_z`, `floor`, `offset_m`, `relative_to=floor|ceiling`, `position_percent`, `target_ids_or_refs`, `global_ids`, `fit=along|across|center`, `coordinate_m`, `flipped`, `show_widget`, `cap_style=hatch|solid|none`, `cap_color`, `box`, `margin_m`, `hatch_pattern=diagonal|diagonal_reverse|cross|crosshatch|horizontal|vertical|dots|brick|insulation`, `hatch_angle_deg`, `hatch_spacing_px`, `hatch_line_width_px`
- **`set_camera`** (D-083, čítanie) - UI AKCIA: kamera v 3D. preset = smer pohľadu (top/bottom/front/back/left/right/iso; fit_all = celý model; section = kolmo na aktívny rez, ako tlačidlo Set view; keep = zachovať smer, default). fit = čo zarámovať pri danom smere: visible (viditeľné, aj izolované prvky), selection (výber vo vieweri).
  Parametre: `preset=top|bottom|front|back|left|right|iso|fit_all|keep|section`, `fit=visible|selection`, `target_ids_or_refs`, `global_ids`, `ifc_type`, `ifc_types`, `domain=hvac|plumbing|electrical|architecture|structure`, `model`, `zoom_percent`, `orbit_h_deg`, `orbit_v_deg`, `pan_x_percent`, `pan_y_percent`, `projection=perspective|orthographic`, `auto_rotate=start|stop`, `speed_deg_s`, `direction=left|right`, `margin_percent`, `area=left|right|top|bottom|front|back`
- **`set_view_mode`** (D-083, čítanie, vždy načítaný) - UI AKCIA: kamera a pohľady vieweru. 2D nie je režim. mode=3d = perspektíva (reset=true s ním vráti pôvodný pohľad: bez rezu, farieb, skrytia, výberu a zvýraznenia, izometria). mode=2d + floor = POHĽAD ZHORA na podlažie na bežnom 3D: ortografická kamera zhora a vodorovný rez 1,2 m nad podlahou, alebo uložený pohľad toho podlažia; bez zámku, orbit a nástroje fungujú hneď (miestnosti ofarbené cez style_in_3d sú v ňom vyplnené a popísané).
  Parametre: `mode=3d|2d|split`, `floor`, `reset`, `saved_view`, `view`, `tab`, `beside`, `close_tab`, `layout=single|split_h|split_v|three_left|three_right|three_top|three_bottom|three_h|three_v|grid4`, `tiles`, `panels`, `panel_scroll`, `panel_zoom`, `underlays_3d`, `plan_position`, `section_offset_m`
- **`open_list`** (D-111, čítanie) - Tabuľka prvkov v paneli Lists vo vieweri (export do CSV/XLSX/PDF): "exportuj dvere na 1NP ako tabuľku", "zoznam tvaroviek s rozmermi do Excelu".
  Parametre: `name`, `columns`, `run`, `action=open|update`, `maximize`, `sort_by`, `sort_dir=asc|desc`, `sum`, `group_by`, `search`, `add_columns`, `remove_columns`, `add_types`, `remove_types`, `remove_filter=storey|model|property|system|system_type|zone|document|global_ids|ids_or_refs|query|...`, `color_by`, `export=csv|xlsx|pdf`, `visible_only`, `column_widths`, `highlight`, `ifc_type`, `ifc_types`, `domain`, `predefined_type`, `storey`, `system`, `system_type`, `zone`, `document`, `page`, `property`, `pset`, `value`, `query`, `model`, `global_ids`, `ids_or_refs`

## Dotazy na stav viewera (1)

Zdroj: živý viewer (spätný kanál). Definície: lib/live/viewer-query-tools.ts. Len MCP.

- **`get_viewer_state`** (D-085, čítanie, vždy načítaný) - Čo práve ukazuje OTVORENÝ živý viewer: kamera (pozícia, cieľ v IFC, projekcia), aktívny rez (os, súradnica v IFC, poloha v %), aktívny pohľad z Presentation (view: id, name), výber a počty skrytých a izolovaných prvkov.
  Parametre: `bounds`, `saved_views`, `target_ids_or_refs`, `global_ids`, `items_offset`, `items_limit`

## Uložené pohľady (1)

Zdroj: DB (saved_views) + živý viewer. Definície: lib/views/tools.ts (zoznam v get_viewer_state, obnova v set_view_mode). Len MCP.

- **`saved_view`** (D-122, zápis) - ULOŽÍ POHĽAD do panela Presentation (pás pohľadov, spoločný pre stavbu): 'ulož to ako Pôdorys technickej miestnosti 3.14'. action=save uloží to, čo je vo vieweri práve nastavené (kamera s projekciou, rezy, košík = viditeľné prvky; prázdny košík = všetko viditeľné, podklady PDF v 3D = zapnuté/vypnuté, ktoré podklady sú viditeľné a ich priehľadnosť), ako tlačidlo Uložiť v paneli; otvorenie pohľadu tento stav podkladov obnoví (pohľad uložený starším viewerom podklady nemení; nastav ich cez calibrate_underlay mode=show_in_3d|hide|set_opacity a ulož znova).
  Parametre: `action*=save|rename|delete`, `name*`, `new_name`, `description`, `overwrite`, `author`

## BCF témy nad modelmi (2)

Zdroj: DB (model_tasks) + session. Definície: lib/bcf/tools.ts. Len MCP.

- **`bcf_topic_list`** (D-099, čítanie) - BCF témy nad modelmi federácie (D-099; issues a požiadavky konektora dá feedback_status), najnovšie prvé: číslo, guid, názov, stav, typ, priorita, komu, model, počet prvkov a komentárov, odkaz na Claude session.
  Parametre: `status`, `model`, `assigned_to`, `guid`, `document`, `page`, `entity`, `limit`
- **`bcf_topic`** (D-099, zápis) - Zápis BCF témy nad modelom federácie (D-099). action=create: založí tému (chyba, kolízia, pripomienka, požiadavka na úpravu modelu), keď používateľ povie 'založ BCF / tému / issue'; prvky cez target_ids_or_refs alebo global_ids, s capture_view (predvolene) sa vezme výber, kamera, rez a režim z otvoreného viewera. assigned_to='claude' = tému rieši Claude: spustí sa Claude Code session (úprava IFC v OCB, nová revízia); ľudí priraď menom alebo e-mailom. update: stav, priorita, komu, popis, štítky, termín alebo comment; start_session spustí session pre tému Claudovi. close: uzavrie tému bez úpravy modelu. viewpoint: nastaví jediný pohľad témy (selection_global_ids, capture_view).
  Parametre: `action*=create|update|close|viewpoint|from_viewer|locate`, `guid`, `title`, `description`, `comment`, `status`, `priority`, `assigned_to`, `type`, `labels`, `model`, `due_date`, `author`, `modified_by`, `target_ids_or_refs`, `global_ids`, `selection_global_ids`, `capture_view`, `start_session`, `document`, `remove_document`, `guids`, `document_guid`, `apply=components|viewpoint|all`, `replace`, `include_parents`

## Pripomienky a požiadavky (2)

Zdroj: GitHub issues + session. Definície: lib/feedback/tools.ts. Len MCP.

- **`feedback_status`** (D-090, čítanie) - Stav pripomienok a požiadaviek na tools (D-090). Bez issue_number vráti otvorené issues konektora (číslo, názov, druh, či beží session); s issue_number stav issue, odkaz na session, PR a posledné komentáre (otázky session na používateľa).
  Parametre: `issue_number`, `state=open|closed|all`, `verified`, `limit`
- **`feedback`** (D-090, zápis) - Zápis do GitHub issues konektora (D-090). Volaj LEN na výslovný pokyn používateľa ('zapíš to', 'založ pripomienku', 'dopíš do #97'); sám to len ponúkni. action=report: PRIPOMIENKA - chyba toolu (bug), zlé dáta (wrong_data), zlá odpoveď (wrong_answer), návrh (improvement); kind, title, description, start_session len keď to používateľ chce. request_tool: POŽIADAVKA NA NOVÝ TOOL až po vyčerpaní existujúcich tools; opíš potrebu (user_request, why_existing_fail, tried_tools s konkrétnymi tools); ak stačí rozšíriť existujúci tool (parameter, akcia, pole vo výsledku), uveď ho v proposal.extend - rozšírenie má prednosť (D-114); spustí session alebo ide do fronty, rovnaká požiadavka sa pripíše ako ďalší výskyt. comment: komentár do existujúceho issue, aj zatvoreného (issue_number, text, kind eval_round | result | note; verification=overene | vratene zapíše overenie hotového issue; reopen len na výslovný pokyn; GitHub konektor na to netreba). start_session: spustí session pre ďalšie issue z fronty (over_limit len na výslovnú žiadosť).
  Parametre: `action*=report|request_tool|comment|start_session`, `kind=bug|wrong_data|wrong_answer|improvement|eval_round|result|note`, `title`, `description`, `tool`, `example`, `object_refs`, `user_request`, `why_existing_fail`, `tried_tools`, `proposal`, `area=aim_data|viewer|ifc_engine|model_change|requirements_library|other`, `examples`, `issue_number`, `text`, `reopen`, `verification=overene|vratene`, `over_limit`, `start_session`, `narocnost=standard|hard`, `narocnost_dovod`

## IDS dokumenty (1)

Zdroj: DB (ids_documents, verzie s XML) + @ifc-lite/mcp (ids_*). Definície: lib/ids/tool-defs.ts, lib/ids/tools.ts. Len MCP.

- **`ids_document`** (D-162, zápis) - IDS DOKUMENTY v AIM (D-162): požiadavky na model (IDS 1.0), ktoré Claude tvorí, upravuje a ukladá s verziami.
  Parametre: `action*=list|get|create|apply_ops|versions|diff|export|open|from_viewer`, `ids`, `version`, `include_xml`, `code`, `title`, `xml`, `derived_from`, `derived_from_version`, `ops`, `target=studio|validation`, `spec`, `run`, `base_version`, `note`, `from_version`, `to_version`, `author`

## IFC motor (9)

Zdroj: IFC súbory federácie (@ifc-lite/mcp); clash ukladá testy, behy a stav kolízií do DB (clash_*). Definície: lib/engine/search-all.ts, lib/engine/tool-defs.ts, lib/engine/passthrough-defs.ts, lib/engine/underlay-tool.ts. Len MCP.

- **`search_all`** (D-095, čítanie) - Hľadanie podľa textu naraz v OBOCH zdrojoch: IFC súbor (atribúty Name, Description, ObjectType, Tag, LongName, všetky psety a Qto aj z typu, klasifikácie, materiály, zóny, skupiny) a graf AIM v DB (názov, object_ref, importované psety, dokumenty, osoby).
  Parametre: `text*`, `source=all|ifc|aim`, `badges=IFC|AIM|IFC+AIM`, `ifc_types`, `model`, `limit`, `fields=attribute|property|quantity|type_property|classification|material`, `fuzzy`, `offset`, `related`
- **`ifc_models`** (D-084, čítanie) - IFC MOTOR: IFC SCHÉMA, modely federácie a údaje súboru. action=schema: z ktorej triedy IFC trieda dedí, celá línia dedičnosti a atribúty (type, napr. IfcAirTerminal; bez modelu) - neodpovedaj z pamäti. revisions (default): aktuálna revízia modelu (vNNN, dátum, autor, zmeny), history = aj predchádzajúce; info: schéma IFC, jednotky, georeferencovanie; materials / classifications: zoznam materiálov a klasifikácií s počtami; audit: zdravie modelu.
  Parametre: `action=revisions|info|materials|classifications|audit|schema`, `model=ASR|VZT`, `history`, `type`, `include_inherited`
- **`ifc_query`** (D-084, čítanie) - IFC MOTOR: prvky v IFC súbore podľa MATERIÁLU (material: izolácia, minerálna vlna, EPS, betón - aj vrstva skladby a materiál z typu; graf AIM materiály nenesie), triedy, podlažia a hodnôt psetov vrátane ČÍSELNÝCH porovnaní (plocha > 20). mode=list (default): prvky s object_ref a show_in_3d; count: presný počet zo súboru, aj group_by trieda/podlažie/materiál; values: aké hodnoty má vlastnosť psetu alebo Qto a koľko prvkov má ktorú (pset + name).
  Parametre: `mode=list|count|values`, `model=ASR|VZT`, `ifc_types`, `where`, `storey`, `group_by=type|storey|material`, `pset`, `name`, `material`, `limit`
- **`ifc_get`** (D-084, čítanie) - IFC MOTOR: všetky údaje prvkov priamo z IFC súboru - atribúty, psety výskytu, množstvá (Qto), klasifikácie, materiály (vrstvy skladby s hrúbkou a kategóriou, aj z typu), dokumenty a voliteľne psety z typu.
  Parametre: `targets*`, `model=ASR|VZT`, `include_type_properties`
- **`ifc_ids_validate`** (D-084, čítanie) - IFC MOTOR: skontroluje model TERAZ voči IDS uloženému v AIM (ids_document, kód a voliteľne version; záložne register IDS_SOURCES).
  Parametre: `model*=ASR|VZT`, `ids*`, `version`, `save`, `spec`, `failures_per_spec`
- **`ifc_relations`** (D-097, čítanie) - IFC MOTOR: všetky IFC vzťahy jednej entity priamo zo súboru, aj entity mimo grafu AIM (zóna, systém, port): členovia zón/skupín/systémov (IfcRelAssignsToGroup), kam prvok patrí, podlažie a miestnosť (IfcRelContainedIn/ReferencedInSpatialStructure), agregácia a vnorenie (IfcRelAggregates/IfcRelNests), typ, otvory a výplne (Voids/Fills), hranice priestoru, porty, dokumenty, klasifikácie, materiály. direction: forward = entita je Relating (skupina -> členovia, podlažie -> prvky, celok -> časti, prvok -> porty), inverse = kam entita patrí.
  Parametre: `target*`, `model=ASR|VZT`, `rel_types`, `direction=forward|inverse|both`, `recursive`, `through_ports`, `stop_at`, `max_steps`, `limit`, `cursor`
- **`ifc_measure`** (D-112, čítanie) - IFC MOTOR: meranie z geometrie (nie z Qto). clear_opening + items (dvere z ifc_query, max 50) = svetlá šírka a výška dverí medzi zárubňami a od prahu po nadpražie z geometrie, nie z psetov (OverallWidth je so zárubňou); s min_width_m / min_height_m aj pass/fail a check.style_pass / style_fail pre style_in_3d.
  Parametre: `a`, `b`, `route=shortest|escape`, `items`, `model=ASR|VZT`, `qto`, `clear_opening`, `axis=x|y|z|width|depth|height`, `face_a=+x|-x|+y|-y|+z|-z`, `face_b=+x|-x|+y|-y|+z|-z`, `min_width_m`, `min_height_m`, `clear`, `show`, `keep`
- **`clash`** (D-164, zápis) - IFC MOTOR: KOLÍZIE modelov federácie (ASR x VZT) počíta server, testy a behy sa ukladajú. list: predvolené testy (VZT-NOSNE hard, VZT-ASR odstup 50 mm) a vlastné s posledným behom; s test jeho behy. save: vlastný test (test = kód, name, a, b, a_model, b_model, a_storey, b_storey, mode, clearance_mm); delete: confirm=true. run: test alebo ad hoc a, b (selektor tried 'IfcDuct*|IfcPipe*', '!IfcSpace'), tolerance_mm; save=true uloží beh (run_id UUID prežije reštart).
  Parametre: `action*=list|run|results|bcf|save|delete|compare|review|open|from_viewer`, `test`, `name`, `description`, `a`, `b`, `a_model=ASR|VZT`, `b_model=ASR|VZT`, `a_storey`, `b_storey`, `mode=hard|clearance`, `clearance_mm`, `tolerance_mm`, `save`, `confirm`, `run_id`, `base_run_id`, `bucket=added|resolved|persistent|unretested`, `group_by=storey|system|type_pair|element|rule|cluster`, `group`, `status=hard|clearance`, `severity=critical|major|minor|info`, `review=open|resolved|accepted`, `review_status=open|resolved|accepted`, `comment`, `keys`, `limit`, `offset`, `model`, `create`
- **`calibrate_underlay`** (D-133, zápis) - KALIBRÁCIA PODKLADU výkresu (PDF strana) pod IFC model (D-133): mierka, rotácia a posun strany voči modelu, výsledok sa ukladá do kalibrácie dokumentu (panel Underlays vo vieweri).
  Parametre: `document_id`, `page`, `mode=dry_run|auto|manual|list|show_in_3d|hide|set_opacity|history|restore`, `floor`, `section_plane`, `pairs`, `scale`, `refine`, `max_error_mm`, `force`, `model`, `opacity`, `only`, `index`, `persist`
