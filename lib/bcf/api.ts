import { randomUUID } from "node:crypto";

import type { BcfComment, BcfTopicRow, BcfTopicWrite, TopicStatus } from "./store";
import { isClaude, maybeStartSession, normalizeStatus, type BcfDeps } from "./tools";

/**
 * BCF API 2.1 nad `model_tasks` (D-099 fáza B): BCF panel viewera (fork,
 * `@ifc-lite/bcf-api`) sa pripojí tokenom a vidí, zakladá a komentuje tie
 * isté témy ako MCP tools. Jeden projekt = celá federácia (téma nemusí mať
 * model). Čistá funkcia nad požiadavkou - autentifikáciu a CORS robí route.
 */

export const BCF_VERSION = "2.1";
export const PROJECT_ID = "aim";
export const PROJECT_NAME = "AIM - modely federácie";

/** DB stav <-> BCF topic_status (Title Case ako v paneli a v iných nástrojoch). */
export const STATUS_TO_BCF: Record<TopicStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
  conflict: "Conflict",
  failed: "Failed",
};
const DEFAULT_TYPES = ["Issue", "Clash", "Request", "Remark"];
const DEFAULT_PRIORITIES = ["High", "Normal", "Low"];
const PROJECT_ACTIONS = ["createTopic"];
const TOPIC_ACTIONS = ["update", "updateRelatedTopics", "updateDocumentReferences", "createComment", "createViewpoint"];

export interface BcfApiRequest {
  method: string;
  /** Cesta za bázou API, napr. ["2.1", "projects", "aim", "topics"]. */
  segments: string[];
  query: URLSearchParams;
  body: unknown;
}

export interface BcfApiResponse {
  status: number;
  body: unknown;
}

export interface BcfApiContext {
  deps: BcfDeps;
  /** Používateľ tokenu (BCF current-user, autor zápisov). */
  user: string;
  /** Prihlásený? Bez tokenu sú len `/versions` a `/auth`. */
  authenticated: boolean;
}

const ok = (body: unknown, status = 200): BcfApiResponse => ({ status, body });
const err = (status: number, message: string): BcfApiResponse => ({ status, body: { message } });

type Vec = { x: number; y: number; z: number };
const isVec = (v: unknown): v is Vec =>
  !!v && typeof v === "object" && ["x", "y", "z"].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * Normála roviny rezu v BCF (IFC svet, Z hore) podľa osi viewera: x = IFC X,
 * y = IFC Z (výška), z = IFC Y; neotočený rez má normálu proti osi viewera,
 * prevod ako `sectionPlaneToClippingPlane` v `@ifc-lite/bcf`.
 */
const SECTION_NORMAL: Record<string, Vec> = {
  x: { x: -1, y: 0, z: 0 },
  y: { x: 0, y: 0, z: -1 },
  z: { x: 0, y: 1, z: 0 },
};

/** Náš pohľad z viewera (`view_state`) -> BCF viewpoint DTO. */
export function viewpointToDto(row: BcfTopicRow): Record<string, unknown> | null {
  const vp = row.viewpoint;
  if (!vp) return null;
  const guid = typeof vp.guid === "string" ? vp.guid : row.id;
  const selection = row.components.map((g) => ({ ifc_guid: g, originating_system: "AIM" }));
  const components = selection.length ? { selection } : undefined;
  // Pohľad založený panelom ostáva v tvare BCF; prvky sú v `components` témy.
  if (vp.source === "bcf" && vp.bcf && typeof vp.bcf === "object") {
    return { ...(vp.bcf as Record<string, unknown>), guid, ...(components ? { components } : {}) };
  }
  const dto: Record<string, unknown> = { guid };
  const cam = vp.camera as Record<string, unknown> | null | undefined;
  if (cam && isVec(cam.position) && isVec(cam.target)) {
    const base = {
      camera_view_point: cam.position,
      camera_direction: unit(sub(cam.target, cam.position)),
      camera_up_vector: isVec(cam.up) ? unit(cam.up) : { x: 0, y: 0, z: 1 },
      ...(Number.isFinite(cam.aspect) ? { aspect_ratio: cam.aspect } : {}),
    };
    if (cam.projection === "orthographic" && Number.isFinite(cam.ortho_size)) {
      // ortho_size je polovica výšky pohľadu, BCF chce celú výšku v metroch.
      dto.orthogonal_camera = { ...base, view_to_world_scale: (cam.ortho_size as number) * 2 };
    } else {
      dto.perspective_camera = { ...base, field_of_view: Number.isFinite(cam.fov_deg) ? cam.fov_deg : 60 };
    }
  }
  const sec = vp.section as Record<string, unknown> | null | undefined;
  if (sec && typeof sec.axis === "string" && SECTION_NORMAL[sec.axis] && Number.isFinite(sec.coordinate)) {
    const c = sec.coordinate as number;
    const n = SECTION_NORMAL[sec.axis];
    const t = cam && isVec(cam.target) ? cam.target : { x: 0, y: 0, z: 0 };
    const location = sec.axis === "x" ? { ...t, x: c } : sec.axis === "y" ? { ...t, z: c } : { ...t, y: c };
    const direction = sec.flipped === true ? { x: -n.x || 0, y: -n.y || 0, z: -n.z || 0 } : n;
    dto.clipping_planes = [{ location, direction }];
  }
  if (components) dto.components = components;
  return dto;
}

