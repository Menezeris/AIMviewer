"use client";

import { LoadingLogo } from "@/components/loading-logo";
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
import { listBridgeMessage, listScopeKeys } from "@/lib/viewer-list";
import type { LiveQueryPayload, LiveReplyPayload } from "@/lib/live/protocol";
import { hasRelativeStep, relativeViewpoint, type CameraMove, type ViewerCamera } from "@/lib/viewer-camera";
import { setViewerQueryHandler } from "@/lib/live/viewer-query-bus";
import { emitApplied, isRestoredCommandUrl, setLiveApplyHandler, takePendingCmdIds, withoutCommandParams, type LiveApply } from "@/lib/live/viewer-apply-bus";
import { BCF_CHANGED_WINDOW_EVENT, bcfLoadMessage } from "@/lib/live/bcf-event";
import { VIEWS_CHANGED_WINDOW_EVENT } from "@/lib/live/views-event";
import { PROD_VIEWER_URL, VIEWER_CHOICE_KEY, urlWithoutViewerChoice } from "@/lib/viewer-source";

/**
 * 3D prehliadač = self-hostovaná IFClite appka (fork AssetinSpace/ifc-lite,
 * vetva aim-integration) vložená cez <iframe>. Tento wrapper drží NEZMENENÝ
 * kontrakt pôvodného three.js vieweru (Props + ViewerApi + onSelect/
 * onPickedElement), takže ifc-workspace.tsx a zvyšok appu sa nemenia — mení
 * sa len transport: in-process volania → postMessage cez hranicu iframu.
 *
 * Druhá strana mostu žije vo forku: apps/viewer/src/aim/AimBridge.tsx.
 * Protokol (source: "aim-bridge"):
 *   host → viewer:  FOCUS{guids} · HIGHLIGHT_FILTER{guids} · CLEAR_FILTER ·
 *                   COLORIZE{guids|selector,color} · HIDE{guids|selector} ·
 *                   SHOW{guids|selector} · ISOLATE{guids|selector} ·
 *                   SHOW_ALL · RESET_COLORS   (D-066; selector = množinový
 *                   výber {types,model} rozkladaný viewer-side) ·
 *                   SELECT{guid} (D-082; výber ako klik: selekcia + kamera +
 *                   panel vlastností, viewer odpovie ENTITY_SELECTED) ·
 *                   SET_SECTION{action,axis,storeyGuid,offsetM,position} ·
 *                   SET_CAMERA{preset,projection,guids} ·
 *                   SET_VIEW_MODE{mode,storeyGuid} (D-083; pohľad bez
 *                   súradníc, podlažie prepočíta viewer) ·
 *                   DOCUMENT_OPEN{documentId,page} ·
 *                   DOCUMENT_LINKS{documents} (D-130; popisky pôdorysov ako odkazy) ·
 *                   AIM_PANEL_DATA{guid,data} · AIM_PANEL_EMPTY{guid,reason} ·
 *                   AIM_DERIVATIONS_LOAD{layer} (D-089; vrstva AIM nad modelmi,
 *                   typy v lib/derivations.ts) · AIM_BCF_LOAD{baseUrl,projectId}
 *                   (D-099; BCF témy z /api/bcf bez tokenu, aj po zmene z chatu)
 *   viewer → host:  READY · MODELS_LOADED · ENTITY_SELECTED{guid} ·
 *                   ENTITY_DESELECTED · AIM_NAVIGATE{href} ·
 *                   DOCUMENT_SHOW_3D{documentId,page} (D-104 krok 4; host odpovie APPLY_LENS)
 *
 * AIM karta: po ENTITY_SELECTED host dotiahne DB súhrn (/api/element/{id})
 * a pošle ho ako render schému (lib/aim-panel.ts) do natívneho panelu
 * viewera — jeden panel namiesto dvoch. Kliky v karte chodia späť cez
 * AIM_NAVIGATE a naviguje ich parent appka.
 */

const SOURCE = "aim-bridge" as const;
/** Po tomto čase bez MODELS_LOADED loader ustúpi chybovej hláške (D-163). */
const LOAD_TIMEOUT_MS = 120_000;

