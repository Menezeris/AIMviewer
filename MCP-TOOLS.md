# Inventory of MCP connector tools

> Generated from the tool definitions (`lib/mcp/tool-list.ts`), do not edit by hand. Regenerate with:
> `npx vitest run lib/mcp/tool-registry.test.ts -u`.

The connector has 31 tools (with the IFC engine, `ENGINE_ENABLED=1`).

**Rule D-114 - fit it into an existing tool first, a new tool only after that:**
1. Find the 2-3 tools closest to what is needed.
2. Try to add the capability to them in this order: a new parameter or enum value
   (`action`, `mode`, `include`...), a field in the result, a better description or instruction
   (if the capability already exists and the agent just did not find it).
3. A new tool only when neither works; the decision record has a section
   "Rejected extension: `<tool>` - why not" and a new row in
   `lib/mcp/tool-registry.json` is approved by Samuel in the issue.

Legend: `*` = required parameter, `=a|b` = allowed values, in parentheses the decision
that introduced the tool and whether it reads or writes (a write asks for consent in claude.ai);
"always loaded" = `_meta` `anthropic/alwaysLoad`, the client does not need to find it via tool_search (D-153).

## AIM graph, view and navigation (15)

Source: DB (AIM graph) -> live viewer. Definitions: lib/llm/tools.ts, lib/llm/view-tools.ts, lib/llm/list-tool.ts. Also the `/api/ask` chat.

- **`get_model_stats`** (D-056, read) - Slovník modelu: počty uzlov podľa object_type, zoznam IFC tried assetov (ifc_type × predefined_type) s počtami, zoznam psetov (názvy + počet properties), podlažia, systémy, klasifikačné systémy a dokumenty.
  Parameters: none
- **`search_objects`** (D-056, read, always loaded) - Nájde, SPOČÍTA alebo LOKALIZUJE uzly grafu AIM podľa identity a IFC typológie. mode=list (default): riadky; count: presný počet ('koľko X je v budove'; z riadkov list nepočítaj, sú orezané); locate: presný počet + rozpad po podlažiach a miestnostiach so vzorkou ('koľko X a kde / na ktorých podlažiach', predvolene object_type asset, alebo ids z predošlého hľadania). `query` hľadá v názve, object_ref, IFC triede aj predefined_type (ilike). ifc_type = IFC trieda (IfcDoor), predefined_type = podtyp (AIRCONDITIONINGUNIT je predefined_type, NIE ifc_type).
  Parameters: `mode=list|count|locate`, `query`, `object_type`, `ifc_type`, `predefined_type`, `ids`, `limit`, `offset`
- **`query_view`** (D-056, read) - Generický read-only dopyt nad ľubovoľnou tabuľkou/view v DB (celá dátová vrstva).
  Parameters: `relation*`, `select`, `filters`, `order`, `count_only`, `limit`, `offset`, `related`
- **`aggregate_objects`** (D-060, read) - Presné agregácie a ČÍSELNÉ porovnania nad hodnotami psetov — počíta databáza, nikdy nepočítaj z orezaných riadkov.
  Parameters: `relation`, `agg`, `prop_path`, `group_by`, `group_by_path`, `filters`, `ids`, `max_groups`, `return_rows`
- **`get_object`** (D-056, read, always loaded) - Detail jedného uzla podľa UUID, object_ref (napr. 'DD01.06.03') alebo kódu prvku (meno ako 'VV.03.01.040'; prvok len v IFC vráti in_aim:false a global_id): identita, IFC trieda, predefined_type, IFC GUID a podlažie (floor). include pridá v tom istom volaní: details = VLASTNOSTI psetov (aj zdedené z typu, napr. výrobný typ) a klasifikácie; path = V KTOREJ MIESTNOSTI a podlaží je (aj odvodené geometriou, napr. VZT prvok v miestnosti z ASR); documents = DOKUMENTY a strany, ktoré k nemu patria, aj zdedené cez typ, zónu, skupinu (skladby), systém, priestorovú zónu (požiarny úsek), podlažie a miestnosť, s cestou (via_name, through) a deep_link na stranu; pri dokumente opačne: ktorých objektov sa týka (počty podľa typu a nositeľa + vzorka); quantities = Qto VÝMERY (objem, plocha, dĺžka...) a psety priamo z IFC súboru, z výskytu aj z typu, ako zoznam {qto, name, value, source} v poli ifc (D-142).
  Parameters: `id_or_ref*`, `include=details|path|documents|quantities`
