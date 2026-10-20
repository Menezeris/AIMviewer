import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PDF_LINK_SOURCE } from "@/lib/data/constants";
import { fetchAllPages } from "@/lib/data/pagination";
import type { ToolDefinition } from "./provider";
import { docOp, selectOp } from "@/lib/viewer-ops";
import { mergeIfcActions, type AskAction } from "./actions";
import { DOMAIN_IFC_TYPES, sanitizeIfcType, sanitizeModelName } from "./ifc-selector";
import { LIST_TOOL_DEFINITIONS, LIST_TOOL_NAMES, execListTool } from "./list-tool";
import { VIEW_TOOL_DEFINITIONS, VIEW_TOOL_NAMES, execViewTool } from "./view-tools";
import { engineEnabled, resolveNamesToGuids } from "@/lib/engine/aim-lookup";
import { execScopedStyle } from "./style-scope";
import { needsScopedStyle } from "./style-plan";
import { LENS_STYLE_ACTIONS, execLensStyle } from "./style-lens";
import { selectPanelInput, selectPanelNote } from "./select-panel";

/**
 * Read-only tools LLM rozhrania (D-056) — tool-calling nad whitelistom, NIE
 * text-to-SQL. Guardraily D-005: každý tool dotazuje len whitelistované
 * views/tabuľky, má tvrdý row-cap a nikdy nezapisuje. Vzťahy idú výhradne cez
 * kanonické `rel_*` views (D-051), nikdy cez base `relationships`.
 *
 * Trust loop: runtime pri každom tool výsledku zbiera „zdroje" (objekty, ktoré
 * sa v odpovedi vyskytli) a po skončení slučky ich obohatí o aktívny IFC GUID
 * (deep-link do 3D) a E4 výkresy (deep-link do výkresu) — dohľadateľnosť
 * nezávisí od formátovania modelu.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Koľko prvkov naraz zvládne show_in_3d (embed viewer unesie aj stovky GUIDov). */
const SHOW_3D_CAP = 100;
/** Max dĺžka JSON payloadu tool výsledku (ochrana kontextu). */
const MAX_RESULT_CHARS = 12_000;
/** Koľko prvkov naraz zvládne lokalizácia (locate_objects). */
const LOCATE_CAP = 500;
/** Veľkosť dávky pre `.in()` filtre (limit dĺžky URL v PostgREST). */
const IN_CHUNK = 100;
/** Max prvkov jednej style_in_3d operácie — GUIDy cestujú v URL (D-066). */
const STYLE_CAP = 400;

/** Max IFC GlobalId priamo z výsledku IFC motora (D-084): ~23 znakov na GUID v URL (limit 16 000). */
const GLOBAL_IDS_CAP = 600;
const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;
/** IFC GlobalId z `global_ids` (výsledok `ifc_*` toolov) - len platný tvar, bez duplicít. */
function sanitizeGlobalIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => IFC_GUID_RE.test(v));
  return [...new Set(ids)].slice(0, GLOBAL_IDS_CAP);
}

/**
 * Whitelist relácií pre generický query_view (celá čitateľná DB, D-056 dodatok).
 * Base `relationships` zámerne chýba — LLM dotazuje len kanonické views (D-051).
 */
const QUERY_RELATIONS = new Set([
  "objects",
  "floors",
  "documents",
  "persons",
  "classification_systems",
  "classification_references",
  "ifc_guid_history",
  "relationship_types",
  "ifc_property_definitions",
  "v_asset_effective",
  "v_asset_classifications",
  "v_floors",
  "v_actors",
  "v_property_dictionary",
  "rel_aggregates",
  "rel_contained_in_spatial_structure",
  "rel_referenced_in_spatial_structure",
  "v_space_elements",
  "ids_runs",
  "v_ids_latest",
  "v_ids_summary",
  "rel_defines_by_type",
  "rel_associates_document",
  "rel_associates_classification",
  "rel_assigns_to_actor",
  "rel_assigns_to_group",
  "rel_member_of",
]);

/** Povolené operátory filtra query_view (PostgREST). */
const QUERY_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]);

/** Stĺpec alebo JSONB cesta (properties->Pset_X->>Kľúč) — nič iné neprejde. */
const COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(->>?[a-zA-Z0-9_ .-]+)*$/;

/** Whitelist kanonických views vzťahov (D-051) — jediné povolené `rel_type`. */
const REL_VIEWS = new Set([
  "rel_aggregates",
  "rel_contained_in_spatial_structure",
  "rel_referenced_in_spatial_structure",
  "rel_defines_by_type",
  "rel_associates_document",
  "rel_associates_classification",
  "rel_assigns_to_actor",
  "rel_assigns_to_group",
  "rel_member_of",
]);

/** Zdroj pre trust loop — deep-linky renderuje UI, nie model. */
export interface AskSource {
  id: string;
  objectType: string;
  objectRef: string | null;
  name: string | null;
  /** Segment detail route: `asset_type` → type, document → drawing, inak node. */
  route: "node" | "type" | "drawing";
  /** Aktívny IFC GUID (deep-link `/ifc?focus=<guid>`); null = nie je v 3D. */
  ifcGuid: string | null;
  /** Výkresy, kde je prvok zobrazený (deep-link `/drawing/[docId]?focus=<id>`). */
  drawings: { docId: string; docName: string | null; page: number | null }[];
}

/** UI akcia vyžiadaná modelom (show_in_3d…) — klient na ňu naviguje (D-056). */
export type { AskAction };

/** Záznam o vykonanom tool calle (transparentnosť v UI). */
export interface AskToolTrace {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  /** Krátky súhrn výsledku (počet riadkov / chyba). */
  summary: string;
}

interface ObjectRow {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type?: string | null;
  predefined_type?: string | null;
}

