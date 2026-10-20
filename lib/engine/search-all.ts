import type { ToolDefinition } from "../llm/provider";

import { SEARCH_FIELDS } from "./search";

/**
 * Kombinované hľadanie `search_all` (D-095 dodatok, issue #66): jedno volanie
 * hľadá text naraz v IFC súbore (`ifc_search`) aj v grafe AIM v DB
 * (`search_everything`), výsledky spojí podľa uzla AIM (inak GlobalId) a každý
 * označí badge podľa toho, KDE sa text našiel: `IFC`, `AIM` alebo `IFC+AIM`.
 * Vstup `badges` filtruje, `counts` sú počty po badge pred filtrom. Bez
 * závislostí motora a DB (zdroje sa vstrekujú), aby to šlo testovať.
 */

export const BADGES = ["IFC", "AIM", "IFC+AIM"] as const;
/** Zdroj hľadania (D-115): all = oba, ifc = len súbor (bývalý `ifc_search`), aim = len graf AIM. */
export const SOURCES = ["all", "ifc", "aim"] as const;
export type Badge = (typeof BADGES)[number];

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
/** Koľko výsledkov sa berie z každého zdroja pred spojením. */
const PER_SOURCE = 100;
const MAX_RESULT_CHARS = 20_000;

export const SEARCH_ALL_TOOL: ToolDefinition = {
  name: "search_all",
  description:
    "Hľadanie podľa textu naraz v OBOCH zdrojoch: IFC súbor (atribúty Name, Description, ObjectType, Tag, " +
    "LongName, všetky psety a Qto aj z typu, klasifikácie, materiály, zóny, skupiny) a graf AIM v DB (názov, " +
    "object_ref, importované psety, dokumenty, osoby). Výsledky sú spojené podľa prvku a každý má badge, KDE sa " +
    "text našiel: IFC, AIM alebo IFC+AIM; object_ref null = prvok je len v súbore. Dôkaz je v evidence (pole a " +
    "hodnota). source=ifc = len IFC súbor (aj fields, fuzzy, offset na stránkovanie), source=aim = len graf AIM. " +
    "Kód prvku netreba hľadať, daj ho priamo ako cieľ toolu. V odpovedi uveď badge pri každom prvku.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Hľadaný text (slová, kód, hodnota; min 2 znaky)" },
      source: { type: "string", enum: [...SOURCES], description: "all (default) | ifc | aim" },
      badges: {
        type: "array",
        items: { type: "string", enum: [...BADGES] },
        description: "Voliteľne len tieto badge, napr. ['IFC'] = len to, čo graf AIM nenašiel",
      },
      ifc_types: {
        type: "array",
        items: { type: "string" },
        description: "Voliteľne IFC triedy vrátane podtried (napr. [IfcDoor]); filtruje obe časti",
      },
      model: { type: "string", description: "Voliteľne IFC model; obmedzí aj AIM časť na prvky z neho. Inak všetky" },
      limit: { type: "number", description: `Max výsledkov (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})` },
      fields: {
        type: "array",
        items: { type: "string", enum: [...SEARCH_FIELDS] },
        description: "IFC časť len v týchto poliach: attribute | property | quantity | type_property | classification | material",
      },
      fuzzy: { type: "boolean", description: "IFC časť: tolerovať preklepy (default true)" },
      offset: { type: "number", description: "source=ifc: posun pre stránkovanie (default 0)" },
    },
    required: ["text"],
  },
};

/** Položka z `ifc_search` (po prepojení na AIM cez GUID). */
export interface IfcSearchItem {
  model: string;
  global_id: string;
  ifc_type: string;
  name: string | null;
  match_kind: string;
  matched: unknown;
  object_id: string | null;
  object_ref: string | null;
  aim_url: string | null;
}

/** Riadok z RPC `search_everything`. */
export interface AimSearchRow {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type?: string | null;
  match_kind: string;
  headline: string | null;
  matched_properties: unknown;
}