- **`list_relations`** (D-056, read) - Vzťahy uzla cez kanonické views: rel_aggregates (dekompozícia štruktúry), rel_contained_in_spatial_structure (prvok v priestore/podlaží, natívne zo súboru), rel_referenced_in_spatial_structure (prvok sa nachádza aj v priestore — odvodené geometriou naprieč modelmi, role inside|partial), rel_space_boundary (prvok ohraničuje priestor, IfcRelSpaceBoundary, role physical|virtual), rel_defines_by_type (occurrence→typ), rel_associates_document (uzol→dokument), rel_associates_classification, rel_assigns_to_actor (zodpovednosti, aktor→uzol), rel_assigns_to_group (člen→systém), rel_member_of (osoba→organizácia).
  Parameters: `rel_type*`, `from_id`, `to_id`, `limit`
- **`show_in_3d`** (D-056, read, always loaded) - UI AKCIA: UKÁŽ alebo VYBER prvky v 3D. Predvolene zvýrazní (oranžovo) a priblíži prvky - 'ukáž / zobraz X', aj jednu miestnosť (skrytú viewer zapne).
  Parameters: `ids_or_refs`, `id_or_ref`, `clear`, `global_ids`, `ifc_type`, `predefined_type`, `query`, `object_type`, `select`, `visible`, `panel_section=properties|quantities`, `highlight`
- **`style_in_3d`** (D-066, read) - UI AKCIA: ofarbí / skryje / znova zobrazí / izoluje prvky v 3D modeli, alebo resetne pohľad.
  Parameters: `action*=colorize|transparent|hide|show|isolate|xray|clear_isolation|show_all|reset_colors|legend`, `opacity`, `mode=add|replace`, `color_by=ifc_type|system|zone|material|model|classification|property|attribute`, `legend_size=compact|large|normal`, `clear_section`, `context_storey`, `color_by_key`, `color`, `ids_or_refs`, `exclude_ids_or_refs`, `exclude_global_ids`, `global_ids`, `ifc_type`, `ifc_types`, `domain=hvac|plumbing|electrical|architecture|structure`, `model`, `predefined_type`, `property`, `value`, `pset`, `query`, `system`, `system_type`, `not_in_system`, `zone`, `storey`, `document`, `page`, `groups`
- **`open_drawing`** (D-056, read) - UI AKCIA: otvorí výkres/dokument v prehliadačke, voliteľne so zvýrazneným prvkom, stranou, výrezom strany (region = priblíženie na časť strany v karte vo vieweri) a rámikmi okolo textu (highlights).
  Parameters: `document_id*`, `focus_id`, `page`, `in_viewer`, `target=tab|split`, `region`, `highlights`, `link`
- **`open_node`** (D-056, read) - UI AKCIA: otvorí detailnú kartu uzla (asset, typ, miestnosť, podlažie, systém, osoba, organizácia…).
  Parameters: `id_or_ref*`
- **`search_documents`** (D-063, read) - OBSAH dokumentov a výkresov (textová vrstva PDF strán, strana bez nej z OCR so source='ocr': popisky a čísla miestností, kóty, hrúbky, legendy, špecifikácie, pečiatky, text technických správ).
  Parameters: `q`, `document_id`, `page`, `include_blocks`, `include_links`, `limit`
- **`set_section`** (D-083, read) - UI AKCIA: rez modelom v 3D. Vodorovný rez nad podlažím = floor + offset_m (výška nad úrovňou podlažia v m, default 1,2 = pôdorysný rez; záporná = pod úrovňou).
  Parameters: `action*=set|clear|widget`, `orientation=horizontal|vertical_x|vertical_z`, `floor`, `offset_m`, `relative_to=floor|ceiling`, `position_percent`, `target_ids_or_refs`, `global_ids`, `fit=along|across|center`, `coordinate_m`, `flipped`, `show_widget`, `cap_style=hatch|solid|none`, `cap_color`, `box`, `margin_m`, `hatch_pattern=diagonal|diagonal_reverse|cross|crosshatch|horizontal|vertical|dots|brick|insulation`, `hatch_angle_deg`, `hatch_spacing_px`, `hatch_line_width_px`
