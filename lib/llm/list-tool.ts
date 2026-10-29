import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  LIST_EXPORT_FORMATS,
  listOp,
  LIST_MAX_HIGHLIGHT_ITEMS,
  LIST_MAX_WIDTH_COLUMNS,
  LIST_MAX_COLUMN_WIDTH,
  LIST_MIN_COLUMN_WIDTH,
  type ListCellValue,
  type ListColumnWidth,
  type ListColumnWire,
  type ListEditWire,
  type ListExportFormat,
  type ListHighlightWire,
  type ListViewWire,
} from "@/lib/viewer-list";

import type { AskAction } from "./actions";
import { DOMAIN_IFC_TYPES, sanitizeIfcType } from "./ifc-selector";
import { parseListColumn } from "./list-columns";
import { assertHostColumnUsable, hostColumnNotes, splitHostColumns } from "./list-host";
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
 * Krok 2: pri `update` pribudnú a ubudnú stĺpce a triedy, odoberú sa filtre, podlažie a model
 * sa prepnú (nahradia staré), `color_by` ofarbí prvky podľa stĺpca a `export` ponúkne stiahnutie.
 */

const DEFAULT_COLUMNS = ["Name", "GlobalId", "ObjectType", "storey"];

/** `remove_filter` -> druh pravidla filtra vo vieweri (zóna, dokument a prvky sú tam GlobalId). */
const REMOVE_FILTER_KINDS: Record<string, string> = {
  storey: "storey",
  model: "model",
  property: "property",
  system: "group",
  system_type: "group",
  zone: "globalId",
  document: "globalId",
  global_ids: "globalId",
  ids_or_refs: "globalId",
  query: "name",
  predefined_type: "predefinedType",
  all: "all",
};
const REMOVE_FILTER_KEYS = Object.keys(REMOVE_FILTER_KINDS);
/** Edit parametre `update` (krok 2). */
const EDIT_KEYS = ["add_columns", "remove_columns", "add_types", "remove_types", "remove_filter"];
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
      "sum, group_by, search; nový zoznam nezakladaj. Stĺpce v sort_by, sum, group_by a color_by píš ako v columns a musia v zozname byť. " +
      "Pri update: add_columns / remove_columns ('pridaj FireRating'), add_types / remove_types ('pridaj aj nosníky a steny' = IfcBeam, IfcWall), " +
      "remove_filter ('zruš filter podlažia', 'zruš všetky filtre' = all, triedy ostanú); storey a model PREPNÚ podlažie či model (nahradia doterajšie), " +
      "ostatné filtre pribudnú cez AND. color_by = farby prvkov v 3D podľa hodnoty stĺpca (Lens, legenda; nie podlažie/priestor). " +
      "export = csv | xlsx | pdf: viewer zvýrazní tlačidlo Stiahnuť, súbor stiahne používateľ klikom (bez kliku prehliadač nedovolí) - povedz mu to. " +
      "Potvrdenie (state.list) a get_viewer_state vrátia stav zoznamu vrátane súčtov (sums) za viditeľné riadky - súčet " +
      "povedz z neho, nepočítaj ho inými toolmi. " +
      "Ak je v 3D izolácia, nový zoznam ukáže všetky svoje riadky (filter 'len viditeľné' sa vypne, visible_only ho prepne). Izoláciu nerušiť. " +
      "highlight zvýrazní v tabuľke riadky (rows: stĺpec + hodnoty), stĺpce, bunky alebo riadok súčtov (sum; zoznam musí mať sum), " +
      "null ho zruší; column_widths = fit | auto | šírky stĺpcov v px (56 až 800). " +
      "Stĺpce zo vzťahov IFC súboru: space_referenced (IfcRelReferencedInSpatialStructure), space_boundary (IfcRelSpaceBoundary), " +
      "aggregate (IfcRelAggregates); 'space' je Container (priestor, v ktorom prvok je v súbore), nie odvodená miestnosť. " +
      "ODVODENÉ väzby z DB (z geometrie, D-167): space_derived (miestnosť, ktorú prvok referencuje, napr. výustka VZT) a space_boundary_derived; " +
      "bunky sú odvodené, nie zo súboru - tak to povedz. Ak viewer stĺpec nevie, odpoveď to povie (derived_columns_dropped).",
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
        add_columns: { type: "array", items: { type: "string" }, description: "update: stĺpce na pridanie (ako columns)" },
        remove_columns: { type: "array", items: { type: "string" }, description: "update: stĺpce na odobratie" },
        add_types: { type: "array", items: { type: "string" }, description: "update: IFC triedy na pridanie (IfcBeam...)" },
        remove_types: { type: "array", items: { type: "string" }, description: "update: IFC triedy na odobratie" },
        remove_filter: {
          type: "array",
          items: { type: "string", enum: REMOVE_FILTER_KEYS },
          description: "update: odobrať filtre tohto druhu; all = všetky okrem tried",
        },
        color_by: { type: "string", description: "Farby prvkov v 3D podľa hodnoty stĺpca (ako v columns); prázdny reťazec zruší" },
        export: { type: "string", enum: [...LIST_EXPORT_FORMATS], description: "Ponúknuť stiahnutie v tomto formáte (klik používateľa)" },
        visible_only: {
          type: "boolean",
          description: "false = tabuľka ukáže všetky riadky aj pri izolácii v 3D, true = len riadky viditeľné v 3D (default pri novom zozname: vypnuté pri izolácii)",
        },
        column_widths: {
          anyOf: [
            { type: "string", enum: ["fit", "auto"] },
            {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string", description: "Stĺpec ako v columns" },
                  width: { anyOf: [{ type: "number" }, { type: "string", enum: ["fit", "auto"] }], description: `px ${LIST_MIN_COLUMN_WIDTH} až ${LIST_MAX_COLUMN_WIDTH}, fit = podľa obsahu, auto = predvolená` },
                },
                required: ["column", "width"],
              },
            },
          ],
          description: "Šírky stĺpcov: fit (všetky podľa obsahu), auto (predvolené), alebo pole {column, width} po jednom",
        },
        highlight: {
          type: ["object", "null"],
          description: "Zvýraznenie v tabuľke; null (alebo prázdny reťazec) ho zruší. Časti sa kombinujú.",
          properties: {
            rows: {
              type: "object",
              properties: { column: { type: "string" }, values: { type: "array", items: { type: ["string", "number"] } } },
              description: `Riadky, kde bunka v stĺpci column sa rovná niektorej z values (1 až ${LIST_MAX_HIGHLIGHT_ITEMS})`,
            },
            columns: { type: "array", items: { type: "string" }, description: "Stĺpce na zvýraznenie (najviac 8)" },
            cells: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  row: { type: "object", properties: { column: { type: "string" }, value: { type: ["string", "number"] } } },
                },
              },
              description: `Bunky: stĺpec column v riadku, kde row.column = row.value (najviac ${LIST_MAX_HIGHLIGHT_ITEMS})`,
            },
            sum: { anyOf: [{ type: "boolean" }, { type: "array", items: { type: "string" } }], description: "true = riadok súčtov, alebo len súčty týchto stĺpcov" },
          },
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
  const view = parseListViewInput(input);
  if (input.action === "update") return execListUpdate(input, view, push);
  const editKey = EDIT_KEYS.find((k) => input[k] !== undefined);
  if (editKey) throw new StyleInputError(`${editKey} platí len s action=update (úprava otvoreného zoznamu).`);
  if (input.action !== undefined && input.action !== "open") throw new StyleInputError("action je open alebo update.");
  const rawColumns = Array.isArray(input.columns) ? input.columns.map((c) => String(c)).filter((c) => c.trim()) : [];
  if (rawColumns.length > MAX_COLUMNS) throw new StyleInputError(`Najviac ${MAX_COLUMNS} stĺpcov.`);
  const asked = (rawColumns.length ? rawColumns : DEFAULT_COLUMNS).map(parseListColumn);
  const { columns: sentColumns, dropped } = splitHostColumns(asked);
  const columns = sentColumns.length > 0 ? sentColumns : DEFAULT_COLUMNS.map(parseListColumn);
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
    ...columnNotes(rawColumns),
    ...hostColumnNotes(columns, dropped),
    run,
    ...(view ? { view: viewSummary(view) } : {}),
    next_step: run
      ? "Panel Lists sa otvára a tabuľka sa spúšťa: či beží, povie potvrdenie viewera (state.list) nižšie. Export (CSV, XLSX, PDF) robí používateľ."
      : "Vo vieweri sa otvoril panel Lists so zoznamom v builderi: používateľ stlačí Run a potom Export (CSV, XLSX, PDF).",
  };
}

