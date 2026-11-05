"use client";

import { LoadingLogo } from "@/components/loading-logo";
import { LoadProgressBar } from "@/components/load-progress-bar";
import {
  INITIAL_LOAD_STATE,
  allSettled,
  applyFirstGeometry,
  applyLoadProgress,
  hasLoadProgress,
  loadSegments,
  parseFirstGeometry,
  parseLoadProgress,
  type LoadState,
} from "@/lib/viewer-load";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { nodeSummaryToAimPanel, type ElementDetail } from "@/lib/aim-panel";
import type { SelectedElement } from "@/lib/data/drawing";
import type { UnderlayDrawingWire } from "@/lib/data/drawing";
import type { DocumentWire } from "@/lib/data/documents";
import type { DocumentLinksWire } from "@/lib/data/drawing-links";
import type { CaptureViewerWire } from "@/lib/data/captures";
import type { TreeDecorations } from "@/lib/data/decoration-counts";
import type { DerivationsLayerWire } from "@/lib/derivations";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";
import { opToBridgeMessage, parseOps } from "@/lib/viewer-ops";
import { isViewWire, viewsLoadMessage, type ViewWire } from "@/lib/viewer-views";
import { clashLoadMessage, clashSavedMessage, parseClashSave, type ClashLoadPayload, type ClashOpenOp, type ClashSaveResult } from "@/lib/viewer-clash";
import { idsLoadMessage, idsSavedMessage, parseIdsSave, type IdsOpenOp, type IdsSaveResult, type IdsTarget } from "@/lib/viewer-ids";
import {
  MAX_ZONE_GUIDS,
  documentLensWire,
  documentScopeKey,
  lensBridgeMessage,
  lensScopeKeys,
  scopeQuery,
} from "@/lib/viewer-lens";
import { listBridgeMessage, listHostKeys, listScopeKeys, type ListHostKey, type ListHostValues } from "@/lib/viewer-list";
import type { LiveQueryPayload, LiveReplyPayload } from "@/lib/live/protocol";
import { hasRelativeStep, relativeViewpoint, type CameraMove, type ViewerCamera } from "@/lib/viewer-camera";
import { setViewerQueryHandler } from "@/lib/live/viewer-query-bus";
import { emitApplied, isRestoredCommandUrl, setLiveApplyHandler, takePendingCmdIds, withoutCommandParams, type LiveApply } from "@/lib/live/viewer-apply-bus";
import { BCF_CHANGED_WINDOW_EVENT, bcfLoadMessage } from "@/lib/live/bcf-event";
import { OPEN_OVERLAY_SELECTOR, shouldClearFocusOnEscape } from "@/lib/viewer-escape";
import { VIEWS_CHANGED_WINDOW_EVENT } from "@/lib/live/views-event";
import { PROD_VIEWER_URL, VIEWER_CHOICE_KEY, urlWithoutViewerChoice } from "@/lib/viewer-source";

/**
 * 3D viewer = a self-hosted IFClite app (fork AssetinSpace/ifc-lite,
 * branch aim-integration) embedded via <iframe>. This wrapper keeps the UNCHANGED
 * contract of the original three.js viewer (Props + ViewerApi + onSelect/
 * onPickedElement), so ifc-workspace.tsx and the rest of the app do not change -
 * only the transport changes: in-process calls -> postMessage across the iframe boundary.
 *
 * The other side of the bridge lives in the fork: apps/viewer/src/aim/AimBridge.tsx.
 * Protocol (source: "aim-bridge"):
 *   host -> viewer:  FOCUS{guids} · HIGHLIGHT_FILTER{guids} · CLEAR_FILTER ·
 *                   COLORIZE{guids|selector,color} · HIDE{guids|selector} ·
 *                   SHOW{guids|selector} · ISOLATE{guids|selector} ·
 *                   SHOW_ALL · RESET_COLORS   (D-066; selector = a set
 *                   selection {types,model} expanded viewer-side) ·
 *                   SELECT{guid} (D-082; selection as a click: selection + camera +
 *                   properties panel, the viewer replies ENTITY_SELECTED) ·
 *                   SET_SECTION{action,axis,storeyGuid,offsetM,position} ·
 *                   SET_CAMERA{preset,projection,guids} ·
 *                   SET_VIEW_MODE{mode,storeyGuid} (D-083; a view without
 *                   coordinates, the viewer computes the storey) ·
 *                   DOCUMENT_OPEN{documentId,page} ·
 *                   DOCUMENT_LINKS{documents} (D-130; floor plan labels as links) ·
 *                   AIM_PANEL_DATA{guid,data} · AIM_PANEL_EMPTY{guid,reason} ·
 *                   AIM_DERIVATIONS_LOAD{layer} (D-089; AIM layer above the models,
 *                   types in lib/derivations.ts) · AIM_BCF_LOAD{baseUrl,projectId}
 *                   (D-099; BCF topics from /api/bcf without a token, also after a change from the chat)
 *   viewer -> host:  READY · MODELS_LOADED · LOAD_PROGRESS{model,phase,percent,index,total} ·
 *                   FIRST_GEOMETRY{model,index,total} (D-178; both already before READY) ·
 *                   ENTITY_SELECTED{guid} ·
 *                   ENTITY_DESELECTED · AIM_NAVIGATE{href} ·
 *                   DOCUMENT_SHOW_3D{documentId,page} (D-104 step 4; the host replies APPLY_LENS)
 *
 * AIM card: after ENTITY_SELECTED the host fetches the DB summary (/api/element/{id})
 * and sends it as a render schema (lib/aim-panel.ts) to the native panel of the
 * viewer - one panel instead of two. Clicks in the card go back via
 * AIM_NAVIGATE and are handled by the parent app.
 */

const SOURCE = "aim-bridge" as const;
/** After this time without MODELS_LOADED the loader gives way to an error message (D-163). */
const LOAD_TIMEOUT_MS = 120_000;

/**
 * "Clear saved state and reload" ("Vyčistiť uložený stav a načítať znova", D-163): drops the viewer choice (`aim.viewer`
 * in sessionStorage, also from `?viewer=`) and reloads the page, i.e. the production viewer.
 * The viewer's storage is on its own origin, the host cannot clear it; the host's chats and the layout
 * of the panels stay.
 */
/**
 * Startup diagnostics (#310): phase, time since the page was opened and the host's JS heap memory
 * (`performance.memory` in Chromium only), so that a console screenshot shows where the startup stalls.
 */
function logLoadPhase(phase: string) {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  console.info(
    `[aim-viewer] ${phase} @ ${(performance.now() / 1000).toFixed(1)} s` +
      (mem ? `, halda ${Math.round(mem.usedJSHeapSize / 2 ** 20)} / ${Math.round(mem.jsHeapSizeLimit / 2 ** 20)} MB` : "")
  );
}

