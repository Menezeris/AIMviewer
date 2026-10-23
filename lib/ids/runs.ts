import type { IdsResultWrite } from "./types";

/**
 * Riadky `ids_results` z reportu `ids_validate` (@ifc-lite/ids) pre záznam kontroly (D-162).
 * Rovnaká sémantika ako ETL `etl.ids_check`: riadok na každý použiteľný prvok (pass aj fail),
 * povinná špecifikácia bez použiteľného prvku = jeden riadok bez `ifc_guid`.
 */

export const NO_APPLICABLE = "Model neobsahuje žiadny prvok, na ktorý sa povinná špecifikácia vzťahuje.";

export interface ReportSpec {
  specification?: { id?: string; identifier?: string; name?: string; description?: string; instructions?: string };
  status?: string;
  applicableCount?: number;
  entityResults?: Array<{
    globalId?: string;
    entityType?: string;
    passed?: boolean;
    requirementResults?: Array<{ status?: string; failureReason?: string }>;
  }>;
}

export function resultRows(specs: ReportSpec[], objectIdOf: (guid: string) => string | null): IdsResultWrite[] {
  const rows: IdsResultWrite[] = [];
  for (const s of specs) {
    const sp = s.specification ?? {};
    const base = {
      spec_identifier: sp.identifier ?? null,
      spec_name: sp.name ?? sp.id ?? "",
      spec_description: sp.description ?? null,
      spec_instructions: sp.instructions ?? null,
    };
    const entities = s.entityResults ?? [];
    if (entities.length === 0) {
      if (s.status === "fail") rows.push({ ...base, object_id: null, ifc_guid: null, ifc_type: null, status: "fail", reasons: [NO_APPLICABLE] });
      continue;
    }
    for (const e of entities) {
      const reasons = (e.requirementResults ?? []).filter((r) => r.status === "fail").map((r) => r.failureReason ?? "").filter(Boolean);
      const failed = e.passed === false;
      rows.push({
        ...base,
        object_id: e.globalId ? objectIdOf(e.globalId) : null,
        ifc_guid: e.globalId ?? null,
        ifc_type: e.entityType ?? null,
        status: failed ? "fail" : "pass",
        reasons: failed ? reasons : [],
      });
    }
  }
  return rows;
}
