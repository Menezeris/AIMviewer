# Inventár toolov MCP konektora

> Generované z definícií toolov (`lib/mcp/tool-list.ts`), needituj ručne. Obnova:
> `npx vitest run lib/mcp/tool-registry.test.ts -u`.

Konektor má 52 toolov (s IFC motorom, `ENGINE_ENABLED=1`).

**Pravidlo D-114 - najprv napasuj, až potom nový tool:**
1. Tu nájdi 2-3 najbližšie tooly k tomu, čo treba.
2. Skús schopnosť dať do nich v tomto poradí: nový parameter alebo hodnota enumu
   (`action`, `mode`, `include`...), pole vo výsledku, lepší opis alebo inštrukcia
   (ak schopnosť už existuje, len ju agent nenašiel).
3. Nový tool len keď nejde ani jedno; záznam rozhodnutia má sekciu
   "Zavrhnuté rozšírenie: `<tool>` - prečo nie" a nový riadok v
   `lib/mcp/tool-registry.json` schvaľuje Samuel v issue.

Legenda: `*` = povinný parameter, `=a|b` = povolené hodnoty, v zátvorke rozhodnutie,
ktoré tool zaviedlo, a či číta alebo zapisuje (zápis si v claude.ai pýta súhlas).

## AIM graf, pohľad a navigácia (22)

Zdroj: DB (AIM graf) -> živý viewer. Definície: lib/llm/tools.ts, lib/llm/view-tools.ts, lib/llm/list-tool.ts. Aj chat `/api/ask`.

- **`get_model_stats`** (D-056, čítanie) - Slovník modelu: počty uzlov podľa object_type, zoznam IFC tried assetov (ifc_type × predefined_type) s počtami, zoznam psetov (názvy + počet properties), podlažia, systémy, klasifikačné systémy a dokumenty.
  Parametre: žiadne
- **`search_objects`** (D-056, čítanie) - Vyhľadanie uzlov grafu (objects) podľa IDENTITY a IFC typológie. `query` hľadá naraz v názve, object_ref, IFC triede aj predefined_type (ilike).
  Parametre: `query`, `object_type`, `ifc_type`, `predefined_type`, `limit`
- **`search_everything`** (D-059, čítanie) - ZDROJ: graf AIM v DB (nie IFC súbor). Fulltextové vyhľadávanie nad CELÝM obsahom uzlov AIM — názov, object_ref, IFC trieda aj VŠETKY importované psety (kľúče a hodnoty, vrátane custom psetov); IFC atribúty Description/ObjectType/Tag/LongName nevidí.
  Parametre: `q*`, `object_types`, `limit`
- **`count_objects`** (D-056, čítanie) - Presný počet uzlov vyhovujúcich filtrom (rovnaké filtre ako search_objects).
  Parametre: `query`, `object_type`, `ifc_type`, `predefined_type`
- **`locate_objects`** (D-056, čítanie) - Nájde prvky podľa filtrov (rovnaké ako search_objects) a rovno určí, na ktorom podlaží a v ktorej miestnosti sú — vráti presný celkový počet + rozpad po podlažiach so vzorkou prvkov.
  Parametre: `query`, `object_type`, `ifc_type`, `predefined_type`, `ids`
- **`query_view`** (D-056, čítanie) - Generický read-only dopyt nad ľubovoľnou tabuľkou/view v DB (celá dátová vrstva).
  Parametre: `relation*`, `select`, `filters`, `order`, `count_only`, `limit`
- **`aggregate_objects`** (D-060, čítanie) - Presné agregácie a ČÍSELNÉ porovnania nad hodnotami psetov — počíta databáza, nikdy nepočítaj z orezaných riadkov. agg=count|sum|avg|min|max nad numerickou hodnotou prop_path (napr. ['VZT_Parametre','AirFlowRate']); group_by (stĺpec: object_type|ifc_type|predefined_type|user_defined_type|name|object_ref) alebo group_by_path (pset cesta ako kľúč, napr. výrobca).
  Parametre: `relation`, `agg`, `prop_path`, `group_by`, `group_by_path`, `filters`, `ids`, `max_groups`, `return_rows`
- **`get_object`** (D-056, čítanie) - Detail jedného uzla podľa UUID, object_ref (napr. 'DD01.06.03') alebo kódu prvku (meno ako 'VV.03.01.040'; prvok len v IFC vráti in_aim:false a global_id): identita, IFC trieda, predefined_type, aktívny IFC GUID a podlažie (floor) - na 'čo je X a kde je' stačí jedno volanie.
  Parametre: `id_or_ref*`
