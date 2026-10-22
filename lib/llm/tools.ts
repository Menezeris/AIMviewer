import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PDF_LINK_SOURCE } from "@/lib/data/constants";
import { fetchDocumentObjectRows, fetchDocumentTypes, fetchObjectDocuments, typeText } from "@/lib/data/object-documents";
import { fetchAllPages } from "@/lib/data/pagination";
import { fetchDocumentLinks } from "@/lib/data/drawing-links";
import { linkSummary } from "@/lib/data/drawing-labels";
import type { ToolDefinition } from "./provider";
import { docHighlightsInput, docOp, docRegionInput, selectOp } from "@/lib/viewer-ops";
import {
  PAGE_BLOCKS_CAP,
  PAGE_TEXT_CAP,
  compactBlocks,
  highlightsRegion,
  matchBlocks,
  parseBlocks,
  type TextBlock,
} from "./document-text";
import { mergeIfcActions, type AskAction } from "./actions";
import { DOMAIN_IFC_TYPES, sanitizeIfcType, sanitizeModelName } from "./ifc-selector";
import { LIST_TOOL_DEFINITIONS, LIST_TOOL_NAMES, execListTool } from "./list-tool";
import { VIEW_TOOL_DEFINITIONS, VIEW_TOOL_NAMES, execViewTool } from "./view-tools";
import { engineEnabled, resolveNamesToGuids } from "@/lib/engine/aim-lookup";
import { execScopedStyle } from "./style-scope";
import { needsScopedStyle } from "./style-plan";
import { LENS_STYLE_ACTIONS, execLensStyle } from "./style-lens";
import { lookupProperty, selectPanelInput, type PropertyLookup } from "./select-panel";
import {
  RELATED_CAP,
  clampOffset,
  orderTerms,
  pageInfo,
  fitPage,
  parseRelated,
  sortRows,
  type OrderTerm,
  type RelatedSpec,
} from "./query-view";

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

/** Stĺpce search_objects, ktoré môže určiť filter (eval D-126, N2). */
const FILTER_COLUMNS = ["object_type", "ifc_type", "predefined_type"] as const;

/**
 * Stĺpec, ktorý určuje filter a má na strane jednu hodnotu, sa z riadkov vynechá a uvedie raz
 * v `same`. Riadok vyústky je tak o štvrtinu kratší a do výsledku sa zmestí viac riadkov.
 */
export function hoistFilterColumns<T extends object>(
  rows: T[],
  input: Record<string, unknown>,
): { same: Record<string, unknown> | null; rows: Partial<T>[] } {
  const same: Record<string, unknown> = {};
  const cell = (r: T, col: string) => (r as Record<string, unknown>)[col];
  for (const col of FILTER_COLUMNS) {
    if (typeof input[col] !== "string" || !input[col] || rows.length === 0) continue;
    const v = cell(rows[0], col);
    if (rows.every((r) => cell(r, col) === v)) same[col] = v;
  }
  const keys = Object.keys(same);
  if (keys.length === 0) return { same: null, rows };
  return {
    same,
    rows: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))) as Partial<T>),
  };
}
/** Koľko prvkov naraz zvládne lokalizácia (search_objects mode=locate). */
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
  "rel_document_information_relationship",
  "rel_external_reference_relationship",
  "v_object_documents",
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
  "rel_document_information_relationship",
  "rel_external_reference_relationship",
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

/** Kód dokumentu z jeho názvu ("D.1.3.04 Pôdorys 3NP PBR"); object_ref je "OCB_SO01_PBR_D-1-3-04_...". */
const DOCUMENT_CODE_RE = /^[A-Z](\.\d+){2,}$/i;

/** Čo `get_object` pridá v tom istom volaní (D-115). */
export const GET_OBJECT_INCLUDES = ["details", "path", "documents", "quantities"] as const;

