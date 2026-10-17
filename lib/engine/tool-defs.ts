import { getIfcModels } from "../data/ifc-models";
import type { ToolDefinition } from "../llm/provider";

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
        "IFC MOTOR: zoznam IFC modelov federácie, ktoré vie motor čítať, a či sú načítané. " +
        "Zavolaj, keď nevieš, ktorý model (ASR/VZT) obsahuje hľadané prvky.",
      inputSchema: { type: "object", properties: {} },
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
      name: "ifc_get",
      description:
        "IFC MOTOR: všetky údaje prvkov priamo z IFC súboru - atribúty, psety výskytu, množstvá (Qto), " +
        "klasifikácie, dokumenty a voliteľne psety z typu. Ciele = object_ref, objects.id alebo IFC GlobalId.",
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
        "IFC MOTOR: zoznam rôznych hodnôt jednej vlastnosti psetu s počtami (histogram) pre IFC triedu - " +
        "na otázky 'aké hodnoty má X' a ako podklad pre farbenie podľa hodnoty.",
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
  ];
}

export const ENGINE_TOOL_NAMES = new Set(engineToolDefinitions().map((t) => t.name));