- **`get_asset_details`** (D-056, čítanie) - Efektívne vlastnosti assetu (dedičnosť type→occurrence, v_asset_effective) + klasifikácie (v_asset_classifications, union vlastných a zdedených).
  Parametre: `id*`
- **`list_relations`** (D-056, čítanie) - Vzťahy uzla cez kanonické views: rel_aggregates (dekompozícia štruktúry), rel_contained_in_spatial_structure (prvok v priestore/podlaží, natívne zo súboru), rel_referenced_in_spatial_structure (prvok sa nachádza aj v priestore — odvodené geometriou naprieč modelmi, role inside|partial), rel_defines_by_type (occurrence→typ), rel_associates_document (uzol→dokument), rel_associates_classification, rel_assigns_to_actor (zodpovednosti, aktor→uzol), rel_assigns_to_group (člen→systém), rel_member_of (osoba→organizácia).
  Parametre: `rel_type*`, `from_id`, `to_id`, `limit`
- **`get_spatial_path`** (D-056, čítanie) - Priestorové zaradenie uzla — cesta nahor (asset → space → floor → building → site) cez rel_contained_in_spatial_structure a rel_aggregates, plus `referenced_in` = miestnosti, v ktorých prvok geometricky leží (rel_referenced_in_spatial_structure, napr. VZT prvok z iného modelu než miestnosti).
  Parametre: `id*`
- **`show_in_3d`** (D-056, čítanie) - UI AKCIA: otvorí 3D model so zvýraznenými a priblíženými prvkami.
  Parametre: `ids_or_refs`, `id_or_ref`, `clear`, `global_ids`, `ifc_type`, `predefined_type`, `query`, `object_type`
- **`select_in_3d`** (D-082, čítanie) - UI AKCIA: VYBERIE jeden prvok v 3D presne ako klik myšou — viewer ho označí, priblíži naň kameru a otvorí jeho panel vlastností priamo v 3D pohľade (IFC vlastnosti + AIM karta).
  Parametre: `id_or_ref`, `clear`, `panel_tab=aim|ifc`, `panel_section=properties|quantities`, `highlight`
- **`style_in_3d`** (D-066, čítanie) - UI AKCIA: ofarbí / skryje / znova zobrazí / izoluje prvky v 3D modeli, alebo resetne pohľad.
  Parametre: `action*=colorize|transparent|hide|show|isolate|xray|show_all|reset_colors`, `mode=add|replace`, `color_by=ifc_type|system|zone|material|model|classification|property|attribute`, `color_by_key`, `color`, `ids_or_refs`, `global_ids`, `ifc_type`, `ifc_types`, `domain=hvac|plumbing|electrical|architecture|structure`, `model`, `predefined_type`, `property`, `value`, `pset`, `query`, `system`, `system_type`, `not_in_system`, `zone`, `storey`, `groups`
- **`open_drawing`** (D-056, čítanie) - UI AKCIA: otvorí výkres/dokument v prehliadačke, voliteľne so zvýrazneným prvkom a stranou.
  Parametre: `document_id*`, `focus_id`, `page`, `in_viewer`
- **`open_node`** (D-056, čítanie) - UI AKCIA: otvorí detailnú kartu uzla (asset, typ, miestnosť, podlažie, systém, osoba, organizácia…).
  Parametre: `id_or_ref*`
- **`search_documents`** (D-063, čítanie) - Fulltextové vyhľadávanie v OBSAHU dokumentov/výkresov (extrahovaný text PDF strán — legendy, špecifikácie, popisky, pečiatky).
  Parametre: `q*`, `limit`
- **`find_in_drawings`** (D-056, čítanie) - Výkresy, v ktorých je prvok (asset/asset_type) zobrazený (E4 auto-linking) vrátane čísel strán s regiónom prvku.
  Parametre: `id*`
- **`set_section`** (D-083, čítanie) - UI AKCIA: rez modelom v 3D. Vodorovný rez nad podlažím = floor + offset_m (výška nad úrovňou podlažia v m, default 1,2 = pôdorysný rez; záporná = pod úrovňou).
  Parametre: `action*=set|clear|widget`, `orientation=horizontal|vertical_x|vertical_z`, `floor`, `offset_m`, `relative_to=floor|ceiling`, `position_percent`, `target_ids_or_refs`, `global_ids`, `fit=along|across|center`, `coordinate_m`, `flipped`, `show_widget`
