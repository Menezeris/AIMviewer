import "server-only";

import { unstable_cache } from "next/cache";

import { AIM_CACHE } from "@/lib/data/constants";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  DERIVED_RELATIONS_CAP,
  type DerivationRuleWire,
  type DerivationsLayerWire,
  type DerivedRelationWire,
} from "@/lib/derivations";

/**
 * Vrstva AIM nad modelmi (D-089): register pravidiel odvodení so stavom a odvodené vzťahy
 * vybraného prvku. Bez migrácie `20261018140000` (tabuľka chýba) vráti null / prázdne pole,
 * aby viewer bežal ďalej bez vrstvy.
 */

/** Kde sa pravidlá spravujú, kým zápis z viewera nie je (fáza 3, D-086). */
const DEFAULT_MANAGE_URL = "https://github.com/Menezeris/OCB/actions/workflows/odvodenie.yml";

interface RuleRow {
  id: string;
  name: string;
  kind: "geometry" | "via_space";
  source: string | null;
  target_classes: string[];
  roles: string[];
  enabled: boolean;
  mode: "auto" | "manual";
}

const RULE_COLUMNS = "id, name, kind, source, target_classes, roles, enabled, mode";

async function fetchRules(): Promise<RuleRow[] | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("derivation_rules")
    .select(RULE_COLUMNS)
    .order("id");
  return error || !data ? null : (data as RuleRow[]);
}

async function fetchDerivationLayerImpl(): Promise<DerivationsLayerWire | null> {
  const supabase = getSupabaseAdmin();
  const rules = await fetchRules();
  if (!rules) return null;

  const [runsRes, revRes, counts] = await Promise.all([
    supabase
      .from("derivation_runs")
      .select("rule_id, status, written, closed, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(200),
    supabase.from("model_revisions").select("model, revision").eq("is_current", true),
    Promise.all(
      rules.map(async (r) => {
        const q =
          r.kind === "via_space"
            ? supabase.from("v_zone_elements").select("element_id", { count: "exact", head: true })
            : supabase
                .from("relationships")
                .select("id", { count: "exact", head: true })
                .eq("source", r.source ?? "")
                .is("valid_until", null);
        const { count } = await q;
        return count ?? 0;
      })
    ),
  ]);

  const lastByRule = new Map<string, DerivationRuleWire["lastRun"]>();
  for (const run of (runsRes.data ?? []) as {
    rule_id: string;
    status: string;
    written: number;
    closed: number;
    started_at: string;
    finished_at: string | null;
  }[]) {
    if (!lastByRule.has(run.rule_id)) {
      lastByRule.set(run.rule_id, {
        at: run.finished_at ?? run.started_at,
        status: run.status,
        written: run.written,
        closed: run.closed,
      });
    }
  }

  return {
    version: 1,
    rules: rules.map((r, i) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      enabled: r.enabled,
      mode: r.mode,
      targetClasses: r.target_classes,
      roles: r.roles,
      count: counts[i],
      lastRun: lastByRule.get(r.id) ?? null,
    })),
    models: ((revRes.data ?? []) as { model: string; revision: number }[]).sort((a, b) =>
      a.model.localeCompare(b.model)
    ),
    manageUrl: process.env.DERIVATIONS_MANAGE_URL || DEFAULT_MANAGE_URL,
  };
}

/** Stav vrstvy pre záložku AIM vo vieweri (ISR 60 s, tag `aim`, D-030). */
export const fetchDerivationLayer = unstable_cache(
  fetchDerivationLayerImpl,
  ["derivation-layer"],
  AIM_CACHE
);

interface OtherObject {
  id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefined_type: string | null;
}

/**
 * Odvodené vzťahy objektu v oboch smeroch: hrany zapnutých geometrických pravidiel
 * (`rel_referenced_in_spatial_structure` so zdrojom pravidla) a riadky `v_zone_elements`
 * (prvok v IfcZone cez priestory). Na smer najviac `DERIVED_RELATIONS_CAP` riadkov.
 */
export async function fetchDerivedRelations(
  objectId: string
): Promise<{ relations: DerivedRelationWire[]; total: number }> {
  const supabase = getSupabaseAdmin();
  const rules = (await fetchRules())?.filter((r) => r.enabled) ?? [];
  if (rules.length === 0) return { relations: [], total: 0 };

  const bySource = new Map(rules.filter((r) => r.source).map((r) => [r.source as string, r]));
  const zoneRule = rules.find((r) => r.kind === "via_space");

  const [edgeRes, zoneRes] = await Promise.all([
    bySource.size > 0
      ? supabase
          .from("rel_referenced_in_spatial_structure")
          .select("from_id, to_id, role, source")
          .or(`from_id.eq.${objectId},to_id.eq.${objectId}`)
          .in("source", [...bySource.keys()])
          .is("valid_until", null)
          .limit(DERIVED_RELATIONS_CAP * 2)
      : Promise.resolve({ data: [], error: null }),
    zoneRule
      ? supabase
          .from("v_zone_elements")
          .select("zone_id, element_id, via_space_ref, relation, role")
          .or(`element_id.eq.${objectId},zone_id.eq.${objectId}`)
          .limit(DERIVED_RELATIONS_CAP * 2)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type Draft = Omit<DerivedRelationWire, "other"> & { otherId: string };
  const drafts: Draft[] = [];
  for (const e of (edgeRes.data ?? []) as {
    from_id: string;
    to_id: string;
    role: string | null;
    source: string;
  }[]) {
    const rule = bySource.get(e.source);
    if (!rule) continue;
    const outgoing = e.from_id === objectId;
    drafts.push({
      ruleId: rule.id,
      ruleName: rule.name,
      ifcRelation: "IfcRelReferencedInSpatialStructure",
      direction: outgoing ? "outgoing" : "incoming",
      role: e.role,
      otherId: outgoing ? e.to_id : e.from_id,
    });
  }
  for (const z of (zoneRes.data ?? []) as {
    zone_id: string;
    element_id: string;
    via_space_ref: string | null;
    relation: string;
    role: string | null;
  }[]) {
    const outgoing = z.element_id === objectId;
    drafts.push({
      ruleId: zoneRule!.id,
      ruleName: zoneRule!.name,
      ifcRelation: null,
      direction: outgoing ? "outgoing" : "incoming",
      role: z.role ?? z.relation,
      otherId: outgoing ? z.zone_id : z.element_id,
      viaSpaceRef: z.via_space_ref,
    });
  }

  const total = drafts.length;
  const kept = [
    ...drafts.filter((d) => d.direction === "outgoing").slice(0, DERIVED_RELATIONS_CAP),
    ...drafts.filter((d) => d.direction === "incoming").slice(0, DERIVED_RELATIONS_CAP),
  ];
  const ids = [...new Set(kept.map((d) => d.otherId))];
  const others = new Map<string, OtherObject>();
  if (ids.length > 0) {
    const { data } = await supabase
      .from("objects")
      .select("id, object_ref, name, ifc_type, ifc_guid, predefined_type")
      .in("id", ids);
    for (const o of (data ?? []) as OtherObject[]) others.set(o.id, o);
  }

  const relations = kept.flatMap(({ otherId, ...d }) => {
    const o = others.get(otherId);
    if (!o) return [];
    return [
      {
        ...d,
        other: {
          objectId: o.id,
          guid: o.ifc_guid,
          ref: o.object_ref,
          name: o.name,
          ifcType: o.ifc_type,
          predefinedType: o.predefined_type && o.predefined_type !== "NOTDEFINED" ? o.predefined_type : null,
        },
      },
    ];
  });
  return { relations, total };
}