- **`set_camera`** (D-083, read) - UI AKCIA: kamera v 3D. preset = smer pohľadu (top/bottom/front/back/left/right/iso; fit_all = celý model; section = kolmo na aktívny rez, ako tlačidlo Set view; keep = zachovať smer, default). fit = čo zarámovať pri danom smere: visible (viditeľné, aj izolované prvky), selection (výber vo vieweri).
  Parameters: `preset=top|bottom|front|back|left|right|iso|fit_all|keep|section`, `fit=visible|selection`, `target_ids_or_refs`, `global_ids`, `ifc_type`, `ifc_types`, `domain=hvac|plumbing|electrical|architecture|structure`, `model`, `zoom_percent`, `orbit_h_deg`, `orbit_v_deg`, `pan_x_percent`, `pan_y_percent`, `projection=perspective|orthographic`, `auto_rotate=start|stop`, `speed_deg_s`, `direction=left|right`, `margin_percent`, `area=left|right|top|bottom|front|back`
- **`set_view_mode`** (D-083, read, always loaded) - UI AKCIA: kamera a pohľady vieweru. 2D nie je režim. mode=3d = perspektíva (reset=true s ním vráti pôvodný pohľad: bez rezu, farieb, skrytia, výberu a zvýraznenia, izometria). mode=2d + floor = POHĽAD ZHORA na podlažie na bežnom 3D: ortografická kamera zhora a vodorovný rez 1,2 m nad podlahou, alebo uložený pohľad toho podlažia; bez zámku, orbit a nástroje fungujú hneď (miestnosti ofarbené cez style_in_3d sú v ňom vyplnené a popísané).
  Parameters: `mode=3d|2d|split`, `discipline`, `floor`, `reset`, `saved_view`, `view`, `tab`, `beside`, `close_tab`, `layout=single|split_h|split_v|three_left|three_right|three_top|three_bottom|three_h|three_v|grid4`, `tiles`, `ratio`, `sizes`, `panel_layout`, `panels`, `panel_scroll`, `panel_zoom`, `underlays_3d`, `plan_position`, `section_offset_m`
- **`open_list`** (D-111, read) - Tabuľka prvkov v paneli Lists vo vieweri (export do CSV/XLSX/PDF): "exportuj dvere na 1NP ako tabuľku", "zoznam tvaroviek s rozmermi do Excelu".
  Parameters: `name`, `columns`, `run`, `action=open|update`, `maximize`, `sort_by`, `sort_dir=asc|desc`, `sum`, `group_by`, `search`, `add_columns`, `remove_columns`, `add_types`, `remove_types`, `remove_filter=storey|model|property|system|system_type|zone|document|global_ids|ids_or_refs|query|...`, `color_by`, `export=csv|xlsx|pdf`, `visible_only`, `column_widths`, `highlight`, `ifc_type`, `ifc_types`, `domain`, `predefined_type`, `storey`, `system`, `system_type`, `zone`, `document`, `page`, `property`, `pset`, `value`, `query`, `model`, `global_ids`, `ids_or_refs`

## Viewer state queries (1)

Source: live viewer (back channel). Definitions: lib/live/viewer-query-tools.ts. MCP only.

- **`get_viewer_state`** (D-085, read, always loaded) - Čo práve ukazuje OTVORENÝ živý viewer: kamera (pozícia, cieľ v IFC, projekcia), aktívny rez (os, súradnica v IFC, poloha v %), aktívny pohľad z Presentation (view: id, name), výber a počty skrytých a izolovaných prvkov.
  Parameters: `bounds`, `saved_views`, `target_ids_or_refs`, `global_ids`, `items_offset`, `items_limit`

## Saved views (1)

Source: DB (saved_views) + live viewer. Definitions: lib/views/tools.ts (list in get_viewer_state, restore in set_view_mode). MCP only.