/**
 * "Vyčistiť uložený stav a načítať znova" (D-163): zahodí voľbu viewera (`aim.viewer`
 * v sessionStorage, aj z `?viewer=`) a načíta stránku znova, teda produkčný viewer.
 * Úložisko viewera je na jeho origin, to host vyčistiť nevie; chaty a rozloženie
 * panelov hosta ostávajú.
 */
/**
 * Diagnostika štartu (#310): fáza, čas od otvorenia stránky a pamäť JS haldy hosta
 * (`performance.memory` len v Chromiu), aby screenshot konzoly ukázal, kde štart stojí.
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
    /* súkromný režim: nič na čistenie */
  }
  window.location.replace(urlWithoutViewerChoice(window.location.href));
}


type OutboundMessage =
  | { source: typeof SOURCE; type: "READY" }
  | { source: typeof SOURCE; type: "MODELS_LOADED"; count: number }
  | { source: typeof SOURCE; type: "ENTITY_SELECTED"; guid: string }
  | { source: typeof SOURCE; type: "ENTITY_DESELECTED" }
  // Klik na link v AIM karte vo viewri — navigáciu robí táto (parent) appka.
  | { source: typeof SOURCE; type: "AIM_NAVIGATE"; href: string }
  // Kalibrácia PDF podkladu uložená vo viewri (D-072) — host ju perzistuje.
  | { source: typeof SOURCE; type: "UNDERLAY_SAVE"; documentId: string; georef: unknown }
  // Klik na Reality Capture pin v 3D (D-073) — host otvorí galériu/panorámu.
  | { source: typeof SOURCE; type: "CAPTURE_PIN_CLICK"; captureId: string }
  // Karta dokumentu otvorená/zavretá vo viewri (D-075) — recents/analytics.
  | { source: typeof SOURCE; type: "DOCUMENT_EVENT"; documentId: string; event: "opened" | "closed" }
  // Tlačidlo "Ukázať v 3D" pri otvorenom dokumente (D-104 krok 4) - host odpovie APPLY_LENS.
  | { source: typeof SOURCE; type: "DOCUMENT_SHOW_3D"; documentId: string; page?: number }
  // Pohľady z panela Presentation (D-161) - host ich zapíše cez /api/saved-views a pošle späť VIEWS_LOAD.
  | { source: typeof SOURCE; type: "VIEW_SAVE"; view: unknown; capture_id?: string }
  | { source: typeof SOURCE; type: "VIEW_RENAME"; id: string; name: string }
  | { source: typeof SOURCE; type: "VIEW_DELETE"; id: string }
  // IDS z panela IDS Studio / Data validation (D-162) - host ho zapíše cez /api/ids a pošle späť IDS_SAVED.
  | { source: typeof SOURCE; type: "IDS_SAVE"; target: string; xml: string; code?: string; base_version?: number; title?: string }
  // Test, beh a stav kolízií z panela clash (D-164) - host ich zapíše cez /api/clash a pošle späť CLASH_SAVED.
  | { source: typeof SOURCE; type: "CLASH_SAVE"; test?: unknown; test_code?: string; run?: unknown; reviews?: unknown }
  // Odpoveď na QUERY spätného kanála (D-085) - obálky, stav pohľadu.
  | { source: typeof SOURCE; type: "QUERY_RESULT"; id: string; ok: boolean; result?: unknown; error?: string }
  // Potvrdenie príkazov pred ACK_REQUEST (D-101) - stav po vykonaní, čo sa nevykonalo.
  | { source: typeof SOURCE; type: "APPLIED"; cmdId: string; ok: boolean; issues: string[]; state?: unknown };

/** Ako dlho čaká živý kanál na odpoveď forku (server čaká dlhšie, QUERY_TIMEOUT_MS). */
const VIEWER_QUERY_TIMEOUT_MS = 5000;
/** Lens sa vyhodnocuje až po navigácii a stiahnutí zóny; fork čaká najviac 6 s. */
const LENS_QUERY_TIMEOUT_MS = 7000;