/** Staré hodnoty `include` (D-104: výkresy E4 nahradili dokumenty z modelu); nevypisujú sa. */
const LEGACY_GET_OBJECT_INCLUDES: Record<string, (typeof GET_OBJECT_INCLUDES)[number]> = {
  drawings: "documents",
};

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
      "Nájde, SPOČÍTA alebo LOKALIZUJE uzly grafu AIM podľa identity a IFC typológie. mode=list (default): " +
      "riadky; count: presný počet ('koľko X je v budove'; z riadkov list nepočítaj, sú orezané); locate: presný " +
      "počet + rozpad po podlažiach a miestnostiach so vzorkou ('koľko X a kde / na ktorých podlažiach', " +
      "predvolene object_type asset, alebo ids z predošlého hľadania). `query` hľadá v názve, object_ref, IFC " +
      "triede aj predefined_type (ilike). ifc_type = IFC trieda (IfcDoor), predefined_type = podtyp " +
      "(AIRCONDITIONINGUNIT je predefined_type, NIE ifc_type). Obsah psetov ani účel miestnosti (lobby, sklad) " +
      "nevidí - na to search_everything. list nad 100 riadkov stránkuj cez offset; stĺpce určené filtrom sú raz v same; " +
      "rozpad podľa podtypu nerátaj z riadkov - dá ho aggregate_objects(group_by=predefined_type); " +
      "slovník tried a psetov dá get_model_stats.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["list", "count", "locate"] },
        query: { type: "string", description: "Hľadaný text (názov/object_ref/ifc_type/predefined_type, ilike)" },
        object_type: { type: "string", description: "asset, asset_type, space, floor, building, site, system, document, person, organization" },
        ifc_type: { type: "string", description: "IFC trieda (case-insensitive zhoda)" },
        predefined_type: { type: "string", description: "IFC predefined_type enum (case-insensitive zhoda)" },
        ids: { type: "array", items: { type: "string" }, description: "locate: konkrétne objects.id namiesto filtrov" },
        limit: { type: "number", description: `list: max riadkov (default ${DEFAULT_LIMIT}, strop ${MAX_LIMIT})` },
        offset: { type: "number", description: "list: posun strany; ďalšia strana = next_offset, nie offset+limit; strany neposielaj súbežne" },
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
      "get_object(include=details); hľadané slovo skús aj v angličtine (kľúče psetov " +
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
      "rel_assigns_to_actor, rel_assigns_to_group, rel_member_of, " +
      "rel_document_information_relationship (strom dokumentácie: časť→nadradený), " +
      "rel_external_reference_relationship (druh dokumentu: dokument→classification_references, " +
      "typ informácie ISO 19650) (všetky: from_id→to_id, valid_until null = aktívna), " +
      "v_object_documents (dokumenty objektu cez vzťahy, D-104: object_id, document_id, page, via, " +
      "via_id, depth). JSONB cesty fungujú v select aj filtri: " +
      "properties->Pset_ValveTypeIsolating->>IsNormallyOpen. Výsledok má total, returned, truncated a " +
      "next_offset (poradie je stabilné, ďalšia strana = offset=next_offset). Uzly so vzťahom na iný uzol " +
      "jedným volaním = related (napr. IfcAirTerminal s rel_referenced_in_spatial_structure na priestor 2.01); " +
      "obsah miestnosti naraz (contained aj referenced) dá v_space_elements (space_ref, element_ref, " +
      "element_ifc_type, element_predefined_type, relation, role).",
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
        offset: { type: "number", description: "Posun strany (default 0); ďalšia strana = next_offset, nie offset+limit; strany neposielaj súbežne" },
        related: {
          type: "object",
          properties: {
            relation: { type: "string", description: "Kanonický view hrán rel_*" },
            node: { type: "string", description: "id alebo object_ref uzla na druhom konci hrany" },
            direction: {
              type: "string",
              enum: ["to", "from"],
              description: "to (default) = hrana vedie z riadku NA node (prvok v priestore, člen zóny); from = z node na riadok (objekty aktéra)",
            },
          },
          required: ["relation", "node"],
          description: "Len uzly so vzťahom na node (relácie uzlov: objects, v_asset_effective, v_floors, v_actors...)",
        },
      },
      required: ["relation"],
    },
  },
  {
    name: "aggregate_objects",
    description:
      "Presné agregácie a ČÍSELNÉ porovnania nad hodnotami psetov — počíta databáza, " +
      "nikdy nepočítaj z orezaných riadkov. Výsledok je konečný: neoveruj ho query_view ani " +
      "ďalším volaním. agg=count|sum|avg|min|max nad numerickou " +
      "hodnotou prop_path (napr. ['VZT_Parametre','AirFlowRate']); group_by (stĺpec: " +
      "object_type|ifc_type|predefined_type|user_defined_type|name|object_ref) alebo " +
      "group_by_path (pset cesta ako kľúč, napr. výrobca). AND filtre " +
      "{column|path, op eq|neq|gt|gte|lt|lte|ilike|is, value} — gt/lt nad path porovnáva " +
      "NUMERICKY (v query_view sa JSONB porovnáva ako text — na čísla vždy toto). " +
      "ids = zúženie na konkrétne prvky (reťazenie so search_objects/search_everything). " +
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
      "Detail jedného uzla podľa UUID, object_ref (napr. 'DD01.06.03') alebo kódu prvku (meno ako " +
      "'VV.03.01.040'; prvok len v IFC vráti in_aim:false a global_id): identita, IFC trieda, predefined_type, " +
      "IFC GUID a podlažie (floor). include pridá v tom istom volaní: details = VLASTNOSTI psetov (aj zdedené z " +
      "typu, napr. výrobný typ) a klasifikácie; path = V KTOREJ MIESTNOSTI a podlaží je (aj odvodené geometriou, " +
      "napr. VZT prvok v miestnosti z ASR); documents = DOKUMENTY a strany, ktoré k nemu patria, aj zdedené " +
      "cez typ, zónu, skupinu (skladby), systém, priestorovú zónu (požiarny úsek), podlažie a miestnosť, s cestou " +
      "(via_name, through) a deep_link na stranu; pri dokumente opačne: ktorých objektov sa týka (počty podľa " +
      "typu a nositeľa + vzorka); quantities = Qto VÝMERY (objem, plocha, dĺžka...) a psety priamo z IFC súboru, z výskytu aj z typu, ako " +
      "zoznam {qto, name, value, source} v poli ifc (D-142). Kód netreba hľadať vopred; na 'čo je X a kde je' stačí jedno volanie.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_ref: { type: "string", description: "objects.id (UUID), object_ref, kód prvku (meno v AIM / IFC) alebo kód dokumentu (D.1.1.09)" },
        include: {
          type: "array",
          items: { type: "string", enum: [...GET_OBJECT_INCLUDES] },
          description: "Čo pridať: details | path | documents | quantities",
        },
      },
      required: ["id_or_ref"],
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
    name: "show_in_3d",
    description:
      "UI AKCIA: UKÁŽ alebo VYBER prvky v 3D. Predvolene zvýrazní (oranžovo) a priblíži prvky - 'ukáž / " +
      "zobraz X', aj jednu miestnosť (skrytú viewer zapne). Celú triedu pošli filtrom (ifc_type, query, " +
      "predefined_type), konkrétne prvky v ids_or_refs (object_ref, kód prvku ako 'SD04.0001' aj číslo miestnosti ako '3.02' " +
      "netreba hľadať vopred). select=true = VYBERIE prvok (viac prvkov v ids_or_refs = viacnásobný výber, odpoveď vráti všetky) ako klik myšou a otvorí jeho IFC panel vlastností ('vyber / označ " +
      "X', 'ukáž jeho vlastnosti'): panel_section properties | quantities, highlight 'Pset.Vlastnosť' (aj Qto výmera) rozbalí " +
      "sadu, prescrolluje a zvýrazní riadok do ďalšieho výberu; výsledok povie, či vlastnosť na prvku je (property.in_aim, " +
      "property_focus.found zo živého viewera). Panel hodnoty ukáže sám, ifc_get len keď sa pýta na hodnotu. clear=true zruší zvýraznenie, so " +
      "select=true výber. Funguje pre prvky s IFC GUID. Prvky, ktorých sa týka dokument alebo strana, " +
      "ukáž cez style_in_3d(document, page).",
    inputSchema: {
      type: "object",
      properties: {
        ids_or_refs: {
          type: "array",
          items: { type: "string" },
          description: `objects.id (UUID), object_ref alebo kód prvku (meno v IFC) na zvýraznenie (1–${SHOW_3D_CAP})`,
        },
        id_or_ref: { type: "string", description: "Alternatíva pre jediný prvok" },
        clear: { type: "boolean", description: "true = zrušiť zvýraznenie (so select=true výber)" },
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
        select: { type: "boolean", description: "Vybrať prvok ako klik (id_or_ref alebo ids_or_refs, viac prvkov = všetky vybrané) a otvoriť panel vlastností prvého" },
        panel_section: { type: "string", enum: ["properties", "quantities"], description: "select: sekcia IFC panelu" },
        highlight: { type: "string", description: "select: zvýrazniť vlastnosť, napr. 'Pset_WallCommon.FireRating' alebo 'Qto_DoorBaseQuantities.Width'" },
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
      "ČOHO SA TÝKA DOKUMENT ('ukáž prvky tohto výkresu / tejto strany') = document (+ page): " +
      "prvky aj zdedené cez podlažie, zónu, skupinu a typ, bez vymenovania GUIDov; " +
      "action=xray (zvyšok priesvitný) alebo isolate. " +
      "Viac farieb naraz = groups: [{label, color, ...filter}] (top-level filter platí pre " +
      "všetky skupiny). Pri prekrytí vyhráva NESKORŠIA skupina v groups aj novšie volanie: konkrétnu trasu " +
      "alebo výnimku daj ako poslednú skupinu, širšie farby pred ňu (jedno volanie stačí). colorize / transparent / isolate / xray idú do panelu Lens vo vieweri ako " +
      "lens 'AIM chat' (pravidlo = skupina, legenda, počty; prvky mimo pravidiel sú stlmené); " +
      "ďalšie volania pridávajú pravidlá (mode=replace začne odznova), počty na pravidlo " +
      "vráti živý viewer v odpovedi. Farby podľa hodnoty (systémy, triedy, materiál, " +
      "vlastnosť...) = color_by, viewer zvolí farby a vráti legendu; filtre volania (ifc_type, storey...) " +
      "obmedzia farby, legendu aj počty na tieto prvky, bez filtra pri izolácii len viditeľné. 'Ukáž legendu' = " +
      "action=legend (malá karta len s AIM chat lens; legend_size large = veľké okno, normal = panel). Miestnosti " +
      "(IfcSpace) a zóny sú vo vieweri predvolene skryté: farbenie či izolácia ich zapne sama, ručne show/hide s " +
      "ifc_type=IfcSpace; farba miestnosti ostane priesvitná (prvky v nej vidno, NEPRIDÁVAJ transparent pravidlo); " +
      "v pôdoryse (2D alebo vodorovný rez s pohľadom zhora) sú ofarbené aj vybrané miestnosti vyplnené a popísané. " +
      "Odpoveď vráti stav po príkaze: pravidlo s inactive nič nezafarbilo (POZOR ho vysvetlí: prekryté vs filter nič nenašiel), izolácia s active=false už neplatí, " +
      "changed_outside_commands = čo zmenil používateľ od predošlého príkazu, POZOR = upozornenie (aktívny rez, " +
      "viac systémov vo filtri, viac okien viewera) - povedz ho používateľovi. Farby určuje používateľ; " +
      "keď ich nepovie, zvoľ dobre odlíšiteľné a povedz ich. " +
      "Efekty sa hromadia, kým ich nezruší show_all/reset_colors (reset_colors vypne aj " +
      "lens, čiaru trasy a kóty od Claude). Viac operácií = viac callov (pokojne v jednom kole).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["colorize", "transparent", "hide", "show", "isolate", "xray", "show_all", "reset_colors", "legend"],
          description:
            "colorize=ofarbiť (vyžaduje color), transparent=priehľadne s farbou, hide=skryť, " +
            "show=znova zobraziť skryté, isolate=zobraziť LEN vybrané (ostatné skryť; bez color " +
            "ostanú v pôvodnom vzhľade, color len keď ho používateľ chce), xray=vybrané plné v pôvodnom " +
            "vzhľade a zvyšok modelu priesvitný (X-ray context, ako tlačidlo duch; filtre ako isolate), " +
            "show_all=zrušiť skrývanie, izoláciu, X-ray aj rez (rez vráti set_section), reset_colors=zrušiť ofarbenie, lens, čiaru trasy a kóty od Claude, " +
            "legend=len legenda AIM chat lens (legend_size; predvolene malá karta), bez filtrov",
        },
        opacity: {
          type: "number",
          description:
            "colorize: 0.05 až 1. Menej ako 1 = priesvitná farba (prvky vnútri a za nimi je vidno), 1 = plná farba. " +
            "Bez hodnoty sú IfcSpace a zóny priesvitné, ostatné prvky plné. Viewer kreslí jednu úroveň priesvitnosti, " +
            "presná hodnota ešte nemení stupeň. Veľké prvky (steny, dosky) farbi priesvitne, ak majú ostať vidno ďalšie farby",
        },
        mode: {
          type: "string",
          enum: ["add", "replace"],
          description:
            "Lens (colorize/transparent/isolate/xray): add = pridať k doterajším pravidlám (predvolené; pri isolate a xray " +
            "rozšíri aktuálnu izoláciu, napr. 'pridaj aj schodiská' = isolate + mode=add, jeden call), replace = " +
            "začať odznova (zmaže aj farby a priehľadnosť z predošlých volaní, odpoveď to oznámi vo warnings; " +
            "izolácia nad existujúcou farbou = mode=add, alebo farby daj do groups toho istého volania)",
        },
        color_by: {
          type: "string",
          enum: ["ifc_type", "system", "zone", "material", "model", "classification", "property", "attribute"],
          description: "Farby podľa hodnoty (action=colorize, bez color a groups): každá hodnota iná farba, legenda vo vieweri",
        },
        legend_size: {
          type: "string",
          enum: ["compact", "large", "normal"],
          description:
            "Legenda: compact = malá karta len s legendou AIM chat lens, bez panelu Lens (predvolené pri action=legend); " +
            "large = panel Lens ako veľké okno cez takmer celý viewer ('zväčši legendu na celú stranu'); normal = " +
            "späť do lišty. S action=legend alebo spolu s colorize/color_by",
        },
        clear_section: {
          type: "boolean",
          description:
            "true = v tom istom volaní zruší aktívny rez (napr. zabudnutý vodorovný rez z predošlej úlohy pri " +
            "isolate, xray alebo colorize celého systému)",
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
        document: {
          type: "string",
          description:
            "Dokument podľa id, object_ref alebo názvu (napr. 'D.1.1.03'): prvky, ktorých sa týka, aj " +
            "zdedené cez nositeľa (get_object(include=documents) pri dokumente dá počty a by_page)",
        },
        page: {
          type: "number",
          description: "S document: len prvky, ktorých sa týka táto strana (odkaz na časť dokumentu)",
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
              opacity: { type: "number", description: "0.05 až 1; menej ako 1 = priesvitná farba, 1 = plná" },
              system: { type: "string" },
              system_type: { type: "string" },
              zone: { type: "string" },
              storey: { type: "string" },
              document: { type: "string" },
              page: { type: "number" },
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
      "UI AKCIA: otvorí výkres/dokument v prehliadačke, voliteľne so zvýrazneným prvkom, " +
      "stranou, výrezom strany (region = priblíženie na časť strany v karte vo vieweri) a " +
      "rámikmi okolo textu (highlights). Zavolaj, keď používateľ žiada otvoriť/ukázať výkres " +
      "alebo prvok vo výkrese, priblížiť výkres na miesto alebo ukázať/zvýrazniť text v ňom " +
      "(document_id a page zisti cez get_object(include=documents), text cez search_documents).",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "objects.id dokumentu (UUID)" },
        focus_id: { type: "string", description: "Voliteľné: objects.id prvku na zvýraznenie" },
        page: { type: "number", description: "Voliteľné: číslo strany" },
        in_viewer: {
          type: "boolean",
          description:
            "true = otvorí dokument vo vieweri (bez zvýraznenia prvku), ako záložku podľa target; " +
            "default false = samostatná prehliadačka výkresu",
        },
        target: {
          type: "string",
          enum: ["tab", "split"],
          description:
            "Vo vieweri (D-132): tab = vlastná záložka na celú plochu (default), split = vedľa 3D alebo " +
            "pohľadu ('otvor výkres vedľa modelu'). Zadaný target otvára vo vieweri aj bez in_viewer.",
        },
        region: {
          type: "object",
          description:
            "Voliteľné: výrez strany v % (0-100, počiatok vľavo hore), napr. pravý horný roh = " +
            "{x:50,y:0,width:50,height:50}. Karta sa priblíži podľa svojej skutočnej veľkosti, aby výrez vyplnil plochu, " +
            "a vycentruje ho; aj pre už otvorenú kartu. Stav po príkaze nesie document.visible (viditeľná časť strany v %) " +
            "a region_fully_visible. S region sa výkres vždy otvorí vo vieweri (in_viewer). " +
            "Polohu prvku vo výkrese tool nepozná: výrez určí používateľ slovne (vpravo hore, " +
            "stred, ľavý okraj...) a ďalší krok sa odvodí z predchádzajúceho výrezu.",
          properties: {
            x: { type: "number", description: "Ľavý okraj výrezu v % šírky strany" },
            y: { type: "number", description: "Horný okraj výrezu v % výšky strany" },
            width: { type: "number", description: "Šírka výrezu v % šírky strany" },
            height: { type: "number", description: "Výška výrezu v % výšky strany" },
          },
          required: ["x", "y", "width", "height"],
        },
        highlights: {
          type: "array",
          description:
            "Voliteľné: rámiky okolo textu na strane page, v % strany (najviac 20) - daj sem " +
            "regions[].bbox zo search_documents. Bez region sa karta priblíži na rámiky. " +
            "Vždy vo vieweri; ďalšie otvorenie dokumentu rámiky zruší.",
          items: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
          },
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
      "OBSAH dokumentov a výkresov (textová vrstva PDF strán: popisky a čísla miestností, kóty, " +
      "hrúbky, legendy, špecifikácie, pečiatky, text technických správ). Tri spôsoby: " +
      "(1) q = fulltext vo všetkých dokumentoch -> dokument, strana, snippet, deep_link a regions; " +
      "(2) q + document_id = hľadanie len v tom dokumente (napr. 'ukáž vo výkrese popisok 1.05', " +
      "'nájdi v technickej správe požiarnu odolnosť'); (3) document_id bez q = PREČÍTA stranu " +
      "(page, default 1): celý text, s include_blocks aj riadky s polohou na strane (legenda, " +
      "kóty), s include_links popisky prvkov a miestností spárované s prvkami (bublina '08 DD01' -> " +
      "DD01.08.0001; AIM odvodenie, vo vieweri sú to klikateľné odkazy). regions = kde na strane text " +
      "je (bbox v %): 'ukáž/zvýrazni vo výkrese' = " +
      "open_drawing(document_id, page, highlights=[regions[].bbox]) - karta sa priblíži a text " +
      "orámuje. Slová sa hľadajú aj v inom tvare (skloňovanie). Výmery a objemy (murivo, plochy) " +
      "počítaj z kót výkresu LEN na výslovnú žiadosť 'z výkresu' a ako hrubý odhad; inak vždy z " +
      "modelu (ifc_measure, Qto). Metadáta dokumentov (názov, typ, revízia) hľadá query_view.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Hľadaný text (min 2 znaky); bez q a s document_id = čítanie strany",
        },
        document_id: {
          type: "string",
          description:
            "Voliteľné: dokument (objects.id UUID alebo object_ref, napr. " +
            "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP) - hľadanie alebo čítanie len v ňom",
        },
        page: {
          type: "number",
          description: "Čítanie: číslo strany (default 1); s q obmedzí zhody na stranu",
        },
        include_blocks: {
          type: "boolean",
          description:
            "Čítanie: aj riadky textu s polohou {t, x, y, w, h} v % strany (počiatok vľavo hore)",
        },
        include_links: {
          type: "boolean",
          description:
            "Čítanie: aj popisky na strane spárované s prvkami (text, code, bbox v %, status " +
            "unique/candidates/none, targets s object_ref a GUID); kandidáti = typ má na podlaží viac výskytov",
        },
        limit: { type: "number", description: "Max výsledkov (default 10, strop 50)" },
      },
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
/** Strop prvkov jedného viacnásobného výberu (#217): GUIDy idú v URL `ops`. */
const MAX_SELECT_REFS = 200;

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
      const result = fitPage(await this.dispatch(name, input), MAX_RESULT_CHARS);
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
        // D-115: počet a lokalizácia sú režimy toho istého hľadania.
        if (input.mode === "count") return this.countObjects(input);
        if (input.mode === "locate") return this.locateObjects(input);
        if (input.mode !== undefined && input.mode !== "list") throw new Error("mode: list | count | locate.");
        return this.searchObjects(input);
      case "search_everything":
        return this.searchEverything(input);
      case "query_view":
        return this.queryView(input);
      case "aggregate_objects":
        return this.aggregateObjects(input);
      case "get_object":
        return this.getObjectWith(input);
      case "list_relations":
        return this.listRelations(input);
      case "search_documents":
        return this.searchDocuments(input);
      case "show_in_3d":
        if (input.select === true) {
          // D-115: výber ako klik je režim show_in_3d; viac prvkov z ids_or_refs je viacnásobný výber (#217).
          return this.selectIn3d(input);
        }
        return this.showIn3d(input);
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
    const offset = clampOffset(input.offset);
    const q = this.applyObjectFilters(
      supabase
        .from("objects")
        .select("id, object_type, object_ref, name, ifc_type, predefined_type", { count: "exact" }),
      input
    )
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ObjectRow[];
    for (const r of rows) this.addSource(r);
    if (rows.length === 0 && offset === 0) {
      return {
        rows,
        hint:
          "Nič sa nenašlo v názve ani kóde — skús fulltext search_everything (v MCP search_all; vidí psety, " +
          "napr. 'lobby' miestnosti 1.01), slovník tried dá get_model_stats.",
      };
    }
    // Eval D-126 (N2): list s limit=100 pri 139 vyústkach vrátil 100 riadkov bez znamenia, že chýba zvyšok.
    const page = pageInfo(count ?? offset + rows.length, offset, rows.length);
    const { same, rows: narrow } = hoistFilterColumns(rows, input);
    if (!page.truncated && offset === 0 && !same) return rows;
    return {
      ...page,
      ...(page.truncated ? { hint: `Výsledok je orezaný: ďalšia strana offset=${page.next_offset}.` } : {}),
      ...(same ? { same } : {}),
      rows: narrow,
    };
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

  /**
   * Generický read-only dopyt nad whitelistom relácií (celá dátová vrstva).
   * D-126: vždy stabilné poradie (kľúč relácie za `order`), `offset` a súhrn
   * strany (total, truncated, next_offset); `related` zúži uzly na susedov uzla.
   */
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
    const countOnly = input.count_only === true;
    const limit = clampLimit(input.limit);
    const offset = clampOffset(input.offset);
    const related = parseRelated(input.related, relation, REL_VIEWS);

    const rawOrder = input.order as { column?: unknown; ascending?: unknown } | undefined;
    let order: OrderTerm | null = null;
    if (rawOrder !== undefined) {
      if (typeof rawOrder?.column !== "string" || !COLUMN_RE.test(rawOrder.column))
        throw new Error("order.column: stĺpec relácie.");
      order = { column: rawOrder.column, ascending: rawOrder.ascending !== false };
    }
    const terms = orderTerms(relation, order);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (q: any) => {
      const filters = Array.isArray(input.filters) ? (input.filters as unknown[]) : [];
      for (const f of filters) {
        if (typeof f !== "object" || f === null) throw new Error("filters: pole objektov {column, op, value}.");
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
          if (vals.length > IN_CHUNK)
            throw new Error(`Filter 'in' berie najviac ${IN_CHUNK} hodnôt (${vals.length}); zúž ho alebo použi related.`);
          q = q.in(col, vals);
        } else if (operator === "is") {
          q = q.is(col, value === "null" ? null : (value as boolean | null));
        } else {
          q = q[operator](col, value);
        }
      }
      return q;
    };

    let rows: Record<string, unknown>[];
    let total: number;
    if (related) {
      const ids = await this.relatedIds(related);
      if (ids.length > RELATED_CAP) {
        throw new Error(
          `Uzol má ${ids.length} susedov cez ${related.relation} (strop ${RELATED_CAP}); zúž dopyt filtrami inej relácie.`
        );
      }
      if (order?.column.includes("->")) throw new Error("order nad JSONB cestou s related nejde; zoraď podľa stĺpca.");
      // Spojené dávky sa zoraďujú v TS, preto riadok nesie aj stĺpce poradia.
      const cols = selectCols.length > 0 ? [...new Set([...selectCols, ...terms.map((t) => t.column)])] : [];
      const all: Record<string, unknown>[] = [];
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const q = applyFilters(
          supabase.from(relation).select(cols.length > 0 ? cols.join(", ") : "*").in("id", ids.slice(i, i + IN_CHUNK))
        );
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        all.push(...((data ?? []) as Record<string, unknown>[]));
      }
      total = all.length;
      if (countOnly) return { count: total };
      rows = sortRows(all, terms).slice(offset, offset + limit);
    } else {
      const select = selectCols.length > 0 ? selectCols.join(", ") : "*";
      let q = countOnly
        ? supabase.from(relation).select("*", { count: "exact", head: true })
        : supabase.from(relation).select(select, { count: "exact" });
      q = applyFilters(q);
      if (!countOnly) {
        for (const t of terms) q = q.order(t.column, { ascending: t.ascending });
        q = q.range(offset, offset + limit - 1);
      }
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      if (countOnly) return { count: count ?? 0 };
      rows = (data ?? []) as Record<string, unknown>[];
      total = count ?? offset + rows.length;
    }

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
    const page = pageInfo(total, offset, rows.length);
    return {
      ...page,
      ...(page.truncated ? { hint: `Výsledok je orezaný: ďalšia strana offset=${page.next_offset}.` } : {}),
      rows,
    };
  }

  /** Susedia uzla cez kanonický view hrán (`related` v query_view, D-126). */
  private async relatedIds(spec: RelatedSpec): Promise<string[]> {
    const supabase = getSupabaseAdmin();
    let nodeId = spec.node;
    if (!isUuid(nodeId)) {
      const { data, error } = await supabase
        .from("objects")
        .select("id")
        .eq("object_ref", spec.node)
        .is("valid_until", null)
        .limit(2);
      if (error) throw new Error(error.message);
      const hit = (data ?? []) as { id: string }[];
      if (hit.length === 0) throw new Error(`related.node '${spec.node}' nie je object_ref ani id uzla.`);
      nodeId = hit[0].id;
    }
    const [match, other] = spec.direction === "to" ? (["to_id", "from_id"] as const) : (["from_id", "to_id"] as const);
    const edges = await fetchAllPages<{ from_id: string; to_id: string }>((from, to) =>
      supabase
        .from(spec.relation)
        .select("from_id, to_id")
        .eq(match, nodeId)
        .is("valid_until", null)
        .order("id")
        .range(from, to)
    );
    return [...new Set(edges.map((e) => e[other]).filter((v): v is string => typeof v === "string"))];
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

  /** `get_object` s include (D-115): detail + vlastnosti, umiestnenie a výkresy v jednom volaní. */
  private async getObjectWith(input: Record<string, unknown>) {
    const include = Array.isArray(input.include)
      ? [...new Set(input.include.map((i) => LEGACY_GET_OBJECT_INCLUDES[String(i)] ?? String(i)))]
      : [];
    const bad = include.filter((i) => !(GET_OBJECT_INCLUDES as readonly string[]).includes(i));
    if (bad.length > 0) throw new Error(`include: ${GET_OBJECT_INCLUDES.join(" | ")} (neznáme: ${bad.join(", ")}).`);
    const base = (await this.getObject(input)) as Record<string, unknown>;
    if (include.length === 0) return base;
    const id = typeof base.id === "string" ? base.id : null;
    if (!id && include.includes("quantities")) {
      // Prvok len v IFC súbore (D-102): výmery z motora podľa global_id, ostatné include nemajú v grafe čo čítať.
      return { ...base, ifc: await this.ifcElementData(base) };
    }
    if (!id) {
      return { ...base, include_note: "Prvok nie je v grafe AIM: vlastnosti, materiály a podlažie zo súboru dá ifc_get." };
    }
    const extra: Record<string, unknown> = {};
    await Promise.all(
      include.map(async (part) => {
        if (part === "details") {
          extra.details =
            base.object_type === "asset"
              ? await this.getAssetDetails({ id })
              : { note: "Vlastnosti s dedením z typu sú len pre asset; psety iných uzlov dá query_view alebo ifc_get." };
        } else if (part === "quantities") {
          extra.ifc = await this.ifcElementData(base);
        } else if (part === "path") {
          extra.path = await this.getSpatialPath({ id });
        } else {
          Object.assign(extra, await this.documentsOf(base as unknown as ObjectRow, input));
        }
      }),
    );
    return { ...base, ...extra };
  }

  /** Qto výmery a psety jedného prvku z IFC motora (D-142); chyba motora sa vráti ako pole `error`. */
  private async ifcElementData(base: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!engineEnabled()) return { error: "IFC motor je vypnutý, výmery zo súboru nie sú dostupné." };
    const target = [base.ifc_guid, base.global_id].find((g): g is string => typeof g === "string" && g.length > 0);
    if (!target) return { error: "Prvok nemá IFC GUID, výmery zo súboru sa nedajú nájsť." };
    const [{ runEngineTool }, { shapeIfcElement }] = await Promise.all([import("@/lib/engine/run"), import("@/lib/engine/element-data")]);
    const res = await runEngineTool("ifc_get", { targets: [target] });
    if (res.isError) return { error: res.content };
    const parsed = JSON.parse(res.content) as { items?: Array<Record<string, unknown>>; missing?: string[] };
    const item = parsed.items?.[0];
    if (!item) return { error: `Prvok nie je v žiadnom načítanom IFC modeli (${(parsed.missing ?? []).join(", ")}).` };
    return { ...shapeIfcElement(item) };
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
    let matchedBy: "name" | "document_code" | undefined;
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
        row = (await this.documentByCode(idOrRef)) ?? undefined;
        matchedBy = row ? "document_code" : undefined;
      }
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
      hint: "Prvok je len v IFC súbore (v grafe AIM nie je); storey = podlažie zo súboru (aj cez celok, napr. schodisko). Ako cieľ ho do set_section / show_in_3d / get_viewer_state daj kódom alebo global_id; vlastnosti a materiály dá ifc_get.",
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

  /**
   * Obsah dokumentov (D-063, D-123) - RPC `search_documents` nad `document_pages`
   * (text a riadky s polohou extrahuje etl/pdf_text.py). S `document_id` hľadá len
   * v ňom, bez `q` číta stranu. Deep-link a výrezy pre open_drawing stavia server.
   */
  private async searchDocuments(input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    const q = String(input.q ?? "").trim().slice(0, 200);
    const docInput = String(input.document_id ?? "").trim();
    const page =
      typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
        ? Math.floor(input.page)
        : null;

    let doc: ObjectRow | null = null;
    if (docInput) {
      doc = await this.resolveObject(docInput);
      if (!doc || doc.object_type !== "document") {
        throw new Error(`Dokument '${docInput}' sa nenašiel (document_id = objects.id alebo object_ref dokumentu).`);
      }
    }
    if (!q) {
      if (!doc) throw new Error("Zadaj q (hľadaný text) alebo document_id (čítanie strany).");
      return this.readDocumentPage(doc, page ?? 1, input.include_blocks === true, input.include_links === true);
    }
    if (q.length < 2) throw new Error("q musí mať aspoň 2 znaky.");

    const { data, error } = await supabase.rpc("search_documents", {
      q,
      max_rows: clampLimit(input.limit),
      ...(doc ? { doc_id: doc.id } : {}),
    });
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as {
      document_id: string;
      document_ref: string | null;
      document_name: string | null;
      page: number;
      rank: number;
      snippet: string | null;
    }[]).filter((r) => page === null || r.page === page);
    if (rows.length === 0) {
      return {
        rows,
        hint: doc
          ? "V tomto dokumente zhoda nie je. Skús kratší tvar slova, kód alebo číslo, alebo " +
            "prečítaj stranu (document_id bez q)."
          : "Žiadna zhoda v extrahovanom texte. Skús kratší tvar slova, kód alebo číslo; " +
            "metadáta dokumentov (názov, typ) hľadá query_view relation=documents/objects.",
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

    // Riadky s polohou len pre strany zhôd (D-123); bez nich (stará extrakcia) regions chýba.
    const blocksByPage = new Map<string, TextBlock[]>();
    const { data: pages, error: pagesError } = await supabase
      .from("document_pages")
      .select("document_id, page, blocks")
      .in("document_id", [...new Set(rows.map((r) => r.document_id))])
      .in("page", [...new Set(rows.map((r) => r.page))]);
    if (pagesError) throw new Error(pagesError.message);
    for (const p of (pages ?? []) as { document_id: string; page: number; blocks: unknown }[]) {
      blocksByPage.set(`${p.document_id}:${p.page}`, parseBlocks(p.blocks));
    }

    return rows.map((r) => {
      const matches = matchBlocks(blocksByPage.get(`${r.document_id}:${r.page}`) ?? [], q);
      return {
        ...r,
        deep_link: `/drawing/${r.document_id}?page=${r.page}`,
        ...(matches.length > 0 ? { regions: matches } : {}),
      };
    });
  }

  /** Čítanie strany dokumentu (D-123): text, voliteľne riadky s polohou a odkazy z popiskov (D-130). */
  private async readDocumentPage(doc: ObjectRow, page: number, includeBlocks: boolean, includeLinks = false) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("document_pages")
      .select(includeBlocks ? "page, text, blocks" : "page, text")
      .eq("document_id", doc.id)
      .order("page");
    if (error) throw new Error(error.message);
    const all = (data ?? []) as unknown as { page: number; text: string; blocks?: unknown }[];
    const document = { document_id: doc.id, document_ref: doc.object_ref, document_name: doc.name };
    if (all.length === 0) {
      return {
        ...document,
        hint:
          "Dokument nemá extrahovaný text (document_pages). Načíta ho ETL " +
          "`python -m etl.pdf_text --from-db`; sken bez textovej vrstvy by potreboval OCR.",
      };
    }
    const pagesWithText = all.map((p) => p.page);
    const hit = all.find((p) => p.page === page);
    if (!hit) {
      return { ...document, page, text: null, pages_with_text: pagesWithText, hint: "Strana nemá text." };
    }
    const blocks = includeBlocks ? parseBlocks(hit.blocks) : [];
    const links = includeLinks ? ((await fetchDocumentLinks(doc.id, page))[0]?.links ?? []) : null;
    return {
      ...document,
      page,
      pages_with_text: pagesWithText,
      text: hit.text.slice(0, PAGE_TEXT_CAP),
      ...(hit.text.length > PAGE_TEXT_CAP ? { text_truncated: true, text_length: hit.text.length } : {}),
      ...(includeBlocks
        ? {
            blocks: compactBlocks(blocks),
            ...(blocks.length > PAGE_BLOCKS_CAP ? { blocks_truncated: true, blocks_total: blocks.length } : {}),
          }
        : {}),
      ...(links
        ? {
            links,
            links_summary: linkSummary(links),
            links_note:
              "AIM odvodenie (D-130): popisok -> prvok podľa object_ref; typový kód (DD01 08) = jediný výskyt " +
              "typu na podlaží výkresu, inak candidates. Vo vieweri je popisok klikateľný.",
          }
        : {}),
      deep_link: `/drawing/${doc.id}?page=${page}`,
    };
  }

  /**
   * Dokumenty objektu cez vzťahy (D-104, `lib/data/object-documents.ts`, ten istý zdroj
   * ako AIM karta): jeden riadok na dokument a stranu, najbližšia cesta prvá. `via` = druh
   * nositeľa, `via_name` = nositeľ, `through` = najbližší nositeľ k objektu, ak je iný.
   */
  private async objectDocuments(objectId: string) {
    const { documents, nodes } = await fetchObjectDocuments(objectId);
    for (const n of nodes) this.addSource(n);
    const types = await fetchDocumentTypes([...new Set(documents.map((d) => d.documentId))]);
    return documents.map((d) => {
      const type = typeText(types.get(d.documentId));
      return {
        document_id: d.documentId,
        document: d.name,
        identification: d.identification,
        ...(type ? { type } : {}),
        ...(d.page ? { page: d.page } : {}),
        via: d.via,
        ...(d.viaName ? { via_name: d.viaName } : {}),
        ...(d.through ? { through: d.through } : {}),
        ...(d.alsoVia ? { also_via: d.alsoVia } : {}),
        deep_link: `/drawing/${d.documentId}${d.page ? `?page=${d.page}` : ""}`,
      };
    });
  }

  /**
   * `get_object(include=documents)` (D-104, D-115): dokumenty objektu, pri dokumente alebo
   * odkaze na stranu opačne objekty, ktorých sa týka.
   */
  private async documentsOf(obj: ObjectRow, input: Record<string, unknown>) {
    const supabase = getSupabaseAdmin();
    if (obj.object_type !== "document" && obj.object_type !== "document_reference") {
      const documents = await this.objectDocuments(obj.id);
      let projectDocuments = 0;
      if (obj.object_type !== "project") {
        const { data: projects, error: pErr } = await supabase
          .from("objects")
          .select("id")
          .eq("object_type", "project")
          .is("valid_until", null);
        if (pErr) throw new Error(pErr.message);
        const ids = (projects ?? []).map((p) => p.id as string);
        if (ids.length) {
          const { count, error } = await supabase
            .from("rel_associates_document")
            .select("id", { count: "exact", head: true })
            .in("from_id", ids)
            .is("valid_until", null);
          if (error) throw new Error(error.message);
          projectDocuments = count ?? 0;
        }
      }
      return {
        documents,
        ...(projectDocuments
          ? { project_documents: projectDocuments, hint_project: "Dokumentácia stavby (projekt) sa prvkom nededí; get_object(<projekt>, include=documents)." }
          : {}),
        ...(documents.length === 0
          ? { hint: "K objektu nevedie z modelu žiadna väzba na dokument (ani cez typ, zónu, skupinu)." }
          : {}),
      };
    }

    const doc = obj;
    const rows = await fetchDocumentObjectRows(doc);
    // Objekt raz, s najbližšou cestou (riadky sú zoradené podľa depth).
    const first = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!first.has(r.object_id)) first.set(r.object_id, r);
    const holders = await this.loadObjects([...new Set(rows.map((r) => r.via_id).filter(Boolean) as string[])]);
    const holderName = new Map(holders.map((h) => [h.id, h.name ?? h.object_ref ?? h.id]));
    const byType: Record<string, number> = {};
    const byHolder: Record<string, number> = {};
    for (const r of first.values()) {
      byType[r.object_type] = (byType[r.object_type] ?? 0) + 1;
      const h = r.via === "direct" ? "priamo" : `${r.via}: ${holderName.get(r.via_id ?? "") ?? r.via_id}`;
      byHolder[h] = (byHolder[h] ?? 0) + 1;
    }
    // Strany (odkazy na časť dokumentu): objekt sa ráta na každej strane, na ktorej je.
    const pageObjects = new Map<number, Set<string>>();
    for (const r of rows) {
      if (!r.page) continue;
      const ids = pageObjects.get(r.page) ?? new Set<string>();
      ids.add(r.object_id);
      pageObjects.set(r.page, ids);
    }
    const byPage = Object.fromEntries([...pageObjects.entries()].sort(([a], [b]) => a - b).map(([p, ids]) => [String(p), ids.size]));
    const limit = clampLimit(input.limit);
    const sampleIds = [...first.keys()].slice(0, limit);
    const sampleMeta = new Map((await this.loadObjects(sampleIds)).map((m) => [m.id, m]));
    return {
      objects_total: first.size,
      by_object_type: byType,
      by_holder: byHolder,
      sample: sampleIds.map((id) => {
        const r = first.get(id)!;
        return {
          ...(sampleMeta.get(id) ?? { id }),
          via: r.via,
          ...(r.via_id ? { via_name: holderName.get(r.via_id) ?? null } : {}),
          ...(r.page ? { page: r.page } : {}),
        };
      }),
      ...(first.size > limit ? { truncated: true } : {}),
      ...(pageObjects.size > 0 ? { by_page: byPage } : {}),
      ...(first.size > 0
        ? {
            in_3d:
              `Prvky v 3D: style_in_3d(action=xray alebo isolate, document='${doc.object_ref ?? doc.id}'` +
              (pageObjects.size > 0 ? ", voliteľne page=<strana>)" : ")"),
          }
        : {}),
    };
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
    const row = (data?.[0] as ObjectRow | undefined) ?? (col === "object_ref" ? await this.documentByCode(value) : null);
    if (row) this.addSource(row);
    return row;
  }

  /**
   * Dokument podľa kódu, ktorým ho volá používateľ (D.1.3.04): je na začiatku názvu,
   * nie v object_ref. Len jednoznačná zhoda; style_in_3d má vlastný výber (pickDocument).
   */
  private async documentByCode(code: string): Promise<ObjectRow | null> {
    if (!DOCUMENT_CODE_RE.test(code)) return null;
    const { data, error } = await getSupabaseAdmin()
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type, predefined_type, user_defined_type")
      .eq("object_type", "document")
      .ilike("name", `${code} %`)
      .is("valid_until", null)
      .limit(2);
    if (error) throw new Error(error.message);
    return data?.length === 1 ? (data[0] as ObjectRow) : null;
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
    const refs = [
      ...new Set(
        [input.id_or_ref, ...(Array.isArray(input.ids_or_refs) ? input.ids_or_refs : [])]
          .map((r) => String(r ?? "").trim())
          .filter(Boolean)
      ),
    ];
    if (refs.length === 0) throw new Error("Prvok neexistuje — najprv ho nájdi cez search_objects.");
    if (refs.length > MAX_SELECT_REFS) throw new Error(`Výber má najviac ${MAX_SELECT_REFS} prvkov, dostal som ${refs.length}.`);
    const items: Array<{ label: string; guid: string; obj: ObjectRow | null }> = [];
    for (const ref of refs) {
      const item = await this.guidForSelect(ref);
      if (!items.some((i) => i.guid === item.guid)) items.push(item);
    }
    const [primary] = items;

    const panel = selectPanelInput(input);
    const multi = items.length > 1;
    this.actions.push({
      type: "navigate",
      url: `/ifc?ops=${encodeURIComponent(selectOp(items.map((i) => i.guid), panel))}&r=${Date.now().toString(36)}`,
      label: multi ? `3D: výber ${items.length} prvkov` : `3D: výber ${primary.label}`,
    });
    // D-127: či zvýraznená vlastnosť na prvku je, povie hneď AIM; IFC panel to potvrdí v stave po príkaze.
    const property = panel?.focus && primary.obj ? await this.propertyOf(primary.obj, panel.focus.pset, panel.focus.property) : undefined;
    return {
      ok: true,
      opened: "3d",
      selected: multi ? items.map((i) => i.label) : primary.label,
      ifc_guid: primary.guid,
      ...(multi ? { ifc_guids: items.map((i) => i.guid), selected_count: items.length } : {}),
      ...(panel ? { panel } : {}),
      ...(property ? { property } : {}),
    };
  }

  /** Prvok výberu -> popis a aktuálny IFC GUID (D-082, D-102); chyba, ak ho viewer nemá. */
  private async guidForSelect(ref: string): Promise<{ label: string; guid: string; obj: ObjectRow | null }> {
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
    } else if (!isUuid(ref)) {
      guid = (await resolveNamesToGuids([ref])).get(ref); // kód prvku (D-102)
    }
    if (!guid) throw new Error(`Prvok ${ref} neexistuje — najprv ho nájdi cez search_objects.`);
    return { label, guid, obj };
  }

  /** `pset.property` v dátach AIM prvku (výskyt s dedičnosťou z typu, D-021) - D-127. */
  private async propertyOf(obj: ObjectRow, pset: string, property: string): Promise<PropertyLookup> {
    const relation = obj.object_type === "asset" ? "v_asset_effective" : "objects";
    const { data, error } = await getSupabaseAdmin().from(relation).select("properties").eq("id", obj.id).limit(1);
    if (error) throw new Error(error.message);
    return lookupProperty((data?.[0] as { properties?: unknown } | undefined)?.properties, pset, property);
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
      legend: "legenda",
    };
    if (!(action in opLabel)) {
      throw new Error(
        "action musí byť colorize | transparent | hide | show | isolate | xray | show_all | reset_colors | legend."
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
      throw new Error("Dokument neexistuje - id dokumentu zisti cez get_object(include=documents).");
    }

    const focusId = typeof input.focus_id === "string" && isUuid(input.focus_id.trim())
      ? input.focus_id.trim()
      : null;
    const page =
      typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
        ? Math.floor(input.page)
        : null;

    const label = doc.name ?? doc.object_ref ?? "výkres";
    const highlights = docHighlightsInput(input.highlights);
    if (input.highlights !== undefined && Array.isArray(input.highlights) && input.highlights.length > 0 && highlights.length === 0) {
      throw new Error("highlights = [{x, y, width, height}] v % strany (0-100), aspoň jeden na strane.");
    }
    // Bez výrezu sa karta priblíži na rámiky (D-123): ich obal, najmenej 15 % na os.
    const region =
      docRegionInput(input.region) ??
      (input.region === undefined && highlights.length > 0 ? highlightsRegion(highlights) : undefined);
    if (input.region !== undefined && !region) {
      throw new Error("region musí mať x, y, width, height v % strany (0-100) a ležať na strane.");
    }
    if (input.target !== undefined && input.target !== "tab" && input.target !== "split") {
      throw new Error("target: tab (záložka na celú plochu) alebo split (vedľa 3D).");
    }
    if (input.in_viewer === true || region || input.target !== undefined) {
      // Dokument vo vieweri (D-075 DOCUMENT_OPEN cez op `doc`, D-083), výrez strany D-117, rámiky D-123,
      // záložka na celú plochu alebo vedľa 3D (D-132).
      const layout = input.target === "split" ? "split" : undefined;
      this.actions.push({
        type: "navigate",
        url: `/ifc?ops=${encodeURIComponent(docOp(doc.id, page ?? undefined, region, highlights, layout))}&r=${Date.now().toString(36)}`,
        label: `Viewer: ${label}`,
      });
      return {
        ok: true,
        opened: "viewer_document",
        layout: layout ?? "tab",
        document: label,
        ...(page ? { page } : {}),
        ...(region ? { region: { x: region.x, y: region.y, width: region.w, height: region.h } } : {}),
        ...(highlights.length > 0 ? { highlights: highlights.length } : {}),
        ...(focusId
          ? {
              note:
                "focus_id karta vo vieweri nezvýrazní; polohu prvku vo výkrese tool nepozná. " +
                "Na priblíženie použi region (výrez strany v %).",
            }
          : {}),
      };
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