- **`set_camera`** (D-083, čítanie) - UI AKCIA: kamera v 3D. preset = smer pohľadu (top/bottom/front/back/left/right/iso; fit_all = celý model; section = kolmo na aktívny rez, ako tlačidlo Set view; keep = zachovať smer, default). fit = čo zarámovať pri danom smere: visible (viditeľné, aj izolované prvky), selection (výber vo vieweri).
  Parametre: `preset=top|bottom|front|back|left|right|iso|fit_all|keep|section`, `fit=visible|selection`, `target_ids_or_refs`, `global_ids`, `ifc_type`, `ifc_types`, `domain=hvac|plumbing|electrical|architecture|structure`, `model`, `zoom_percent`, `orbit_h_deg`, `orbit_v_deg`, `pan_x_percent`, `pan_y_percent`, `projection=perspective|orthographic`
- **`set_view_mode`** (D-083, čítanie) - UI AKCIA: prepne viewer medzi 3D, 2D (pôdorys podlažia) a Split (2D + 3D vedľa seba). 2D s kalibrovaným výkresom ukáže PDF pôdorys, inak model zhora s rezom 1,2 m nad podlahou.
  Parametre: `mode*=3d|2d|split`, `floor`, `reset`
- **`open_list`** (D-111, čítanie) - Tabuľka prvkov v paneli Lists vo vieweri (export do CSV/XLSX/PDF): "exportuj dvere na 1NP ako tabuľku", "zoznam tvaroviek s rozmermi do Excelu".
  Parametre: `name`, `columns`, `ifc_type`, `ifc_types`, `domain`, `predefined_type`, `storey`, `system`, `system_type`, `zone`, `property`, `pset`, `value`, `query`, `model`, `global_ids`, `ids_or_refs`

## Dotazy na stav viewera (2)

Zdroj: živý viewer (spätný kanál). Definície: lib/live/viewer-query-tools.ts. Len MCP.

- **`get_bounds`** (D-085, čítanie) - Obálky (bounding box) v súradniciach IFC modelu (m, Z hore) z OTVORENÉHO živého viewera: celý model (rozsah a osi) a voliteľne vybrané prvky (min, max, size, center).
  Parametre: `target_ids_or_refs`, `global_ids`
- **`get_viewer_state`** (D-085, čítanie) - Čo práve ukazuje OTVORENÝ živý viewer: režim (3d/2d/split) a podlažie, aktívny rez (os, súradnica v IFC, poloha v %), kamera (pozícia a cieľ v IFC), výber a počty skrytých a izolovaných prvkov.
  Parametre: `items_offset`, `items_limit`

## BCF témy nad modelmi (5)

Zdroj: DB (model_tasks) + session. Definície: lib/bcf/tools.ts. Len MCP.

- **`bcf_topic_create`** (D-099, zápis) - Založí BCF tému (issue) nad modelom federácie (D-099): chyba, kolízia, pripomienka alebo požiadavka na úpravu modelu.
  Parametre: `title*`, `description`, `author`, `type`, `status`, `priority`, `assigned_to`, `labels`, `model`, `due_date`, `target_ids_or_refs`, `global_ids`, `capture_view`, `start_session`
- **`bcf_topic_list`** (D-099, čítanie) - BCF témy nad modelmi federácie (D-099), najnovšie prvé: číslo, guid, názov, stav, typ, priorita, komu, model, počet prvkov a komentárov, odkaz na Claude session.
  Parametre: `status`, `model`, `assigned_to`, `guid`, `limit`
- **`bcf_topic_update`** (D-099, zápis) - Upraví BCF tému alebo k nej pridá komentár (D-099): stav, priorita, komu, popis, štítky, termín.
  Parametre: `guid*`, `status`, `priority`, `comment`, `modified_by`, `assigned_to`, `title`, `description`, `type`, `labels`, `due_date`, `start_session`
- **`bcf_topic_close`** (D-099, zápis) - Uzavrie BCF tému (stav closed, D-099) - vybavené bez úpravy modelu; voliteľne s komentárom.
  Parametre: `guid*`, `modified_by`, `comment`
- **`bcf_viewpoint_create`** (D-099, zápis) - Nastaví pohľad BCF témy (D-099): prvky (selection_global_ids, target_ids_or_refs) a s capture_view (predvolene true) kameru, rez, režim a výber z otvoreného viewera.
  Parametre: `guid*`, `selection_global_ids`, `target_ids_or_refs`, `capture_view`

## Pripomienky a požiadavky (5)

Zdroj: GitHub issues + session. Definície: lib/feedback/tools.ts. Len MCP.

- **`request_tool`** (D-090, zápis) - Zapíše POŽIADAVKU NA NOVÝ TOOL (GitHub issue) a hneď spustí Claude Code session, ktorá ho navrhne a naprogramuje (D-090).
  Parametre: `title*`, `user_request*`, `why_existing_fail*`, `tried_tools`, `proposal`, `area=aim_data|viewer|ifc_engine|model_change|requirements_library|other`, `examples`, `start_session`