- **`saved_view`** (D-122, write) - ULOŽÍ POHĽAD do panela Presentation (pás pohľadov, spoločný pre stavbu): 'ulož to ako Pôdorys technickej miestnosti 3.14'. action=save uloží to, čo je vo vieweri práve nastavené (kamera s projekciou, rezy, košík = viditeľné prvky, aj po izolácii cez style_in_3d (Lens) alebo skrytí; starší viewer uloží len výber; prázdny košík = všetko viditeľné, podklady PDF v 3D = zapnuté/vypnuté, ktoré podklady sú viditeľné a ich priehľadnosť), ako tlačidlo Uložiť v paneli; otvorenie pohľadu tento stav podkladov obnoví (pohľad uložený starším viewerom podklady nemení; nastav ich cez calibrate_underlay mode=show_in_3d|hide|set_opacity a ulož znova).
  Parameters: `action*=save|rename|delete`, `name*`, `new_name`, `description`, `overwrite`, `author`

## BCF topics over models (2)

Source: DB (model_tasks) + session. Definitions: lib/bcf/tools.ts. MCP only.

- **`bcf_topic_list`** (D-099, read) - BCF témy nad modelmi federácie (D-099; issues a požiadavky konektora dá feedback_status), najnovšie prvé: číslo, guid, názov, stav, typ, priorita, komu, model, počet prvkov a komentárov, odkaz na Claude session.
  Parameters: `status`, `model`, `assigned_to`, `guid`, `document`, `page`, `entity`, `context=3d|pdf|both|none`, `needs_review`, `limit`
- **`bcf_topic`** (D-099, write) - Zápis BCF témy nad modelom federácie (D-099). action=create: založí tému (chyba, kolízia, pripomienka, požiadavka na úpravu modelu), keď používateľ povie 'založ BCF / tému / issue'; prvky cez target_ids_or_refs alebo global_ids, s capture_view (predvolene) sa vezme výber, kamera, rez a režim z otvoreného viewera. assigned_to='claude' = tému rieši Claude: spustí sa Claude Code session (úprava IFC v OCB, nová revízia); ľudí priraď menom alebo e-mailom. update: stav, priorita, komu, popis, štítky, termín alebo comment; start_session spustí session pre tému Claudovi. close: uzavrie tému bez úpravy modelu. viewpoint: nastaví jediný pohľad témy (selection_global_ids, capture_view).
  Parameters: `action*=create|update|close|viewpoint|from_viewer|locate|import`, `guid`, `title`, `description`, `comment`, `status`, `priority`, `assigned_to`, `type`, `labels`, `model`, `due_date`, `author`, `modified_by`, `target_ids_or_refs`, `global_ids`, `selection_global_ids`, `capture_view`, `start_session`, `document`, `remove_document`, `review_document`, `guids`, `url`, `data_base64`, `dry_run`, `conflict=keep|overwrite`, `document_guid`, `apply=components|viewpoint|all`, `replace`, `include_parents`

## Feedback and requests (2)

Source: GitHub issues + session. Definitions: lib/feedback/tools.ts. MCP only.

- **`feedback_status`** (D-090, read) - Stav pripomienok a požiadaviek na tools (D-090). Bez issue_number vráti otvorené issues konektora (číslo, názov, druh, či beží session); s issue_number stav issue, odkaz na session, PR a posledné komentáre (otázky session na používateľa).
  Parameters: `issue_number`, `state=open|closed|all`, `verified`, `limit`
- **`feedback`** (D-090, write) - Zápis do GitHub issues konektora (D-090). Volaj LEN na výslovný pokyn používateľa ('zapíš to', 'založ pripomienku', 'dopíš do #97'); sám to len ponúkni. action=report: PRIPOMIENKA - chyba toolu (bug), zlé dáta (wrong_data), zlá odpoveď (wrong_answer), návrh (improvement); kind, title, description, start_session len keď to používateľ chce. request_tool: POŽIADAVKA NA NOVÝ TOOL až po vyčerpaní existujúcich tools; opíš potrebu (user_request, why_existing_fail, tried_tools s konkrétnymi tools); ak stačí rozšíriť existujúci tool (parameter, akcia, pole vo výsledku), uveď ho v proposal.extend - rozšírenie má prednosť (D-114); spustí session alebo ide do fronty, rovnaká požiadavka sa pripíše ako ďalší výskyt. comment: komentár do existujúceho issue, aj zatvoreného (issue_number, text, kind eval_round | result | note; verification=overene | vratene zapíše overenie hotového issue; reopen len na výslovný pokyn; GitHub konektor na to netreba). start_session: spustí session pre ďalšie issue z fronty (over_limit len na výslovnú žiadosť).
  Parameters: `action*=report|request_tool|comment|start_session`, `kind=bug|wrong_data|wrong_answer|improvement|eval_round|result|note`, `title`, `description`, `tool`, `example`, `object_refs`, `user_request`, `why_existing_fail`, `tried_tools`, `proposal`, `area=aim_data|viewer|ifc_engine|model_change|requirements_library|other`, `examples`, `issue_number`, `text`, `reopen`, `verification=overene|vratene`, `over_limit`, `start_session`, `narocnost=standard|hard`, `narocnost_dovod`

