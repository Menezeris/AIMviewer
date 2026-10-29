import type { ListColumnWire } from "../viewer-list";

import { StyleInputError } from "./style-plan";

/**
 * Host stĺpce `open_list` (D-174, #277): odvodené väzby z DB (`v_space_elements`, D-167) ako stĺpec
 * `source: "host"`. Viewer ich vie zobraziť až po fork PR so stĺpcom `host`; do vtedy by starší viewer
 * celú správu `OPEN_LIST` odmietol (neznámy zdroj stĺpca), preto je podpora za príznakom
 * `AIM_VIEWER_HOST_COLUMNS=1`. Bez príznaku host stĺpce z volania vypadnú a odpoveď to povie.
 */

export const hostColumnsEnabled = (): boolean => process.env.AIM_VIEWER_HOST_COLUMNS === "1";

export const isHostColumn = (c: ListColumnWire): boolean => c.s === "host";

const colName = (c: ListColumnWire) => c.l ?? c.k;

/** Stĺpce na odoslanie; bez podpory viewera host stĺpce vypadnú. */
export function splitHostColumns(columns: ListColumnWire[]): { columns: ListColumnWire[]; dropped: ListColumnWire[] } {
  if (hostColumnsEnabled()) return { columns, dropped: [] };
  return { columns: columns.filter((c) => !isHostColumn(c)), dropped: columns.filter(isHostColumn) };
}

/** Host stĺpec v zoradení, súčte, zoskupení, zvýraznení či šírke: bez podpory viewera ho tam tool neprijme. */
export function assertHostColumnUsable(c: ListColumnWire, where: string): ListColumnWire {
  if (c.s === "host" && !hostColumnsEnabled()) {
    throw new StyleInputError(`${where}: stĺpec '${colName(c)}' viewer zatiaľ nevie (odvodené väzby z DB sa v zozname zobrazia, až keď viewer podporí stĺpec source host). Odpoveď daj z query_view v_space_elements.`);
  }
  return c;
}

/** Odpoveď toolu o host stĺpcoch: čo sa poslalo, alebo čo vypadlo a prečo. */
export function hostColumnNotes(sent: ListColumnWire[], dropped: ListColumnWire[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const host = sent.filter(isHostColumn);
  if (host.length > 0) {
    out.derived_columns = {
      columns: host.map(colName),
      note:
        "Stĺpce sú ODVODENÉ z databázy AIM (v_space_elements, väzby počítané z geometrie, D-167), nie zo súboru IFC; " +
        "volaj ich tak, že sú odvodené. Hodnota je kód alebo názov priestoru, viac priestorov oddelených ', '.",
    };
  }
  if (dropped.length > 0) {
    out.derived_columns_dropped = {
      columns: dropped.map(colName),
      note:
        "Viewer zatiaľ nevie stĺpec source host, preto zoznam otvorený BEZ týchto stĺpcov (D-174). " +
        "Odvodené väzby z DB dá query_view v_space_elements; stĺpce zo súboru IFC dá space_referenced / space_boundary. Povedz to používateľovi.",
    };
  }
  return out;
}
