import { getIfcModels } from "../data/ifc-models";
import type { ToolDefinition } from "../llm/provider";

import { PASSTHROUGH_TOOLS, passthroughName } from "./passthrough-defs";

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

/** `ifc_models` action -> prevzatý tool balíka (D-087); revisions je vlastný (D-109). */
export const MODEL_ACTIONS = {
  revisions: null,
  info: "model_info",
  materials: "materials_list",
  classifications: "classifications_list",
  audit: "model_audit",
  schema: "schema_describe",
} as const;
export type ModelAction = keyof typeof MODEL_ACTIONS;

export const QUERY_MODES = ["list", "count", "values"] as const;

export function engineToolDefinitions(): ToolDefinition[] {
  const models = modelEnum();
  const model = { type: "string", enum: models, description: `Model federácie (${models.join(", ")})` };
  return [
    {
      name: "ifc_models",
      description:
        "IFC MOTOR: IFC SCHÉMA, modely federácie a údaje súboru. action=schema: z ktorej triedy IFC trieda " +
        "dedí, celá línia dedičnosti a atribúty (type, napr. IfcAirTerminal; bez modelu) - neodpovedaj z pamäti. " +
        "revisions (default): aktuálna revízia modelu (vNNN, dátum, autor, zmeny), history = aj predchádzajúce; " +
        "info: schéma IFC, jednotky, georeferencovanie; materials / classifications: zoznam materiálov a " +
        "klasifikácií s počtami; audit: zdravie modelu.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: Object.keys(MODEL_ACTIONS) },
          model: { ...model, description: "Pri info, materials, classifications a audit povinný" },
          history: { type: "number", description: "revisions: koľko posledných revízií na model (1-20)" },
          type: { type: "string", description: "schema: IFC trieda, napr. IfcWall" },
          include_inherited: { type: "boolean", description: "schema: aj zdedené atribúty (default true)" },
        },
      },
    },
    {
      name: "ifc_query",
      description:
        "IFC MOTOR: prvky v IFC súbore podľa MATERIÁLU (material: izolácia, minerálna vlna, EPS, betón - aj " +
        "vrstva skladby a materiál z typu; graf AIM materiály nenesie), triedy, podlažia a hodnôt psetov vrátane " +
        "ČÍSELNÝCH porovnaní (plocha > 20). mode=list (default): prvky s object_ref a show_in_3d; count: presný " +
        "počet zo súboru, aj group_by trieda/podlažie/materiál; values: aké hodnoty má vlastnosť psetu alebo Qto " +
        "a koľko prvkov má ktorú (pset + name). Číta vlastnosti výskytu, nie zdedené z typu.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: [...QUERY_MODES] },
          model: { ...model, description: "Model; bez neho len s material (inak všetky)" },
          ifc_types: { type: "array", items: { type: "string" }, description: "IFC triedy, napr. [IfcSpace]; count a values berú prvú" },
          where: whereSchema,
          storey: { type: "string", description: "list: podlažie podľa štítku AIM (2NP, 3NP)" },
          group_by: { type: "string", enum: ["type", "storey", "material"], description: "count: zoskupiť (s where sa nekombinuje)" },
          pset: { type: "string", description: "values: pset alebo Qto, napr. Pset_DoorCommon" },
          name: { type: "string", description: "values: vlastnosť, napr. FireRating" },
          material: { type: "string", description: "Časť názvu materiálu, vrstvy alebo kategórie; s mode=count len počet" },
          limit: { type: "number", description: "Max prvkov alebo hodnôt vo výsledku" },
        },
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
      name: "ifc_measure",
      description:
        "IFC MOTOR: meranie z geometrie (nie z Qto). a + b = svetlá vzdialenosť povrchov dvoch prvkov (aj ASR " +
        "voči VZT; záporná = prienik), vzdialenosť stredov, medzera obálok po osiach X/Y/Z a vodorovne, " +
        "a_above_b_m = výška spodku a nad vrchom b (napr. klapka nad doskou: b = doska). Len a alebo items = " +
        "rozmery obálky, povrch, pôdorys a objem z meshu, porovnané s Qto zo súboru (vs_qto, mismatch nad 5 %), " +
        "pri viacerých aj súčet. Objem množiny podľa filtra: GUIDy z ifc_query do items (max 50). Prvé volanie " +
        "nad modelom ho tesseluje (ASR ~4 s), ďalšie sú rýchle.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "string", description: "Prvý prvok: object_ref, objects.id alebo IFC GlobalId" },
          b: { type: "string", description: "Druhý prvok na vzdialenosť" },
          items: { type: "array", items: { type: "string" }, description: "Prvky na rozmery a výmery (max 50)" },
          model: { ...model, description: "Voliteľne model; inak sa prvky hľadajú vo všetkých" },
          qto: {
            type: "boolean",
            description: "Len plocha a objem z Qto v súbore (a alebo items), bez tesselácie geometrie - rýchle",
          },
        },
      },
    },
  ];
}

/**
 * Staré mená zlúčených toolov (D-115): v zozname už nie sú, ale volanie nimi
 * ešte prejde (klient si zoznam toolov drží počas konverzácie). Zmažú sa,
 * keď ich `mcp_call_log` dva týždne neukáže.
 */
export const LEGACY_ENGINE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ifc_search",
  "ifc_count",
  "ifc_property_values",
  "ifc_material_layers",
  ...PASSTHROUGH_TOOLS.map((t) => passthroughName(t.upstream)),
]);

/** Mená, ktoré vykoná motor: zoznam + staré mená. */
export const ENGINE_TOOL_NAMES = new Set([...engineToolDefinitions().map((t) => t.name), ...LEGACY_ENGINE_TOOL_NAMES]);
