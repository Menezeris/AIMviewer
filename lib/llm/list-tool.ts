import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { listOp, type ListColumnWire, type ListViewWire } from "@/lib/viewer-list";

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
 *
 * "Excel hlasom" (D-149): `action=update` upraví práve otvorený zoznam (filtre pribudnú
 * cez AND a tabuľka sa spustí znova), `maximize`, `sort_by`, `sum`, `group_by` a `search`
 * platia pri otvorení aj úprave. Stav zoznamu vráti potvrdenie viewera a `get_viewer_state`.
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
  document: { type: "string", description: "Dokument (id, object_ref, názov) - prvky, ktorých sa týka" },
  page: { type: "number", description: "S document: len prvky danej strany" },
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
      "zoznam v builderi; povedz používateľovi, nech stlačí Run a potom Export - súbor stiahne on sám. " +
      "run=true tabuľku hneď spustí (výsledok je vidieť bez kliku); odpoveď povie, či beží. " +
      "ÚPRAVA OTVORENÉHO ZOZNAMU ('filtruj 3NP', 'zoraď podľa objemu', 'sčítaj NetVolume', 'na celú obrazovku'): " +
      "action=update s filtrami (pribudnú k filtrom zoznamu, tabuľka sa spustí znova) a/alebo maximize, sort_by + sort_dir, " +
      "sum, group_by, search; nový zoznam nezakladaj. Stĺpce v sort_by, sum a group_by píš ako v columns a musia v zozname byť. " +
      "Potvrdenie (state.list) a get_viewer_state vrátia stav zoznamu vrátane súčtov (sums) za viditeľné riadky - súčet " +
      "povedz z neho, nepočítaj ho inými toolmi.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Názov zoznamu (napr. Dvere 1NP)" },
        columns: {
          type: "array",
          items: { type: "string" },
          description: "Stĺpce v poradí; default Name, GlobalId, ObjectType, storey",
        },
        run: { type: "boolean", description: "true = tabuľku po otvorení rovno spustiť (default false: builder, Run stlačí používateľ)" },
        action: {
          type: "string",
          enum: ["open", "update"],
          description: "open (default) = nový zoznam; update = upraviť otvorený zoznam (filtre pribudnú cez AND, tabuľka sa spustí)",
        },
        maximize: { type: "boolean", description: "true = panel Lists na celú plochu viewera, false = späť" },
        sort_by: { type: "string", description: "Stĺpec na zoradenie (ako v columns); prázdny reťazec zruší zoradenie" },
        sort_dir: { type: "string", enum: ["asc", "desc"], description: "Smer zoradenia (default asc)" },
        sum: { type: "array", items: { type: "string" }, description: "Stĺpce so súčtom (Qto_X.NetVolume...); [] zruší súčty" },
        group_by: { type: "array", items: { type: "string" }, description: "Zoskupenie podľa stĺpcov, vonkajšie prvé (storey...); [] zruší" },
        search: { type: "string", description: "Rýchle hľadanie textu v riadkoch tabuľky; prázdny reťazec zruší" },
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
  const view = parseListViewInput(input);
  if (input.action === "update") return execListUpdate(input, view, push);
  if (input.action !== undefined && input.action !== "open") throw new StyleInputError("action je open alebo update.");
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
  const run = input.run === true;
  const listName = (typeof input.name === "string" && input.name.trim() ? input.name.trim() : group.label).slice(0, 120);
  push({
    type: "navigate",
    url: listUrl({ n: listName, g: [lensFilter], c: columns, ...(run ? { r: 1 as const } : {}), ...(view ? { v: view } : {}) }),
    label: `3D: zoznam - ${listName}`,
  });
  return {
    ok: true,
    opened: "lists",
    name: listName,
    filter: info,
    columns: columns.map((c) => (c.p ? `${c.p}.${c.k}` : c.k || c.s)),
    run,
    ...(view ? { view: viewSummary(view) } : {}),
    next_step: run
      ? "Panel Lists sa otvára a tabuľka sa spúšťa: či beží, povie potvrdenie viewera (state.list) nižšie. Export (CSV, XLSX, PDF) robí používateľ."
      : "Vo vieweri sa otvoril panel Lists so zoznamom v builderi: používateľ stlačí Run a potom Export (CSV, XLSX, PDF).",
  };
}

const listUrl = (wire: Parameters<typeof listOp>[0]) => `/ifc?ops=${encodeURIComponent(listOp(wire))}&r=${Date.now().toString(36)}`;

