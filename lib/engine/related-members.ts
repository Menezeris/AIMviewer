import "server-only";

import { fetchAllPages } from "../data/pagination";
import { getSupabaseAdmin } from "../supabase/server";

import type { RelatedGroup } from "./search-all";

/**
 * Členovia zón, skupín a aktérov z grafu AIM pre `search_all related` (D-126,
 * #174): "prenajímateľné priestory" nájde zónu a cez `rel_assigns_to_group`
 * jej priestory. Systémy sa nerozbaľujú (stovky prvkov, na to je ifc_relations).
 */

const GROUP_TYPES = ["zone", "spatial_zone", "group"];
const ACTOR_TYPES = ["person", "organization"];
/** Koľko členov na skupinu sa vypíše (počet je vždy úplný). */
export const MEMBERS_PER_GROUP = 50;
const IN_CHUNK = 100;

interface Node {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
}

async function nodes(ids: string[], types: string[] | null): Promise<Node[]> {
  const supabase = getSupabaseAdmin();
  const out: Node[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    let q = supabase
      .from("objects")
      .select("id, object_type, object_ref, name, ifc_type")
      .in("id", ids.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (types) q = q.in("object_type", types);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Node[]));
  }
  return out;
}

async function edges(view: string, matchCol: "from_id" | "to_id", ids: string[]) {
  const supabase = getSupabaseAdmin();
  return fetchAllPages<{ from_id: string; to_id: string }>((from, to) =>
    supabase
      .from(view)
      .select("from_id, to_id")
      .in(matchCol, ids)
      .is("valid_until", null)
      .order("id")
      .range(from, to),
  );
}

export async function fetchRelatedMembers(ids: string[]): Promise<RelatedGroup[]> {
  const unique = [...new Set(ids)].slice(0, IN_CHUNK);
  if (unique.length === 0) return [];
  const hits = await nodes(unique, [...GROUP_TYPES, ...ACTOR_TYPES]);
  const groups = hits.filter((n) => GROUP_TYPES.includes(n.object_type));
  const actors = hits.filter((n) => ACTOR_TYPES.includes(n.object_type));
  if (groups.length === 0 && actors.length === 0) return [];

  const [groupEdges, actorEdges] = await Promise.all([
    groups.length > 0 ? edges("rel_assigns_to_group", "to_id", groups.map((g) => g.id)) : [],
    actors.length > 0 ? edges("rel_assigns_to_actor", "from_id", actors.map((a) => a.id)) : [],
  ]);
  // Člen -> skupina (rel_assigns_to_group), aktér -> objekt (rel_assigns_to_actor).
  const members = new Map<string, string[]>();
  const add = (owner: string, member: string) => {
    const list = members.get(owner) ?? [];
    if (!list.includes(member)) list.push(member);
    members.set(owner, list);
  };
  for (const e of groupEdges) add(e.to_id, e.from_id);
  for (const e of actorEdges) add(e.from_id, e.to_id);

  const shown = [...members.values()].flatMap((l) => l.slice(0, MEMBERS_PER_GROUP));
  const detail = new Map((await nodes([...new Set(shown)], null)).map((n) => [n.id, n]));

  return [...groups, ...actors]
    .map((owner) => {
      const all = (members.get(owner.id) ?? []).filter((m) => detail.has(m) || !shown.includes(m));
      const listed = all.slice(0, MEMBERS_PER_GROUP).flatMap((m) => {
        const n = detail.get(m);
        return n ? [{ object_id: n.id, object_ref: n.object_ref, name: n.name, object_type: n.object_type, ifc_type: n.ifc_type }] : [];
      });
      return {
        via: GROUP_TYPES.includes(owner.object_type) ? ("rel_assigns_to_group" as const) : ("rel_assigns_to_actor" as const),
        node: { object_id: owner.id, object_ref: owner.object_ref, name: owner.name, object_type: owner.object_type },
        members_total: all.length,
        truncated: all.length > listed.length,
        members: listed,
      };
    })
    .filter((g) => g.members_total > 0);
}