/** BCF viewpoint DTO z panela -> uložený pohľad a GlobalId výberu. */
export function viewpointFromDto(dto: Record<string, unknown>): { viewpoint: Record<string, unknown>; selection: string[] } {
  const comps = (dto.components ?? {}) as { selection?: { ifc_guid?: unknown }[] };
  const selection = [
    ...new Set(
      (comps.selection ?? []).map((c) => c?.ifc_guid).filter((g): g is string => typeof g === "string" && g !== ""),
    ),
  ];
  const rest: Record<string, unknown> = { ...dto };
  // Snímka zatiaľ nie je (D-099 fáza D); prvky idú do `components` témy.
  delete rest.snapshot;
  delete rest.components;
  delete rest.guid;
  const guid = typeof dto.guid === "string" && dto.guid ? dto.guid : randomUUID();
  return { viewpoint: { guid, source: "bcf", bcf: rest }, selection };
}

export function topicToDto(row: BcfTopicRow): Record<string, unknown> {
  return {
    guid: row.id,
    server_assigned_id: `#${row.number}`,
    index: row.number,
    title: row.title,
    description: row.description,
    topic_type: row.topic_type,
    topic_status: STATUS_TO_BCF[row.status] ?? row.status,
    priority: row.priority,
    labels: row.labels,
    assigned_to: row.assigned_to,
    stage: row.stage,
    due_date: row.due_date,
    creation_date: row.created_at,
    creation_author: row.author,
    modified_date: row.updated_at,
    modified_author: row.modified_by,
    reference_links: row.session_url ? [row.session_url] : [],
    authorization: { topic_actions: TOPIC_ACTIONS, topic_status: Object.values(STATUS_TO_BCF) },
  };
}