function routeFor(objectType: string): AskSource["route"] {
  if (objectType === "asset_type") return "type";
  if (objectType === "document") return "drawing";
  return "node";
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/** Sanitizácia textu do PostgREST `or=`/`ilike` filtra (čiarky/zátvorky = syntax). */
function sanitizeQuery(raw: unknown): string {
  return String(raw ?? "").replace(/[,()%]/g, " ").trim().slice(0, 100);
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_model_stats",
    description:
      "Slovník modelu: počty uzlov podľa object_type, zoznam IFC tried assetov " +
      "(ifc_type × predefined_type) s počtami, zoznam psetov (názvy + počet properties), " +
      "podlažia, systémy, klasifikačné systémy a dokumenty. Zavolaj, keď nevieš, aké " +
      "triedy/podtypy/psety v projekte existujú, alebo keď search nič nenašiel — zistíš " +
      "správne hodnoty filtrov. Presné JSONB cesty (pset × property × typ hodnoty × " +
      "vzorky hodnôt) → query_view relation=v_property_dictionary (D-058).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_objects",
    description:
      "Vyhľadanie uzlov grafu (objects) podľa IDENTITY a IFC typológie. `query` hľadá naraz " +
      "v názve, object_ref, IFC triede aj predefined_type (ilike). Filtre: object_type " +
      "(asset, asset_type, space, floor, building, site, system, document, person, " +
      "organization), ifc_type = IFC trieda (napr. IfcDoor, IfcUnitaryEquipment), " +
      "predefined_type = IFC enum podtypu (napr. AIRCONDITIONINGUNIT, VAV). POZOR: podtyp " +
      "ako AIRCONDITIONINGUNIT je predefined_type, NIE ifc_type. Obsah VLASTNOSTÍ (psety) " +
      "tento tool nevidí — na to je search_everything. Na počty použi count_objects, " +
      "na slovník hodnôt get_model_stats.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "Filter na object_type" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "Filter na IFC predefined_type enum (case-insensitive zhoda)" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
    },
  },
  {
    name: "search_everything",
    description:
      "ZDROJ: graf AIM v DB (nie IFC súbor). Fulltextové vyhľadávanie nad CELÝM obsahom uzlov " +
      "AIM — názov, object_ref, IFC trieda aj VŠETKY importované psety (kľúče a hodnoty, vrátane " +
      "custom psetov); IFC atribúty Description/ObjectType/Tag/LongName nevidí. Tolerantné na diakritiku " +
      "a preklepy (fuzzy). Použi vždy, keď hľadáš podľa OBSAHU vlastností (výrobca, materiál, " +
      "sériové číslo, ľubovoľné kľúčové slovo) alebo keď search_objects nič nenašiel. " +
      "Vracia score, match_kind, úryvok (headline) a matched_properties = v ktorom psete/" +
      "property match nastal — cituj to ako dôkaz. Kandidátov ďalej over cez " +
      "get_asset_details/get_object; hľadané slovo skús aj v angličtine (kľúče psetov " +
      "bývajú anglické: HeatRecovery, Manufacturer…).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Hľadaný text (slová, kód, hodnota; min 2 znaky)" },
        object_types: {
          type: "array",
          items: { type: "string" },
          description: "Voliteľný filter na object_type (napr. ['asset','asset_type'])",
        },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
      required: ["q"],
    },
  },
  {
    name: "count_objects",
    description:
      "Presný počet uzlov vyhovujúcich filtrom (rovnaké filtre ako search_objects). " +
      "Použi na otázky typu 'koľko X je v projekte' — search_objects vracia max " +
      `${MAX_LIMIT} riadkov, takže počítať z jeho výsledkov je nespoľahlivé.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "Filter na object_type" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "Filter na IFC predefined_type enum (case-insensitive zhoda)" },
      },
    },
  },
  {
    name: "locate_objects",
    description:
      "Nájde prvky podľa filtrov (rovnaké ako search_objects) a rovno určí, na ktorom " +
      "podlaží a v ktorej miestnosti sú — vráti presný celkový počet + rozpad po podlažiach " +
      "so vzorkou prvkov. Ideálne na otázky 'koľko X je v projekte a kde/na akých podlažiach'. " +
      "Alternatívne miesto filtrov prijme zoznam ids z predchádzajúceho hľadania.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "Filter na object_type (default asset)" },
        ifc_type: { type: "string", description: "Filter na IFC triedu (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "Filter na IFC predefined_type enum (case-insensitive zhoda)" },
        ids: { type: "array", items: { type: "string" }, description: "Alternatíva k filtrom: konkrétne objects.id" },
      },
    },
  },
  {
    name: "query_view",
    description:
      "Generický read-only dopyt nad ľubovoľnou tabuľkou/view v DB (celá dátová vrstva). " +
      "Relácie: objects (uzly: id, object_type, object_ref, name, ifc_type, predefined_type, " +
      "user_defined_type, properties JSONB s psetmi), floors (elevation), documents, persons, " +
      "classification_systems/references, ifc_guid_history, relationship_types (manifest hrán), " +
      "v_asset_effective (properties s dedičnosťou type→occurrence), v_asset_classifications, " +
      "v_floors, v_actors, v_property_dictionary (slovník psetov z dát: object_type, ifc_type, " +
      "pset, property, value_type, object_count, sample_values, min/max_number — presné JSONB " +
      "cesty zisti TU, nehádaj ich), ifc_property_definitions (IFC definície štandardných " +
      "psetov: description, data_type, enum_values, applicable_classes — VÝZNAM a jednotky " +
      "property) a hrany rel_aggregates, rel_contained_in_spatial_structure, " +
      "rel_defines_by_type, rel_associates_document, rel_associates_classification, " +
      "rel_assigns_to_actor, rel_assigns_to_group, rel_member_of (všetky: from_id→to_id, " +
      "valid_until null = aktívna). JSONB cesty fungujú v select aj filtri: " +
      "properties->Pset_ValveTypeIsolating->>IsNormallyOpen. Join nie je — reťaz dopyty " +
      "cez op 'in' so zoznamom id z predchádzajúceho výsledku.",
    inputSchema: {
      type: "object",
      properties: {
        relation: { type: "string", description: "Názov tabuľky/view z whitelistu" },
        select: {
          type: "array",
          items: { type: "string" },
          description: "Stĺpce (default *). JSONB cesta: properties->Pset->>Kľúč",
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op: { type: "string", description: "eq|neq|gt|gte|lt|lte|like|ilike|is|in" },
              value: { description: "Hodnota; pre 'in' pole hodnôt; pre 'is' null" },
            },
            required: ["column", "op"],
          },
          description: "AND filtre",
        },
        order: {
          type: "object",
          properties: {
            column: { type: "string" },
            ascending: { type: "boolean" },
          },
          description: "Zoradenie výsledku",
        },
        count_only: { type: "boolean", description: "true = vráť len presný počet riadkov" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
      required: ["relation"],
    },
  },
  {
    name: "aggregate_objects",
    description:
      "Presné agregácie a ČÍSELNÉ porovnania nad hodnotami psetov — počíta databáza, " +
      "nikdy nepočítaj z orezaných riadkov. agg=count|sum|avg|min|max nad numerickou " +
      "hodnotou prop_path (napr. ['VZT_Parametre','AirFlowRate']); group_by (stĺpec: " +
      "object_type|ifc_type|predefined_type|user_defined_type|name|object_ref) alebo " +
      "group_by_path (pset cesta ako kľúč, napr. výrobca). AND filtre " +
      "{column|path, op eq|neq|gt|gte|lt|lte|ilike|is, value} — gt/lt nad path porovnáva " +
      "NUMERICKY (v query_view sa JSONB porovnáva ako text — na čísla vždy toto). " +
      "ids = zúženie na konkrétne prvky (reťazenie s locate_objects/search_everything). " +
      "return_rows=true vráti top 50 riadkov s hodnotou (implicitne len tie, čo hodnotu " +
      "majú). Nenumerické hodnoty preskočí a reportuje v skipped_non_numeric. " +
      "relation: objects | v_asset_effective (dedičnosť type→occurrence — pre psety " +
      "assetov preferuj v_asset_effective).",
    inputSchema: {
      type: "object",
      properties: {
        relation: { type: "string", description: "objects (default) | v_asset_effective" },
        agg: { type: "string", description: "count (default) | sum | avg | min | max" },
        prop_path: {
          type: "array",
          items: { type: "string" },
          description: "Cesta v properties, napr. ['Qto_DoorBaseQuantities','Width']",
        },
        group_by: { type: "string", description: "Stĺpec pre skupiny (whitelist)" },
        group_by_path: {
          type: "array",
          items: { type: "string" },
          description: "Alternatíva: pset cesta ako kľúč skupiny",
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string", description: "Stĺpec z whitelistu" },
              path: { type: "array", items: { type: "string" }, description: "Alebo pset cesta" },
              op: { type: "string", description: "eq|neq|gt|gte|lt|lte|ilike|is" },
              value: { description: "Hodnota (pre gt/lt nad path číslo ako string)" },
            },
            required: ["op"],
          },
          description: "AND filtre",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Voliteľné: len tieto objects.id (UUID)",
        },
        max_groups: { type: "number", description: "Strop skupín (default a max 50)" },
        return_rows: { type: "boolean", description: "true = riadky s hodnotou namiesto agregátu" },
      },
    },
  },
  {
    name: "get_object",
    description:
      "Detail jedného uzla podľa UUID, object_ref (napr. 'DD01.06.03') alebo kódu prvku " +
      "(meno ako 'VV.03.01.040'; prvok len v IFC vráti in_aim:false a global_id): " +
      "identita, IFC trieda, predefined_type, aktívny IFC GUID a podlažie (floor) - na " +
      "'čo je X a kde je' stačí jedno volanie.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_ref: { type: "string", description: "objects.id (UUID), object_ref alebo kód prvku (meno v AIM / IFC)" },
      },
      required: ["id_or_ref"],
    },
  },
  {
    name: "get_asset_details",
    description:
      "Efektívne vlastnosti assetu (dedičnosť type→occurrence, v_asset_effective) + " +
      "klasifikácie (v_asset_classifications, union vlastných a zdedených). Len pre object_type='asset'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id assetu (UUID)" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_relations",
    description:
      "Vzťahy uzla cez kanonické views: rel_aggregates (dekompozícia štruktúry), " +
      "rel_contained_in_spatial_structure (prvok v priestore/podlaží, natívne zo súboru), " +
      "rel_referenced_in_spatial_structure (prvok sa nachádza aj v priestore — odvodené geometriou " +
      "naprieč modelmi, role inside|partial), rel_defines_by_type (occurrence→typ), " +
      "rel_associates_document (uzol→dokument), rel_associates_classification, " +
      "rel_assigns_to_actor (zodpovednosti, aktor→uzol), rel_assigns_to_group (člen→systém), " +
      "rel_member_of (osoba→organizácia). Smer je subjekt(from)→objekt(to); zadaj from_id alebo to_id.",
    inputSchema: {
      type: "object",
      properties: {
        rel_type: { type: "string", description: "Názov kanonického view (rel_*)" },
        from_id: { type: "string", description: "Filter na subjekt (objects.id)" },
        to_id: { type: "string", description: "Filter na objekt (objects.id)" },
        limit: { type: "number", description: `Max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
      },
      required: ["rel_type"],
    },
  },
  {
    name: "get_spatial_path",
    description:
      "Priestorové zaradenie uzla — cesta nahor (asset → space → floor → building → site) " +
      "cez rel_contained_in_spatial_structure a rel_aggregates, plus `referenced_in` = miestnosti, " +
      "v ktorých prvok geometricky leží (rel_referenced_in_spatial_structure, napr. VZT prvok z iného " +
      "modelu než miestnosti). Odpovedá na 'v ktorej miestnosti/podlaží je X'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id (UUID)" },
      },
      required: ["id"],
    },
  },
  {
    name: "show_in_3d",
    description:
      "UI AKCIA: otvorí 3D model so zvýraznenými a priblíženými prvkami. Zavolaj, keď " +
      "používateľ žiada prvky UKÁZAŤ/ZOBRAZIŤ v 3D - aj jednu miestnosť ('ukáž miestnosť 3.02'; " +
      "skrytú miestnosť viewer zapne a priblíži). Hromadné zobrazenie podľa typu " +
      "(napr. všetky dvere) = pošli PRIAMO filter (ifc_type/query/predefined_type), server " +
      "prvky dohľadá sám. Konkrétnu množinu prvkov pošli v ids_or_refs (JEDEN call; object_ref " +
      "ako '3.02' aj kód prvku ako 'SD04.0001' netreba hľadať vopred). Zvýraznenie je oranžové; clear=true ho zruší (ostatné " +
      "farby ostanú). Funguje len pre prvky s IFC GUID (sú z IFC modelu).",
    inputSchema: {
      type: "object",
      properties: {
        ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: `objects.id (UUID), object_ref alebo kód prvku (meno v IFC) na zvýraznenie (1–${SHOW_3D_CAP})`,
        },
        id_or_ref: { type: "string", description: "Alternatíva pre jediný prvok" },
        clear: { type: "boolean", description: "true = len zrušiť oranžové zvýraznenie z predošlého show_in_3d" },
        global_ids: {
          type: "array",
          items: { type: "string" },
          description:
            `IFC GlobalId prvkov priamo z výsledku ifc_* toolov (pole show_in_3d.global_ids) - ` +
            `aj prvky, ktoré nie sú v grafe AIM; max ${GLOBAL_IDS_CAP}`,
        },
        ifc_type: {
          type: "string",
          description: "Filter namiesto ids: IFC typ (IfcDoor, IfcWindow…) — zobrazí všetky zhody",
        },
        predefined_type: { type: "string", description: "Filter namiesto ids: PredefinedType" },
        query: { type: "string", description: "Filter namiesto ids: fulltext (názov/ref/typ)" },
        object_type: { type: "string", description: "Filter namiesto ids: objects.object_type" },
      },
    },
  },
  {
    name: "select_in_3d",
    description:
      "UI AKCIA: VYBERIE jeden prvok v 3D presne ako klik myšou — viewer ho označí, " +
      "priblíži naň kameru a otvorí jeho panel vlastností priamo v 3D pohľade (IFC " +
      "vlastnosti + AIM karta). Zavolaj LEN keď používateľ chce prvok VYBRAŤ/OZNAČIŤ " +
      "(kliknúť naň) alebo vidieť jeho VLASTNOSTI v 3D; 'ukáž/zobraz X' = show_in_3d. Rozdiel: show_in_3d prvky " +
      "zvýrazní a priblíži (aj mnoho naraz, panel vlastností neotvorí); open_node otvorí " +
      "samostatnú kartu uzla MIMO 3D pohľadu. Jeden prvok na call; funguje len pre " +
      "prvky s IFC GUID (sú z IFC modelu). clear=true výber zruší (ako klik do prázdna). " +
      "Panel (D-113): panel_tab = aim (AIM karta, default) | ifc (dáta zo súboru), panel_section = " +
      "properties | quantities (výmery), highlight = 'Pset.Vlastnosť' rozbalí sadu, posunie a zvýrazní " +
      "riadok (prepne na IFC / Properties; len psety výskytu, Qto_* otvorí sekciu Quantities). Hodnoty na odpoveď ber z ifc_get, panel " +
      "ich len ukáže používateľovi.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_ref: { type: "string", description: "objects.id (UUID), object_ref alebo kód prvku (meno v IFC)" },
        clear: { type: "boolean", description: "true = zrušiť výber vo vieweri (id_or_ref netreba)" },
        panel_tab: { type: "string", enum: ["aim", "ifc"], description: "Záložka panelu vlastností" },
        panel_section: { type: "string", enum: ["properties", "quantities"], description: "Sekcia IFC panelu" },
        highlight: { type: "string", description: "Zvýrazniť vlastnosť: 'Pset_WallCommon.FireRating'" },
      },
    },
  },
  {
    name: "style_in_3d",
    description:
      "UI AKCIA: ofarbí / skryje / znova zobrazí / izoluje prvky v 3D modeli, alebo " +
      "resetne pohľad. Zavolaj, keď používateľ žiada prvky OFARBIŤ, SKRYŤ, IZOLOVAŤ " +
      "(zobraziť len ich) alebo vrátiť pohľad (zobraziť všetko / zrušiť farby). " +
      "Množiny vyberaj filtrom, nie vymenúvaním: jedna trieda = ifc_type, viac tried " +
      "= ifc_types, celá profesia = domain (hvac/plumbing/electrical/architecture/" +
      "structure), celý súbor federácie = model (VZT/ASR) — kombinovateľné " +
      "(napr. domain=hvac + model=VZT). Výber podľa HODNOTY VLASTNOSTI psetu " +
      "(nosné prvky, vonkajšie, požiarna odolnosť…) = property + value (presná " +
      "zhoda, dedičnosť z typu zahrnutá) — NIKDY neaproximuj vlastnosť triedami. " +
      "Systém (VZT vetva, ZTI...), zóna a podlažie: system / system_type / zone / " +
      "storey rozbalia členov v grafe AIM (NIE id systému v ids_or_refs - to vyberie len " +
      "samotný systém). Prvky mimo systémov: not_in_system=true. Všetky zadané kritériá " +
      "platia naraz (AND), napr. ifc_type=IfcDuctFitting + storey=1NP + system=Prívod. " +
      "Viac farieb naraz = groups: [{label, color, ...filter}] (top-level filter platí pre " +
      "všetky skupiny). colorize / transparent / isolate / xray idú do panelu Lens vo vieweri ako " +
      "lens 'AIM chat' (pravidlo = skupina, legenda, počty; prvky mimo pravidiel sú stlmené); " +
      "ďalšie volania pridávajú pravidlá (mode=replace začne odznova), počty na pravidlo " +
      "vráti živý viewer v odpovedi. Farby podľa hodnoty (systémy, triedy, materiál, " +
      "vlastnosť...) = color_by, viewer zvolí farby a vráti legendu. Farby určuje používateľ; " +
      "keď ich nepovie, zvoľ dobre odlíšiteľné a povedz ich. " +
      "Efekty sa hromadia, kým ich nezruší show_all/reset_colors (reset_colors vypne aj " +
      "lens). Viac operácií = viac callov (pokojne v jednom kole).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["colorize", "transparent", "hide", "show", "isolate", "xray", "show_all", "reset_colors"],
          description:
            "colorize=ofarbiť (vyžaduje color), transparent=priehľadne s farbou, hide=skryť, " +
            "show=znova zobraziť skryté, isolate=zobraziť LEN vybrané (ostatné skryť; bez color " +
            "ostanú v pôvodnom vzhľade, color len keď ho používateľ chce), xray=vybrané plné v pôvodnom " +
            "vzhľade a zvyšok modelu priesvitný (X-ray context, ako tlačidlo duch; filtre ako isolate), " +
            "show_all=zrušiť skrývanie, izoláciu a X-ray, reset_colors=zrušiť ofarbenie a lens",
        },
        mode: {
          type: "string",
          enum: ["add", "replace"],
          description:
            "Lens (colorize/transparent/isolate/xray): add = pridať k doterajším pravidlám (predvolené; pri isolate a xray " +
            "rozšíri aktuálnu izoláciu, napr. 'pridaj aj schodiská' = isolate + mode=add, jeden call), replace = " +
            "začať odznova (nová izolácia)",
        },
        color_by: {
          type: "string",
          enum: ["ifc_type", "system", "zone", "material", "model", "classification", "property", "attribute"],
          description: "Farby podľa hodnoty (action=colorize, bez color a groups): každá hodnota iná farba, legenda vo vieweri",
        },
        color_by_key: {
          type: "string",
          description: "Pri color_by=property 'Pset.Vlastnosť' (Pset_WallCommon.FireRating), pri attribute meno atribútu (ObjectType)",
        },
        color: {
          type: "string",
          description:
            "Hex farba RRGGBB pre colorize (napr. ef4444 = červená, 22c55e = zelená, " +
            "3b82f6 = modrá) — preveď pomenovanú farbu používateľa na hex sám",
        },
        ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: "objects.id (UUID) alebo object_ref konkrétnych prvkov",
        },
        global_ids: {
          type: "array",
          items: { type: "string" },
          description:
            `IFC GlobalId prvkov priamo z výsledku ifc_* toolov (pole show_in_3d.global_ids) - ` +
            `aj prvky, ktoré nie sú v grafe AIM; max ${GLOBAL_IDS_CAP}`,
        },
        ifc_type: {
          type: "string",
          description: "Alternatíva: všetky prvky IFC triedy (napr. IfcDoor)",
        },
        ifc_types: {
          type: "array",
          items: { type: "string" },
          description: "Alternatíva: viac IFC tried naraz (napr. [IfcWall, IfcSlab])",
        },
        domain: {
          type: "string",
          enum: ["hvac", "plumbing", "electrical", "architecture", "structure"],
          description:
            "Alternatíva: celá IFC doména — hvac=vzduchotechnika/chladenie/kúrenie, " +
            "plumbing=ZTI/potrubia, electrical=elektro/MaR, architecture=stavebné " +
            "prvky, structure=nosná konštrukcia",
        },
        model: {
          type: "string",
          description:
            "Alternatíva/spresnenie: celý súbor federácie podľa názvu (napr. VZT " +
            "alebo ASR) — kombinovateľné s ifc_type(s)/domain",
        },
        predefined_type: {
          type: "string",
          description: "Voliteľné spresnenie ifc_type cez predefined_type enum",
        },
        property: {
          type: "string",
          description:
            "Alternatíva: prvky podľa hodnoty vlastnosti psetu (napr. LoadBearing, " +
            "IsExternal, FireRating) — vyžaduje value. Pset netreba (nájde sa v " +
            "slovníku), pri nejednoznačnosti ho spresni cez pset. Dedičnosť z typu " +
            "je zahrnutá. Kombinovateľné s ifc_type/predefined_type (AND).",
        },
        value: {
          type: "string",
          description:
            "Očakávaná hodnota vlastnosti ako text — presná zhoda bez ohľadu na " +
            "veľkosť písmen (booleany: true/false). Číselné porovnania (>, <) tool " +
            "nevie — ids si zisti cez aggregate_objects/query_view.",
        },
        pset: {
          type: "string",
          description: "Voliteľné spresnenie property na konkrétny pset (napr. Pset_WallCommon)",
        },
        query: {
          type: "string",
          description: "Alternatíva: prvky podľa názvu/object_ref (ilike substring)",
        },
        system: {
          type: "string",
          description:
            "Členovia systému (IfcDistributionSystem) podľa id, object_ref, názvu alebo ObjectType; " +
            "presná zhoda, inak všetky systémy, ktoré text obsahujú (Prívod = Prívod-1NP, " +
            "Prívod-2NP...; 'Přiváděný vzduch' = všetky s týmto ObjectType). Odpoveď vráti zhodné systémy.",
        },
        system_type: {
          type: "string",
          description: "Členovia systémov s týmto predefined_type (VENTILATION, EXHAUST, SEWAGE...) alebo ObjectType",
        },
        not_in_system: {
          type: "boolean",
          description: "true = len prvky, ktoré nepatria do žiadneho systému (s ifc_type/storey)",
        },
        zone: {
          type: "string",
          description:
            "Zóna (IfcZone, IfcSpatialZone, IfcGroup) podľa id, object_ref alebo názvu: vždy " +
            "miestnosti AJ všetky prvky v nich alebo dotýkajúce sa ich. Len miestnosti/objemy " +
            "zón iba na výslovnú žiadosť: ifc_type=IfcSpace alebo IfcSpatialZone",
        },
        storey: {
          type: "string",
          description: "Podlažie (1NP, 2.NP, object_ref): miestnosti a prvky na ňom",
        },
        groups: {
          type: "array",
          description:
            `Viac skupín s vlastnou farbou v jednom volaní (action colorize, transparent alebo ` +
            `isolate, max 12): každá {label, color, + ľubovoľné filtre z tohto toolu} = jedno ` +
            `pravidlo Lens; top-level filtre platia pre všetky skupiny.`,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              color: { type: "string", description: "Hex RRGGBB" },
              system: { type: "string" },
              system_type: { type: "string" },
              zone: { type: "string" },
              storey: { type: "string" },
              ifc_type: { type: "string" },
              ifc_types: { type: "array", items: { type: "string" } },
              predefined_type: { type: "string" },
              property: { type: "string" },
              value: { type: "string" },
              model: { type: "string" },
              not_in_system: { type: "boolean" },
            },
            required: ["color"],
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "open_drawing",
    description:
      "UI AKCIA: otvorí výkres/dokument v prehliadačke, voliteľne so zvýrazneným prvkom " +
      "a stranou. Zavolaj, keď používateľ žiada otvoriť/ukázať výkres alebo prvok vo výkrese " +
      "(document_id a page zisti cez find_in_drawings).",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "objects.id dokumentu (UUID)" },
        focus_id: { type: "string", description: "Voliteľné: objects.id prvku na zvýraznenie" },
        page: { type: "number", description: "Voliteľné: číslo strany" },
        in_viewer: {
          type: "boolean",
          description:
            "true = otvorí dokument ako kartu vedľa 3D modelu vo vieweri (bez zvýraznenia " +
            "prvku); default false = samostatná prehliadačka výkresu",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "open_node",
    description:
      "UI AKCIA: otvorí detailnú kartu uzla (asset, typ, miestnosť, podlažie, systém, " +
      "osoba, organizácia…). Zavolaj, keď používateľ žiada otvoriť/ukázať detail alebo kartu.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_ref: { type: "string", description: "objects.id (UUID) alebo object_ref uzla" },
      },
      required: ["id_or_ref"],
    },
  },
  {
    name: "search_documents",
    description:
      "Fulltextové vyhľadávanie v OBSAHU dokumentov/výkresov (extrahovaný text PDF strán — " +
      "legendy, špecifikácie, popisky, pečiatky). Vracia dokument, stranu, snippet a " +
      "deep_link na otvorenie výkresu na danej strane. Použi na otázky 'v ktorom dokumente " +
      "sa píše o X'. POZOR: výkresy sú prevažne grafika — text býva riedky; ak dokument " +
      "nemá extrahovaný text, nenájde sa tu (metadáta dokumentov hľadá query_view/search).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Hľadaný text (min 2 znaky)" },
        limit: { type: "number", description: "Max výsledkov (default 10, strop 50)" },
      },
      required: ["q"],
    },
  },
  {
    name: "find_in_drawings",
    description:
      "Výkresy, v ktorých je prvok (asset/asset_type) zobrazený (E4 auto-linking) vrátane " +
      "čísel strán s regiónom prvku. Odpovedá na 'na ktorých výkresoch a kde je X'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "objects.id prvku (UUID)" },
      },
      required: ["id"],
    },
  },
  ...VIEW_TOOL_DEFINITIONS,
  ...LIST_TOOL_DEFINITIONS,
];