function clearViewerStateAndReload() {
  try {
    window.sessionStorage.removeItem(VIEWER_CHOICE_KEY);
  } catch {
    /* private mode: nothing to clean */
  }
  window.location.replace(urlWithoutViewerChoice(window.location.href));
}


type OutboundMessage =
  | { source: typeof SOURCE; type: "READY" }
  | { source: typeof SOURCE; type: "MODELS_LOADED"; count: number }
  // Autoload progress per model and the first geometry on the scene (D-178); the body is validated by parseLoadProgress and parseFirstGeometry.
  | { source: typeof SOURCE; type: "LOAD_PROGRESS" }
  | { source: typeof SOURCE; type: "FIRST_GEOMETRY" }
  | { source: typeof SOURCE; type: "ENTITY_SELECTED"; guid: string }
  | { source: typeof SOURCE; type: "ENTITY_DESELECTED" }
  // A click on a link in the AIM card in the viewer - the navigation is done by this (parent) app.
  | { source: typeof SOURCE; type: "AIM_NAVIGATE"; href: string }
  // PDF underlay calibration saved in the viewer (D-072) - the host persists it.
  | { source: typeof SOURCE; type: "UNDERLAY_SAVE"; documentId: string; georef: unknown; calibrationIndex?: unknown }
  // A click on a Reality Capture pin in 3D (D-073) - the host opens the gallery/panorama.
  | { source: typeof SOURCE; type: "CAPTURE_PIN_CLICK"; captureId: string }
  // A document card opened/closed in the viewer (D-075) - recents/analytics.
  | { source: typeof SOURCE; type: "DOCUMENT_EVENT"; documentId: string; event: "opened" | "closed" }
  // The "Show in 3D" ("Ukázať v 3D") button with an open document (D-104 step 4) - the host replies APPLY_LENS.
  | { source: typeof SOURCE; type: "DOCUMENT_SHOW_3D"; documentId: string; page?: number }
  // Views from the Presentation panel (D-161) - the host writes them via /api/saved-views and sends back VIEWS_LOAD.
  | { source: typeof SOURCE; type: "VIEW_SAVE"; view: unknown; capture_id?: string }
  | { source: typeof SOURCE; type: "VIEW_RENAME"; id: string; name: string }
  | { source: typeof SOURCE; type: "VIEW_DELETE"; id: string }
  // IDS from the IDS Studio / Data validation panel (D-162) - the host writes it via /api/ids and sends back IDS_SAVED.
  | { source: typeof SOURCE; type: "IDS_SAVE"; target: string; xml: string; code?: string; base_version?: number; title?: string }
  // Test, run and state of clashes from the clash panel (D-164) - the host writes them via /api/clash and sends back CLASH_SAVED.
  | { source: typeof SOURCE; type: "CLASH_SAVE"; test?: unknown; test_code?: string; run?: unknown; reviews?: unknown }
  // ICDD export and check from the AIM ribbon (D-181) - the host assembles the container, downloads it and replies ICDD_STATUS.
  | { source: typeof SOURCE; type: "ICDD_EXPORT"; id: string; extras?: string[] }
  // Requirements library (D-182) - card and saving of the check result; the host calls /api/ids/* and replies REQLIB_RESULT.
  | { source: typeof SOURCE; type: "REQLIB_REQUEST"; id: string; action: string; payload?: Record<string, unknown> }
  // Verification of quantities (D-185 UI) - ticks in the properties panel and the Overovanie ribbon; the host calls /api/verify/* and replies VERIFY_RESULT.
  | { source: typeof SOURCE; type: "VERIFY_REQUEST"; id: string; action: string; payload?: Record<string, unknown> }
  | { source: typeof SOURCE; type: "ICDD_CHECK"; id: string; name?: string; bytes: ArrayBuffer }
  // Import of .bcfzip from the BCF panel (D-158 step 8) - the host writes it via /api/bcf/viewer-import and sends back BCF_IMPORTED.
  | { source: typeof SOURCE; type: "BCF_IMPORT"; id: string; name?: string; bytes: ArrayBuffer; dry_run?: boolean }
  // Reply to a QUERY of the back channel (D-085) - envelopes, view state.
  | { source: typeof SOURCE; type: "QUERY_RESULT"; id: string; ok: boolean; result?: unknown; error?: string }
  // Confirmation of commands before ACK_REQUEST (D-101) - state after execution, what was not executed.
  | { source: typeof SOURCE; type: "APPLIED"; cmdId: string; ok: boolean; issues: string[]; state?: unknown };

/** How long the live channel waits for a reply from the fork (the server waits longer, QUERY_TIMEOUT_MS). */
const VIEWER_QUERY_TIMEOUT_MS = 5000;
/** The lens is evaluated only after navigation and downloading the zone; the fork waits at most 6 s. */
const LENS_QUERY_TIMEOUT_MS = 7000;

/** Host wire -> viewer wire: removes the host-only `spaceId` from capture pins. */
function toCapturePins(captures: CaptureViewerWire[]) {
  return captures.map((c) => ({
    id: c.id,
    kind: c.kind,
    world: c.world,
    name: c.name,
    thumbUrl: c.thumbUrl,
  }));
}

/**
 * GUIDs of zones (rooms + elements in them and touching them) and documents (elements the
 * document or page relates to, D-104) from `/api/style-scope`; an error = an empty set.
 */
async function fetchScopeGuids(keys: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  await Promise.all(
    keys.map(async (id) => {
      const query = scopeQuery(id);
      if (!query) return;
      try {
        const r = await fetch(`/api/style-scope?${query}`);
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { guids?: unknown };
        const guids = Array.isArray(body.guids) ? body.guids.filter((g): g is string => typeof g === "string") : [];
        out.set(id, guids.slice(0, MAX_ZONE_GUIDS));
      } catch (err) {
        console.warn("[aim] zóna alebo dokument pre lens sa nenačítali", id, err);
      }
    }),
  );
  return out;
}

/** Values of the host columns of a list from `/api/list-host-values` (D-174); an error = an empty column. */
async function fetchHostValues(keys: ListHostKey[]): Promise<Map<string, ListHostValues>> {
  const out = new Map<string, ListHostValues>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const r = await fetch(`/api/list-host-values?key=${encodeURIComponent(key)}`);
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { values?: unknown };
        if (body.values && typeof body.values === "object") out.set(key, body.values as ListHostValues);
      } catch (err) {
        console.warn("[aim] hodnoty stĺpca zoznamu sa nenačítali", key, err);
      }
    }),
  );
  return out;
}