export function commentToDto(topic: BcfTopicRow, c: BcfComment): Record<string, unknown> {
  return { guid: c.guid, topic_guid: topic.id, date: c.date, author: c.author, comment: c.comment };
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

async function extensions(deps: BcfDeps): Promise<Record<string, unknown>> {
  const v = await deps.store.vocabulary();
  return {
    topic_type: union(DEFAULT_TYPES, v.topic_type),
    topic_status: Object.values(STATUS_TO_BCF),
    priority: union(DEFAULT_PRIORITIES, v.priority),
    stage: v.stage,
    // Bez zoznamu štítkov panel štítky nekontroluje (MCP ich píše voľne).
    user_id_type: union(["claude"], v.assigned_to),
    snippet_type: [],
    project_actions: PROJECT_ACTIONS,
    topic_actions: TOPIC_ACTIONS,
    comment_actions: [],
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function topicOr404(deps: BcfDeps, guid: string): Promise<BcfTopicRow | BcfApiResponse> {
  if (!UUID_RE.test(guid)) return err(404, `Téma ${guid} neexistuje.`);
  const row = await deps.store.get({ id: guid.toLowerCase() });
  return row ?? err(404, `Téma ${guid} neexistuje.`);
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/** BCF topic write DTO -> polia témy; PUT nahrádza, čo BCF zapisuje (chýbajúce = prázdne). */
function topicWrite(body: unknown, user: string): BcfTopicWrite & { title: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = str(b.title, 200);
  if (!title) throw new ApiInputError("Chýba title.");
  let status: TopicStatus | undefined;
  try {
    status = normalizeStatus(b.topic_status);
  } catch (e) {
    throw new ApiInputError(e instanceof Error ? e.message : String(e));
  }
  const due = str(b.due_date, 40);
  return {
    title,
    description: str(b.description, 8000),
    topic_type: str(b.topic_type, 60) ?? "Issue",
    status: status ?? "open",
    priority: str(b.priority, 60),
    assigned_to: str(b.assigned_to, 200),
    due_date: due ? due.slice(0, 10) : null,
    labels: Array.isArray(b.labels) ? [...new Set(b.labels.map((l) => str(l, 60)).filter((l): l is string => !!l))] : [],
    modified_by: user,
  };
}

class ApiInputError extends Error {}

async function startIfClaude(row: BcfTopicRow, wasClaude: boolean, deps: BcfDeps): Promise<BcfTopicRow> {
  if (!isClaude(row.assigned_to) || wasClaude) return row;
  return (await maybeStartSession(row, deps, true)).topic;
}

/** Spracuje jednu požiadavku BCF API; `segments` sú za bázou (napr. `/api/bcf`). */
export async function handleBcfApi(req: BcfApiRequest, ctx: BcfApiContext): Promise<BcfApiResponse> {
  const { method, segments: s } = req;
  const { deps, user } = ctx;
  try {
    if (s.length === 1 && s[0] === "versions" && method === "GET") {
      return ok({
        versions: [{ version_id: BCF_VERSION, detailed_version: "https://github.com/buildingSMART/BCF-API/tree/release_2_1" }],
      });
    }
    if (s[0] !== BCF_VERSION) return err(404, "Neznáma cesta BCF API.");
    if (s.length === 2 && s[1] === "auth" && method === "GET") {
      // Len vložený token (Bearer); OAuth server nemáme.
      return ok({ http_basic_supported: false, supported_oauth2_flows: [] });
    }
    if (!ctx.authenticated) return err(401, "Chýba alebo nesedí token (Authorization: Bearer).");
    if (s.length === 2 && s[1] === "current-user" && method === "GET") return ok({ id: user, name: user });
    if (s[1] !== "projects") return err(404, "Neznáma cesta BCF API.");
    if (s.length === 2 && method === "GET") {
      return ok([{ project_id: PROJECT_ID, name: PROJECT_NAME, authorization: { project_actions: PROJECT_ACTIONS } }]);
    }
    if (s[2] !== PROJECT_ID) return err(404, `Projekt ${s[2]} neexistuje (jediný je '${PROJECT_ID}').`);
    if (s.length === 3 && method === "GET") {
      return ok({ project_id: PROJECT_ID, name: PROJECT_NAME, authorization: { project_actions: PROJECT_ACTIONS } });
    }
    if (s.length === 4 && s[3] === "extensions" && method === "GET") return ok(await extensions(deps));
    if (s[3] !== "topics") return err(404, "Neznáma cesta BCF API.");

    if (s.length === 4) {
      if (method === "GET") {
        // $filter a $orderby sa nevyhodnocujú: témy idú podľa čísla, stránkuje $top/$skip.
        const top = Math.min(500, Math.max(1, Number.parseInt(req.query.get("$top") ?? "", 10) || 100));
        const skip = Math.max(0, Number.parseInt(req.query.get("$skip") ?? "", 10) || 0);
        const { rows } = await deps.store.list({ limit: top, offset: skip, ascending: true });
        return ok(rows.map(topicToDto));
      }
      if (method === "POST") {
        const row = await deps.store.create({ ...topicWrite(req.body, user), author: user });
        return ok(topicToDto(await startIfClaude(row, false, deps)), 201);
      }
      return err(405, "Metóda nie je povolená.");
    }

    const found = await topicOr404(deps, s[4]);
    if (!("id" in found)) return found;
    const topic = found;

    if (s.length === 5) {
      if (method === "GET") return ok(topicToDto(topic));
      if (method === "PUT") {
        const row = await deps.store.update(topic.id, topicWrite(req.body, user));
        return ok(topicToDto(await startIfClaude(row, isClaude(topic.assigned_to), deps)));
      }
      return err(405, "Metóda nie je povolená.");
    }

    if (s[5] === "comments" && s.length === 6) {
      if (method === "GET") return ok(topic.comments.map((c) => commentToDto(topic, c)));
      if (method === "POST") {
        const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
        const text = str(b.comment, 8000);
        if (!text) return err(400, "Chýba comment.");
        const c = await deps.store.addComment(topic.id, user, text);
        return c ? ok(commentToDto(topic, c), 201) : err(404, `Téma ${topic.id} neexistuje.`);
      }
      return err(405, "Metóda nie je povolená.");
    }

    if (s[5] === "viewpoints") {
      const current = viewpointToDto(topic);
      if (s.length === 6) {
        if (method === "GET") return ok(current ? [current] : []);
        if (method === "POST") {
          const dto = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
          const { viewpoint, selection } = viewpointFromDto(dto);
          // Téma má jeden pohľad (D-099): nový nahradí starý; prvky len keď ich pohľad nesie.
          const row = await deps.store.update(topic.id, {
            viewpoint,
            ...(selection.length ? { components: selection } : {}),
            modified_by: user,
          });
          return ok(viewpointToDto(row), 201);
        }
        return err(405, "Metóda nie je povolená.");
      }
      if (method !== "GET") return err(405, "Metóda nie je povolená.");
      if (!current || current.guid !== s[6]) return err(404, `Pohľad ${s[6]} neexistuje.`);
      if (s.length === 7) return ok(current);
      const comps = (current.components ?? {}) as { selection?: unknown[] };
      if (s.length === 8 && s[7] === "selection") return ok({ selection: comps.selection ?? [] });
      if (s.length === 8 && s[7] === "coloring") return ok({ coloring: [] });
      if (s.length === 8 && s[7] === "visibility") return ok({ visibility: { default_visibility: true } });
      if (s.length === 8 && s[7] === "snapshot") return err(404, "Pohľad nemá snímku.");
    }
    return err(404, "Neznáma cesta BCF API.");
  } catch (e) {
    if (e instanceof ApiInputError) return err(400, e.message);
    return err(500, e instanceof Error ? e.message : String(e));
  }
}
