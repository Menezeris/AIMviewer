import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { listOp } from "@/lib/viewer-list";

import type { AskAction } from "./actions";
import { DOMAIN_IFC_TYPES } from "./ifc-selector";
import { parseListColumn } from "./list-columns";
import { lensGroup } from "./lens-plan";
import type { ToolDefinition } from "./provider";
import { LENS_GUID_CAP, resolveFilter, type GroupInfo } from "./style-lens";
import { StyleInputError, parseStyleGroups } from "./style-plan";
import { ScopeResolver } from "./style-scope";

/**
 * `open_list` (D-111): zoznam (tabuľka) prvkov v paneli Lists vo vieweri. Filter
 * je ten istý ako pri `style_in_3d` (zostaví sa ako skupina Lens, D-096), stĺpce
 * sú atribúty, psety, Qto, materiál, klasifikácia, podlažie alebo model. Viewer
 * otvorí builder upstream panela Lists; spustenie a export (CSV/XLSX/PDF) urobí
 * používateľ tlačidlom - stiahnutie súboru bez jeho kliku prehliadač v iframe nedovolí.
 */

const DEFAULT_COLUMNS = ["Name", "GlobalId", "ObjectType", "storey"];
const MAX_COLUMNS = 30;

const filterProps = {
  ifc_type: { type: "string", description: "IFC trieda, napr. IfcDoor" },
  ifc_types: { type: "array", items: { type: "string" } },
  domain: { type: "string", description: "Doména prvkov ako v style_in_3d" },
  predefined_type: { type: "string" },
  storey: { type: "string", description: "Podlažie (1NP, 2.NP...)" },
  system: { type: "string" },
  system_type: { type: "string" },
  zone: { type: "string", description: "Zóna (IfcZone, požiarny úsek...) - miestnosti aj prvky v nich" },
  property: { type: "string", description: "Vlastnosť na filter (s value)" },
  pset: { type: "string" },
  value: { type: "string" },
  query: { type: "string", description: "Časť názvu prvku" },
  model: { type: "string", description: "Model federácie (ASR, VZT)" },
  global_ids: { type: "array", items: { type: "string" } },
  ids_or_refs: { type: "array", items: { type: "string" } },
};

export const LIST_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "open_list",
    description:
      "Tabuľka prvkov v paneli Lists vo vieweri (export do CSV/XLSX/PDF): \"exportuj dvere na 1NP ako tabuľku\", " +
      "\"zoznam tvaroviek s rozmermi do Excelu\". Filtre ako style_in_3d (ifc_type, storey, system, zone, property/value, " +
      "global_ids, ids_or_refs, model), všetky platia naraz. columns = atribúty (Name, GlobalId, ObjectType, Tag...), " +
      "storey / space / building, material, classification, model alebo Pset.Vlastnosť / Qto_X.Množstvo. Viewer otvorí " +
      "zoznam v builderi; povedz používateľovi, nech stlačí Run a potom Export - súbor stiahne on sám.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Názov zoznamu (napr. Dvere 1NP)" },
        columns: {
          type: "array",
          items: { type: "string" },
          description: "Stĺpce v poradí; default Name, GlobalId, ObjectType, storey",
        },
        ...filterProps,
      },
    },
  },
];

export const LIST_TOOL_NAMES = new Set(LIST_TOOL_DEFINITIONS.map((t) => t.name));

export async function execListTool(
  name: string,
  input: Record<string, unknown>,
  push: (a: AskAction) => void,
): Promise<Record<string, unknown>> {
  if (name !== "open_list") throw new Error(`Neznámy tool '${name}'.`);
  const rawColumns = Array.isArray(input.columns) ? input.columns.map((c) => String(c)).filter((c) => c.trim()) : [];
  if (rawColumns.length > MAX_COLUMNS) throw new StyleInputError(`Najviac ${MAX_COLUMNS} stĺpcov.`);
  const columns = (rawColumns.length ? rawColumns : DEFAULT_COLUMNS).map(parseListColumn);
  const [group] = parseStyleGroups({ ...input, groups: undefined }, "isolate");
  const info: GroupInfo = { label: group.label };
  const filter = await resolveFilter(new ScopeResolver(getSupabaseAdmin()), group.filter, { domainTypes: DOMAIN_IFC_TYPES }, info, {
    left: LENS_GUID_CAP,
  });
  const lensFilter = lensGroup(filter);
  if (lensFilter.rules.length === 0) {
    throw new StyleInputError("Zadaj aspoň jeden filter (ifc_type, storey, system, zone, property, global_ids...), inak by zoznam niesol celý model.");
  }
  const listName = (typeof input.name === "string" && input.name.trim() ? input.name.trim() : group.label).slice(0, 120);
  push({
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(listOp({ n: listName, g: [lensFilter], c: columns }))}&r=${Date.now().toString(36)}`,
    label: `3D: zoznam - ${listName}`,
  });
  return {
    ok: true,
    opened: "lists",
    name: listName,
    filter: info,
    columns: columns.map((c) => (c.p ? `${c.p}.${c.k}` : c.k || c.s)),
    next_step: "Vo vieweri sa otvoril panel Lists so zoznamom v builderi: používateľ stlačí Run a potom Export (CSV, XLSX, PDF).",
  };
}