/** `space` / `miestnost` je Container (priestor zo súboru): povedz to, nech Claude nehlási odvodenú miestnosť (#277). */
const CONTAINER_WORDS = new Set(["space", "miestnost", "container"]);
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function columnNotes(raw: unknown): Record<string, unknown> {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.some((c) => CONTAINER_WORDS.has(fold(String(c))))) return {};
  return {
    note:
      "Stĺpec space / miestnost / container je Container: priestor, v ktorom prvok leží podľa IFC súboru. " +
      "Priestor, ktorý prvok referencuje alebo ohraničuje, dajú stĺpce space_referenced a space_boundary.",
  };
}

const listUrl = (wire: Parameters<typeof listOp>[0]) => `/ifc?ops=${encodeURIComponent(listOp(wire))}&r=${Date.now().toString(36)}`;

const FILTER_KEYS = Object.keys(filterProps);
const MAX_VIEW_COLUMNS = 8;

function columnList(raw: unknown, key: string): ListColumnWire[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new StyleInputError(`${key} je pole stĺpcov (napr. ["Qto_ColumnBaseQuantities.NetVolume"]).`);
  if (raw.length > MAX_VIEW_COLUMNS) throw new StyleInputError(`${key}: najviac ${MAX_VIEW_COLUMNS} stĺpcov.`);
  return raw.map((c) => assertHostColumnUsable(parseListColumn(String(c)), key));
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
    v.o = col ? { c: assertHostColumnUsable(parseListColumn(col), "sort_by"), d: input.sort_dir === "desc" ? "desc" : "asc" } : null;
  }
  const sum = columnList(input.sum, "sum");
  if (sum) v.sum = sum;
  const gb = columnList(input.group_by, "group_by");
  if (gb) v.gb = gb;
  if (input.search !== undefined) v.q = String(input.search).slice(0, 200);
  if (input.color_by !== undefined) {
    const col = String(input.color_by).trim();
    v.cb = col ? parseListColumn(col) : null;
    if (v.cb?.s === "spatial" || v.cb?.s === "host") {
      throw new StyleInputError(`Podľa stĺpca '${col}' Lens farbiť nevie (podlažie, priestor); vyber vlastnosť, atribút, materiál alebo model.`);
    }
  }
  if (input.export !== undefined) {
    if (!(LIST_EXPORT_FORMATS as readonly unknown[]).includes(input.export)) throw new StyleInputError("export je csv, xlsx alebo pdf.");
    v.x = input.export as ListExportFormat;
  }
  if (input.visible_only !== undefined) {
    if (typeof input.visible_only !== "boolean") throw new StyleInputError("visible_only je true alebo false.");
    v.vo = input.visible_only;
  }
  if (input.column_widths !== undefined) v.cw = parseColumnWidths(input.column_widths);
  if (input.highlight !== undefined) v.hl = parseHighlight(input.highlight);
  return Object.keys(v).length ? v : undefined;
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function requiredColumn(raw: unknown, where: string): ListColumnWire {
  if (typeof raw !== "string" || !raw.trim()) throw new StyleInputError(`${where}: stĺpec ako v columns (napr. "Name" alebo "Qto_X.NetVolume").`);
  return assertHostColumnUsable(parseListColumn(raw), where);
}