## IDS documents (1)

Source: DB (ids_documents, versions with XML) + @ifc-lite/mcp (ids_*). Definitions: lib/ids/tool-defs.ts, lib/ids/tools.ts. MCP only.

- **`ids_document`** (D-162, write) - IDS DOKUMENTY v AIM (D-162): požiadavky na model (IDS 1.0), ktoré Claude tvorí, upravuje a ukladá s verziami.
  Parameters: `action*=list|get|create|apply_ops|versions|diff|export|open|from_viewer`, `ids`, `version`, `include_xml`, `code`, `title`, `xml`, `derived_from`, `derived_from_version`, `ops`, `target=studio|validation`, `spec`, `run`, `base_version`, `note`, `from_version`, `to_version`, `author`

## IFC engine (9)

Source: IFC files of the federation (@ifc-lite/mcp); clash stores tests, runs and clash state in the DB (clash_*). Definitions: lib/engine/search-all.ts, lib/engine/tool-defs.ts, lib/engine/passthrough-defs.ts, lib/engine/underlay-tool.ts. MCP only.

- **`search_all`** (D-095, read) - Hľadanie podľa textu naraz v OBOCH zdrojoch: IFC súbor (atribúty Name, Description, ObjectType, Tag, LongName, všetky psety a Qto aj z typu, klasifikácie, materiály, zóny, skupiny) a graf AIM v DB (názov, object_ref, importované psety, dokumenty, osoby).
  Parameters: `text*`, `source=all|ifc|aim`, `badges=IFC|AIM|IFC+AIM`, `ifc_types`, `model`, `limit`, `fields=attribute|property|quantity|type_property|classification|material`, `fuzzy`, `offset`, `related`
- **`ifc_models`** (D-084, read) - IFC MOTOR: IFC SCHÉMA, modely federácie a údaje súboru. action=schema: z ktorej triedy IFC trieda dedí, celá línia dedičnosti a atribúty (type, napr. IfcAirTerminal; bez modelu) - neodpovedaj z pamäti. revisions (default): aktuálna revízia modelu (vNNN, dátum, autor, zmeny), history = aj predchádzajúce; info: schéma IFC, jednotky, georeferencovanie; materials / classifications: zoznam materiálov a klasifikácií s počtami; audit: zdravie modelu.
  Parameters: `action=revisions|info|materials|classifications|audit|schema`, `model=ASR|VZT`, `history`, `type`, `include_inherited`
- **`ifc_query`** (D-084, read) - IFC MOTOR: prvky v IFC súbore podľa MATERIÁLU (material: izolácia, minerálna vlna, EPS, betón - aj vrstva skladby a materiál z typu; graf AIM materiály nenesie), triedy, podlažia a hodnôt psetov vrátane ČÍSELNÝCH porovnaní (plocha > 20). mode=list (default): prvky s object_ref a show_in_3d; count: presný počet zo súboru, aj group_by trieda/podlažie/materiál; values: aké hodnoty má vlastnosť psetu alebo Qto a koľko prvkov má ktorú (pset + name).
  Parameters: `mode=list|count|values`, `model=ASR|VZT`, `ifc_types`, `where`, `storey`, `group_by=type|storey|material`, `pset`, `name`, `material`, `limit`
- **`ifc_get`** (D-084, read) - IFC MOTOR: všetky údaje prvkov priamo z IFC súboru - atribúty, psety výskytu, množstvá (Qto), klasifikácie, materiály (vrstvy skladby s hrúbkou a kategóriou, aj z typu), dokumenty a voliteľne psety z typu.
  Parameters: `targets*`, `model=ASR|VZT`, `include_type_properties`