- **`report_feedback`** (D-090, zápis) - Zapíše PRIPOMIENKU ku konektoru (GitHub issue, D-090): chyba toolu (bug), zlé alebo chýbajúce dáta (wrong_data), zlá odpoveď alebo postup (wrong_answer), návrh na zlepšenie (improvement).
  Parametre: `kind*=bug|wrong_data|wrong_answer|improvement`, `title*`, `description*`, `tool`, `example`, `object_refs`, `start_session`
- **`feedback_status`** (D-090, čítanie) - Stav pripomienok a požiadaviek na tools (D-090). Bez issue_number vráti otvorené issues konektora (číslo, názov, druh, či beží session); s issue_number stav issue, odkaz na session, PR a posledné komentáre (otázky session na používateľa).
  Parametre: `issue_number`
- **`feedback_comment`** (D-090, zápis) - Dopíše KOMENTÁR do existujúceho issue konektora, otvoreného aj zatvoreného (štítok mcp, D-090): kolo evalov, výsledky pred / po, poznámka k požiadavke.
  Parametre: `issue_number*`, `text*`, `kind=eval_round|result|note`, `reopen`
- **`start_queued_session`** (D-090, zápis) - Spustí Claude Code session pre ďalšiu požiadavku z fronty (D-090): bez issue_number najstaršiu so štítkom fronta, s issue_number konkrétne otvorené issue konektora.
  Parametre: `issue_number`, `over_limit`

## IFC motor (18)

Zdroj: IFC súbory federácie (@ifc-lite/mcp). Definície: lib/engine/search-all.ts, lib/engine/tool-defs.ts, lib/engine/passthrough-defs.ts. Len MCP.

- **`search_all`** (D-095, čítanie) - Kombinované hľadanie textu naraz v OBOCH zdrojoch: IFC súbor (ako ifc_search: atribúty Description, ObjectType, Tag, LongName, všetky psety a Qto aj z typu, klasifikácie, materiály, zóny) aj graf AIM v DB (ako search_everything: názov, object_ref, importované psety, dokumenty, osoby).
  Parametre: `text*`, `badges=IFC|AIM|IFC+AIM`, `ifc_types`, `model`, `limit`
- **`ifc_models`** (D-084, čítanie) - IFC MOTOR: zoznam IFC modelov federácie a ich aktuálna revízia (vNNN, dátum, autor, súhrn zmien, sha256, výsledok poistky: pridané/odobraté objekty). history = aj predchádzajúce revízie.
  Parametre: `history`
- **`ifc_query`** (D-084, čítanie) - IFC MOTOR: nájde prvky priamo v IFC súbore podľa IFC triedy, podlažia a hodnôt psetov - aj ČÍSELNÉ porovnania (plocha > 20, výkon >= 5).
  Parametre: `model*=ASR|VZT`, `ifc_types`, `where`, `storey`, `limit`
- **`ifc_search`** (D-095, čítanie) - IFC MOTOR - ZDROJ: IFC súbor (nie graf AIM). Full-text v IFC súbore: atribúty (Name, Description, ObjectType, Tag, LongName, PredefinedType...), psety a Qto výskytu aj z typu, klasifikácie a materiály prvkov, priestorov, zón (IfcZone), skupín, systémov aj typov.
  Parametre: `text*`, `model=ASR|VZT`, `ifc_types`, `fields=attribute|property|quantity|type_property|classification|material`, `fuzzy`, `limit`, `offset`
- **`ifc_get`** (D-084, čítanie) - IFC MOTOR: všetky údaje prvkov priamo z IFC súboru - atribúty, psety výskytu, množstvá (Qto), klasifikácie, materiály (vrstvy skladby s hrúbkou a kategóriou, aj z typu), dokumenty a voliteľne psety z typu.
  Parametre: `targets*`, `model=ASR|VZT`, `include_type_properties`
- **`ifc_count`** (D-084, čítanie) - IFC MOTOR: presný počet prvkov v IFC súbore - celkovo, podľa podmienok where, alebo zoskupený podľa triedy / podlažia / materiálu (group_by; s where sa nekombinuje).
  Parametre: `model*=ASR|VZT`, `ifc_type`, `where`, `group_by=type|storey|material`
- **`ifc_property_values`** (D-084, čítanie) - IFC MOTOR: zoznam rôznych hodnôt jednej vlastnosti psetu alebo množstva Qto s počtami (histogram) pre IFC triedu - na otázky 'aké hodnoty má X' a ako podklad pre farbenie podľa hodnoty. `source` hovorí, odkiaľ hodnota je (pset | qto); typové psety nečíta.
  Parametre: `model*=ASR|VZT`, `ifc_type*`, `pset*`, `name*`, `limit`