/** Host wire → viewer wire: odstráni host-only `spaceId` z capture pinov. */
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
 * GUIDy zón (miestnosti + prvky v nich a dotýkajúce sa ich) a dokumentov (prvky, ktorých
 * sa dokument alebo strana týka, D-104) z `/api/style-scope`; chyba = prázdna množina.
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

/** Prvky dokumentu alebo strany z `/api/style-scope` (D-104 krok 4); chyba = `null`. */
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
  /** Modely federácie (D-049) — renderované do jednej scény. */
  models: IfcModel[];
  guidMap: GuidMap;
  focus?: string;
  /** Nonce akcie AI docku — nová hodnota vynúti re-aplikáciu focusu/ops (D-056). */
  focusNonce?: string;
  /** Viewer operácie AI docku (ofarbenie/skrytie/izolácia, D-066) — wire formát viď parseOps. */
  ops?: string;
  /** Georeferencované PDF podklady (D-072) — poslané do viewera po MODELS_LOADED. */
  underlays?: UnderlayDrawingWire[];
  /** Knižnica dokumentov pre in-viewer Documents panel (D-075) — po MODELS_LOADED. */
  documents?: DocumentWire[];
  /** Deep link (D-075): id dokumentu, ktorý sa má otvoriť ako karta (`?doc=`). */
  openDocumentId?: string;
  /** Reality Capture piny s 3D ukotvením (D-073) — poslané po MODELS_LOADED. */
  captures?: CaptureViewerWire[];
  /** AIM dekorácie stromu (D-077) — per-GUID badge counts, po MODELS_LOADED. */
  decorations?: TreeDecorations;
  /** Vrstva AIM nad modelmi (D-089) — AIM_DERIVATIONS_LOAD po MODELS_LOADED. */
  derivations?: DerivationsLayerWire | null;
  /** Popisky pôdorysov ako odkazy na prvok (D-130) — DOCUMENT_LINKS po DOCUMENTS_LOAD. */
  documentLinks?: DocumentLinksWire[] | null;
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
  /** Navigácia z AIM karty vo viewri (host-relatívne href, napr. /node/{id}). */
  onNavigate?: (href: string) => void;
  /** Klik na capture pin v 3D (D-073) — host otvorí galériu/panorámu. */
  onCaptureClick?: (captureId: string) => void;
  /** Vložený viewer (D-116): produkčný, alebo náhľad PR forku z výberu viewera.
   *  Overený volajúcim (lib/viewer-source.ts); zmena remountne iframe. */
  viewerUrl?: string;
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
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "timeout" | "ready">("loading");
  /** Zlyhaný zápis kalibrácie podkladu (#317): hláška nad viewerom, kým ju používateľ nezavrie. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const readyRef = useRef(false);
  /** true až po MODELS_LOADED — skôr viewer nevie resolvnúť GUIDy. */
  const loadedRef = useRef(false);
  // AIM karta: race guard fetchu detailu — nová selekcia abortne predchádzajúci
  // fetch a odpoveď sa pošle len pre stále aktuálny GUID (viewer má navyše
  // vlastný guid guard, belt-and-suspenders).
  const aimGuidRef = useRef<string | null>(null);
  const aimAbortRef = useRef<AbortController | null>(null);

  // Fail-closed: nevalidná viewer URL = žiadny iframe ani postMessage.
  // Fallback "*" by vypol origin filter prichádzajúcich správ A poslal
  // AIM panel dáta ľubovoľnej origin — misconfigurácia nesmie otvárať bridge.
  const viewerOrigin = useMemo(() => {
    try {
      return new URL(viewerUrl).origin;
    } catch {
      return null;
    }
  }, [viewerUrl]);

  // objects.id → ifc_guid (reverz guidMap) — na preklad DB→3D príkazov.
  const objectIdToGuid = useMemo(() => {
    const m = new Map<string, string>();
    for (const [guid, oid] of Object.entries(guidMap)) m.set(oid, guid);
    return m;
  }, [guidMap]);

  // iframe src — modely sa autoloadnú cez ?models=<url>,<url> (AimBridge/
  // ViewerLayout). URLSearchParams zakóduje čiarky/URL bezpečne; viewer ich
  // dekóduje späť a splitne na ','.
  const src = useMemo(() => {
    if (!viewerOrigin) return null;
    const u = new URL(viewerUrl);
    u.searchParams.set("models", models.map((m) => m.url).join(","));
    return u.toString();
  }, [models, viewerOrigin, viewerUrl]);

  // Stabilný kľúč — iframe sa remountuje len keď sa zmenia URL modelov alebo viewer (D-116).
  const modelsKey = `${viewerUrl}#${models.map((m) => m.url).join("|")}`;

  // Reset stavu pri zmene modelov — React pattern „adjust state during render"
  // (nie setState v effekte). V praxi sa modely počas session nemenia.
  const [prevModelsKey, setPrevModelsKey] = useState(modelsKey);
  if (modelsKey !== prevModelsKey) {
    setPrevModelsKey(modelsKey);
    setStatus("loading");
  }

  // Poistka: ak MODELS_LOADED nepríde (viewer nemá chybovú správu), loader nesmie
  // visieť donekonečna - ukáž chybovú hlášku; neskorý MODELS_LOADED ju prepíše.
  useEffect(() => {
    if (status !== "loading") return;
    logLoadPhase("čakám na viewer");
    const t = setTimeout(() => {
      logLoadPhase(`MODELS_LOADED neprišlo do ${LOAD_TIMEOUT_MS / 1000} s (READY ${readyRef.current ? "áno" : "nie"})`);
      setStatus("timeout");
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [status, modelsKey]);

  function post(msg: Record<string, unknown>) {
    if (!viewerOrigin) return;
    iframeRef.current?.contentWindow?.postMessage(
      { source: SOURCE, ...msg },
      viewerOrigin
    );
  }

  /** Zápisy pohľadov idú za sebou: odpoveď každého nesie úplný zoznam, starší by prepísal novší (D-161). */
  const viewsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const viewsWarnedRef = useRef(false);

  /** Zoznam z DB do Presentation (`VIEWS_LOAD`): po načítaní modelov a po každom zápise. */
  function sendViews(views: unknown) {
    if (!loadedRef.current || !Array.isArray(views)) return;
    const valid = views.filter((v): v is ViewWire => isViewWire(v));
    if (valid.length !== views.length) console.warn("[ifc-viewer] pohľady: neplatný riadok v zozname z DB, zoznam sa neposiela");
    else post(viewsLoadMessage(valid));
  }

  /** Zoznam pohľadov z DB (len čítanie) do Presentation; ide za zápismi, aby nepredbehol ich výsledok. */
  function loadViews() {
    viewsQueueRef.current = viewsQueueRef.current
      .then(async () => {
        const r = await fetch("/api/saved-views", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        sendViews(((await r.json()) as { views?: unknown }).views);
      })
      .catch((err: unknown) => console.warn("[ifc-viewer] pohľady sa nenačítali", err));
  }

  /** Zápis pohľadu z panela alebo z chatu (`VIEW_SAVE`, `VIEW_RENAME`, `VIEW_DELETE`); zapnutie je v route (env brána). */
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
        // Pohľad žije vo vieweri aj bez zápisu; zamietnutý zápis (vypnutá brána) zaloguj raz.
        if (viewsWarnedRef.current) return;
        viewsWarnedRef.current = true;
        console.error("saved views write failed", err);
      });
  }

  /**
   * IDS z AIM do panela (D-162): `ids_open` z chatu. Klient si XML stiahne z `GET /api/ids` (živý kanál ho nenesie)
   * a pošle forku `IDS_LOAD`; chyba sa neskryje, `APPLIED` ju ukáže chatu ako problém.
   */
  async function openIds(o: IdsOpenOp) {
    const r = await fetch(`/api/ids?code=${encodeURIComponent(o.code)}${o.version ? `&version=${o.version}` : ""}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`IDS '${o.code}' sa nenačítalo (HTTP ${r.status})`);
    const doc = (await r.json()) as { code: string; version: number; title: string; xml: string };
    post(idsLoadMessage(o, doc));
  }

  /**
   * Clash z AIM do panela (D-164): `clash_open` z chatu. Klient si test a beh stiahne z `GET /api/clash` (živý kanál
   * kolízie nenesie) a pošle forku `CLASH_LOAD`; chyba sa neskryje, `APPLIED` ju ukáže chatu ako problém.
   */
  async function openClash(o: ClashOpenOp) {
    const r = await fetch(`/api/clash?test=${encodeURIComponent(o.test)}${o.run ? `&run=${encodeURIComponent(o.run)}` : ""}`, { cache: "no-store" });
    const body = (await r.json().catch(() => ({}))) as ClashLoadPayload & { error?: string };
    if (!r.ok) throw new Error(body.error ?? `Test '${o.test}' sa nenačítal (HTTP ${r.status})`);
    post(clashLoadMessage(body));
  }

  /** Uloženie z panela clash (`CLASH_SAVE`): route je za env bránou; výsledok sa vráti ako `CLASH_SAVED` (tlačidlo ho ukáže). */
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

  /** Uloženie IDS z panela (`IDS_SAVE`): route je za env bránou; výsledok sa vráti ako `IDS_SAVED` (tlačidlo ho ukáže). */
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

  // GUID-nosné príkazy vydané pred MODELS_LOADED (klik na „3D: N prvkov" počas
  // parsovania, soft-nav focus) by viewer zahodil — resolveGuids pred
  // naparsovaním modelov nič nenájde. Queue-ujú sa a flushnú v handleri
  // MODELS_LOADED (prenesené z už zmazaného ifc-viewer-embed.tsx).
  const pendingRef = useRef<Record<string, unknown>[]>([]);
  // Otázky D-085 čakajúce na QUERY_RESULT z iframu, podľa id.
  const queriesRef = useRef(new Map<string, (r: LiveReplyPayload) => void>());
  // Ops AI docku idú po sebe; relatívna kamera v nich čaká na view_state (D-098).
  const opsChainRef = useRef<Promise<void>>(Promise.resolve());
  // Príkazy živého kanála vykonané na mieste (D-101): nonce, ktorý už soft-nav efekt nezopakuje,
  // a príkazy, ktoré prišli pred MODELS_LOADED.
  const liveNonceRef = useRef<string | null>(null);
  const pendingLiveRef = useRef<LiveApply[]>([]);
  const cameraQueryRef = useRef(0);
  function send(msg: Record<string, unknown>) {
    if (loadedRef.current) post(msg);
    else pendingRef.current.push(msg);
  }

  /**
   * Po selekcii vo viewri dotiahne DB súhrn a pošle ho do AIM karty
   * v natívnom paneli viewera (AIM_PANEL_DATA / AIM_PANEL_EMPTY).
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
    // Jeden fetch: /api/element vracia od D-077 obohatený detail vrátane
    // capture súhrnu (paralelný /api/captures/summary z D-073 už netreba).
    fetch(`/api/element/${objectId}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ElementDetail>;
      })
      .then((detail) => {
        if (aimGuidRef.current !== guid) return; // medzičasom iná selekcia
        post({ type: "AIM_PANEL_DATA", guid, data: nodeSummaryToAimPanel(detail, guid) });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || aimGuidRef.current !== guid) return;
        const reason = err instanceof Error && err.message === "404" ? "not-found" : "error";
        post({ type: "AIM_PANEL_EMPTY", guid, reason });
      });
  }

  /**
   * Aplikuje viewer ops AI docku (D-066, pohľad D-083) - jedna op = jedna
   * bridge správa; formát a preklad žijú v `lib/viewer-ops.ts`.
   */
  function applyOps(raw: string) {
    const list = parseOps(raw);
    // Relatívny krok kamery čaká na view_state; ops za ním idú až potom, aby
    // poradie ostalo také, ako ho poslal tool (D-098).
    opsChainRef.current = opsChainRef.current.then(async () => {
      for (const o of list) {
        if (o.op === "camera" && hasRelativeStep(o)) await applyRelativeCamera(o);
        else if (o.op === "lens" && lensScopeKeys(o.wire).length > 0) {
          // Zóna alebo dokument z grafu AIM (D-096, D-104): GUIDy prvkov si klient stiahne sám.
          post(lensBridgeMessage(o.mode, o.wire, await fetchScopeGuids(lensScopeKeys(o.wire)), o.rev));
        } else if (o.op === "list" && listScopeKeys(o.wire).length > 0) {
          post(listBridgeMessage(o.wire, await fetchScopeGuids(listScopeKeys(o.wire))));
        } else if (o.op === "ids_open") {
          await openIds(o);
        } else if (o.op === "clash_open") {
          await openClash(o);
        } else post(opToBridgeMessage(o));
        // Reset farieb vypne aj AIM chat lens a zmaže čiaru trasy aj kóty od Claude (D-137, D-152), zobraziť všetko zruší izoláciu z chatu (D-096, D-137).
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
   * "Ukázať v 3D" z otvoreného dokumentu (D-104 krok 4): X-ray prvkov strany; strana bez
   * vlastných prvkov (titulná, výkres bez odkazov na strany) ukáže celý dokument. Ide v
   * reťazci ops, aby sa neprekrížila s lens z chatu.
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

  /** Potvrdenie (D-101): ACK_REQUEST ide za ops v tom istom reťazci, fork ho vybaví po nich. */
  function requestAck(cmdIds: string[]) {
    if (cmdIds.length === 0) return;
    opsChainRef.current = opsChainRef.current.then(() => {
      for (const cmdId of cmdIds) post({ type: "ACK_REQUEST", cmdId });
    });
  }

  /** Príkaz živého kanála na mieste (D-101): to isté ako focus/ops z URL, bez navigácie. */
  function runLive(a: LiveApply) {
    if (a.focus) post({ type: "FOCUS", guids: a.focus.split(",") });
    if (a.ops) applyOps(a.ops);
    requestAck(a.cmdIds);
  }

  /**
   * Otázka spätného kanála (D-085) forku: QUERY -> QUERY_RESULT s tým istým id.
   * Pýta sa ňou živý kanál aj host sám (relatívna kamera).
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
        // Počty AIM chat lens (D-096): viewer počká na vyhodnotenie verzie `rev`.
        post({ type: "LENS_QUERY", id: q.id, ...(q.rev ? { rev: q.rev } : {}) });
        return;
      }
      post({ type: "QUERY", id: q.id, query: q.query, ...(q.guids ? { guids: q.guids } : {}) });
    });
  }

  /**
   * Relatívny zoom/orbit/posun (D-098): aktuálna póza z view_state, nová
   * póza čistou funkciou `relativeViewpoint`, do forku ako `SET_CAMERA
   * {viewpoint}` (fork ju len prenesie do kamery).
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

  // ── Príjem správ z iframu (3D → DB) ─────────────────────────────────────
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
          // Overlay (loader D-163) drží až do MODELS_LOADED: po READY by sa pod
          // ním ukázala vlastná úvodka forku (veil AimBridge) a progresívne
          // odkrývanie modelu, teda druhá obrazovka načítavania. Visenie
          // poistí timeout nižšie.
          // Naplň ViewerApi až po READY — presne ako pôvodný kontrakt, kde
          // apiRef.current bol null pred načítaním scény.
          if (apiRef) apiRef.current = makeApi();
          break;
        }
        case "MODELS_LOADED": {
          // Modely sú naparsované — až teraz vie resolveGuids nájsť prvok.
          // Počiatočný deep-link focus/ops (?focus=…&ops=…) aplikuj tu, nie na READY.
          loadedRef.current = true;
          logLoadPhase("MODELS_LOADED");
          setStatus("ready");
          // Obnova stránky alebo karty s adresou príkazu (živý príkaz ju prepíše, D-101) príkaz
          // nezopakuje: čerstvý štart je bez rezu a pohľadu, kým ich niekto nežiada (#313).
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
          // PDF podklady (D-072) — až po naparsovaní modelov, aby viewer vedel
          // resolvnúť storey GUIDy z placementov.
          if (underlays && underlays.length > 0) {
            post({ type: "UNDERLAYS_LOAD", drawings: underlays });
          }
          // Knižnica dokumentov (D-075) — rovnaký timing slot; kalibrované
          // výkresy idú v oboch správach (prepojenie cez documentId/storeyGuid).
          if (documents && documents.length > 0) {
            post({ type: "DOCUMENTS_LOAD", documents });
            // Popisky pôdorysov ako odkazy (D-130): až keď viewer knižnicu dokumentov má.
            if (documentLinks && documentLinks.length > 0) post({ type: "DOCUMENT_LINKS", documents: documentLinks });
            // Deep link `?doc=<id>` — otvor kartu až keď viewer knižnicu má.
            if (openDocumentId) {
              post({ type: "DOCUMENT_OPEN", documentId: openDocumentId });
            }
          }
          // Reality Capture piny (D-073) — world-ukotvené capture pointy; spaceId
          // je host-only (navigácia po kliku), do viewera sa neposiela.
          if (captures && captures.length > 0) {
            post({ type: "CAPTURES_LOAD", captures: toCapturePins(captures) });
          }
          // AIM dekorácie stromu (D-077) — badge counts per GUID.
          if (decorations && Object.keys(decorations).length > 0) {
            post({ type: "AIM_TREE_DECORATIONS", decorations });
          }
          // Vrstva AIM nad modelmi (D-089): pravidlá odvodení, počty, revízie modelov.
          if (derivations) post({ type: "AIM_DERIVATIONS_LOAD", layer: derivations });
          // BCF témy (D-099): viewer si ich načíta z /api/bcf tohto originu bez tokenu.
          post(bcfLoadMessage(window.location.origin));
          // Pohľady z DB (D-161) do panela Presentation; odpoveď príde až po ops, ale `VIEW_ACTIVATE` z ops
          // si pohľad hľadá vo vieweri, preto ju fork zaradí do brány príkazov za ne.
          loadViews();
          // Ops až po podkladoch, dokumentoch a pinoch (D-083): `view:2d` potrebuje
          // vedieť, či má podlažie kalibrovaný výkres, a `doc` otvorí len dokument,
          // ktorý viewer už dostal v DOCUMENTS_LOAD.
          if (ops && !restored) applyOps(ops);
          // Flush príkazov vydaných pred načítaním modelov (viď send()).
          const queued = pendingRef.current;
          pendingRef.current = [];
          for (const msg of queued) post(msg);
          // D-101: potvrdenie príkazu, ktorý prišiel navigáciou, a príkazy na mieste spred načítania.
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
          // AIM kartu si viewer čistí sám pri deselekcii; tu stačí zahodiť
          // rozbehnutý fetch, aby stale odpoveď nešla do ďalšej selekcie.
          aimAbortRef.current?.abort();
          aimGuidRef.current = null;
          break;
        case "AIM_NAVIGATE": {
          // Len host-relatívne cesty — obrana pred navigáciou na cudzie URL.
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
          // D-075: zatiaľ bez host-side využitia (kandidát: recents/analytics).
          // Prijíma sa naschvál — neznámy typ by inak skončil ako šum v konzole
          // budúceho stricter handlera.
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
        case "UNDERLAY_SAVE": {
          // Kalibrácia z viewera → perzistuj _georef (D-072). Server payload
          // validuje (isValidGeorefV1) a zapína/vypína zápis env bránou.
          const { documentId, georef } = e.data;
          if (typeof documentId !== "string" || documentId.length === 0) return;
          void fetch(`/api/underlay/${encodeURIComponent(documentId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ georef }),
          })
            .then(async (r) => {
              if (r.ok) return setSaveError(null);
              const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
              throw new Error(`${r.status}${typeof body?.error === "string" ? `: ${body.error}` : ""}`);
            })
            .catch((err: unknown) => {
              // Kalibrácia žije vo viewri aj bez zápisu, po obnove stránky by sa ale stratila:
              // používateľ to musí vidieť, nielen konzola (#317).
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
    // Spätný kanál (D-085): otázku pošli forku až s naparsovanými modelmi.
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

  // ── Focus (karta/AI dock → 3D), reaktívne pri soft-nav (D-056). Pred
  // MODELS_LOADED sa cez send() queue-uje (počiatočný ?focus= z URL posiela
  // handler MODELS_LOADED sám — pred READY sa preto neposiela nič).
  useEffect(() => {
    if (!readyRef.current || !focus) return;
    if (focusNonce && focusNonce === liveNonceRef.current) return; // už vykonané na mieste (D-101)
    send({ type: "FOCUS", guids: focus.split(",") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, focusNonce]);

  // ── Viewer ops AI docku (ofarbenie/skrytie/izolácia, D-066) pri soft-nav.
  // Pred MODELS_LOADED nemá zmysel posielať (GUIDy sa nedajú resolvnúť) —
  // počiatočné ops aplikuje handler MODELS_LOADED vyššie.
  useEffect(() => {
    if (!loadedRef.current || !ops) return;
    if (focusNonce && focusNonce === liveNonceRef.current) return; // už vykonané na mieste (D-101)
    applyOps(ops);
    requestAck(takePendingCmdIds());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, focusNonce]);

  // ── Reality Capture piny (D-073) — re-send po zmene (napr. po uploade +
  // router.refresh()). Pred MODELS_LOADED sa piny pošlú v jeho handleri vyššie.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "CAPTURES_LOAD", captures: toCapturePins(captures ?? []) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures]);

  // ── Dokumenty (D-075) — re-send po zmene (router.refresh po ETL/uploade).
  // Pred MODELS_LOADED ich pošle handler MODELS_LOADED vyššie.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "DOCUMENTS_LOAD", documents: documents ?? [] });
    post({ type: "DOCUMENT_LINKS", documents: documentLinks ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, documentLinks]);

  // ── AIM dekorácie stromu (D-077) — re-send po zmene (router.refresh po ETL).
  // Pred MODELS_LOADED ich pošle handler MODELS_LOADED vyššie.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "AIM_TREE_DECORATIONS", decorations: decorations ?? {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorations]);

  // ── BCF témy (D-099) — po zápise z chatu príde udalosť zo živého kanála.
  useEffect(() => {
    const reload = () => {
      if (loadedRef.current) post(bcfLoadMessage(window.location.origin));
    };
    window.addEventListener(BCF_CHANGED_WINDOW_EVENT, reload);
    return () => window.removeEventListener(BCF_CHANGED_WINDOW_EVENT, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pohľady (D-161) — chat ich premenoval, zmazal alebo prepísal: zoznam z DB znova.
  useEffect(() => {
    const reload = () => {
      if (loadedRef.current) loadViews();
    };
    window.addEventListener(VIEWS_CHANGED_WINDOW_EVENT, reload);
    return () => window.removeEventListener(VIEWS_CHANGED_WINDOW_EVENT, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Vrstva AIM (D-089) — re-send po zmene (router.refresh po novej revízii).
  useEffect(() => {
    if (!loadedRef.current || !derivations) return;
    post({ type: "AIM_DERIVATIONS_LOAD", layer: derivations });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivations]);

  // ── `?doc=` deep link pri soft-navigácii (D-075): handler MODELS_LOADED ho
  // pokrýva len pri prvom otvorení stránky — na už načítanej scéne sa iframe
  // neremountuje a MODELS_LOADED znova nepríde, takže sa posiela reaktívne.
  useEffect(() => {
    if (!loadedRef.current || !openDocumentId) return;
    post({ type: "DOCUMENT_OPEN", documentId: openDocumentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDocumentId]);

  // Misconfigurácia (nevalidná NEXT_PUBLIC_IFC_VIEWER_URL) — fail-closed UI.
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
        className={`h-full w-full border-0${status === "loading" ? " pointer-events-none" : ""}`}
        onError={() => setStatus("error")}
        allow="fullscreen"
      />

      {/* Nepriehľadný overlay — kým sa nenačíta federácia, nesmie presvitať
          ifc-lite úvodná obrazovka s ich logom (D-163: biele pozadie + animované logo). */}
      {status === "loading" && <LoadingLogo label="Načítavam 3D scénu" />}

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