function parseColumnWidths(raw: unknown): NonNullable<ListViewWire["cw"]> {
  if (raw === "fit" || raw === "auto") return raw;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIST_MAX_WIDTH_COLUMNS) {
    throw new StyleInputError(`column_widths je fit, auto alebo neprázdne pole {column, width} (najviac ${LIST_MAX_WIDTH_COLUMNS}).`);
  }
  return raw.map((item, i) => {
    if (!isObject(item)) throw new StyleInputError(`column_widths[${i}] je {column, width}.`);
    const w = item.width;
    const ok = w === "fit" || w === "auto" || (typeof w === "number" && Number.isFinite(w) && w >= LIST_MIN_COLUMN_WIDTH && w <= LIST_MAX_COLUMN_WIDTH);
    if (!ok) throw new StyleInputError(`column_widths[${i}].width je ${LIST_MIN_COLUMN_WIDTH} až ${LIST_MAX_COLUMN_WIDTH} (px), fit alebo auto.`);
    return { c: requiredColumn(item.column, `column_widths[${i}].column`), w: w as ListColumnWidth };
  });
}

function cellValue(raw: unknown, where: string): ListCellValue {
  if ((typeof raw === "string" && raw.length <= 200) || (typeof raw === "number" && Number.isFinite(raw))) return raw;
  throw new StyleInputError(`${where}: hodnota je text (do 200 znakov) alebo číslo.`);
}

