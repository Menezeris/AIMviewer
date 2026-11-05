import {
  documentLabel,
  documentReferenceToDto,
  documentWrite,
  MAX_TOPIC_DOCUMENTS,
  parseDocumentReferenceDto,
  stripOwnLabel,
  TopicDocumentError,
} from "./documents";
import type { BcfComment, BcfTopicRow, BcfTopicWrite, TopicDocumentRow, TopicDocumentWrite, TopicStatus } from "./store";
import { isClaude, maybeStartSession, normalizeStatus, reviewStates, type BcfDeps } from "./tools";
import { parseMarkup } from "./markup";
import { overviewViewpoint, pickCalibration, regionFrame, regionViewpoint } from "./region-model";
import type { SnapshotRequest } from "./snapshot";
import { snapshotPlan } from "./snapshot-plan";
import { viewpointFromDto } from "./viewpoint";

export { viewpointFromDto };

/**
 * BCF API 2.1 over `model_tasks` (D-099 phase B): the viewer BCF panel (fork,
 * `@ifc-lite/bcf-api`) connects with a token and sees, creates and comments on the same
 * topics as the MCP tools. One project = the whole federation (a topic need not have a
 * model). Reading is without a token (the viewer loads topics itself, D-099 addendum),
 * writing only with a token. A pure function over the request - the route handles token and CORS.
 */

export const BCF_VERSION = "2.1";
/**
 * The only BCF project before D-189. The BCF project id is now the AIM project code (`OCB`); `aim`
 * stays accepted as the request project for viewers loaded before the change.
 */
export const LEGACY_PROJECT_ID = "aim";
/** Default BCF project of tests and contexts without a project (D-189). */
export const PROJECT_ID = LEGACY_PROJECT_ID;
export const PROJECT_NAME = "AIM - modely federácie";

/** DB status <-> BCF topic_status (Title Case as in the panel and in other tools). */
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
  /** Path after the API base, e.g. ["2.1", "projects", "aim", "topics"]. */
  segments: string[];
  query: URLSearchParams;
  body: unknown;
}

export interface BcfApiResponse {
  status: number;
  body: unknown;
  /** Binary response (viewpoint snapshot, D-158 step 3); the route sends it instead of JSON. */
  binary?: { bytes: Buffer; headers: Record<string, string> };
}

export interface BcfApiContext {
  deps: BcfDeps;
  /** Token user (BCF current-user, author of writes). */
  user: string;
  /** The request carries a valid write token. */
  authenticated: boolean;
  /** The write token is set (`BCF_API_TOKEN`); without it the API is read-only. */
  writeEnabled: boolean;
  /** Page origin (links to documents in DocumentReference, D-158). */
  origin: string;
  /** Snapshot of a document region (D-158 step 3); without it document viewpoints offer no snapshot. */
  snapshot?: (req: SnapshotRequest) => Promise<SnapshotOutcome>;
  /** The AIM project of the request (D-189): BCF `project_id` = its code. Missing = legacy `aim`. */
  project?: { code: string; name: string };
}

/** Snapshot result for the BCF API (identical to `snapshot-http.ts`, without a server dependency). */
export type SnapshotOutcome =
  | { ok: true; png: Buffer; revisionChanged: boolean }
  | { ok: false; status: number; message: string; retryAfter?: number };

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
 * Section plane normal in BCF (IFC world, Z up) from the viewer axis: x = IFC X,
 * y = IFC Z (height), z = IFC Y; an unflipped section has the normal against the viewer axis,
 * conversion as `sectionPlaneToClippingPlane` in `@ifc-lite/bcf`.
 */
const SECTION_NORMAL: Record<string, Vec> = {
  x: { x: -1, y: 0, z: 0 },
  y: { x: 0, y: 0, z: -1 },
  z: { x: 0, y: 1, z: 0 },
};