/** Elements of a document or page from `/api/style-scope` (D-104 step 4); an error = `null`. */
async function fetchDocumentScope(id: string, page?: number): Promise<{ name: string; guids: string[] } | null> {
  const query = scopeQuery(documentScopeKey(id, page));
  if (!query) return null;
  try {
    const r = await fetch(`/api/style-scope?${query}`);
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as { document?: unknown; guids?: unknown };
    const guids = Array.isArray(body.guids) ? body.guids.filter((g): g is string => typeof g === "string") : [];
    return { name: typeof body.document === "string" ? body.document : "Dokument", guids: guids.slice(0, MAX_ZONE_GUIDS) };
  } catch (err) {
    console.warn("[aim] prvky dokumentu sa nenačítali", id, page, err);
    return null;
  }
}

function isBridgeMessage(data: unknown): data is OutboundMessage {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { source?: unknown }).source === SOURCE &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

interface Props {
  /** Federation models (D-049) - rendered into one scene. */
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** AI dock action nonce - a new value forces re-applying focus/ops (D-056). */
  focusNonce?: string;
  /** AI dock viewer operations (coloring/hiding/isolation, D-066) - wire format see parseOps. */
  ops?: string;
  /** Georeferenced PDF underlays (D-072) - sent to the viewer after MODELS_LOADED. */
  underlays?: UnderlayDrawingWire[];
  /** Document library for the in-viewer Documents panel (D-075) - after MODELS_LOADED. */
  documents?: DocumentWire[];
  /** Deep link (D-075): id of the document to open as a tab (`?doc=`). */
  openDocumentId?: string;
  /** Reality Capture pins with 3D anchoring (D-073) - sent after MODELS_LOADED. */
  captures?: CaptureViewerWire[];
  /** AIM tree decorations (D-077) - per-GUID badge counts, after MODELS_LOADED. */
  decorations?: TreeDecorations;
  /** AIM layer above the models (D-089) - AIM_DERIVATIONS_LOAD after MODELS_LOADED. */
  derivations?: DerivationsLayerWire | null;
  /** Floor plan labels as links to an element (D-130) - DOCUMENT_LINKS after DOCUMENTS_LOAD. */
  documentLinks?: DocumentLinksWire[] | null;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
  /** Navigation from the AIM card in the viewer (host-relative href, e.g. /node/{id}). */
  onNavigate?: (href: string) => void;
  /** A click on a capture pin in 3D (D-073) - the host opens the gallery/panorama. */
  onCaptureClick?: (captureId: string) => void;
  /** Embedded viewer (D-116): production, or a PR fork preview chosen in the viewer picker.
   *  Verified by the caller (lib/viewer-source.ts); a change remounts the iframe. */
  viewerUrl?: string;
  /** Project code (D-189): the BCF project id the viewer loads topics from. */
  projectCode?: string;
}