/** `highlight` -> `ListHighlightWire`; null alebo prázdny reťazec zruší zvýraznenie. */
function parseHighlight(raw: unknown): ListHighlightWire | null {
  if (raw === null || raw === "") return null;
  if (!isObject(raw)) throw new StyleInputError("highlight je objekt {rows, columns, cells, sum}, alebo null na zrušenie.");
  const known = ["rows", "columns", "cells", "sum"];
  const unknown = Object.keys(raw).filter((k) => !known.includes(k));
  if (unknown.length) throw new StyleInputError(`highlight: neznáme pole ${unknown.join(", ")} (rows, columns, cells, sum).`);
  const h: ListHighlightWire = {};
  if (raw.rows !== undefined) {
    const rows = raw.rows;
    if (!isObject(rows) || !Array.isArray(rows.values) || rows.values.length === 0 || rows.values.length > LIST_MAX_HIGHLIGHT_ITEMS) {
      throw new StyleInputError(`highlight.rows je {column, values} s 1 až ${LIST_MAX_HIGHLIGHT_ITEMS} hodnotami.`);
    }
    h.r = { c: requiredColumn(rows.column, "highlight.rows.column"), v: rows.values.map((x) => cellValue(x, "highlight.rows.values")) };
  }
  if (raw.columns !== undefined) {
    if (!Array.isArray(raw.columns) || raw.columns.length === 0 || raw.columns.length > MAX_VIEW_COLUMNS) {
      throw new StyleInputError(`highlight.columns je pole 1 až ${MAX_VIEW_COLUMNS} stĺpcov.`);
    }
    h.c = raw.columns.map((c) => requiredColumn(c, "highlight.columns"));
  }
  if (raw.cells !== undefined) {
    if (!Array.isArray(raw.cells) || raw.cells.length === 0 || raw.cells.length > LIST_MAX_HIGHLIGHT_ITEMS) {
      throw new StyleInputError(`highlight.cells je pole 1 až ${LIST_MAX_HIGHLIGHT_ITEMS} buniek {column, row: {column, value}}.`);
    }
    h.x = raw.cells.map((cell) => {
      if (!isObject(cell) || !isObject(cell.row)) throw new StyleInputError("highlight.cells: {column, row: {column, value}}.");
      return {
        c: requiredColumn(cell.column, "highlight.cells.column"),
        r: { c: requiredColumn(cell.row.column, "highlight.cells.row.column"), v: cellValue(cell.row.value, "highlight.cells.row.value") },
      };
    });
  }
  if (raw.sum !== undefined && raw.sum !== false) {
    if (raw.sum === true) h.s = true;
    else if (Array.isArray(raw.sum) && raw.sum.length > 0 && raw.sum.length <= MAX_VIEW_COLUMNS) h.s = raw.sum.map((c) => requiredColumn(c, "highlight.sum"));
    else throw new StyleInputError(`highlight.sum je true alebo pole 1 až ${MAX_VIEW_COLUMNS} stĺpcov.`);
  }
  if (Object.keys(h).length === 0) throw new StyleInputError("highlight je prázdny: zadaj rows, columns, cells alebo sum, alebo null na zrušenie.");
  return h;
}