/** Our viewer view (`view_state`) -> BCF viewpoint DTO. */
export function viewpointToDto(row: BcfTopicRow): Record<string, unknown> | null {
  const vp = row.viewpoint;
  if (!vp) return null;
  const guid = typeof vp.guid === "string" ? vp.guid : row.id;
  const selection = row.components.map((g) => ({ ifc_guid: g, originating_system: "AIM" }));
  const components = selection.length ? { selection } : undefined;
  // A viewpoint created by the panel stays in BCF shape; elements are in the topic `components`.
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
      // ortho_size is half of the view height, BCF wants the whole height in meters.
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

/**
 * Viewpoint of a document page reference (D-158 steps 3 and 4): a snapshot of the region with a frame; the BCF panel
 * shows it with the topic and the upstream export writes it into the .bcfzip as the viewpoint snapshot. BCF 3.0 wants a
 * camera in every viewpoint: with page calibration (D-133) it is a view over the region in the model, without
 * it the camera of the topic 3D viewpoint, otherwise a top-down preview.
 */
export function documentViewpointToDto(d: TopicDocumentRow, georef: unknown = null, fallback: Record<string, unknown> | null = null): Record<string, unknown> {
  const cal = d.page ? pickCalibration(georef, d.page, d.region) : null;
  const size = d.page_size ?? cal?.page_size ?? null;
  const plan = size ? snapshotPlan(size, d.region) : null;
  const aspect = plan ? plan.width / plan.height : undefined;
  const camera = cal
    ? regionViewpoint(regionFrame(cal, d.region), { aspect })
    : fallback?.perspective_camera
      ? { perspective_camera: fallback.perspective_camera }
      : fallback?.orthogonal_camera
        ? { orthogonal_camera: fallback.orthogonal_camera }
        : overviewViewpoint(aspect);
  return { guid: d.id, ...camera, snapshot: { snapshot_type: "png" } };
}

/** Document viewpoints of a topic with calibration of their pages (one `_georef` read per document). */
async function documentViewpoints(deps: BcfDeps, docs: TopicDocumentRow[], current: Record<string, unknown> | null) {
  const ids = [...new Set(docs.map((d) => d.document_id as string))];
  const georefs = new Map(await Promise.all(ids.map(async (id) => [id, await deps.store.georef(id)] as const)));
  return docs.map((d) => documentViewpointToDto(d, georefs.get(d.document_id as string) ?? null, current));
}

async function documentSnapshotResponse(d: TopicDocumentRow, ctx: BcfApiContext): Promise<BcfApiResponse> {
  if (!ctx.snapshot || !d.document_id || !d.page) return err(404, "Pohľad nemá snímku.");
  // Saved markups from the column (D-158 step 7); without them the request stays as before.
  const markup = parseMarkup(d.markup);
  const out = await ctx.snapshot({ document_id: d.document_id, page: d.page, region: d.region, sha256: d.document_sha256, ...(markup.length ? { markup } : {}) });
  if (!out.ok) return err(out.status, out.message);
  return {
    status: 200,
    body: null,
    binary: {
      bytes: out.png,
      headers: { "Content-Type": "image/png", ...(out.revisionChanged ? { "X-AIM-Revision-Changed": "1" } : {}) },
    },
  };
}

/**
 * Header of document references in the topic description (D-158): the BCF panel (upstream
 * `fetchProjectAsBCF`) does not download DocumentReference, it shows the description. On write
 * from the panel it is cut off, in the DB the description is without it.
 */
export const DOCUMENTS_HEADING = "Dokumenty (AIM):";

export function descriptionWithDocuments(description: string | null, docs: TopicDocumentRow[]): string | null {
  if (docs.length === 0) return description;
  const block = [DOCUMENTS_HEADING, ...docs.map((d) => `- ${documentLabel(d)}${d.description ? `: ${d.description}` : ""}`)].join("\n");
  return description ? `${description}\n\n${block}` : block;
}

export function descriptionWithoutDocuments(description: string | null): string | null {
  if (!description) return description;
  const i = description.startsWith(DOCUMENTS_HEADING) ? 0 : description.indexOf(`\n\n${DOCUMENTS_HEADING}`);
  return i < 0 ? description : description.slice(0, i).trim() || null;
}

export function topicToDto(row: BcfTopicRow, canWrite = true, docs: TopicDocumentRow[] = []): Record<string, unknown> {
  return {
    guid: row.id,
    server_assigned_id: `#${row.number}`,
    index: row.number,
    title: row.title,
    description: descriptionWithDocuments(row.description, docs),
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
    authorization: canWrite
      ? { topic_actions: TOPIC_ACTIONS, topic_status: Object.values(STATUS_TO_BCF) }
      : { topic_actions: [], topic_status: [] },
  };
}

export function commentToDto(topic: BcfTopicRow, c: BcfComment): Record<string, unknown> {
  return { guid: c.guid, topic_guid: topic.id, date: c.date, author: c.author, comment: c.comment };
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

async function extensions(deps: BcfDeps, canWrite: boolean): Promise<Record<string, unknown>> {
  const v = await deps.store.vocabulary();
  return {
    topic_type: union(DEFAULT_TYPES, v.topic_type),
    topic_status: Object.values(STATUS_TO_BCF),
    priority: union(DEFAULT_PRIORITIES, v.priority),
    stage: v.stage,
    // Without a label list the panel does not check labels (MCP writes them freely).
    user_id_type: union(["claude"], v.assigned_to),
    snippet_type: [],
    project_actions: canWrite ? PROJECT_ACTIONS : [],
    topic_actions: canWrite ? TOPIC_ACTIONS : [],
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

/** BCF topic write DTO -> topic fields; PUT replaces what BCF writes (missing = empty). */
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
    description: descriptionWithoutDocuments(str(b.description, 8000)),
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

/** The notification is a convenience: a failure must not fail a write that already happened. */
async function notified(ctx: BcfApiContext): Promise<void> {
  await ctx.deps.notify?.().catch(() => undefined);
}

/** DocumentReference DTO -> reference row (D-158); an AIM document is verified and gets a snapshot of code and revision. */
async function referenceWrite(body: unknown, topic: BcfTopicRow, ctx: BcfApiContext): Promise<TopicDocumentWrite> {
  const ref = parseDocumentReferenceDto(body, ctx.origin);
  if (ref.document_id) {
    const info = await ctx.deps.store.findDocument(ref.document_id);
    if (info) {
      const row = documentWrite(info, { page: ref.page ?? undefined, region: ref.region ?? undefined }, topic.id, ctx.user);
      return { ...row, description: stripOwnLabel(ref.description, row) };
    }
  }
  // A foreign reference (or a document that is no longer in AIM) stays as url.
  const b = (body ?? {}) as Record<string, unknown>;
  const row: TopicDocumentWrite = {
    task_id: topic.id,
    document_id: null,
    document_ref: null,
    document_name: null,
    document_revision: null,
    page: null,
    region: null,
    markup: null,
    url: ref.url ?? (typeof b.url === "string" ? b.url.trim() : null),
    description: null,
    author: ctx.user,
    document_sha256: null,
  };
  return { ...row, description: stripOwnLabel(ref.description, row) };
}

async function startIfClaude(row: BcfTopicRow, wasClaude: boolean, deps: BcfDeps): Promise<BcfTopicRow> {
  if (!isClaude(row.assigned_to) || wasClaude) return row;
  return (await maybeStartSession(row, deps, true)).topic;
}

/** Handles one BCF API request; `segments` are after the base (e.g. `/api/bcf`). */
export async function handleBcfApi(req: BcfApiRequest, ctx: BcfApiContext): Promise<BcfApiResponse> {
  const { method, segments: s } = req;
  const { deps, user } = ctx;
  const canWrite = ctx.authenticated;
  const projectId = ctx.project?.code ?? LEGACY_PROJECT_ID;
  const project = () => ({
    project_id: projectId,
    name: ctx.project ? `${ctx.project.name} - modely federácie` : PROJECT_NAME,
    authorization: { project_actions: canWrite ? PROJECT_ACTIONS : [] },
  });
  try {
    if (s.length === 1 && s[0] === "versions" && method === "GET") {
      return ok({
        versions: [{ version_id: BCF_VERSION, detailed_version: "https://github.com/buildingSMART/BCF-API/tree/release_2_1" }],
      });
    }
    if (s[0] !== BCF_VERSION) return err(404, "Neznáma cesta BCF API.");
    if (s.length === 2 && s[1] === "auth" && method === "GET") {
      // Only an inserted token (Bearer); we have no OAuth server.
      return ok({ http_basic_supported: false, supported_oauth2_flows: [] });
    }
    if (method !== "GET") {
      if (!ctx.writeEnabled) {
        return err(403, "Zápis cez BCF API je vypnutý (bez BCF_API_TOKEN); témy zakladaj a meň v chate cez konektor AIM.");
      }
      if (!ctx.authenticated) return err(401, "Zápis potrebuje token (Authorization: Bearer).");
    }
    if (s.length === 2 && s[1] === "current-user" && method === "GET") {
      // Token login in the panel; without a token the panel does not connect, the AIM bridge sends it the topics.
      return ctx.authenticated ? ok({ id: user, name: user }) : err(401, "Chýba alebo nesedí token (Authorization: Bearer).");
    }
    if (s[1] !== "projects") return err(404, "Neznáma cesta BCF API.");
    if (s.length === 2 && method === "GET") return ok([project()]);
    if (s[2] !== projectId && s[2] !== LEGACY_PROJECT_ID) return err(404, `Projekt ${s[2]} neexistuje (tento je '${projectId}').`);
    if (s.length === 3 && method === "GET") return ok(project());
    if (s.length === 4 && s[3] === "extensions" && method === "GET") return ok(await extensions(deps, canWrite));
    if (s[3] !== "topics") return err(404, "Neznáma cesta BCF API.");

    if (s.length === 4) {
      if (method === "GET") {
        // $filter and $orderby are not evaluated: topics go by number, $top/$skip paginate.
        const top = Math.min(500, Math.max(1, Number.parseInt(req.query.get("$top") ?? "", 10) || 100));
        const skip = Math.max(0, Number.parseInt(req.query.get("$skip") ?? "", 10) || 0);
        const { rows } = await deps.store.list({ limit: top, offset: skip, ascending: true });
        const docs = await deps.store.documents(rows.map((r) => r.id));
        return ok(rows.map((r) => topicToDto(r, canWrite, docs.filter((d) => d.task_id === r.id))));
      }
      if (method === "POST") {
        const row = await deps.store.create({ ...topicWrite(req.body, user), author: user });
        const started = await startIfClaude(row, false, deps);
        await notified(ctx);
        return ok(topicToDto(started), 201);
      }
      return err(405, "Metóda nie je povolená.");
    }

    const found = await topicOr404(deps, s[4]);
    if (!("id" in found)) return found;
    const topic = found;

    if (s.length === 5) {
      if (method === "GET") return ok(topicToDto(topic, canWrite, await deps.store.documents([topic.id])));
      if (method === "PUT") {
        const row = await deps.store.update(topic.id, topicWrite(req.body, user));
        const started = await startIfClaude(row, isClaude(topic.assigned_to), deps);
        await notified(ctx);
        return ok(topicToDto(started, true, await deps.store.documents([topic.id])));
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
        if (!c) return err(404, `Téma ${topic.id} neexistuje.`);
        await notified(ctx);
        return ok(commentToDto(topic, c), 201);
      }
      return err(405, "Metóda nie je povolená.");
    }

    if (s[5] === "document_references") {
      if (s.length === 6) {
        if (method === "GET") {
          // revision_changed only when it applies (same computation as bcf_topic_list); an older fork ignores it.
          const links = await deps.store.documents([topic.id]);
          const states = await reviewStates(deps, topic, links);
          return ok(links.map((d, i) => ({ ...documentReferenceToDto(d, ctx.origin), ...(states[i].revision_changed ? { revision_changed: true } : {}) })));
        }
        if (method === "POST") {
          const existing = await deps.store.documents([topic.id]);
          if (existing.length >= MAX_TOPIC_DOCUMENTS) return err(400, `Téma má už ${existing.length} odkazov na dokumenty (strop ${MAX_TOPIC_DOCUMENTS}).`);
          const row = await deps.store.addDocument(await referenceWrite(req.body, topic, ctx));
          await deps.store.update(topic.id, { modified_by: user });
          await notified(ctx);
          return ok(documentReferenceToDto(row, ctx.origin), 201);
        }
        return err(405, "Metóda nie je povolená.");
      }
      if (s.length === 7 && method === "PUT") {
        if (!UUID_RE.test(s[6])) return err(404, `Odkaz ${s[6]} neexistuje.`);
        const patch: Partial<TopicDocumentWrite> = await referenceWrite(req.body, topic, ctx);
        delete patch.task_id;
        const row = await deps.store.updateDocument(topic.id, s[6].toLowerCase(), patch);
        if (!row) return err(404, `Odkaz ${s[6]} neexistuje.`);
        await deps.store.update(topic.id, { modified_by: user });
        await notified(ctx);
        return ok(documentReferenceToDto(row, ctx.origin));
      }
      return err(405, "Metóda nie je povolená.");
    }

    if (s[5] === "viewpoints") {
      const current = viewpointToDto(topic);
      // A comment on a document page = a viewpoint with a region snapshot (D-158 step 3); guid = the reference guid.
      const docViews = ctx.snapshot ? (await deps.store.documents([topic.id])).filter((d) => d.document_id && d.page) : [];
      if (s.length === 6) {
        if (method === "GET") return ok([...(current ? [current] : []), ...(await documentViewpoints(deps, docViews, current))]);
        if (method === "POST") {
          const dto = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
          const { viewpoint, selection } = viewpointFromDto(dto);
          // A topic has one viewpoint (D-099): a new one replaces the old; elements only when the viewpoint carries them.
          const row = await deps.store.update(topic.id, {
            viewpoint,
            ...(selection.length ? { components: selection } : {}),
            modified_by: user,
          });
          await notified(ctx);
          return ok(viewpointToDto(row), 201);
        }
        return err(405, "Metóda nie je povolená.");
      }
      if (method !== "GET") return err(405, "Metóda nie je povolená.");
      const docView = docViews.find((d) => d.id === s[6].toLowerCase());
      if (docView) {
        if (s.length === 7) return ok((await documentViewpoints(deps, [docView], current))[0]);
        if (s.length === 8 && s[7] === "selection") return ok({ selection: [] });
        if (s.length === 8 && s[7] === "coloring") return ok({ coloring: [] });
        if (s.length === 8 && s[7] === "visibility") return ok({ visibility: { default_visibility: true } });
        if (s.length === 8 && s[7] === "snapshot") return documentSnapshotResponse(docView, ctx);
        return err(404, "Neznáma cesta BCF API.");
      }
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
    if (e instanceof ApiInputError || e instanceof TopicDocumentError) return err(400, e.message);
    return err(500, e instanceof Error ? e.message : String(e));
  }
}
