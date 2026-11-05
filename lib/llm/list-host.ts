import type { ListColumnWire } from "../viewer-list";

import { StyleInputError } from "./style-plan";

/**
 * Host columns of `open_list` (D-174, #277): derived links from the DB (`v_space_elements`, D-167) as a column
 * `source: "host"`. The viewer can display them only after the fork PR with the `host` column; until then an older viewer would
 * reject the whole `OPEN_LIST` message (unknown column source), so the support is behind the flag
 * `AIM_VIEWER_HOST_COLUMNS=1`. Without the flag the host columns drop out of the call and the answer says so.
 */

export const hostColumnsEnabled = (): boolean => process.env.AIM_VIEWER_HOST_COLUMNS === "1";

export const isHostColumn = (c: ListColumnWire): boolean => c.s === "host";

const colName = (c: ListColumnWire) => c.l ?? c.k;

/** Columns to send; without viewer support the host columns drop out. */
export function splitHostColumns(columns: ListColumnWire[]): { columns: ListColumnWire[]; dropped: ListColumnWire[] } {
  if (hostColumnsEnabled()) return { columns, dropped: [] };
  return { columns: columns.filter((c) => !isHostColumn(c)), dropped: columns.filter(isHostColumn) };
}

/** Host column in sort, sum, grouping, highlight or width: without viewer support the tool does not accept it there. */
export function assertHostColumnUsable(c: ListColumnWire, where: string): ListColumnWire {
  if (c.s === "host" && !hostColumnsEnabled()) {
    throw new StyleInputError(`${where}: stĺpec '${colName(c)}' viewer zatiaľ nevie (odvodené väzby z DB sa v zozname zobrazia, až keď viewer podporí stĺpec source host). Odpoveď daj z query_view v_space_elements.`);
  }
  return c;
}

/** Tool answer about host columns: what was sent, or what dropped out and why. */
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