- **`ifc_ids_validate`** (D-084, read) - IFC MOTOR: skontroluje model TERAZ voči IDS uloženému v AIM (ids_document, kód a voliteľne version; záložne register IDS_SOURCES).
  Parameters: `model*=ASR|VZT`, `ids*`, `version`, `save`, `spec`, `failures_per_spec`
- **`ifc_relations`** (D-097, read) - IFC MOTOR: všetky IFC vzťahy jednej entity priamo zo súboru, aj entity mimo grafu AIM (zóna, systém, port): členovia zón/skupín/systémov (IfcRelAssignsToGroup), kam prvok patrí, podlažie a miestnosť (IfcRelContainedIn/ReferencedInSpatialStructure), agregácia a vnorenie (IfcRelAggregates/IfcRelNests), typ, otvory a výplne (Voids/Fills), hranice priestoru, porty, dokumenty, klasifikácie, materiály. direction: forward = entita je Relating (skupina -> členovia, podlažie -> prvky, celok -> časti, prvok -> porty), inverse = kam entita patrí.
  Parameters: `target*`, `model=ASR|VZT`, `rel_types`, `direction=forward|inverse|both`, `recursive`, `through_ports`, `stop_at`, `max_steps`, `limit`, `cursor`
- **`ifc_measure`** (D-112, read) - IFC MOTOR: meranie z geometrie (nie z Qto). clear_opening + items (dvere z ifc_query, max 50) = svetlá šírka a výška dverí medzi zárubňami a od prahu po nadpražie z geometrie, nie z psetov (OverallWidth je so zárubňou); s min_width_m / min_height_m aj pass/fail a check.style_pass / style_fail pre style_in_3d.
  Parameters: `a`, `b`, `route=shortest|escape`, `items`, `model=ASR|VZT`, `qto`, `clear_opening`, `axis=x|y|z|width|depth|height`, `face_a=+x|-x|+y|-y|+z|-z`, `face_b=+x|-x|+y|-y|+z|-z`, `min_width_m`, `min_height_m`, `clear`, `show`, `keep`, `verify`, `save`, `author`
- **`clash`** (D-164, write) - IFC MOTOR: KOLÍZIE modelov federácie (ASR x VZT) počíta server, testy a behy sa ukladajú. list: predvolené testy (VZT-NOSNE hard, VZT-ASR odstup 50 mm) a vlastné s posledným behom; s test jeho behy. save: vlastný test (test = kód, name, a, b, a_model, b_model, a_storey, b_storey, mode, clearance_mm); delete: confirm=true. run: test alebo ad hoc a, b (selektor tried 'IfcDuct*|IfcPipe*', '!IfcSpace'), tolerance_mm; save=true uloží beh (run_id UUID prežije reštart).
  Parameters: `action*=list|run|results|bcf|save|delete|compare|review|open|from_viewer|...`, `test`, `name`, `description`, `a`, `b`, `a_model=ASR|VZT`, `b_model=ASR|VZT`, `a_storey`, `b_storey`, `a_load_bearing=true|false|unknown`, `b_load_bearing=true|false|unknown`, `mode=hard|clearance`, `clearance_mm`, `tolerance_mm`, `save`, `confirm`, `run_id`, `base_run_id`, `bucket=added|resolved|persistent|unretested`, `group_by=storey|system|type_pair|element|rule|cluster`, `group`, `status=hard|clearance`, `severity=critical|major|minor|info`, `review=open|resolved|accepted`, `review_status=open|resolved|accepted`, `comment`, `keys`, `limit`, `offset`, `model`, `create`
- **`calibrate_underlay`** (D-133, write) - KALIBRÁCIA PODKLADU výkresu (PDF strana) pod IFC model (D-133): mierka, rotácia a posun strany voči modelu, výsledok sa ukladá do kalibrácie dokumentu (panel Underlays vo vieweri).
  Parameters: `document_id`, `page`, `mode=dry_run|auto|manual|list|show_in_3d|hide|set_opacity|history|restore|remove`, `floor`, `section_plane`, `pairs`, `region`, `scale`, `refine`, `max_error_mm`, `force`, `model`, `opacity`, `only`, `index`, `persist`