export interface ToolExecution {
  content: string;
  isError: boolean;
}

/** Runtime jednej /api/ask požiadavky: vykonáva tools + zbiera zdroje a trace. */
export class AskToolRuntime {
  private sources = new Map<string, AskSource>();
  readonly trace: AskToolTrace[] = [];
  /** UI akcie vyžiadané modelom — route ich vráti klientovi na vykonanie. */
  readonly actions: AskAction[] = [];
  /** Verzia AIM chat lens z posledného `style_in_3d` (D-096) - MCP sa podľa nej spýta viewera na počty. */
  lensRev: string | null = null;

  /** Zaregistruje objekt medzi zdroje (dedupe podľa id). */
  private addSource(row: ObjectRow) {
    if (this.sources.has(row.id)) return;
    this.sources.set(row.id, {
      id: row.id,
      objectType: row.object_type,
      objectRef: row.object_ref ?? null,
      name: row.name ?? null,
      route: routeFor(row.object_type),
      ifcGuid: null,
      drawings: [],
    });
  }

  private async loadObjects(ids: string[]): Promise<ObjectRow[]> {
    const unique = [...new Set(ids)].slice(0, LOCATE_CAP);
    if (unique.length === 0) return [];
    const supabase = getSupabaseAdmin();
    const rows: ObjectRow[] = [];
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name, ifc_type, predefined_type")
        .in("id", unique.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as ObjectRow[]));
    }
    for (const r of rows) this.addSource(r);
    return rows;
  }

  async exec(name: string, input: Record<string, unknown>): Promise<ToolExecution> {
    try {
      const result = await this.dispatch(name, input);
      let content = JSON.stringify(result);
      if (content.length > MAX_RESULT_CHARS) {
        content = content.slice(0, MAX_RESULT_CHARS) + "…(orezané)";
      }
      const count = Array.isArray(result)
        ? result.length
        : typeof result === "object" && result !== null && "rows" in result &&
            Array.isArray((result as { rows: unknown[] }).rows)
          ? (result as { rows: unknown[] }).rows.length
          : 1;
      this.trace.push({ name, input, ok: true, summary: `${count} výsledkov` });
      return { content, isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.trace.push({ name, input, ok: false, summary: msg.slice(0, 200) });
      return { content: `Chyba toolu: ${msg.slice(0, 300)}`, isError: true };
    }
  }

  private async dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "get_model_stats":
        return this.getModelStats();
      case "search_objects":
        return this.searchObjects(input);
      case "search_everything":
        return this.searchEverything(input);
      case "count_objects":
        return this.countObjects(input);
      case "locate_objects":
        return this.locateObjects(input);
      case "query_view":
        return this.queryView(input);
      case "aggregate_objects":
        return this.aggregateObjects(input);
      case "get_object":
        return this.getObject(input);
      case "get_asset_details":
        return this.getAssetDetails(input);
      case "list_relations":
        return this.listRelations(input);
      case "get_spatial_path":
        return this.getSpatialPath(input);
      case "find_in_drawings":
        return this.findInDrawings(input);
      case "search_documents":
        return this.searchDocuments(input);
      case "show_in_3d":
        return this.showIn3d(input);
      case "select_in_3d":
        return this.selectIn3d(input);
      case "style_in_3d":
        return this.styleIn3d(input);
      case "open_drawing":
        return this.openDrawing(input);
      case "open_node":
        return this.openNode(input);
      default:
        if (VIEW_TOOL_NAMES.has(name)) return execViewTool(name, input, (a) => this.actions.push(a));
        if (LIST_TOOL_NAMES.has(name)) return execListTool(name, input, (a) => this.actions.push(a));
        throw new Error(`Neznámy tool '${name}'.`);
    }
  }

  /** Spoločné filtre search_objects/count_objects nad `objects`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyObjectFilters<T extends { or: any; ilike: any; eq: any; is: any }>(
    q: T,
    input: Record<string, unknown>
  ): T {
    // Zaniknuté objekty (už ich nevydáva žiadny model, D-088) AI nevidí.
    q = q.is("valid_until", null);
    const query = sanitizeQuery(input.query);
    if (query) {
      // Hľadáme naprieč identitou aj IFC typológiou — podtyp (AIRCONDITIONINGUNIT)
      // žije v predefined_type, nie v názve (poučenie z prevádzky, D-056).
      q = q.or(
        `name.ilike.%${query}%,object_ref.ilike.%${query}%,` +
          `ifc_type.ilike.%${query}%,predefined_type.ilike.%${query}%`
      );
    }
    if (typeof input.object_type === "string" && input.object_type)
      q = q.eq("object_type", input.object_type);
    // ilike bez % = case-insensitive presná zhoda (model píše ifcdoor/IFCDOOR…).
    const ifcType = sanitizeQuery(input.ifc_type);
    if (ifcType) q = q.ilike("ifc_type", ifcType);
    const predefinedType = sanitizeQuery(input.predefined_type);
    if (predefinedType) q = q.ilike("predefined_type", predefinedType);
    return q;
  }

  private async searchObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const limit = clampLimit(input.limit);
    const q = this.applyObjectFilters(
      supabase
        .from("objects")
        .select("id, object_type, object_ref, name, ifc_type, predefined_type"),
      input
    ).limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ObjectRow[];
    for (const r of rows) this.addSource(r);
    if (rows.length === 0) {
      return { rows, hint: "Nič sa nenašlo — zavolaj get_model_stats a over hodnoty filtrov." };
    }
    return rows;
  }

  /**
   * Fulltext + fuzzy nad `objects.search_text` (D-059) — RPC `search_everything`.
   * Jediné .rpc() volanie LLM vrstvy: parametrizované (žiadny SQL splicing),
   * row-cap drží SQL funkcia (limit 50).
   */
  /** Aj pre kombinované `search_all` (D-095), preto verejné. */
  async searchEverything(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const q = String(input.q ?? "").trim().slice(0, 200);
    if (q.length < 2) throw new Error("q musí mať aspoň 2 znaky.");
    const objectTypes = Array.isArray(input.object_types)
      ? (input.object_types as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        )
      : null;

    const { data, error } = await supabase.rpc("search_everything", {
      q,
      object_types: objectTypes && objectTypes.length > 0 ? objectTypes : null,
      max_rows: clampLimit(input.limit),
    });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as (ObjectRow & {
      score: number;
      match_kind: string;
      headline: string | null;
      matched_properties: unknown;
    })[];
    for (const r of rows) this.addSource(r);
    if (rows.length === 0) {
      return {
        rows,
        hint:
          "Nič sa nenašlo — skús synonymá alebo anglický ekvivalent (kľúče psetov " +
          "bývajú anglické), prípadne over slovník cez v_property_dictionary.",
      };
    }
    return rows;
  }

  private async countObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const q = this.applyObjectFilters(
      supabase.from("objects").select("id", { count: "exact", head: true }),
      input
    );
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  }

  /**
   * Batch lokalizácia: prvky podľa filtrov/ids → podlažie (+ miestnosť) na
   * jeden call. Containment: prvok →(contained_in) space|floor; space
   * →(aggregates) floor (MEP býva rovno na podlaží, D-049).
   */
  private async locateObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();

    let elements: ObjectRow[];
    let total: number;
    const idsInput = Array.isArray(input.ids)
      ? (input.ids as unknown[]).filter((v): v is string => typeof v === "string" && isUuid(v))
      : [];
    if (idsInput.length > 0) {
      elements = await this.loadObjects(idsInput.slice(0, LOCATE_CAP));
      total = elements.length;
    } else {
      const filters = { object_type: "asset", ...input };
      const [listRes, countRes] = await Promise.all([
        this.applyObjectFilters(
          supabase
            .from("objects")
            .select("id, object_type, object_ref, name, ifc_type, predefined_type"),
          filters
        ).limit(LOCATE_CAP),
        this.applyObjectFilters(
          supabase.from("objects").select("id", { count: "exact", head: true }),
          filters
        ),
      ]);
      if (listRes.error) throw new Error(listRes.error.message);
      if (countRes.error) throw new Error(countRes.error.message);
      elements = (listRes.data ?? []) as ObjectRow[];
      total = countRes.count ?? elements.length;
    }
    if (elements.length === 0) {
      return { total: 0, hint: "Nič sa nenašlo — over hodnoty filtrov cez get_model_stats." };
    }

    // Rodičia (space alebo priamo floor) po dávkach.
    const elementIds = elements.map((e) => e.id);
    const parentByElement = new Map<string, string>();
    for (let i = 0; i < elementIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("rel_contained_in_spatial_structure")
        .select("from_id, to_id")
        .in("from_id", elementIds.slice(i, i + IN_CHUNK))
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { from_id: string; to_id: string }[]) {
        parentByElement.set(r.from_id, r.to_id);
      }
    }

    const parentIds = [...new Set(parentByElement.values())];
    const parents = new Map<string, ObjectRow>();
    for (let i = 0; i < parentIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name")
        .in("id", parentIds.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as ObjectRow[]) parents.set(r.id, r);
    }

    // space → floor (rel_aggregates, smer dieťa→rodič).
    const spaceIds = parentIds.filter((id) => parents.get(id)?.object_type === "space");
    const floorBySpace = new Map<string, string>();
    for (let i = 0; i < spaceIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("rel_aggregates")
        .select("from_id, to_id")
        .in("from_id", spaceIds.slice(i, i + IN_CHUNK))
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { from_id: string; to_id: string }[]) {
        floorBySpace.set(r.from_id, r.to_id);
      }
    }
    const floorIds = [...new Set(floorBySpace.values())].filter((id) => !parents.has(id));
    for (let i = 0; i < floorIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name")
        .in("id", floorIds.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as ObjectRow[]) parents.set(r.id, r);
    }

    // Zoskupenie po podlažiach; vzorka prvkov (+miestnosť) na podlažie.
    const SAMPLE = 10;
    const groups = new Map<
      string,
      { floor: { id: string; name: string | null; object_ref: string | null } | null; count: number; sample: unknown[] }
    >();
    for (const el of elements) {
      const parentId = parentByElement.get(el.id);
      const parent = parentId ? parents.get(parentId) : undefined;
      const floorId =
        parent?.object_type === "floor"
          ? parent.id
          : parent?.object_type === "space"
            ? floorBySpace.get(parent.id)
            : undefined;
      const floor = floorId ? parents.get(floorId) : undefined;
      const key = floor?.id ?? "bez-podlažia";
      let g = groups.get(key);
      if (!g) {
        g = {
          floor: floor
            ? { id: floor.id, name: floor.name ?? null, object_ref: floor.object_ref ?? null }
            : null,
          count: 0,
          sample: [],
        };
        groups.set(key, g);
        if (floor) this.addSource(floor);
      }
      g.count += 1;
      if (g.sample.length < SAMPLE) {
        this.addSource(el);
        g.sample.push({
          id: el.id,
          object_ref: el.object_ref,
          name: el.name,
          ifc_type: el.ifc_type,
          predefined_type: el.predefined_type,
          space: parent?.object_type === "space" ? (parent.name ?? parent.object_ref) : null,
        });
      }
    }

    return {
      total,
      located: elements.length,
      truncated: total > elements.length,
      by_floor: [...groups.values()].sort((a, b) => b.count - a.count),
    };
  }

  /** Generický read-only dopyt nad whitelistom relácií (celá dátová vrstva). */
  private async queryView(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const relation = String(input.relation ?? "").trim();
    if (!QUERY_RELATIONS.has(relation)) {
      throw new Error(
        `Relácia '${relation}' nie je vo whiteliste. Povolené: ${[...QUERY_RELATIONS].join(", ")}.`
      );
    }

    const selectCols = Array.isArray(input.select)
      ? (input.select as unknown[]).filter(
          (c): c is string => typeof c === "string" && COLUMN_RE.test(c)
        )
      : [];
    const select = selectCols.length > 0 ? selectCols.join(", ") : "*";

    const countOnly = input.count_only === true;
    let q = countOnly
      ? supabase.from(relation).select("*", { count: "exact", head: true })
      : supabase.from(relation).select(select).limit(clampLimit(input.limit));

    const filters = Array.isArray(input.filters) ? (input.filters as unknown[]) : [];
    for (const f of filters) {
      if (typeof f !== "object" || f === null) continue;
      const { column, op, value } = f as { column?: unknown; op?: unknown; value?: unknown };
      const col = String(column ?? "");
      const operator = String(op ?? "");
      if (!COLUMN_RE.test(col)) throw new Error(`Neplatný stĺpec '${col}'.`);
      if (!QUERY_OPS.has(operator))
        throw new Error(`Neplatný operátor '${operator}' — povolené: ${[...QUERY_OPS].join(", ")}.`);
      // PostgREST porovnáva JSONB cesty ako TEXT ('9' > '10') → číselné porovnanie
      // psetov musí ísť cez aggregate_objects (guidance error, viditeľný v trace).
      if (col.includes("->") && ["gt", "gte", "lt", "lte"].includes(operator)) {
        throw new Error(
          `Porovnanie '${operator}' nad JSONB cestou tu porovnáva text ('9' > '10'), nie ` +
            `čísla — použi aggregate_objects s filters: [{path: [...], op: '${operator}', ` +
            `value: '...'}] (numericky bezpečné; return_rows=true vráti riadky).`
        );
      }
      if (operator === "in") {
        const vals = Array.isArray(value) ? value : [value];
        q = q.in(col, vals.slice(0, IN_CHUNK));
      } else if (operator === "is") {
        q = q.is(col, value === "null" ? null : (value as boolean | null));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        q = (q as any)[operator](col, value);
      }
    }

    const order = input.order as { column?: unknown; ascending?: unknown } | undefined;
    if (!countOnly && order && typeof order.column === "string" && COLUMN_RE.test(order.column)) {
      q = q.order(order.column, { ascending: order.ascending !== false });
    }

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    if (countOnly) return { count: count ?? 0 };

    const rows = (data ?? []) as Record<string, unknown>[];
    // Uzly do zdrojov (trust loop) — podľa tvaru riadku (objects/v_* views).
    for (const r of rows) {
      if (typeof r.id === "string" && (typeof r.object_type === "string" || relation === "v_asset_effective")) {
        this.addSource({
          id: r.id,
          object_type: (r.object_type as string | undefined) ?? "asset",
          object_ref: (r.object_ref as string | null | undefined) ?? null,
          name: (r.name as string | null | undefined) ?? null,
        });
      }
    }
    return { rows, row_count: rows.length };
  }

  /**
   * Agregácie/číselné filtre nad psetmi (D-060) — RPC `aggregate_objects`.
   * Whitelisty a formátovanie identifikátorov/literálov drží SQL funkcia;
   * TS strana len normalizuje vstup a zbiera zdroje z rows režimu.
   */
  private async aggregateObjects(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const strArr = (v: unknown): string[] | null =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
        : null;
    const propPath = strArr(input.prop_path);
    const groupByPath = strArr(input.group_by_path);
    const idsArr = (strArr(input.ids) ?? []).filter(isUuid);

    const { data, error } = await supabase.rpc("aggregate_objects", {
      relation:
        typeof input.relation === "string" && input.relation ? input.relation : "objects",
      agg: typeof input.agg === "string" && input.agg ? input.agg : "count",
      prop_path: propPath && propPath.length > 0 ? propPath : null,
      group_by:
        typeof input.group_by === "string" && input.group_by ? input.group_by : null,
      group_by_path: groupByPath && groupByPath.length > 0 ? groupByPath : null,
      filters: Array.isArray(input.filters) ? input.filters : [],
      ids: idsArr.length > 0 ? idsArr : null,
      max_groups: typeof input.max_groups === "number" ? input.max_groups : 50,
      return_rows: input.return_rows === true,
    });
    if (error) throw new Error(error.message);

    const res = data as {
      mode?: string;
      rows?: {
        id?: string;
        object_ref?: string | null;
        name?: string | null;
        object_type?: string;
      }[];
    } | null;
    if (res?.mode === "rows" && Array.isArray(res.rows)) {
      for (const r of res.rows) {
        if (typeof r.id === "string" && typeof r.object_type === "string") {
          this.addSource({
            id: r.id,
            object_type: r.object_type,
            object_ref: r.object_ref ?? null,
            name: r.name ?? null,
          });
        }
      }
    }
    return data;
  }

  /** Slovník modelu — grounding pre filtre (model nemusí hádať hodnoty). */
  private async getModelStats() {
    const supabase = getSupabaseAdmin();
    // Jadro (objects) je povinné; grounding bloky (psety, podlažia, systémy,
    // klasifikácie, dokumenty — D-058) sú best-effort: ich výpadok nezhodí tool.
    const [objRows, psetRes, floorsRes, systemsRes, clsSysRes, docsRes] = await Promise.all([
      // Stránkovane: .limit(10000) neprebije PostgREST db-max-rows (1000) —
      // bez stránkovania by slovník modelu (grounding pre LLM) ticho podhodnotil
      // počty typov/tried nad prvých 1000 objektov.
      fetchAllPages<{
        object_type: string;
        ifc_type: string | null;
        predefined_type: string | null;
      }>((from, to) =>
        supabase
          .from("objects")
          .select("object_type, ifc_type, predefined_type")
          .is("valid_until", null)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      supabase.from("v_property_dictionary").select("pset, property").limit(5000),
      supabase
        .from("v_floors")
        .select("name, elevation")
        .order("elevation", { ascending: true })
        .limit(50),
      supabase.from("objects").select("name").eq("object_type", "system").is("valid_until", null).limit(50),
      supabase.from("classification_systems").select("name").limit(20),
      supabase.from("objects").select("name").eq("object_type", "document").is("valid_until", null).limit(50),
    ]);
    const byObjectType = new Map<string, number>();
    const byClass = new Map<string, { ifc_type: string; predefined_type: string | null; count: number }>();
    for (const r of objRows) {
      byObjectType.set(r.object_type, (byObjectType.get(r.object_type) ?? 0) + 1);
      if ((r.object_type === "asset" || r.object_type === "asset_type") && r.ifc_type) {
        const key = `${r.object_type}|${r.ifc_type}|${r.predefined_type ?? ""}`;
        const entry = byClass.get(key);
        if (entry) entry.count += 1;
        else
          byClass.set(key, {
            ifc_type: r.ifc_type,
            predefined_type: r.predefined_type,
            count: 1,
          });
      }
    }

    // Psety: názov → počet properties (presné cesty žijú vo v_property_dictionary).
    const psetProps = new Map<string, Set<string>>();
    for (const r of (psetRes.error ? [] : (psetRes.data ?? [])) as {
      pset: string;
      property: string;
    }[]) {
      let set = psetProps.get(r.pset);
      if (!set) {
        set = new Set();
        psetProps.set(r.pset, set);
      }
      set.add(r.property);
    }
    const names = (res: { error: unknown; data: { name: string | null }[] | null }) =>
      res.error ? [] : (res.data ?? []).map((r) => r.name).filter(Boolean);

    return {
      object_types: Object.fromEntries(byObjectType),
      // Len occurrence triedy (asset) — typy by duplikovali slovník.
      asset_classes: [...byClass.entries()]
        .filter(([k]) => k.startsWith("asset|"))
        .map(([, v]) => v)
        .sort((a, b) => b.count - a.count)
        .slice(0, 150),
      psets: [...psetProps.entries()]
        .map(([pset, props]) => ({ pset, properties: props.size }))
        .sort((a, b) => b.properties - a.properties)
        .slice(0, 100),
      psets_hint:
        "Presné cesty properties->Pset->>Key, typy hodnôt a vzorky: " +
        "query_view relation=v_property_dictionary (filtruj ifc_type/pset).",
      floors: floorsRes.error ? [] : (floorsRes.data ?? []),
      systems: names(systemsRes),
      classification_systems: names(clsSysRes),
      documents: names(docsRes),
    };
  }

  private async getObject(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const idOrRef = String(input.id_or_ref ?? "").trim();
    if (!idOrRef) throw new Error("Chýba id_or_ref.");

    const col = isUuid(idOrRef) ? "id" : "object_ref";
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type, user_defined_type")
      .eq(col, idOrRef)
      .is("valid_until", null)
      .limit(1);
    if (error) throw new Error(error.message);
    let row = data?.[0] as (ObjectRow & { user_defined_type?: string | null }) | undefined;
    let matchedBy: "name" | undefined;
    if (!row && col === "object_ref") {
      // Kód prvku býva meno, nie object_ref (VV.03.01.040), alebo prvok nie je v AIM vôbec (D-102).
      const { data: named, error: nameErr } = await supabase
        .from("objects")
        .select("id, object_type, object_ref, name, ifc_type, predefined_type, user_defined_type")
        .eq("name", idOrRef)
        .is("valid_until", null)
        .limit(6);
      if (nameErr) throw new Error(nameErr.message);
      const rows = (named ?? []) as (ObjectRow & { user_defined_type?: string | null })[];
      if (rows.length > 1) {
        return { found: false, ambiguous: rows.slice(0, 5).map((r) => ({ id: r.id, object_ref: r.object_ref, ifc_type: r.ifc_type })), hint: "Meno má viac uzlov - vyber podľa id." };
      }
      row = rows[0];
      matchedBy = row ? "name" : undefined;
      if (!row) {
        const inIfc = await this.findInIfc(idOrRef);
        if (inIfc) return inIfc;
      }
    }
    if (!row) return { found: false, hint: "Uzol neexistuje — skús search_objects." };
    this.addSource(row);

    const [{ data: guidRows }, floor] = await Promise.all([
      supabase.from("ifc_guid_history").select("ifc_guid").eq("object_id", row.id).is("valid_until", null).limit(1),
      this.floorOf(row.id),
    ]);
    return { ...row, ifc_guid: guidRows?.[0]?.ifc_guid ?? null, ...(floor ? { floor } : {}), ...(matchedBy ? { matched_by: matchedBy } : {}) };
  }

  /** Podlažie uzla: priame umiestnenie, alebo cez miestnosť (contained -> aggregates), 1-2 dotazy. */
  private async floorOf(id: string): Promise<{ id: string; object_ref: string | null; name: string | null } | null> {
    const supabase = getSupabaseAdmin();
    let current = id;
    for (let depth = 0; depth < 3; depth++) {
      const [contained, aggregated] = await Promise.all(
        ["rel_contained_in_spatial_structure", "rel_aggregates"].map((view) =>
          supabase.from(view).select("to_id").eq("from_id", current).is("valid_until", null).limit(1),
        ),
      );
      const parent = (contained.data?.[0]?.to_id ?? aggregated.data?.[0]?.to_id) as string | undefined;
      if (!parent) return null;
      const { data } = await supabase.from("objects").select("id, object_type, object_ref, name").eq("id", parent).limit(1);
      const p = data?.[0] as { id: string; object_type: string; object_ref: string | null; name: string | null } | undefined;
      if (!p) return null;
      if (p.object_type === "floor") return { id: p.id, object_ref: p.object_ref, name: p.name };
      current = p.id;
    }
    return null;
  }

  /** Prvok len v IFC súbore podľa presného mena / Tagu (motor, D-102); null = nič alebo motor vypnutý. */
  private async findInIfc(code: string): Promise<Record<string, unknown> | null> {
    if (!engineEnabled()) return null;
    const { findByNames } = await import("@/lib/engine/names");
    const hits = (await findByNames([code])).get(code) ?? [];
    if (hits.length === 0) return null;
    return {
      found: true,
      in_aim: false,
      source: "ifc",
      ...(hits.length === 1 ? hits[0] : { candidates: hits.slice(0, 5) }),
      hint: "Prvok je len v IFC súbore (v grafe AIM nie je). Ako cieľ ho do set_section / show_in_3d / get_bounds daj kódom alebo global_id; vlastnosti a podlažie dá ifc_get.",
    };
  }

  private async getAssetDetails(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const id = String(input.id ?? "").trim();
    if (!isUuid(id)) throw new Error("id musí byť UUID (objects.id).");

    const [effRes, clsRes] = await Promise.all([
      supabase
        .from("v_asset_effective")
        .select("id, object_ref, name, ifc_type, predefined_type, user_defined_type, properties, type_id, type_name")
        .eq("id", id)
        .limit(1),
      supabase
        .from("v_asset_classifications")
        .select("classification_ref_id, level")
        .eq("object_id", id)
        .limit(MAX_LIMIT),
    ]);
    if (effRes.error) throw new Error(effRes.error.message);
    const eff = effRes.data?.[0];
    if (!eff) return { found: false, hint: "Nie je asset — skús get_object." };
    if (clsRes.error) throw new Error(clsRes.error.message);

    const clsRows = (clsRes.data ?? []) as { classification_ref_id: string; level: string }[];
    let classifications: unknown[] = [];
    if (clsRows.length > 0) {
      const { data: refs, error: refErr } = await supabase
        .from("classification_references")
        .select("id, identification, name")
        .in("id", clsRows.map((c) => c.classification_ref_id));
      if (refErr) throw new Error(refErr.message);
      const byId = new Map((refs ?? []).map((r) => [r.id as string, r]));
      classifications = clsRows.map((c) => ({
        identification: byId.get(c.classification_ref_id)?.identification ?? null,
        name: byId.get(c.classification_ref_id)?.name ?? null,
        level: c.level,
      }));
    }

    this.addSource({
      id: eff.id as string,
      object_type: "asset",
      object_ref: (eff.object_ref as string | null) ?? null,
      name: (eff.name as string | null) ?? null,
    });
    if (eff.type_id) {
      this.addSource({
        id: eff.type_id as string,
        object_type: "asset_type",
        object_ref: null,
        name: (eff.type_name as string | null) ?? null,
      });
    }
    return { ...eff, classifications };
  }

  private async listRelations(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const relType = String(input.rel_type ?? "").trim();
    if (!REL_VIEWS.has(relType)) {
      throw new Error(
        `rel_type '${relType}' nie je vo whiteliste. Povolené: ${[...REL_VIEWS].join(", ")}.`
      );
    }
    const limit = clampLimit(input.limit);
    const fromId = typeof input.from_id === "string" ? input.from_id.trim() : "";
    const toId = typeof input.to_id === "string" ? input.to_id.trim() : "";
    if (!fromId && !toId) throw new Error("Zadaj from_id alebo to_id.");
    if (fromId && !isUuid(fromId)) throw new Error("from_id musí byť UUID.");
    if (toId && !isUuid(toId)) throw new Error("to_id musí byť UUID.");

    let q = supabase.from(relType).select("*").is("valid_until", null).limit(limit);
    if (fromId) q = q.eq("from_id", fromId);
    if (toId) q = q.eq("to_id", toId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { from_id: string; to_id: string; role?: string | null }[];
    // Klasifikačné to_id mieri do classification_references, nie objects.
    const isClassification = relType === "rel_associates_classification";
    const objIds = rows.flatMap((r) => (isClassification ? [r.from_id] : [r.from_id, r.to_id]));
    const metas = await this.loadObjects(objIds);
    const metaById = new Map(metas.map((m) => [m.id, m]));

    let classRefById = new Map<string, { identification: string; name: string | null }>();
    if (isClassification && rows.length > 0) {
      const { data: refs, error: refErr } = await supabase
        .from("classification_references")
        .select("id, identification, name")
        .in("id", rows.map((r) => r.to_id));
      if (refErr) throw new Error(refErr.message);
      classRefById = new Map(
        (refs ?? []).map((r) => [
          r.id as string,
          { identification: r.identification as string, name: (r.name as string | null) ?? null },
        ])
      );
    }

    return rows.map((r) => ({
      from: metaById.get(r.from_id) ?? { id: r.from_id },
      to: isClassification
        ? classRefById.get(r.to_id) ?? { id: r.to_id }
        : metaById.get(r.to_id) ?? { id: r.to_id },
      ...(r.role !== undefined ? { role: r.role } : {}),
    }));
  }

  private async getSpatialPath(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const id = String(input.id ?? "").trim();
    if (!isUuid(id)) throw new Error("id musí byť UUID (objects.id).");

    // Nahor: najprv fyzické umiestnenie (contained), potom dekompozícia (aggregates).
    const chainIds: string[] = [];
    let current = id;
    for (let depth = 0; depth < 8; depth++) {
      let parent: string | null = null;
      for (const view of ["rel_contained_in_spatial_structure", "rel_aggregates"]) {
        const { data, error } = await supabase
          .from(view)
          .select("to_id")
          .eq("from_id", current)
          .is("valid_until", null)
          .limit(1);
        if (error) throw new Error(error.message);
        if (data?.length) {
          parent = data[0].to_id as string;
          break;
        }
      }
      if (!parent || chainIds.includes(parent)) break;
      chainIds.push(parent);
      current = parent;
    }

    // D-080: odvodené zaradenie do miestností (geometria naprieč federáciou).
    const { data: refs, error: refErr } = await supabase
      .from("rel_referenced_in_spatial_structure")
      .select("to_id, role")
      .eq("from_id", id)
      .is("valid_until", null)
      .limit(MAX_LIMIT);
    if (refErr) throw new Error(refErr.message);
    const refRows = (refs ?? []) as { to_id: string; role: string | null }[];

    const metas = await this.loadObjects([id, ...chainIds, ...refRows.map((r) => r.to_id)]);
    const metaById = new Map(metas.map((m) => [m.id, m]));
    return {
      object: metaById.get(id) ?? { id },
      path: chainIds.map((cid) => metaById.get(cid) ?? { id: cid }),
      ...(refRows.length
        ? {
            referenced_in: refRows.map((r) => ({
              ...(metaById.get(r.to_id) ?? { id: r.to_id }),
              role: r.role,
            })),
          }
        : {}),
    };
  }

  private async findInDrawings(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const id = String(input.id ?? "").trim();
    if (!isUuid(id)) throw new Error("id musí byť UUID (objects.id).");

    const { data: rels, error } = await supabase
      .from("rel_associates_document")
      .select("to_id")
      .eq("from_id", id)
      .eq("source", PDF_LINK_SOURCE)
      .is("valid_until", null)
      .limit(MAX_LIMIT);
    if (error) throw new Error(error.message);

    const docIds = [...new Set((rels ?? []).map((r) => r.to_id as string))];
    if (docIds.length === 0) return { drawings: [], hint: "Prvok nie je v žiadnom výkrese (E4)." };

    const { data: docs, error: docErr } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, properties")
      .in("id", docIds);
    if (docErr) throw new Error(docErr.message);

    const source = this.sources.get(id);
    const out = (docs ?? []).map((d) => {
      this.addSource(d as ObjectRow);
      // Strany, na ktorých má prvok región (_drawing_links, D-042).
      const links = ((d.properties as Record<string, unknown> | null)?.["_drawing_links"] ??
        []) as { page?: number; target_id?: string }[];
      const pages = [
        ...new Set(
          links
            .filter((l) => l.target_id === id && typeof l.page === "number")
            .map((l) => l.page as number)
        ),
      ].sort((a, b) => a - b);
      const entry = {
        docId: d.id as string,
        docName: (d.name as string | null) ?? null,
        page: pages[0] ?? null,
      };
      if (source && !source.drawings.some((x) => x.docId === entry.docId)) {
        source.drawings.push(entry);
      }
      return {
        ...entry,
        pages,
        deep_link: `/drawing/${d.id}?focus=${id}${pages[0] ? `&page=${pages[0]}` : ""}`,
      };
    });
    return { drawings: out };
  }

  /**
   * Fulltext v obsahu dokumentov (D-063) — RPC `search_documents` nad
   * `document_pages` (text extrahuje etl/pdf_text.py). Deep-link stavia server.
   */
  private async searchDocuments(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const q = String(input.q ?? "").trim().slice(0, 200);
    if (q.length < 2) throw new Error("q musí mať aspoň 2 znaky.");

    const { data, error } = await supabase.rpc("search_documents", {
      q,
      max_rows: clampLimit(input.limit),
    });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as {
      document_id: string;
      document_ref: string | null;
      document_name: string | null;
      page: number;
      rank: number;
      snippet: string | null;
    }[];
    if (rows.length === 0) {
      return {
        rows,
        hint:
          "Žiadna zhoda v extrahovanom texte — dokument nemusí mať textovú vrstvu " +
          "(výkresy sú prevažne grafika). Metadáta dokumentov skús cez query_view " +
          "relation=documents/objects alebo search_everything.",
      };
    }
    for (const r of rows) {
      this.addSource({
        id: r.document_id,
        object_type: "document",
        object_ref: r.document_ref ?? null,
        name: r.document_name ?? null,
      });
    }
    return rows.map((r) => ({
      ...r,
      deep_link: `/drawing/${r.document_id}?page=${r.page}`,
    }));
  }

  /** Uzol podľa UUID alebo object_ref — spoločné pre akčné tools. */
  private async resolveObject(idOrRef: string): Promise<ObjectRow | null> {
    const supabase = getSupabaseAdmin();
    const value = idOrRef.trim();
    if (!value) return null;
    const col = isUuid(value) ? "id" : "object_ref";
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type")
      .eq(col, value)
      .is("valid_until", null)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data?.[0] as ObjectRow | undefined) ?? null;
    if (row) this.addSource(row);
    return row;
  }

  private async showIn3d(input: Record<string, unknown>) {
    if (input.clear === true) {
      // D-101 (#94): zvýraznenie sa dá zrušiť samostatne, bez reset_colors.
      this.actions.push({ type: "navigate", url: `/ifc?ops=clear_focus::&r=${Date.now().toString(36)}`, label: "Zrušiť zvýraznenie" });
      return { ok: true, cleared: "zvýraznenie" };
    }
    const supabase = getSupabaseAdmin();
    const refs: string[] = [];
    if (Array.isArray(input.ids_or_refs)) {
      refs.push(
        ...(input.ids_or_refs as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0
        )
      );
    }
    const single = String(input.id_or_ref ?? "").trim();
    if (single) refs.push(single);
    const globalIds = sanitizeGlobalIds(input.global_ids);
    const hasFilters = Boolean(
      sanitizeQuery(input.query) ||
        sanitizeQuery(input.ifc_type) ||
        sanitizeQuery(input.predefined_type) ||
        (typeof input.object_type === "string" && input.object_type)
    );
    if (refs.length === 0 && !hasFilters && globalIds.length === 0) {
      throw new Error("Zadaj ids_or_refs / id_or_ref / global_ids, alebo filter (ifc_type, query...).");
    }

    // Dva režimy: explicitné ids/refs (dávkové `.in()` — pri SHOW_3D_CAP prvkoch
    // by per-prvok slučka znamenala stovky round-tripov), alebo filter — model
    // pošle len `ifc_type:'IfcDoor'` a prvky dohľadá server (obrovský zoznam
    // UUID v tool calle narážal na MAX_TOKENS a odpoveď sa odsekla).
    const unique = [...new Set(refs.map((r) => r.trim()))].slice(0, SHOW_3D_CAP);
    const rows: ObjectRow[] = [];
    if (unique.length > 0) {
      for (const [col, vals] of [
        ["id", unique.filter(isUuid)],
        ["object_ref", unique.filter((r) => !isUuid(r))],
      ] as const) {
        for (let i = 0; i < vals.length; i += IN_CHUNK) {
          const { data, error } = await supabase
            .from("objects")
            .select("id, object_type, object_ref, name, ifc_type, predefined_type")
            .in(col, vals.slice(i, i + IN_CHUNK))
            .is("valid_until", null);
          if (error) throw new Error(error.message);
          rows.push(...((data ?? []) as ObjectRow[]));
        }
      }
    } else if (hasFilters) {
      const q = this.applyObjectFilters(
        supabase
          .from("objects")
          .select("id, object_type, object_ref, name, ifc_type, predefined_type"),
        input
      );
      const { data, error } = await q.order("object_ref").limit(SHOW_3D_CAP);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as ObjectRow[]));
      if (rows.length === 0) {
        throw new Error("Filtru nezodpovedá žiadny prvok — skús search_objects.");
      }
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const byRef = new Map(
      rows.filter((r) => r.object_ref).map((r) => [r.object_ref as string, r])
    );

    const guidByObjectId = new Map<string, string>();
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("ifc_guid_history")
        .select("object_id, ifc_guid")
        .in("object_id", ids.slice(i, i + IN_CHUNK))
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (row.object_id && row.ifc_guid && !guidByObjectId.has(row.object_id as string)) {
          guidByObjectId.set(row.object_id as string, row.ifc_guid as string);
        }
      }
    }

    const shown: { label: string; guid: string }[] = [];
    const skipped: string[] = [];
    const addRow = (obj: ObjectRow) => {
      this.addSource(obj);
      const label = obj.object_ref ?? obj.name ?? obj.id.slice(0, 8);
      const guid = guidByObjectId.get(obj.id);
      if (!guid) skipped.push(`${label} (bez IFC GUID — nie je v 3D)`);
      else shown.push({ label, guid });
    };
    if (unique.length > 0) {
      // Kód, ktorý nie je object_ref (meno prvku, prvok len v IFC), dohľadá meno a motor (D-102).
      const missing = unique.filter((ref) => !isUuid(ref) && !byRef.has(ref));
      const byName = missing.length > 0 ? await resolveNamesToGuids(missing) : new Map<string, string>();
      for (const ref of unique) {
        const obj = isUuid(ref) ? byId.get(ref) : byRef.get(ref);
        const guid = byName.get(ref);
        if (obj) addRow(obj);
        else if (guid) shown.push({ label: ref, guid });
        else skipped.push(`${ref} (neexistuje)`);
      }
    } else {
      for (const obj of rows) addRow(obj);
    }
    // GlobalId priamo z IFC motora (D-084) - prvok nemusí byť v grafe AIM.
    for (const g of globalIds) {
      if (!shown.some((s) => s.guid === g)) shown.push({ label: g, guid: g });
    }
    if (shown.length === 0) {
      throw new Error(`Žiadny z prvkov sa nedá zobraziť v 3D: ${skipped.join(", ")}.`);
    }

    // Nonce `r`: každá akcia = unikátna URL → viewer focus efekt sa spustí aj
    // pri identickej množine prvkov a klientská router cache (staleTimes)
    // nikdy neservíruje starý render tej istej cesty (D-056).
    this.actions.push({
      type: "navigate",
      url:
        `/ifc?focus=${encodeURIComponent(shown.map((s) => s.guid).join(","))}` +
        `&r=${Date.now().toString(36)}`,
      label: shown.length === 1 ? `3D: ${shown[0].label}` : `3D: ${shown.length} prvkov`,
    });
    return {
      ok: true,
      opened: "3d",
      shown: shown.map((s) => s.label),
      ...(skipped.length ? { skipped } : {}),
    };
  }

  /**
   * Výber prvku v 3D ako klik myšou (D-082): op `select::<guid>` v `ops`
   * (wire formát D-066). Viewer nastaví selekciu, priblíži kameru a otvorí
   * panel vlastností; AIM kartu dotiahne host po ENTITY_SELECTED ako pri kliku.
   */
  private async selectIn3d(input: Record<string, unknown>) {
    // Panel sa overí pred hľadaním prvku: zlý vstup nemá stáť dotaz do DB.
    selectPanelInput(input);
    if (input.clear === true) {
      // D-102: výber sa dá zrušiť ako klik do prázdna.
      this.actions.push({ type: "navigate", url: `/ifc?ops=clear_selection::&r=${Date.now().toString(36)}`, label: "Zrušiť výber" });
      return { ok: true, cleared: "výber" };
    }
    const ref = String(input.id_or_ref ?? "").trim();
    const obj = await this.resolveObject(ref);
    let label = ref;
    let guid: string | undefined;
    if (obj) {
      label = obj.object_ref ?? obj.name ?? obj.id.slice(0, 8);
      const { data, error } = await getSupabaseAdmin()
        .from("ifc_guid_history")
        .select("ifc_guid")
        .eq("object_id", obj.id)
        .is("valid_until", null)
        .limit(1);
      if (error) throw new Error(error.message);
      guid = (data?.[0] as { ifc_guid?: string } | undefined)?.ifc_guid;
      if (!guid) {
        throw new Error(`${label} nemá IFC GUID — nie je v 3D modeli (kartu otvor cez open_node).`);
      }
    } else if (ref && !isUuid(ref)) {
      guid = (await resolveNamesToGuids([ref])).get(ref); // kód prvku (D-102)
    }
    if (!guid) throw new Error("Prvok neexistuje — najprv ho nájdi cez search_objects.");

    const panel = selectPanelInput(input);
    this.actions.push({
      type: "navigate",
      url: `/ifc?ops=${encodeURIComponent(selectOp(guid, panel))}&r=${Date.now().toString(36)}`,
      label: `3D: výber ${label}`,
    });
    const note = selectPanelNote(input);
    return { ok: true, opened: "3d", selected: label, ifc_guid: guid, ...(panel ? { panel } : {}), ...(note ? { note } : {}) };
  }

  /**
   * Viewer operácia nad 3D scénou (D-066): ofarbenie/skrytie/izolácia prvkov.
   * GUIDy sa resolvujú dávkovo a cestujú klientovi v URL parametri `ops`
   * (wire formát `<op>:<arg>:<guid.guid…>`, viď parseOps v ifc-viewer.tsx);
   * viewer si stav drží, kým ho nezruší show_all/reset_colors.
   */
  private async styleIn3d(input: Record<string, unknown>) {
    const action = String(input.action ?? "").trim();
    const opLabel: Record<string, string> = {
      colorize: "ofarbenie",
      transparent: "priehľadnosť",
      hide: "skrytie",
      show: "zobrazenie",
      isolate: "izolácia",
      xray: "X-ray",
      show_all: "zobraziť všetko",
      reset_colors: "zrušiť farby",
    };
    if (!(action in opLabel)) {
      throw new Error(
        "action musí byť colorize | transparent | hide | show | isolate | xray | show_all | reset_colors."
      );
    }

    const nonce = () => Date.now().toString(36);

    // Globálne resety nepotrebujú prvky.
    if (action === "show_all" || action === "reset_colors") {
      this.actions.push({
        type: "navigate",
        url: `/ifc?ops=${encodeURIComponent(`${action}::`)}&r=${nonce()}`,
        label: `3D: ${opLabel[action]}`,
      });
      return { ok: true, applied: action };
    }

    // Farbenie, priehľadnosť, izolácia a X-ray nad Lens vo vieweri (D-096, D-105): pravidlá s AND, skupiny, počty.
    if (LENS_STYLE_ACTIONS.has(action)) {
      const { result, rev } = await execLensStyle(action, input, (a) => this.actions.push(a), {
        domainTypes: DOMAIN_IFC_TYPES,
      });
      this.lensRev = rev;
      return result;
    }

    // Skrytie / zobrazenie so systémom, zónou alebo podlažím: členov rozbalí graf AIM (GUIDy).
    if (needsScopedStyle(input)) {
      return execScopedStyle(action, input, (a) => this.actions.push(a), { domainTypes: DOMAIN_IFC_TYPES });
    }

    let color = "";
    if (action === "colorize") {
      color = String(input.color ?? "").trim().replace(/^#/, "").toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(color)) {
        throw new Error("color musí byť hex RRGGBB (napr. ef4444 pre červenú).");
      }
    }

    // ── Množinový selektor (D-066 rozšírenie): celé triedy / IFC domény /
    // súbory federácie rozkladá viewer sám z entity tables — žiadne DB
    // round-tripy, žiadny STYLE_CAP, URL ostáva krátka pri tisícoch prvkov.
    // predefined_type/query selektor nevie (žijú len v DB) → DB vetva nižšie.
    const domain = String(input.domain ?? "").trim().toLowerCase();
    if (domain && !(domain in DOMAIN_IFC_TYPES)) {
      throw new Error(`domain musí byť jedna z: ${Object.keys(DOMAIN_IFC_TYPES).join(", ")}.`);
    }
    const modelName = sanitizeModelName(input.model);
    const multiTypes = Array.isArray(input.ifc_types)
      ? (input.ifc_types as unknown[]).map(sanitizeIfcType).filter(Boolean)
      : [];
    const singleType = sanitizeIfcType(input.ifc_type);
    const globalIds = sanitizeGlobalIds(input.global_ids);
    const explicitGiven =
      (Array.isArray(input.ids_or_refs) && (input.ids_or_refs as unknown[]).length > 0) ||
      globalIds.length > 0;
    // Výber podľa hodnoty vlastnosti psetu žije len v DB → DB vetva nižšie.
    const propertyName = String(input.property ?? "").trim();
    const dbOnlyFilter =
      sanitizeQuery(input.predefined_type) || sanitizeQuery(input.query) || propertyName;
    const selectorTypes = domain
      ? DOMAIN_IFC_TYPES[domain]
      : multiTypes.length > 0
        ? multiTypes
        : singleType
          ? [singleType]
          : [];
    if (!explicitGiven && !dbOnlyFilter && (selectorTypes.length > 0 || modelName)) {
      const fields: string[] = [];
      if (selectorTypes.length > 0) fields.push(`t=${selectorTypes.join(".")}`);
      if (modelName) fields.push(`m=${modelName}`);
      const op = `${action}_sel:${color}:${fields.join("~")}`;
      const scope = domain || (modelName && selectorTypes.length === 0 ? `model ${modelName}` : "");
      const scopeLabel =
        scope ||
        `${selectorTypes.slice(0, 3).join("+")}${selectorTypes.length > 3 ? "…" : ""}` +
          (modelName ? ` v ${modelName}` : "");
      this.actions.push({
        type: "navigate",
        url: `/ifc?ops=${encodeURIComponent(op)}&r=${nonce()}`,
        label: `3D: ${opLabel[action]} — ${scopeLabel}`,
      });
      return {
        ok: true,
        applied: action,
        selector: {
          ...(selectorTypes.length > 0 ? { ifc_types: selectorTypes } : {}),
          ...(modelName ? { model: modelName } : {}),
        },
        note: "Výber rozloží 3D viewer podľa IFC tried/súboru — triedy mimo modelu sa ticho preskočia.",
      };
    }

    // ── Výber prvkov: explicitné ids_or_refs ALEBO filter (ifc_type/…/query).
    const supabase = getSupabaseAdmin();
    const explicit = Array.isArray(input.ids_or_refs)
      ? [
          ...new Set(
            (input.ids_or_refs as unknown[]).filter(
              (v): v is string => typeof v === "string" && v.trim().length > 0
            )
          ),
        ].slice(0, STYLE_CAP)
      : [];

    const objectIds: string[] = [];
    const skipped: string[] = [];
    let propertyPsets: string[] = [];
    if (explicit.length > 0) {
      const uuids = explicit.filter((v) => isUuid(v.trim())).map((v) => v.trim());
      const refs = explicit.filter((v) => !isUuid(v.trim())).map((v) => v.trim());
      const found = new Map<string, ObjectRow>();
      for (const [col, values] of [["id", uuids], ["object_ref", refs]] as const) {
        for (let i = 0; i < values.length; i += IN_CHUNK) {
          const { data, error } = await supabase
            .from("objects")
            .select("id, object_type, object_ref, name")
            .in(col, values.slice(i, i + IN_CHUNK))
            .is("valid_until", null);
          if (error) throw new Error(error.message);
          for (const row of (data ?? []) as ObjectRow[]) {
            found.set(row.id, row);
            if (col === "object_ref" && row.object_ref) found.set(row.object_ref, row);
          }
        }
      }
      for (const ref of explicit) {
        const row = found.get(ref.trim());
        if (row) objectIds.push(row.id);
        else skipped.push(`${ref} (neexistuje)`);
      }
    } else if (propertyName) {
      // ── Výber podľa hodnoty vlastnosti psetu (fix „nosné = LoadBearing true",
      // nie aproximácia triedami). Kľúče idú do PostgREST or() výrazu, preto
      // striktný whitelist znakov (čiarka/zátvorka/medzera = syntax filtra).
      const PSET_KEY_RE = /^[A-Za-z0-9_.-]+$/;
      if (!PSET_KEY_RE.test(propertyName)) {
        throw new Error("property smie obsahovať len písmená, číslice a _ . - (napr. LoadBearing).");
      }
      const propertyValue = sanitizeQuery(input.value);
      if (!propertyValue) {
        throw new Error("Pri property zadaj aj value — očakávanú hodnotu (napr. true).");
      }
      const psetNarrow = String(input.pset ?? "").trim();
      if (psetNarrow) {
        if (!PSET_KEY_RE.test(psetNarrow)) {
          throw new Error("pset smie obsahovať len písmená, číslice a _ . - (napr. Pset_WallCommon).");
        }
        propertyPsets = [psetNarrow];
      } else {
        // V ktorých psetoch vlastnosť reálne existuje — slovník z dát (D-058).
        const { data, error } = await supabase
          .from("v_property_dictionary")
          .select("pset")
          .ilike("property", propertyName);
        if (error) throw new Error(error.message);
        propertyPsets = [...new Set((data ?? []).map((r) => (r as { pset: string }).pset))]
          .filter((p) => PSET_KEY_RE.test(p))
          .slice(0, 20);
        if (propertyPsets.length === 0) {
          throw new Error(
            `Vlastnosť '${propertyName}' sa v dátach nenašla — over presný názov cez ` +
              "query_view relation=v_property_dictionary."
          );
        }
      }
      // ilike bez % = case-insensitive presná zhoda (true/True/TRUE);
      // v_asset_effective = properties zmergované s typom → dedičnosť zahrnutá.
      const orExpr = propertyPsets
        .map((p) => `properties->${p}->>${propertyName}.ilike.${propertyValue}`)
        .join(",");
      let q = supabase
        .from("v_asset_effective")
        .select("id")
        .or(orExpr)
        .limit(STYLE_CAP);
      if (singleType) q = q.ilike("ifc_type", singleType);
      else if (multiTypes.length > 0) q = q.in("ifc_type", multiTypes);
      const predefinedType = sanitizeQuery(input.predefined_type);
      if (predefinedType) q = q.ilike("predefined_type", predefinedType);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { id: string }[]) objectIds.push(row.id);
      if (objectIds.length === 0) {
        throw new Error(
          `Žiadny prvok nemá ${propertyName}='${propertyValue}' ` +
            `(hľadané psety: ${propertyPsets.join(", ")}) — over hodnoty cez v_property_dictionary.`
        );
      }
    } else if (globalIds.length === 0) {
      const hasFilter =
        sanitizeQuery(input.ifc_type) ||
        sanitizeQuery(input.predefined_type) ||
        sanitizeQuery(input.query);
      if (!hasFilter) {
        throw new Error(
          "Zadaj ids_or_refs, alebo filter ifc_type / predefined_type / query."
        );
      }
      const q = this.applyObjectFilters(
        supabase.from("objects").select("id, object_type, object_ref, name"),
        input
      ).limit(STYLE_CAP);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as ObjectRow[]) objectIds.push(row.id);
      if (objectIds.length === 0) {
        throw new Error(
          "Filtru nezodpovedá žiadny prvok — over hodnoty cez get_model_stats."
        );
      }
    }

    // ── objects.id → aktívny IFC GUID (len prvky prítomné v 3D modeli);
    // GlobalId z IFC motora (D-084) idú rovno.
    const guids: string[] = [...globalIds];
    for (let i = 0; i < objectIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("ifc_guid_history")
        .select("ifc_guid, object_id")
        .in("object_id", objectIds.slice(i, i + IN_CHUNK))
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { ifc_guid: string }[]) {
        if (row.ifc_guid && !guids.includes(row.ifc_guid)) guids.push(row.ifc_guid);
      }
    }
    if (guids.length === 0) {
      throw new Error("Žiadny z vybraných prvkov nemá IFC GUID — nie sú v 3D modeli.");
    }

    this.actions.push({
      type: "navigate",
      url:
        `/ifc?ops=${encodeURIComponent(`${action}:${color}:${guids.join(".")}`)}` +
        `&r=${nonce()}`,
      label: `3D: ${opLabel[action]} ${guids.length} prvkov`,
    });
    return {
      ok: true,
      applied: action,
      elements: guids.length,
      ...(color ? { color: `#${color}` } : {}),
      ...(propertyName
        ? { property: propertyName, value: String(input.value ?? ""), psets: propertyPsets }
        : {}),
      ...(objectIds.length >= STYLE_CAP
        ? { note: `Výber orezaný na ${STYLE_CAP} prvkov — zúž filter (ifc_type/pset).` }
        : {}),
      ...(skipped.length ? { skipped } : {}),
    };
  }

  private async openDrawing(input: Record<string, unknown>) {
    const docId = String(input.document_id ?? "").trim();
    if (!isUuid(docId)) throw new Error("document_id musí byť UUID (objects.id dokumentu).");
    const doc = await this.resolveObject(docId);
    if (!doc || doc.object_type !== "document") {
      throw new Error("Dokument neexistuje — id výkresu zisti cez find_in_drawings.");
    }

    const focusId = typeof input.focus_id === "string" && isUuid(input.focus_id.trim())
      ? input.focus_id.trim()
      : null;
    const page =
      typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
        ? Math.floor(input.page)
        : null;

    const label = doc.name ?? doc.object_ref ?? "výkres";
    if (input.in_viewer === true) {
      // Karta dokumentu vedľa 3D (D-075 DOCUMENT_OPEN cez op `doc`, D-083).
      this.actions.push({
        type: "navigate",
        url: `/ifc?ops=${encodeURIComponent(docOp(doc.id, page ?? undefined))}&r=${Date.now().toString(36)}`,
        label: `Viewer: ${label}`,
      });
      return { ok: true, opened: "viewer_document", document: label, ...(page ? { page } : {}) };
    }

    const params = new URLSearchParams();
    if (focusId) params.set("focus", focusId);
    if (page) params.set("page", String(page));
    const qs = params.toString();
    this.actions.push({
      type: "navigate",
      url: `/drawing/${doc.id}${qs ? `?${qs}` : ""}`,
      label: `Výkres: ${label}`,
    });
    return { ok: true, opened: "drawing", document: label };
  }

  private async openNode(input: Record<string, unknown>) {
    const obj = await this.resolveObject(String(input.id_or_ref ?? ""));
    if (!obj) throw new Error("Uzol neexistuje — najprv ho nájdi cez search_objects.");
    const label = obj.name ?? obj.object_ref ?? obj.id.slice(0, 8);
    this.actions.push({
      type: "navigate",
      url: `/${routeFor(obj.object_type)}/${obj.id}`,
      label: `Karta: ${label}`,
    });
    return { ok: true, opened: "node", node: label, object_type: obj.object_type };
  }

  /**
   * Akcie pre klienta: viac 3D akcií (model občas zavolá show_in_3d per prvok;
   * style_in_3d vydáva jednu akciu per operácia) sa zlúči do jednej /ifc URL —
   * klient vykonáva len prvú navigáciu. Focus GUIDy sa spoja do `focus`,
   * viewer ops (D-066) sa zreťazia cez `;` do `ops` v pôvodnom poradí.
   */
  finalActions(): AskAction[] {
    return mergeIfcActions(this.actions);
  }

  /**
   * Po skončení slučky: obohatí zdroje o aktívne IFC GUIDy (3D deep-link) a
   * E4 výkresy prvkov, ktoré ich ešte nemajú. Zlyhanie obohatenia nezhodí
   * odpoveď — zdroje sa vrátia bez neho.
   */
  async finalizeSources(): Promise<AskSource[]> {
    const all = [...this.sources.values()];
    if (all.length === 0) return all;
    const supabase = getSupabaseAdmin();

    try {
      const ids = all.map((s) => s.id);
      const guidById = new Map<string, string>();
      const relRows: { from_id: string; to_id: string }[] = [];
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const chunk = ids.slice(i, i + IN_CHUNK);
        const [guidRes, drawRes] = await Promise.all([
          supabase
            .from("ifc_guid_history")
            .select("object_id, ifc_guid")
            .in("object_id", chunk)
            .is("valid_until", null),
          supabase
            .from("rel_associates_document")
            .select("from_id, to_id")
            .in("from_id", chunk)
            .eq("source", PDF_LINK_SOURCE)
            .is("valid_until", null),
        ]);
        if (!guidRes.error) {
          for (const g of guidRes.data ?? [])
            guidById.set(g.object_id as string, g.ifc_guid as string);
        }
        if (!drawRes.error) {
          relRows.push(...((drawRes.data ?? []) as { from_id: string; to_id: string }[]));
        }
      }

      for (const s of all) s.ifcGuid = guidById.get(s.id) ?? null;

      {
        const docIds = [...new Set(relRows.map((r) => r.to_id))];
        if (docIds.length > 0) {
          const { data: docs } = await supabase
            .from("objects")
            .select("id, name")
            .in("id", docIds);
          const nameById = new Map(
            (docs ?? []).map((d) => [d.id as string, (d.name as string | null) ?? null])
          );
          for (const r of relRows) {
            const s = this.sources.get(r.from_id);
            if (s && !s.drawings.some((x) => x.docId === r.to_id)) {
              s.drawings.push({
                docId: r.to_id,
                docName: nameById.get(r.to_id) ?? null,
                page: null,
              });
            }
          }
        }
      }
    } catch {
      // bez obohatenia — zdroje aj tak vrátime
    }
    return all;
  }
}