- **`ifc_ids_validate`** (D-084, čítanie) - IFC MOTOR: skontroluje model TERAZ voči IDS z knižnice požiadaviek (nič neukladá).
  Parametre: `model*=ASR|VZT`, `ids*`, `spec`, `failures_per_spec`
- **`ifc_relations`** (D-097, čítanie) - IFC MOTOR: všetky IFC vzťahy jednej entity priamo zo súboru, aj entity mimo grafu AIM (zóna, systém, port): členovia zón/skupín/systémov (IfcRelAssignsToGroup), kam prvok patrí, podlažie a miestnosť (IfcRelContainedIn/ReferencedInSpatialStructure), agregácia a vnorenie (IfcRelAggregates/IfcRelNests), typ, otvory a výplne (Voids/Fills), hranice priestoru, porty, dokumenty, klasifikácie, materiály. direction: forward = entita je Relating (skupina -> členovia, podlažie -> prvky, celok -> časti, prvok -> porty), inverse = kam entita patrí. recursive rozvinie vnorené zóny/systémy (bez rel_types len cez IfcRelAssignsToGroup). through_ports = prvky napojené cez porty (IfcRelConnectsPorts), jeden krok; s recursive=true prechod celou sieťou cez porty a stop_at (napr. IfcUnitaryEquipment, IfcDamper.FIREDAMPER) = najbližšia jednotka alebo klapka s cestou (reached, path_show_in_3d).
  Parametre: `target*`, `model=ASR|VZT`, `rel_types`, `direction=forward|inverse|both`, `recursive`, `through_ports`, `stop_at`, `max_steps`, `limit`, `cursor`
- **`ifc_material_layers`** (D-108, čítanie) - IFC MOTOR: prvky, ktorých materiál obsahuje hľadaný materiál alebo kategóriu - aj ako jedna vrstva zloženej skladby (IfcMaterialLayerSet), zložka alebo profil, vrátane materiálu z typu.
  Parametre: `material*`, `model=ASR|VZT`, `ifc_types`, `limit`
- **`ifc_measure`** (D-112, čítanie) - IFC MOTOR: meranie z geometrie (nie z Qto). a + b = svetlá vzdialenosť povrchov dvoch prvkov (aj ASR voči VZT; záporná = prienik), vzdialenosť stredov, medzera obálok po osiach X/Y/Z a vodorovne, a_above_b_m = výška spodku a nad vrchom b (napr. klapka nad doskou: b = doska).
  Parametre: `a`, `b`, `items`, `model=ASR|VZT`
- **`ifc_model_info`** (D-087, čítanie) - Return schema, entity counts, file metadata, georeferencing, and units for the active (or named) model. [@ifc-lite/mcp model_info; model_id: ASR | VZT; GUIDy výsledku nesú object_ref v poli aim, ak ich AIM pozná]
  Parametre: `model_id*=ASR|VZT`
- **`ifc_materials_list`** (D-087, čítanie) - All materials present in the model with usage counts. [@ifc-lite/mcp materials_list; model_id: ASR | VZT; GUIDy výsledku nesú object_ref v poli aim, ak ich AIM pozná]
  Parametre: `model_id*=ASR|VZT`
- **`ifc_classifications_list`** (D-087, čítanie) - All classification references in the model with usage counts. [@ifc-lite/mcp classifications_list; model_id: ASR | VZT; GUIDy výsledku nesú object_ref v poli aim, ak ich AIM pozná]
  Parametre: `model_id*=ASR|VZT`
- **`ifc_geometry_area`** (D-087, čítanie) - Element surface area (in the file area unit, typically m²) read from IfcElementQuantity.
  Parametre: `model_id*=ASR|VZT`, `global_id`, `express_id`, `global_ids`, `express_ids`
- **`ifc_geometry_volume`** (D-087, čítanie) - Element volume (in the file volume unit, typically m³) read from IfcElementQuantity.
  Parametre: `model_id*=ASR|VZT`, `global_id`, `express_id`, `global_ids`, `express_ids`
- **`ifc_model_audit`** (D-087, čítanie) - Comprehensive model health check: required entities, GlobalId uniqueness, orphan detection, naming conventions, broken relationships.
  Parametre: `model_id*=ASR|VZT`
- **`ifc_schema_describe`** (D-087, čítanie) - Describe an IFC entity type: attributes, parents, inheritance chain.
  Parametre: `type*`, `include_inherited`