const FILTER_KEYS = Object.keys(filterProps);
const MAX_VIEW_COLUMNS = 8;

function columnList(raw: unknown, key: string): ListColumnWire[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new StyleInputError(`${key} je pole stĺpcov (napr. ["Qto_ColumnBaseQuantities.NetVolume"]).`);
  if (raw.length > MAX_VIEW_COLUMNS) throw new StyleInputError(`${key}: najviac ${MAX_VIEW_COLUMNS} stĺpcov.`);
  return raw.map((c) => parseListColumn(String(c)));
}

/** `maximize`, `sort_by`, `sum`, `group_by`, `search` -> `ListViewWire`; nič z toho = undefined. */
export function parseListViewInput(input: Record<string, unknown>): ListViewWire | undefined {
  const v: ListViewWire = {};
  if (input.maximize !== undefined) {
    if (typeof input.maximize !== "boolean") throw new StyleInputError("maximize je true alebo false.");
    v.m = input.maximize;
  }
  if (input.sort_dir !== undefined && input.sort_dir !== "asc" && input.sort_dir !== "desc") {
    throw new StyleInputError("sort_dir je asc alebo desc.");
  }
  if (input.sort_by !== undefined) {
    const col = String(input.sort_by).trim();
    v.o = col ? { c: parseListColumn(col), d: input.sort_dir === "desc" ? "desc" : "asc" } : null;
  }
  const sum = columnList(input.sum, "sum");
  if (sum) v.sum = sum;
  const gb = columnList(input.group_by, "group_by");
  if (gb) v.gb = gb;
  if (input.search !== undefined) v.q = String(input.search).slice(0, 200);
  return Object.keys(v).length ? v : undefined;
}

const colName = (c: ListColumnWire) => (c.p ? `${c.p}.${c.k}` : c.k || c.s);

function viewSummary(v: ListViewWire): Record<string, unknown> {
  return {
    ...(v.m !== undefined ? { maximize: v.m } : {}),
    ...(v.o !== undefined ? { sort: v.o ? `${colName(v.o.c)} ${v.o.d}` : null } : {}),
    ...(v.sum ? { sum: v.sum.map(colName) } : {}),
    ...(v.gb ? { group_by: v.gb.map(colName) } : {}),
    ...(v.q !== undefined ? { search: v.q } : {}),
  };
}

/** `action=update` (D-149): úprava otvoreného zoznamu, filtre pribudnú cez AND. */
async function execListUpdate(
  input: Record<string, unknown>,
  view: ListViewWire | undefined,
  push: (a: AskAction) => void,
): Promise<Record<string, unknown>> {
  if (input.columns !== undefined) {
    throw new StyleInputError("Stĺpce otvoreného zoznamu sa zatiaľ meniť nedajú: otvor nový zoznam cez open_list s columns.");
  }
  const hasFilter = FILTER_KEYS.some((k) => input[k] !== undefined);
  let groups: ReturnType<typeof lensGroup>[] = [];
  let info: GroupInfo | undefined;
  if (hasFilter) {
    const [group] = parseStyleGroups({ ...input, groups: undefined }, "isolate");
    info = { label: group.label };
    const filter = await resolveFilter(new ScopeResolver(getSupabaseAdmin()), group.filter, { domainTypes: DOMAIN_IFC_TYPES }, info, {
      left: LENS_GUID_CAP,
    });
    const lensFilter = lensGroup(filter);
    if (lensFilter.rules.length === 0) throw new StyleInputError("Filter nič nevybral; skús iné podlažie, triedu alebo vlastnosť.");
    groups = [lensFilter];
  }
  if (!hasFilter && !view) {
    throw new StyleInputError("action=update potrebuje filter (storey, property/value...) alebo maximize, sort_by, sum, group_by, search.");
  }
  push({
    type: "navigate",
    url: listUrl({ n: "", g: groups, c: [], u: 1, ...(view ? { v: view } : {}) }),
    label: "3D: úprava zoznamu",
  });
  return {
    ok: true,
    updated: "lists",
    ...(info ? { added_filter: info } : {}),
    ...(view ? { view: viewSummary(view) } : {}),
    next_step: hasFilter
      ? "Filter pribudol k zoznamu a tabuľka sa spúšťa znova; stav (riadky, súčty) je v potvrdení viewera (state.list)."
      : "Zoznam sa upravuje; stav (zoradenie, súčty, maximalizácia) je v potvrdení viewera (state.list).",
  };
}
