import { getIfcModels } from "../data/ifc-models";
import type { ToolDefinition } from "../llm/provider";

import { passthroughDefinitions } from "./passthrough-defs";
import { SEARCH_FIELDS } from "./search";

/**
 * Definície `ifc_*` tools IFC motora (D-084) - bez závislostí motora, aby ich
 * MCP route mohla importovať staticky; vykonanie je v `./tools` (lenivo).
 */

export const OPS = ["=", "!=", ">", "<", ">=", "<=", "contains", "exists", "matches"] as const;

function modelEnum(): string[] {
  return getIfcModels().map((m) => m.id);
}

const whereSchema = {
  type: "array",
  maxItems: 3,
  description:
    "Podmienky na hodnoty psetov (AND), napr. [{pset:'Qto_SpaceBaseQuantities', name:'NetFloorArea', " +
    "op:'>', value:20}]. Prvá podmienka smie mať aj op contains/exists/matches, ďalšie len = != > < >= <=. " +
    "Čítajú sa vlastnosti výskytu (nie zdedené z typu).",
  items: {
    type: "object",
    properties: {
      pset: { type: "string" },
      name: { type: "string" },
      op: { type: "string", enum: OPS as unknown as string[] },
      value: { description: "Číslo, text alebo boolean (pri exists netreba)" },
    },
    required: ["pset", "name", "op"],
  },
};