const colName = (c: ListColumnWire) => (c.p ? `${c.p}.${c.k}` : c.k || c.s);

function viewSummary(v: ListViewWire): Record<string, unknown> {
  return {
    ...(v.m !== undefined ? { maximize: v.m } : {}),
    ...(v.o !== undefined ? { sort: v.o ? `${colName(v.o.c)} ${v.o.d}` : null } : {}),
    ...(v.sum ? { sum: v.sum.map(colName) } : {}),
    ...(v.gb ? { group_by: v.gb.map(colName) } : {}),
    ...(v.q !== undefined ? { search: v.q } : {}),
    ...(v.cb !== undefined ? { color_by: v.cb ? colName(v.cb) : null } : {}),
    ...(v.x ? { export: v.x } : {}),
    ...(v.vo !== undefined ? { visible_only: v.vo } : {}),
    ...(v.cw !== undefined
      ? { column_widths: v.cw === "fit" || v.cw === "auto" ? v.cw : v.cw.map((w) => ({ column: colName(w.c), width: w.w })) }
      : {}),
    ...(v.hl !== undefined ? { highlight: v.hl ? highlightSummary(v.hl) : null } : {}),
  };
}

function highlightSummary(h: ListHighlightWire): Record<string, unknown> {
  return {
    ...(h.r ? { rows: { column: colName(h.r.c), values: h.r.v.length } } : {}),
    ...(h.c ? { columns: h.c.map(colName) } : {}),
    ...(h.x ? { cells: h.x.length } : {}),
    ...(h.s !== undefined ? { sum: h.s === true ? true : h.s.map(colName) } : {}),
  };
}

function typeList(raw: unknown, key: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) throw new StyleInputError(`${key} je neprázdne pole IFC tried (napr. ["IfcBeam"]).`);
  const out = raw.map(sanitizeIfcType);
  const bad = out.filter((t) => !/^Ifc[A-Za-z0-9]+$/i.test(t));
  if (bad.length || out.length > 16) throw new StyleInputError(`${key}: IFC triedy v tvare IfcBeam, IfcWall (najviac 16).`);
  return out;
}

/** `add_columns`, `remove_columns`, `add_types`, `remove_types`, `remove_filter` -> `ListEditWire`; nič = undefined. */
export function parseListEditInput(input: Record<string, unknown>): ListEditWire | undefined {
  const e: ListEditWire = {};
  for (const [key, field] of [["add_columns", "ac"], ["remove_columns", "rc"]] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.length === 0) throw new StyleInputError(`${key} je neprázdne pole stĺpcov.`);
    if (raw.length > 16) throw new StyleInputError(`${key}: najviac 16 stĺpcov.`);
    e[field] = raw.map((c) => parseListColumn(String(c)));
  }
  const at = typeList(input.add_types, "add_types");
  if (at) e.at = at;
  const rt = typeList(input.remove_types, "remove_types");
  if (rt) e.rt = rt;
  if (input.remove_filter !== undefined) {
    const raw = Array.isArray(input.remove_filter) ? input.remove_filter : [input.remove_filter];
    const kinds = raw.map((k) => REMOVE_FILTER_KINDS[String(k)]);
    if (raw.length === 0 || kinds.some((k) => !k)) {
      throw new StyleInputError(`remove_filter: ${REMOVE_FILTER_KEYS.join(", ")} (triedy odober cez remove_types).`);
    }
    e.rf = [...new Set(kinds)];
  }
  return Object.keys(e).length ? e : undefined;
}