export function IFCViewer({
  models,
  guidMap,
  focus,
  focusNonce,
  ops,
  underlays,
  documents,
  openDocumentId,
  captures,
  decorations,
  derivations,
  documentLinks,
  apiRef,
  onSelect,
  onPickedElement,
  onNavigate,
  onCaptureClick,
  viewerUrl = PROD_VIEWER_URL,
  projectCode,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "timeout" | "ready">("loading");
  /** Loading progress per model (D-178); empty until the viewer (an older one) has sent any. */
  const [load, setLoad] = useState<LoadState>(INITIAL_LOAD_STATE);
  // The loader overlay holds until the first geometry; without LOAD_PROGRESS/FIRST_GEOMETRY (an older viewer) until MODELS_LOADED.
  const overlay = status === "loading" && !load.firstGeometry;
  const segments = useMemo(() => loadSegments(load), [load]);
  const showStrip = status === "loading" && load.firstGeometry && !allSettled(load);
  /** A failed underlay calibration write (#317): a message above the viewer until the user closes it. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const readyRef = useRef(false);
  /** true only after MODELS_LOADED - earlier the viewer cannot resolve GUIDs. */
  const loadedRef = useRef(false);
  // AIM card: race guard of the detail fetch - a new selection aborts the previous
  // fetch and the reply is sent only for the still current GUID (the viewer additionally has its
  // own guid guard, belt-and-suspenders).
  const aimGuidRef = useRef<string | null>(null);
  const aimAbortRef = useRef<AbortController | null>(null);

  // Fail-closed: an invalid viewer URL = no iframe and no postMessage.
  // A fallback "*" would turn off the origin filter of incoming messages AND send
  // the AIM panel data to any origin - a misconfiguration must not open the bridge.
  const viewerOrigin = useMemo(() => {
    try {
      return new URL(viewerUrl).origin;
    } catch {
      return null;
    }
  }, [viewerUrl]);

  // objects.id -> ifc_guid (reverse of guidMap) - for translating DB->3D commands.
  const objectIdToGuid = useMemo(() => {
    const m = new Map<string, string>();
    for (const [guid, oid] of Object.entries(guidMap)) m.set(oid, guid);
    return m;
  }, [guidMap]);

  // iframe src - models are autoloaded via ?models=<url>,<url> (AimBridge/
  // ViewerLayout). URLSearchParams encodes commas/URLs safely; the viewer
  // decodes them back and splits on ','.
  const src = useMemo(() => {
    if (!viewerOrigin) return null;
    const u = new URL(viewerUrl);
    u.searchParams.set("models", models.map((m) => m.url).join(","));
    return u.toString();
  }, [models, viewerOrigin, viewerUrl]);

  // Stable key - the iframe is remounted only when the model URLs or the viewer change (D-116).
  const modelsKey = `${viewerUrl}#${models.map((m) => m.url).join("|")}`;

  // Reset of state on a change of models - the React pattern "adjust state during render"
  // (not setState in an effect). In practice models do not change during a session.
  const [prevModelsKey, setPrevModelsKey] = useState(modelsKey);
  if (modelsKey !== prevModelsKey) {
    setPrevModelsKey(modelsKey);
    setStatus("loading");
    setLoad(INITIAL_LOAD_STATE);
  }

  // Safeguard: if MODELS_LOADED does not arrive (the viewer has no error message), the loader must not
  // hang forever - show an error message; a late MODELS_LOADED overwrites it.
  useEffect(() => {
    // After the first geometry the model is visible and being completed; an error message would cover it.
    if (status !== "loading" || load.firstGeometry) return;
    logLoadPhase("čakám na viewer");
    const t = setTimeout(() => {
      logLoadPhase(`MODELS_LOADED neprišlo do ${LOAD_TIMEOUT_MS / 1000} s (READY ${readyRef.current ? "áno" : "nie"})`);
      setStatus("timeout");
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
    // `load` in the dependencies: every progress message restarts the 120 s measurement (inactivity, not total time).
  }, [status, modelsKey, load]);

  function post(msg: Record<string, unknown>) {
    if (!viewerOrigin) return;
    iframeRef.current?.contentWindow?.postMessage(
      { source: SOURCE, ...msg },
      viewerOrigin
    );
  }

  /** View writes go one after another: the reply of each carries the full list, an older one would overwrite a newer one (D-161). */
  const viewsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const viewsWarnedRef = useRef(false);

  /** List from the DB into Presentation (`VIEWS_LOAD`): after the models load and after every write. */
  function sendViews(views: unknown) {
    if (!loadedRef.current || !Array.isArray(views)) return;
    const valid = views.filter((v): v is ViewWire => isViewWire(v));
    if (valid.length !== views.length) console.warn("[ifc-viewer] pohľady: neplatný riadok v zozname z DB, zoznam sa neposiela");
    else post(viewsLoadMessage(valid));
  }

  /** List of views from the DB (read-only) into Presentation; goes after the writes so that it does not outrun their result. */
  function loadViews() {
    viewsQueueRef.current = viewsQueueRef.current
      .then(async () => {
        const r = await fetch("/api/saved-views", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        sendViews(((await r.json()) as { views?: unknown }).views);
      })
      .catch((err: unknown) => console.warn("[ifc-viewer] pohľady sa nenačítali", err));
  }

  /** View write from the panel or from the chat (`VIEW_SAVE`, `VIEW_RENAME`, `VIEW_DELETE`); enabling is in the route (env gate). */
  function writeViews(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    viewsQueueRef.current = viewsQueueRef.current
      .then(async () => {
        const r = await fetch("/api/saved-views", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(String(r.status));
        sendViews(((await r.json()) as { views?: unknown }).views);
      })
      .catch((err: unknown) => {
        // The view lives in the viewer even without a write; a rejected write (gate turned off) is logged once.
        if (viewsWarnedRef.current) return;
        viewsWarnedRef.current = true;
        console.error("saved views write failed", err);
      });
  }

  /**
   * IDS from AIM into the panel (D-162): `ids_open` from the chat. The client downloads the XML from `GET /api/ids` (the live channel does not carry it)
   * and sends the fork `IDS_LOAD`; an error is not hidden, `APPLIED` shows it to the chat as a problem.
   */
  async function openIds(o: IdsOpenOp) {
    const r = await fetch(`/api/ids?code=${encodeURIComponent(o.code)}${o.version ? `&version=${o.version}` : ""}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`IDS '${o.code}' sa nenačítalo (HTTP ${r.status})`);
    const doc = (await r.json()) as { code: string; version: number; title: string; xml: string };
    post(idsLoadMessage(o, doc));
  }

  /**
   * Clash from AIM into the panel (D-164): `clash_open` from the chat. The client downloads the test and run from `GET /api/clash` (the live channel
   * does not carry the clashes) and sends the fork `CLASH_LOAD`; an error is not hidden, `APPLIED` shows it to the chat as a problem.
   */
  async function openClash(o: ClashOpenOp) {
    const r = await fetch(`/api/clash?test=${encodeURIComponent(o.test)}${o.run ? `&run=${encodeURIComponent(o.run)}` : ""}`, { cache: "no-store" });
    const body = (await r.json().catch(() => ({}))) as ClashLoadPayload & { error?: string };
    if (!r.ok) throw new Error(body.error ?? `Test '${o.test}' sa nenačítal (HTTP ${r.status})`);
    post(clashLoadMessage(body));
  }

  /**
   * Underlays anew (D-168): `underlays_load` after `calibrate_underlay mode=restore`. The client downloads them from
   * `GET /api/underlay` and sends the fork `UNDERLAYS_LOAD`, same as at startup.
   */
  async function reloadUnderlays() {
    const r = await fetch("/api/underlay", { cache: "no-store" });
    if (!r.ok) throw new Error(`Podklady sa nenačítali (HTTP ${r.status})`);
    const body = (await r.json()) as { drawings?: UnderlayDrawingWire[] };
    post({ type: "UNDERLAYS_LOAD", drawings: body.drawings ?? [] });
  }

  /** Save from the clash panel (`CLASH_SAVE`): the route is behind the env gate; the result returns as `CLASH_SAVED` (the button shows it). */
  function saveClash(raw: unknown) {
    const save = parseClashSave(raw);
    const reply = (result: ClashSaveResult) => post(clashSavedMessage(result));
    if (!save) return reply({ ok: false, error: "neplatná správa z viewera" });
    void fetch("/api/clash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(save) })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as Extract<ClashSaveResult, { ok: true }> & { error?: string };
        if (r.ok && body.ok) reply(body);
        else reply({ ok: false, error: body.error ?? `HTTP ${r.status}` });
      })
      .catch((err: unknown) => reply({ ok: false, error: err instanceof Error ? err.message : "uloženie zlyhalo" }));
  }

  /** Saving IDS from the panel (`IDS_SAVE`): the route is behind the env gate; the result returns as `IDS_SAVED` (the button shows it). */
  /** Requirements library (D-182): the module is loaded at the first request of the card; the host knows the model revision from `models`. */
  function runReqlib(raw: unknown) {
    void import("@/lib/viewer-reqlib").then(async ({ parseReqlibRequest, runReqlibRequest }) => {
      const req = parseReqlibRequest(raw);
      if (req) await runReqlibRequest(req, { fetch, models, post });
    });
  }

  /** Verification of quantities (D-185 UI): the module is loaded at the first request; `run_all` from one card only one at a time. */
  const verifyRunAllRef = useRef({ busy: false });
  function runVerify(raw: unknown) {
    void import("@/lib/viewer-verify").then(async ({ parseVerifyRequest, runVerifyRequest }) => {
      const req = parseVerifyRequest(raw);
      if (req) await runVerifyRequest(req, { fetch, post, runAll: verifyRunAllRef.current });
    });
  }

  /** ICDD from the ribbon (D-181): the library is loaded only on first use, the work runs in the host window. */
  function runIcdd(raw: unknown) {
    void (async () => {
      const [{ parseIcddRequest, runIcddRequest }, client] = await Promise.all([
        import("@/lib/viewer-icdd"),
        import("@/lib/icdd/client"),
      ]);
      const req = parseIcddRequest(raw);
      if (!req) return;
      await runIcddRequest(req, (status) => post({ ...status }), {
        exportIcdd: (progress, extras) => client.exportIcdd(progress, fetch, extras),
        checkIcdd: (bytes, progress) => client.checkIcdd(bytes, progress),
        download: client.downloadBytes,
      });
    })();
  }

  /** Import of .bcfzip from the BCF panel (`BCF_IMPORT`): the route is behind the env gate; the result returns as `BCF_IMPORTED`. */
  function importBcf(raw: unknown) {
    void (async () => {
      const { parseBcfImport, bcfImportedMessage, BCF_VIEWER_IMPORT_MAX_BYTES } = await import("@/lib/viewer-bcf-import");
      const req = parseBcfImport(raw);
      if (!req) return;
      const reply = (result: Parameters<typeof bcfImportedMessage>[1]) => post(bcfImportedMessage(req.id, result));
      if (req.bytes.byteLength > BCF_VIEWER_IMPORT_MAX_BYTES) return reply({ ok: false, error: "Súbor je príliš veľký, importuj ho v chate (bcf_topic action=import)." });
      try {
        const r = await fetch(`/api/bcf/viewer-import${req.dry_run ? "?dry_run=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: req.bytes });
        const body = (await r.json().catch(() => ({}))) as { ok?: boolean; summary?: unknown; error?: string };
        if (r.ok && body.ok && body.summary) reply({ ok: true, summary: body.summary as Extract<Parameters<typeof bcfImportedMessage>[1], { ok: true }>["summary"] });
        else reply({ ok: false, error: body.error ?? `HTTP ${r.status}` });
      } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : "import zlyhal" });
      }
    })();
  }

  function saveIds(raw: unknown) {
    const save = parseIdsSave(raw);
    const target: IdsTarget = save?.target ?? "studio";
    const reply = (result: IdsSaveResult) => post(idsSavedMessage(target, result));
    if (!save) return reply({ ok: false, error: "neplatná správa z viewera" });
    void fetch("/api/ids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml: save.xml, ...(save.code ? { code: save.code } : {}), ...(save.base_version ? { base_version: save.base_version } : {}), ...(save.title ? { title: save.title } : {}) }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string; version?: number; error?: string; latest_version?: number };
        if (r.ok && body.ok && body.code && body.version) reply({ ok: true, code: body.code, version: body.version });
        else reply({ ok: false, error: body.error ?? `HTTP ${r.status}`, ...(body.latest_version ? { latest_version: body.latest_version } : {}) });
      })
      .catch((err: unknown) => reply({ ok: false, error: err instanceof Error ? err.message : "uloženie zlyhalo" }));
  }

  // GUID-carrying commands issued before MODELS_LOADED (a click on "3D: N elements" during
  // parsing, soft-nav focus) would be dropped by the viewer - resolveGuids finds nothing
  // before the models are parsed. They are queued and flushed in the
  // MODELS_LOADED handler (carried over from the already deleted ifc-viewer-embed.tsx).
  const pendingRef = useRef<Record<string, unknown>[]>([]);
  // D-085 questions waiting for QUERY_RESULT from the iframe, by id.
  const queriesRef = useRef(new Map<string, (r: LiveReplyPayload) => void>());
  // AI dock ops go one after another; a relative camera in them waits for view_state (D-098).
  const opsChainRef = useRef<Promise<void>>(Promise.resolve());
  // Live channel commands executed in place (D-101): a nonce that the soft-nav effect no longer repeats,
  // and commands that arrived before MODELS_LOADED.
  const liveNonceRef = useRef<string | null>(null);
  const pendingLiveRef = useRef<LiveApply[]>([]);
  const cameraQueryRef = useRef(0);
  function send(msg: Record<string, unknown>) {
    if (loadedRef.current) post(msg);
    else pendingRef.current.push(msg);
  }

  /**
   * After a selection in the viewer fetches the DB summary and sends it to the AIM card
   * in the native viewer panel (AIM_PANEL_DATA / AIM_PANEL_EMPTY).
   */
  function sendAimPanel(guid: string, objectId: string | undefined) {
    aimAbortRef.current?.abort();
    aimGuidRef.current = guid;

    if (!objectId) {
      post({ type: "AIM_PANEL_EMPTY", guid, reason: "no-mapping" });
      return;
    }

    const controller = new AbortController();
    aimAbortRef.current = controller;
    // One fetch: since D-077 /api/element returns an enriched detail including the
    // capture summary (the parallel /api/captures/summary from D-073 is no longer needed).
    fetch(`/api/element/${objectId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ElementDetail>;
      })
      .then((detail) => {
        if (aimGuidRef.current !== guid) return; // meanwhile another selection
        post({ type: "AIM_PANEL_DATA", guid, data: nodeSummaryToAimPanel(detail, guid) });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || aimGuidRef.current !== guid) return;
        const reason = err instanceof Error && err.message === "404" ? "not-found" : "error";
        post({ type: "AIM_PANEL_EMPTY", guid, reason });
      });
  }

  /**
   * Applies the AI dock viewer ops (D-066, view D-083) - one op = one
   * bridge message; the format and translation live in `lib/viewer-ops.ts`.
   */
  function applyOps(raw: string) {
    const list = parseOps(raw);
    // A relative camera step waits for view_state; the ops after it go only then, so that
    // the order stays as the tool sent it (D-098).
    opsChainRef.current = opsChainRef.current.then(async () => {
      for (const o of list) {
        if (o.op === "camera" && hasRelativeStep(o)) await applyRelativeCamera(o);
        else if (o.op === "lens" && lensScopeKeys(o.wire).length > 0) {
          // A zone or document from the AIM graph (D-096, D-104): the client downloads the element GUIDs itself.
          post(lensBridgeMessage(o.mode, o.wire, await fetchScopeGuids(lensScopeKeys(o.wire)), o.rev));
        } else if (o.op === "list" && (listScopeKeys(o.wire).length > 0 || listHostKeys(o.wire).length > 0)) {
          // A zone or document (D-096) and the values of host columns from the DB (D-174): the client downloads them itself.
          post(listBridgeMessage(o.wire, await fetchScopeGuids(listScopeKeys(o.wire)), await fetchHostValues(listHostKeys(o.wire))));
        } else if (o.op === "ids_open") {
          await openIds(o);
        } else if (o.op === "clash_open") {
          await openClash(o);
        } else if (o.op === "underlays_load") {
          await reloadUnderlays();
        } else post(opToBridgeMessage(o));
        // A color reset also turns off the AIM chat lens and deletes the route line and the dimensions from Claude (D-137, D-152), show all cancels the isolation from the chat (D-096, D-137).
        if (o.op === "reset_colors") {
          post({ type: "APPLY_LENS", mode: "clear" });
          post({ type: "ROUTE_SHOW", points: [] });
          post({ type: "MEASURE_SHOW", segments: [] });
        }
        if (o.op === "show_all") post({ type: "APPLY_LENS", mode: "unisolate" });
      }
    }).catch((err: unknown) => console.warn("[ifc-viewer] ops", err));
  }

  /**
   * "Show in 3D" ("Ukázať v 3D") from an open document (D-104 step 4): X-ray of the page's elements; a page without
   * its own elements (title page, a drawing without links to pages) shows the whole document. It goes in
   * the ops chain so that it does not cross with the lens from the chat.
   */
  function showDocumentIn3d(documentId: string, page: number | undefined) {
    opsChainRef.current = opsChainRef.current.then(async () => {
      let scope = page ? await fetchDocumentScope(documentId, page) : null;
      let usedPage = page;
      if (!scope || scope.guids.length === 0) {
        scope = await fetchDocumentScope(documentId);
        usedPage = undefined;
      }
      if (!scope) return;
      const wire = documentLensWire(documentId, scope.name, usedPage);
      post(lensBridgeMessage("replace", wire, new Map([[documentScopeKey(documentId, usedPage), scope.guids]])));
    }).catch((err: unknown) => console.warn("[ifc-viewer] dokument v 3D", err));
  }

  /** Confirmation (D-101): ACK_REQUEST goes after the ops in the same chain, the fork handles it after them. */
  function requestAck(cmdIds: string[]) {
    if (cmdIds.length === 0) return;
    opsChainRef.current = opsChainRef.current.then(() => {
      for (const cmdId of cmdIds) post({ type: "ACK_REQUEST", cmdId });
    });
  }

  /** A live channel command in place (D-101): the same as focus/ops from the URL, without navigation. */
  function runLive(a: LiveApply) {
    if (a.focus) post({ type: "FOCUS", guids: a.focus.split(",") });
    if (a.ops) applyOps(a.ops);
    requestAck(a.cmdIds);
  }

  /**
   * A question of the back channel (D-085) to the fork: QUERY -> QUERY_RESULT with the same id.
   * It is asked by the live channel and by the host itself (relative camera).
   */
  function askViewer(q: LiveQueryPayload): Promise<LiveReplyPayload> {
    return new Promise<LiveReplyPayload>((resolve) => {
      if (!loadedRef.current) {
        resolve({ id: q.id, ok: false, error: "3D viewer ešte načítava model." });
        return;
      }
      const pending = queriesRef.current;
      const timer = setTimeout(() => {
        pending.delete(q.id);
        resolve({ id: q.id, ok: false, error: "3D viewer neodpovedal." });
      }, q.query === "lens_state" ? LENS_QUERY_TIMEOUT_MS : VIEWER_QUERY_TIMEOUT_MS);
      pending.set(q.id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      if (q.query === "lens_state") {
        // Counts of the AIM chat lens (D-096): the viewer waits for the evaluation of version `rev`.
        post({ type: "LENS_QUERY", id: q.id, ...(q.rev ? { rev: q.rev } : {}) });
        return;
      }
      post({ type: "QUERY", id: q.id, query: q.query, ...(q.guids ? { guids: q.guids } : {}) });
    });
  }

  /**
   * Relative zoom/orbit/pan (D-098): the current pose from view_state, the new
   * pose by the pure function `relativeViewpoint`, to the fork as `SET_CAMERA
   * {viewpoint}` (the fork only carries it over to the camera).
   */
  async function applyRelativeCamera(o: CameraMove) {
    const r = await askViewer({ id: `camera-${++cameraQueryRef.current}`, query: "view_state" });
    const camera = r.ok ? (r.result as { camera?: ViewerCamera | null } | undefined)?.camera : null;
    if (!camera) {
      console.warn("[ifc-viewer] relatívna kamera: view_state bez kamery", r.ok ? "" : r.error);
      return;
    }
    post({ type: "SET_CAMERA", preset: "keep", viewpoint: relativeViewpoint(camera, o) });
  }

  // ── Receiving messages from the iframe (3D -> DB) ─────────────────────────────────────
  useEffect(() => {
    readyRef.current = false;

    function onMessage(e: MessageEvent) {
      if (!viewerOrigin || e.origin !== viewerOrigin) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!isBridgeMessage(e.data)) return;

      switch (e.data.type) {
        case "READY": {
          readyRef.current = true;
          logLoadPhase("READY");
          // The overlay (loader D-163) holds until MODELS_LOADED: after READY the fork's own intro (the AimBridge veil)
          // and the progressive reveal of the model would show under it, i.e. a second loading screen.
          // A hang is
          // guarded by the timeout below.
          // Fill ViewerApi only after READY - exactly like the original contract, where
          // apiRef.current was null before the scene loaded.
          if (apiRef) apiRef.current = makeApi();
          break;
        }
        case "LOAD_PROGRESS": {
          const msg = parseLoadProgress(e.data);
          if (msg) setLoad((s) => applyLoadProgress(s, msg));
          break;
        }
        case "FIRST_GEOMETRY": {
          const msg = parseFirstGeometry(e.data);
          if (msg) {
            logLoadPhase(`FIRST_GEOMETRY ${msg.model}`);
            setLoad((s) => applyFirstGeometry(s, msg));
          }
          break;
        }
        case "MODELS_LOADED": {
          // The models are parsed - only now can resolveGuids find the element.
          // Apply the initial deep-link focus/ops (?focus=...&ops=...) here, not on READY.
          loadedRef.current = true;
          logLoadPhase("MODELS_LOADED");
          setStatus("ready");
          // A page or tab reload with a command address (a live command overwrites it, D-101) does not
          // repeat the command: a fresh start is without a section and view until someone asks for them (#313).
          const restored =
            (!!focus || !!ops) &&
            isRestoredCommandUrl(
              performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined,
              window.location.href
            );
          if (restored) {
            console.info("[aim-viewer] obnovená adresa s príkazom: focus/ops z adresy sa nevykonajú");
            window.history.replaceState(window.history.state, "", withoutCommandParams(window.location.href));
          }
          if (focus && !restored) post({ type: "FOCUS", guids: focus.split(",") });
          // PDF underlays (D-072) - only after the models are parsed, so that the viewer can
          // resolve the storey GUIDs from the placements.
          if (underlays && underlays.length > 0) {
            post({ type: "UNDERLAYS_LOAD", drawings: underlays });
          }
          // Document library (D-075) - the same timing slot; calibrated
          // drawings go in both messages (linked via documentId/storeyGuid).
          if (documents && documents.length > 0) {
            post({ type: "DOCUMENTS_LOAD", documents });
            // Floor plan labels as links (D-130): only once the viewer has the document library.
            if (documentLinks && documentLinks.length > 0) post({ type: "DOCUMENT_LINKS", documents: documentLinks });
            // Deep link `?doc=<id>` - open the card only once the viewer has the library.
            if (openDocumentId) {
              post({ type: "DOCUMENT_OPEN", documentId: openDocumentId });
            }
          }
          // Reality Capture pins (D-073) - world-anchored capture points; spaceId
          // is host-only (navigation after a click), it is not sent to the viewer.
          if (captures && captures.length > 0) {
            post({ type: "CAPTURES_LOAD", captures: toCapturePins(captures) });
          }
          // AIM tree decorations (D-077) - badge counts per GUID.
          if (decorations && Object.keys(decorations).length > 0) {
            post({ type: "AIM_TREE_DECORATIONS", decorations });
          }
          // AIM layer above the models (D-089): derivation rules, counts, model revisions.
          if (derivations) post({ type: "AIM_DERIVATIONS_LOAD", layer: derivations });
          // BCF topics (D-099): the viewer loads them from /api/bcf of this origin without a token.
          post(bcfLoadMessage(window.location.origin, projectCode));
          // Views from the DB (D-161) into the Presentation panel; the reply arrives only after the ops, but `VIEW_ACTIVATE` from the ops
          // looks the view up in the viewer, so the fork queues it in the command gate behind them.
          loadViews();
          // Ops only after underlays, documents and pins (D-083): `view:2d` needs
          // to know whether the storey has a calibrated drawing, and `doc` opens only a document
          // that the viewer already received in DOCUMENTS_LOAD.
          if (ops && !restored) applyOps(ops);
          // Flush of commands issued before the models loaded (see send()).
          const queued = pendingRef.current;
          pendingRef.current = [];
          for (const msg of queued) post(msg);
          // D-101: confirmation of a command that arrived via navigation, and the in-place commands from before the load.
          requestAck(takePendingCmdIds());
          const live = pendingLiveRef.current;
          pendingLiveRef.current = [];
          for (const a of live) runLive(a);
          break;
        }
        case "APPLIED":
          emitApplied({ cmdId: e.data.cmdId, ok: e.data.ok, issues: e.data.issues, state: e.data.state });
          break;
        case "QUERY_RESULT": {
          const resolve = queriesRef.current.get(e.data.id);
          if (!resolve) break;
          queriesRef.current.delete(e.data.id);
          resolve(
            e.data.ok
              ? { id: e.data.id, ok: true, result: e.data.result }
              : { id: e.data.id, ok: false, error: e.data.error ?? "viewer chyba" },
          );
          break;
        }
        case "ENTITY_SELECTED": {
          const objectId = guidMap[e.data.guid];
          sendAimPanel(e.data.guid, objectId);
          if (!objectId) return;
          onSelect?.({ id: objectId, route: "node", label: e.data.guid });
          onPickedElement?.(objectId, e.data.guid);
          break;
        }
        case "ENTITY_DESELECTED":
          // The viewer clears the AIM card itself on deselection; here it is enough to drop
          // the running fetch so that a stale reply does not go to the next selection.
          aimAbortRef.current?.abort();
          aimGuidRef.current = null;
          break;
        case "AIM_NAVIGATE": {
          // Only host-relative paths - a defense against navigation to foreign URLs.
          const href = e.data.href;
          if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
            onNavigate?.(href);
          }
          break;
        }
        case "CAPTURE_PIN_CLICK":
          if (typeof e.data.captureId === "string" && e.data.captureId.length > 0) {
            onCaptureClick?.(e.data.captureId);
          }
          break;
        case "DOCUMENT_SHOW_3D": {
          const { documentId, page } = e.data;
          if (typeof documentId === "string" && documentId) {
            showDocumentIn3d(documentId, typeof page === "number" && Number.isInteger(page) && page > 0 ? page : undefined);
          }
          break;
        }
        case "DOCUMENT_EVENT":
          // D-075: no host-side use yet (candidate: recents/analytics).
          // It is accepted on purpose - an unknown type would otherwise end up as noise in the console
          // of a future stricter handler.
          break;
        case "VIEW_SAVE": {
          const { view, capture_id: captureId } = e.data;
          if (!isViewWire(view)) return;
          writeViews("POST", { view, ...(typeof captureId === "string" ? { capture_id: captureId } : {}) });
          break;
        }
        case "VIEW_RENAME": {
          const { id, name } = e.data;
          if (typeof id === "string" && typeof name === "string") writeViews("PATCH", { id, name });
          break;
        }
        case "VIEW_DELETE": {
          if (typeof e.data.id === "string") writeViews("DELETE", { id: e.data.id });
          break;
        }
        case "IDS_SAVE":
          saveIds(e.data);
          break;
        case "CLASH_SAVE":
          saveClash(e.data);
          break;
        case "ICDD_EXPORT":
        case "ICDD_CHECK":
          runIcdd(e.data);
          break;
        case "REQLIB_REQUEST":
          runReqlib(e.data);
          break;
        case "VERIFY_REQUEST":
          runVerify(e.data);
          break;
        case "BCF_IMPORT":
          importBcf(e.data);
          break;
        case "UNDERLAY_SAVE": {
          // Calibration from the viewer -> persist _georef (D-072). The server validates the payload
          // (isValidGeorefV1) and turns writing on/off via the env gate.
          const { documentId, georef, calibrationIndex } = e.data;
          if (typeof documentId !== "string" || documentId.length === 0) return;
          void fetch(`/api/underlay/${encodeURIComponent(documentId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ georef, ...(typeof calibrationIndex === "number" ? { calibrationIndex } : {}) }),
          })
            .then(async (r) => {
              if (r.ok) return setSaveError(null);
              const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
              throw new Error(`${r.status}${typeof body?.error === "string" ? `: ${body.error}` : ""}`);
            })
            .catch((err: unknown) => {
              // The calibration lives in the viewer even without a write, but would be lost after a page reload:
              // the user must see it, not just the console (#317).
              console.error("underlay save failed", err);
              setSaveError(err instanceof Error ? err.message : String(err));
            });
          break;
        }
      }
    }

    function makeApi(): ViewerApi {
      const toGuids = (oids: ReadonlyArray<string>, excludeOid?: string) =>
        oids
          .filter((oid) => oid !== excludeOid)
          .map((oid) => objectIdToGuid.get(oid))
          .filter((g): g is string => !!g);

      return {
        highlightFilter: (oids, excludeOid) =>
          send({ type: "HIGHLIGHT_FILTER", guids: toGuids(oids, excludeOid) }),
        highlightSiblings: (oids, excludeOid) =>
          send({ type: "HIGHLIGHT_FILTER", guids: toGuids(oids, excludeOid) }),
        clearFilter: () => send({ type: "CLEAR_FILTER" }),
        focusObject: (guid) => send({ type: "FOCUS", guids: [guid] }),
        getIfcBuffer: () => null,
      };
    }

    window.addEventListener("message", onMessage);
    // Back channel (D-085): send the question to the fork only with parsed models.
    const pendingQueries = queriesRef.current;
    const unregisterQueries = setViewerQueryHandler(askViewer);
    const unregisterApply = setLiveApplyHandler((a) => {
      if (a.nonce) liveNonceRef.current = a.nonce;
      if (loadedRef.current) runLive(a);
      else pendingLiveRef.current.push(a);
    });
    return () => {
      window.removeEventListener("message", onMessage);
      unregisterQueries();
      unregisterApply();
      pendingLiveRef.current = [];
      pendingQueries.clear();
      readyRef.current = false;
      loadedRef.current = false;
      pendingRef.current = [];
      aimAbortRef.current?.abort();
      aimAbortRef.current = null;
      aimGuidRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey, viewerOrigin]);

  // ── Focus (card/AI dock -> 3D), reactive on soft-nav (D-056). Before
  // MODELS_LOADED it is queued via send() (the initial ?focus= from the URL is sent
  // by the MODELS_LOADED handler itself - so nothing is sent before READY).
  useEffect(() => {
    if (!readyRef.current || !focus) return;
    if (focusNonce && focusNonce === liveNonceRef.current) return; // already executed in place (D-101)
    send({ type: "FOCUS", guids: focus.split(",") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, focusNonce]);

  // ── AI dock viewer ops (coloring/hiding/isolation, D-066) on soft-nav.
  // Sending before MODELS_LOADED makes no sense (GUIDs cannot be resolved) -
  // the initial ops are applied by the MODELS_LOADED handler above.
  useEffect(() => {
    if (!loadedRef.current || !ops) return;
    if (focusNonce && focusNonce === liveNonceRef.current) return; // already executed in place (D-101)
    applyOps(ops);
    requestAck(takePendingCmdIds());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, focusNonce]);

  // ── Reality Capture pins (D-073) - re-send on a change (e.g. after an upload +
  // router.refresh()). Before MODELS_LOADED the pins are sent in its handler above.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "CAPTURES_LOAD", captures: toCapturePins(captures ?? []) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures]);

  // ── Documents (D-075) - re-send on a change (router.refresh after ETL/upload).
  // Before MODELS_LOADED the MODELS_LOADED handler above sends them.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "DOCUMENTS_LOAD", documents: documents ?? [] });
    post({ type: "DOCUMENT_LINKS", documents: documentLinks ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, documentLinks]);

  // ── AIM tree decorations (D-077) - re-send on a change (router.refresh after ETL).
  // Before MODELS_LOADED the MODELS_LOADED handler above sends them.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "AIM_TREE_DECORATIONS", decorations: decorations ?? {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorations]);

  // ── BCF topics (D-099) - after a write from the chat an event comes from the live channel.
  useEffect(() => {
    const reload = () => {
      if (loadedRef.current) post(bcfLoadMessage(window.location.origin, projectCode));
    };
    window.addEventListener(BCF_CHANGED_WINDOW_EVENT, reload);
    return () => window.removeEventListener(BCF_CHANGED_WINDOW_EVENT, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Esc in the host (#94) - after show_in_3d the focus is in the chat, Esc does not reach the iframe.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!loadedRef.current) return;
      if (!shouldClearFocusOnEscape(e, document.querySelector(OPEN_OVERLAY_SELECTOR) !== null)) return;
      post({ type: "CLEAR_FOCUS" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Views (D-161) - the chat renamed, deleted or overwrote them: the list from the DB again.
  useEffect(() => {
    const reload = () => {
      if (loadedRef.current) loadViews();
    };
    window.addEventListener(VIEWS_CHANGED_WINDOW_EVENT, reload);
    return () => window.removeEventListener(VIEWS_CHANGED_WINDOW_EVENT, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AIM layer (D-089) - re-send on a change (router.refresh after a new revision).
  useEffect(() => {
    if (!loadedRef.current || !derivations) return;
    post({ type: "AIM_DERIVATIONS_LOAD", layer: derivations });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivations]);

  // ── `?doc=` deep link on soft navigation (D-075): the MODELS_LOADED handler
  // covers it only on the first page open - on an already loaded scene the iframe
  // is not remounted and MODELS_LOADED does not arrive again, so it is sent reactively.
  useEffect(() => {
    if (!loadedRef.current || !openDocumentId) return;
    post({ type: "DOCUMENT_OPEN", documentId: openDocumentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDocumentId]);

  // Misconfiguration (an invalid NEXT_PUBLIC_IFC_VIEWER_URL) - fail-closed UI.
  if (!viewerOrigin || !src) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            3D prehliadač nie je nakonfigurovaný
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1">NEXT_PUBLIC_IFC_VIEWER_URL</code>{" "}
            nie je platná URL: <code className="rounded bg-muted px-1">{viewerUrl}</code>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md ring-1 ring-border">
      <iframe
        key={modelsKey}
        ref={iframeRef}
        src={src}
        title="3D model budovy"
        className={`h-full w-full border-0${overlay ? " pointer-events-none" : ""}`}
        onError={() => setStatus("error")}
        allow="fullscreen"
      />

      {/* Opaque overlay - until the federation loads, the ifc-lite intro screen with their logo
          must not show through (D-163: white background + animated logo). */}
      {overlay && <LoadingLogo label="Načítavam 3D scénu" segments={hasLoadProgress(load) ? segments : undefined} />}

      {/* After the first geometry (D-178) the viewer completes the model itself; only a thin per-model strip stays at the top. */}
      {showStrip && <LoadProgressBar segments={segments} variant="strip" />}

      {status === "timeout" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            3D scéna sa nenačítala do 2 minút
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Prehliadač možno nemá zapnutú grafickú akceleráciu (WebGPU, pozri{" "}
            <code className="rounded bg-muted px-1">chrome://gpu</code>), alebo štart blokuje
            uložený stav či rozšírenie prehliadača.
          </span>
          <button
            type="button"
            onClick={clearViewerStateAndReload}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Vyčistiť uložený stav a načítať znova
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            Chyba pri načítaní 3D prehliadača
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Skontrolujte dostupnosť vieweru na{" "}
            <code className="rounded bg-muted px-1">{viewerUrl}</code> alebo
            nastavte <code className="rounded bg-muted px-1">NEXT_PUBLIC_IFC_VIEWER_URL</code>.
          </span>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="absolute left-1/2 top-3 z-20 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-md border border-destructive/40 bg-background px-3 py-2 text-xs shadow-md"
        >
          <span>
            <span className="font-semibold text-destructive">Kalibráciu podkladu sa nepodarilo uložiť.</span>{" "}
            Po obnove stránky sa stratí. ({saveError})
          </span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted"
            aria-label="Zavrieť"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