export function engineToolDefinitions(): ToolDefinition[] {
  const models = modelEnum();
  const model = { type: "string", enum: models, description: `Model federácie (${models.join(", ")})` };
  return [
    {
      name: "ifc_models",
      description:
        "IFC MOTOR: zoznam IFC modelov federácie a ich aktuálna revízia (vNNN, dátum, autor, súhrn " +
        "zmien, sha256, výsledok poistky: pridané/odobraté objekty). history = aj predchádzajúce revízie. " +
        "Na \"je toto najnovšie VZT?\" a \"čo sa zmenilo\"; hlavičku súboru, jednotky a súradnicový " +
        "systém dáva ifc_model_info. Zavolaj aj, keď nevieš, ktorý model (ASR/VZT) obsahuje hľadané prvky.",
      inputSchema: {
        type: "object",
        properties: {
          history: { type: "number", description: "Koľko posledných revízií na model (1-20); bez neho len aktuálna" },
        },
      },
    },
    {
      name: "ifc_query",
      description:
        "IFC MOTOR: nájde prvky priamo v IFC súbore podľa IFC triedy, podlažia a hodnôt psetov - aj " +
        "ČÍSELNÉ porovnania (plocha > 20, výkon >= 5). Použi na otázky, ktoré DB tools nevedia " +
        "(číselné porovnanie, vlastnosť, ktorú ETL nenaimportovalo). Vráti prvky s object_ref z AIM, " +
        "počet nenamapovaných a pole show_in_3d pripravené pre show_in_3d/style_in_3d.",
      inputSchema: {
        type: "object",
        properties: {
          model,
          ifc_types: { type: "array", items: { type: "string" }, description: "IFC triedy, napr. [IfcSpace]" },
          where: whereSchema,
          storey: { type: "string", description: "Podlažie podľa štítku AIM (2NP, 2.NP, 3NP)" },
          limit: { type: "number", description: "Max prvkov vo výsledku (1-500, default 100)" },
        },
        required: ["model"],
      },
    },
    {
      name: "ifc_search",
      description:
        "IFC MOTOR - ZDROJ: IFC súbor (nie graf AIM). Full-text v IFC súbore: atribúty (Name, Description, " +
        "ObjectType, Tag, LongName, PredefinedType...), psety a Qto výskytu aj z typu, klasifikácie a materiály " +
        "prvkov, priestorov, zón (IfcZone), skupín, systémov aj typov. Bez ohľadu na diakritiku a veľkosť " +
        "písmen, všetky slová musia sedieť (aj ako začiatok slova), pri preklepe fuzzy. Použi na hľadanie " +
        "podľa textu, ktorý graf AIM nenesie (popis, LongName zóny, ObjectType, Tag, neimportované psety), " +
        "a keď search_everything nič nenašiel. Každý výsledok nesie source (ifc = len v súbore, ifc+aim = " +
        "prvok pozná aj AIM, potom má object_ref), matched (pole a hodnota ako dôkaz) a show_in_3d.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Hľadaný text (slová, kód, hodnota; min 2 znaky)" },
          model: { ...model, description: "Voliteľne model; inak sa hľadá vo všetkých" },
          ifc_types: { type: "array", items: { type: "string" }, description: "Voliteľne IFC triedy vrátane podtried, napr. [IfcDoor] alebo [IfcZone]" },
          fields: {
            type: "array",
            items: { type: "string", enum: [...SEARCH_FIELDS] },
            description: "Voliteľne len tieto časti: attribute | property | quantity | type_property | classification | material",
          },
          fuzzy: { type: "boolean", description: "Tolerovať preklepy (default true)" },
          limit: { type: "number", description: "Max výsledkov (1-200, default 30)" },
          offset: { type: "number", description: "Posun pre stránkovanie (default 0)" },
        },
        required: ["text"],
      },
    },
    {
      name: "ifc_get",
      description:
        "IFC MOTOR: všetky údaje prvkov priamo z IFC súboru - atribúty, psety výskytu, množstvá (Qto), " +
        "klasifikácie, materiály (vrstvy skladby s hrúbkou a kategóriou, aj z typu), dokumenty a voliteľne " +
        "psety z typu. Ciele = object_ref, objects.id alebo IFC GlobalId.",
      inputSchema: {
        type: "object",
        properties: {
          targets: { type: "array", items: { type: "string" }, description: "1-50 cieľov" },
          model: { ...model, description: "Voliteľne model; inak sa prvok hľadá vo všetkých" },
          include_type_properties: { type: "boolean", description: "Pridať psety z typu (default true)" },
        },
        required: ["targets"],
      },
    },
    {
      name: "ifc_count",
      description:
        "IFC MOTOR: presný počet prvkov v IFC súbore - celkovo, podľa podmienok where, alebo zoskupený " +
        "podľa triedy / podlažia / materiálu (group_by; s where sa nekombinuje).",
      inputSchema: {
        type: "object",
        properties: {
          model,
          ifc_type: { type: "string" },
          where: whereSchema,
          group_by: { type: "string", enum: ["type", "storey", "material"] },
        },
        required: ["model"],
      },
    },
    {
      name: "ifc_property_values",
      description:
        "IFC MOTOR: zoznam rôznych hodnôt jednej vlastnosti psetu alebo množstva Qto s počtami (histogram) " +
        "pre IFC triedu - na otázky 'aké hodnoty má X' a ako podklad pre farbenie podľa hodnoty. " +
        "`source` hovorí, odkiaľ hodnota je (pset | qto); typové psety nečíta.",
      inputSchema: {
        type: "object",
        properties: {
          model,
          ifc_type: { type: "string", description: "IFC trieda, napr. IfcSpace" },
          pset: { type: "string" },
          name: { type: "string", description: "Názov vlastnosti" },
          limit: { type: "number", description: "Max hodnôt (1-200, default 50)" },
        },
        required: ["model", "ifc_type", "pset", "name"],
      },
    },
    {
      name: "ifc_ids_validate",
      description:
        "IFC MOTOR: skontroluje model TERAZ voči IDS z knižnice požiadaviek (nič neukladá). Vráti " +
        "verdikt každej špecifikácie a nesplnené prvky s dôvodmi a object_ref. Uložený posledný beh " +
        "(ETL, ifctester) je v DB - v_ids_summary/v_ids_latest cez query_view.",
      inputSchema: {
        type: "object",
        properties: {
          model,
          ids: { type: "string", description: "Id IDS z registra (ifc_models ukáže dostupné)" },
          spec: { type: "string", description: "Voliteľne len špecifikácia (identifikátor alebo názov)" },
          failures_per_spec: { type: "number", description: "Max nesplnených prvkov na špecifikáciu (1-100, default 20)" },
        },
        required: ["model", "ids"],
      },
    },
    {
      name: "ifc_relations",
      description:
        "IFC MOTOR: všetky IFC vzťahy jednej entity priamo zo súboru, aj entity mimo grafu AIM (zóna, " +
        "systém, port): členovia zón/skupín/systémov (IfcRelAssignsToGroup), kam prvok patrí, podlažie a " +
        "miestnosť (IfcRelContainedIn/ReferencedInSpatialStructure), agregácia a vnorenie (IfcRelAggregates/" +
        "IfcRelNests), typ, otvory a výplne (Voids/Fills), hranice priestoru, porty, dokumenty, klasifikácie, " +
        "materiály. direction: forward = entita je Relating (skupina -> členovia, podlažie -> prvky, celok -> " +
        "časti, prvok -> porty), inverse = kam entita patrí. recursive rozvinie vnorené zóny/systémy (bez rel_types len cez IfcRelAssignsToGroup). " +
        "through_ports = prvky napojené cez porty (IfcRelConnectsPorts), jeden krok; s recursive=true prechod " +
        "celou sieťou cez porty a stop_at (napr. IfcUnitaryEquipment, IfcDamper.FIREDAMPER) = najbližšia jednotka " +
        "alebo klapka s cestou (reached, path_show_in_3d). Úplný zoznam bez stropu: " +
        "stránkuj cez next_cursor, kým nie je null; total a counts platia pre celý výsledok.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "object_ref, objects.id alebo IFC GlobalId" },
          model: { ...model, description: "Voliteľne model; inak sa entita hľadá vo všetkých" },
          rel_types: {
            type: "array",
            items: { type: "string" },
            description: "Len tieto triedy vzťahov, napr. [IfcRelAssignsToGroup]. Bez filtra všetky okrem psetov (IfcRelDefinesByProperties)",
          },
          direction: { type: "string", enum: ["forward", "inverse", "both"], description: "Default both" },
          recursive: { type: "boolean", description: "Rozvinúť do hĺbky (max 10) cez tie isté vzťahy, bez rel_types len cez IfcRelAssignsToGroup; len s direction forward alebo inverse" },
          through_ports: { type: "boolean", description: "Prvky napojené cez porty namiesto priamych vzťahov" },
          stop_at: {
            type: "array",
            items: { type: "string" },
            description: "S through_ports a recursive: zastaviť na triede, voliteľne Trieda.PREDEFINED (IfcDamper.FIREDAMPER)",
          },
          max_steps: { type: "number", description: "S through_ports a recursive: max krokov sieťou (1-200, default 50)" },
          limit: { type: "number", description: "Max vzťahov na stránku (1-200, default 100)" },
          cursor: { type: "string", description: "next_cursor z predchádzajúcej stránky" },
        },
        required: ["target"],
      },
    },
    {
      name: "ifc_material_layers",
      description:
        "IFC MOTOR: prvky, ktorých materiál obsahuje hľadaný materiál alebo kategóriu - aj ako jedna vrstva " +
        "zloženej skladby (IfcMaterialLayerSet), zložka alebo profil, vrátane materiálu z typu. Na \"ukáž " +
        "izoláciu / EPS / minerálnu vlnu\"; hľadá bez diakritiky v názve materiálu, vrstvy aj kategórie. Vráti " +
        "total, súhrn podľa skladby (sets) s nájdenými vrstvami a hrúbkou, prvky a show_in_3d za všetky nájdené.",
      inputSchema: {
        type: "object",
        properties: {
          material: { type: "string", description: "Časť názvu materiálu, vrstvy alebo kategórie (napr. izol, EPS, minerál, betón)" },
          model: { ...model, description: "Voliteľne model; inak všetky" },
          ifc_types: { type: "array", items: { type: "string" }, description: "Len tieto triedy (default IfcElement so všetkými podtriedami)" },
          limit: { type: "number", description: "Max vypísaných prvkov (1-500, default 100); total, sets a show_in_3d platia pre všetky" },
        },
        required: ["material"],
      },
    },
    ...passthroughDefinitions(models),
  ];
}

export const ENGINE_TOOL_NAMES = new Set(engineToolDefinitions().map((t) => t.name));