export interface SearchAllItem {
  badge: Badge;
  name: string | null;
  ifc_type: string | null;
  object_type: string | null;
  object_ref: string | null;
  object_id: string | null;
  global_id: string | null;
  model: string | null;
  aim_url: string | null;
  evidence: {
    ifc?: { match_kind: string; matched: unknown };
    aim?: { match_kind: string; headline: string | null; matched_properties: unknown };
  };
}

const aimRoute = (objectType: string): string =>
  objectType === "asset_type" ? "type" : objectType === "document" ? "drawing" : "node";

/**
 * Spojí výsledky oboch zdrojov. Kľúč = objects.id (IFC prvok ho má, ak ho AIM
 * pozná), inak GlobalId. Poradie: najprv IFC+AIM, potom podľa najlepšieho
 * poradia v niektorom zo zdrojov (skóre zdrojov nie sú porovnateľné).
 */
export function combineResults(ifc: IfcSearchItem[], aim: AimSearchRow[]): SearchAllItem[] {
  const byKey = new Map<string, { item: SearchAllItem; rank: number }>();
  ifc.forEach((h, i) => {
    const key = h.object_id ?? `guid:${h.global_id}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      rank: i,
      item: {
        badge: "IFC",
        name: h.name,
        ifc_type: h.ifc_type,
        object_type: null,
        object_ref: h.object_ref,
        object_id: h.object_id,
        global_id: h.global_id,
        model: h.model,
        aim_url: h.aim_url,
        evidence: { ifc: { match_kind: h.match_kind, matched: h.matched } },
      },
    });
  });
  aim.forEach((r, i) => {
    const aimEvidence = { match_kind: r.match_kind, headline: r.headline, matched_properties: r.matched_properties };
    const hit = byKey.get(r.id);
    if (hit) {
      hit.item.badge = "IFC+AIM";
      hit.item.object_type = r.object_type;
      hit.item.evidence.aim = aimEvidence;
      hit.rank = Math.min(hit.rank, i);
      return;
    }
    byKey.set(r.id, {
      rank: i,
      item: {
        badge: "AIM",
        name: r.name,
        ifc_type: r.ifc_type ?? null,
        object_type: r.object_type,
        object_ref: r.object_ref,
        object_id: r.id,
        global_id: null,
        model: null,
        aim_url: `/${aimRoute(r.object_type)}/${r.id}`,
        evidence: { aim: aimEvidence },
      },
    });
  });
  return [...byKey.values()]
    .sort((a, b) => Number(b.item.badge === "IFC+AIM") - Number(a.item.badge === "IFC+AIM") || a.rank - b.rank)
    .map((v) => v.item);
}

export interface SearchAllDeps {
  /** `ifc_search` (vracia `items`). */
  ifc: (input: Record<string, unknown>) => Promise<{ items: IfcSearchItem[] }>;
  /** `search_everything` (riadky alebo `{rows, hint}`). */
  aim: (input: Record<string, unknown>) => Promise<unknown>;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
}

/** Vykoná `search_all`; zlyhanie jedného zdroja vráti v `errors`, druhý ostane. */
export async function execSearchAll(
  input: Record<string, unknown>,
  deps: SearchAllDeps,
): Promise<{ content: string; isError: boolean }> {
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 200) : "";
  if (text.length < 2) return { content: "Chyba toolu: text musí mať aspoň 2 znaky.", isError: true };
  const badgesIn = strList(input.badges);
  const badBadge = badgesIn.filter((b) => !(BADGES as readonly string[]).includes(b));
  if (badBadge.length > 0) {
    return { content: `Chyba toolu: badges: ${BADGES.join(" | ")} (neznáme: ${badBadge.join(", ")}).`, isError: true };
  }
  const ifcTypes = strList(input.ifc_types);
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined;
  const rawLimit = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.floor(input.limit) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const source = typeof input.source === "string" && input.source ? input.source : "all";
  if (!(SOURCES as readonly string[]).includes(source)) {
    return { content: `Chyba toolu: source: ${SOURCES.join(" | ")}.`, isError: true };
  }
  // fields a fuzzy idú do IFC časti; offset len pri source=ifc (spojený výsledok sa nestránkuje).
  const ifcExtra = {
    ...(input.fields !== undefined ? { fields: input.fields } : {}),
    ...(input.fuzzy !== undefined ? { fuzzy: input.fuzzy } : {}),
    ...(ifcTypes.length > 0 ? { ifc_types: ifcTypes } : {}),
    ...(model ? { model } : {}),
  };
  try {
    if (source === "ifc") {
      const res = await deps.ifc({ text, limit, ...(input.offset !== undefined ? { offset: input.offset } : {}), ...ifcExtra });
      return { content: clip(JSON.stringify({ source: "IFC súbor", ...res })), isError: false };
    }
    if (source === "aim") {
      return { content: clip(JSON.stringify({ source: "graf AIM v DB", result: await deps.aim({ q: text, limit }) })), isError: false };
    }
  } catch (err) {
    return { content: `Chyba toolu: ${errText(err)}`, isError: true };
  }

  const errors: Record<string, string> = {};
  const [ifcRes, aimRes] = await Promise.allSettled([
    deps.ifc({ text, limit: PER_SOURCE, ...ifcExtra }),
    deps.aim({ q: text, limit: PER_SOURCE }),
  ]);
  let ifc: IfcSearchItem[] = [];
  if (ifcRes.status === "fulfilled") ifc = ifcRes.value.items;
  else errors.ifc = errText(ifcRes.reason);
  let aim: AimSearchRow[] = [];
  if (aimRes.status === "fulfilled") {
    const v = aimRes.value as AimSearchRow[] | { rows?: AimSearchRow[] };
    aim = Array.isArray(v) ? v : (v.rows ?? []);
  } else errors.aim = errText(aimRes.reason);
  if (ifcRes.status === "rejected" && aimRes.status === "rejected") {
    return { content: `Chyba toolu: IFC: ${errors.ifc}; AIM: ${errors.aim}`, isError: true };
  }

  // ifc_types platí aj pre AIM časť (uzly bez IFC triedy, napr. dokumenty, vypadnú).
  if (ifcTypes.length > 0) {
    const want = new Set(ifcTypes.map((t) => t.toLowerCase()));
    const ifcIds = new Set(ifc.map((h) => h.object_id).filter(Boolean));
    aim = aim.filter((r) => (r.ifc_type && want.has(r.ifc_type.toLowerCase())) || ifcIds.has(r.id));
  }
  if (model) {
    // AIM nevie, z ktorého modelu uzol je; ostanú len zhody, ktoré má aj IFC časť.
    const ifcIds = new Set(ifc.map((h) => h.object_id).filter(Boolean));
    aim = aim.filter((r) => ifcIds.has(r.id));
  }

  const all = combineResults(ifc, aim);
  const counts: Record<Badge, number> = { IFC: 0, AIM: 0, "IFC+AIM": 0 };
  for (const it of all) counts[it.badge]++;
  const filtered = badgesIn.length > 0 ? all.filter((it) => badgesIn.includes(it.badge)) : all;
  const items = filtered.slice(0, limit);
  const idsOrRefs = [...new Set(items.map((it) => it.object_id).filter((v): v is string => Boolean(v)))];
  const globalIds = [...new Set(items.filter((it) => !it.object_id && it.global_id).map((it) => it.global_id as string))];

  const result = {
    sources: { ifc: "IFC súbor", aim: "graf AIM v DB" },
    counts,
    ...(badgesIn.length > 0 ? { badges: badgesIn } : {}),
    total: filtered.length,
    returned: items.length,
    truncated: filtered.length > items.length,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
    items,
    ...(items.length > 0 ? { show_in_3d: { ids_or_refs: idsOrRefs, global_ids: globalIds } } : {}),
    ...(all.length === 0
      ? { hint: "Nič v IFC ani v AIM - skús synonymum, anglický výraz alebo kratší tvar slova." }
      : {}),
  };
  return { content: clip(JSON.stringify(result)), isError: false };
}

function clip(content: string): string {
  if (content.length <= MAX_RESULT_CHARS) return content;
  return content.slice(0, MAX_RESULT_CHARS) + `... [orezané, ${content.length} znakov - zúž dotaz, badges alebo limit]`;
}