/** Bez podpory viewera host stĺpce z `add_columns` a `remove_columns` vypadnú (nie je čo pridať ani odobrať). */
function dropHostEdit(e: ListEditWire, addColumns: ListColumnWire[]): ListEditWire | undefined {
  const out: ListEditWire = { ...e };
  delete out.ac;
  delete out.rc;
  if (addColumns.length > 0) out.ac = addColumns;
  const removed = e.rc ? splitHostColumns(e.rc).columns : [];
  if (removed.length > 0) out.rc = removed;
  return Object.keys(out).length ? out : undefined;
}

function editSummary(e: ListEditWire): Record<string, unknown> {
  return {
    ...(e.ac ? { add_columns: e.ac.map(colName) } : {}),
    ...(e.rc ? { remove_columns: e.rc.map(colName) } : {}),
    ...(e.at ? { add_types: e.at } : {}),
    ...(e.rt ? { remove_types: e.rt } : {}),
    ...(e.rf ? { remove_filter: e.rf } : {}),
  };
}

/** `action=update` (D-149): úprava otvoreného zoznamu, filtre pribudnú cez AND. */
async function execListUpdate(
  input: Record<string, unknown>,
  view: ListViewWire | undefined,
  push: (a: AskAction) => void,
): Promise<Record<string, unknown>> {
  if (input.columns !== undefined) {
    throw new StyleInputError("Pri update stĺpce meň cez add_columns / remove_columns, columns platí len pre nový zoznam.");
  }
  const rawEdit = parseListEditInput(input);
  const hostAdd = rawEdit?.ac ? splitHostColumns(rawEdit.ac) : { columns: [], dropped: [] };
  const edit = rawEdit ? dropHostEdit(rawEdit, hostAdd.columns) : undefined;
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
  if (!hasFilter && !view && !edit) {
    throw new StyleInputError(
      "action=update potrebuje filter (storey, property/value...), add/remove_columns, add/remove_types, remove_filter " +
        "alebo maximize, sort_by, sum, group_by, search, color_by, export, visible_only, column_widths, highlight.",
    );
  }
  push({
    type: "navigate",
    url: listUrl({ n: "", g: groups, c: [], u: 1, ...(view ? { v: view } : {}), ...(edit ? { e: edit } : {}) }),
    label: "3D: úprava zoznamu",
  });
  return {
    ok: true,
    updated: "lists",
    ...(info ? { added_filter: info } : {}),
    ...(edit ? { edit: editSummary(edit) } : {}),
    ...columnNotes(input.add_columns),
    ...hostColumnNotes(hostAdd.columns, hostAdd.dropped),
    ...(view ? { view: viewSummary(view) } : {}),
    next_step: [
      hasFilter || edit
        ? "Zoznam sa upravil a tabuľka sa spúšťa znova (podlažie a model nahradia doterajšie); stav (stĺpce, filtre, riadky, súčty) je v potvrdení viewera (state.list), problémy v ňom povedz."
        : "Zoznam sa upravuje; stav (zoradenie, súčty, farby, maximalizácia) je v potvrdení viewera (state.list).",
      ...(view?.x
        ? [`Stiahnutie ${view.x.toUpperCase()} nespustíš: vo vieweri je zvýraznené tlačidlo Stiahnuť, používateľ naň klikne.`]
        : []),
    ].join(" "),
  };
}
