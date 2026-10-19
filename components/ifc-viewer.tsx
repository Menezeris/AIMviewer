"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { nodeSummaryToAimPanel, type ElementDetail } from "@/lib/aim-panel";
import type { SelectedElement } from "@/lib/data/drawing";
import type { UnderlayDrawingWire } from "@/lib/data/drawing";
import type { DocumentWire } from "@/lib/data/documents";
import type { CaptureViewerWire } from "@/lib/data/captures";
import type { TreeDecorations } from "@/lib/data/decoration-counts";
import type { DerivationsLayerWire } from "@/lib/derivations";
import type { GuidMap, IfcModel } from "@/lib/data/ifc";
import type { ViewerApi } from "@/lib/viewer-api";
import { opToBridgeMessage, parseOps } from "@/lib/viewer-ops";
import { MAX_ZONE_GUIDS, lensBridgeMessage, lensZoneIds } from "@/lib/viewer-lens";
import type { LiveReplyPayload } from "@/lib/live/protocol";
import { setViewerQueryHandler } from "@/lib/live/viewer-query-bus";

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
 *                   AIM_PANEL_DATA{guid,data} · AIM_PANEL_EMPTY{guid,reason} ·
 *                   AIM_DERIVATIONS_LOAD{layer} (D-089; vrstva AIM nad modelmi,
 *                   typy v lib/derivations.ts)
 *   viewer → host:  READY · MODELS_LOADED · ENTITY_SELECTED{guid} ·
 *                   ENTITY_DESELECTED · AIM_NAVIGATE{href}
 *
 * AIM karta: po ENTITY_SELECTED host dotiahne DB súhrn (/api/element/{id})
 * a pošle ho ako render schému (lib/aim-panel.ts) do natívneho panelu
 * viewera — jeden panel namiesto dvoch. Kliky v karte chodia späť cez
 * AIM_NAVIGATE a naviguje ich parent appka.
 */

const SOURCE = "aim-bridge" as const;

/** URL nasadeného IFClite vieweru. Override cez NEXT_PUBLIC_IFC_VIEWER_URL. */
const VIEWER_URL =
  process.env.NEXT_PUBLIC_IFC_VIEWER_URL ?? "https://ifc-lite-viewer.vercel.app";

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
  // Odpoveď na QUERY spätného kanála (D-085) - obálky, stav pohľadu.
  | { source: typeof SOURCE; type: "QUERY_RESULT"; id: string; ok: boolean; result?: unknown; error?: string };

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

/** GUIDy zón (miestnosti + prvky v nich a dotýkajúce sa ich) z `/api/style-scope`; chyba = prázdna zóna. */
async function fetchZoneGuids(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`/api/style-scope?zone=${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { guids?: unknown };
        const guids = Array.isArray(body.guids) ? body.guids.filter((g): g is string => typeof g === "string") : [];
        out.set(id, guids.slice(0, MAX_ZONE_GUIDS));
      } catch (err) {
        console.warn("[aim] zóna pre lens sa nenačítala", id, err);
      }
    }),
  );
  return out;
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
  apiRef?: React.RefObject<ViewerApi | null>;
  onSelect?: (element: SelectedElement) => void;
  onPickedElement?: (objectId: string, guid: string) => void;
  /** Navigácia z AIM karty vo viewri (host-relatívne href, napr. /node/{id}). */
  onNavigate?: (href: string) => void;
  /** Klik na capture pin v 3D (D-073) — host otvorí galériu/panorámu. */
  onCaptureClick?: (captureId: string) => void;
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
  apiRef,
  onSelect,
  onPickedElement,
  onNavigate,
  onCaptureClick,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
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
      return new URL(VIEWER_URL).origin;
    } catch {
      return null;
    }
  }, []);

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
    const u = new URL(VIEWER_URL);
    u.searchParams.set("models", models.map((m) => m.url).join(","));
    return u.toString();
  }, [models, viewerOrigin]);

  // Stabilný kľúč — iframe sa remountuje len keď sa zmenia URL modelov.
  const modelsKey = models.map((m) => m.url).join("|");

  // Reset stavu pri zmene modelov — React pattern „adjust state during render"
  // (nie setState v effekte). V praxi sa modely počas session nemenia.
  const [prevModelsKey, setPrevModelsKey] = useState(modelsKey);
  if (modelsKey !== prevModelsKey) {
    setPrevModelsKey(modelsKey);
    setStatus("loading");
  }

  function post(msg: Record<string, unknown>) {
    if (!viewerOrigin) return;
    iframeRef.current?.contentWindow?.postMessage(
      { source: SOURCE, ...msg },
      viewerOrigin
    );
  }

  // GUID-nosné príkazy vydané pred MODELS_LOADED (klik na „3D: N prvkov" počas
  // parsovania, soft-nav focus) by viewer zahodil — resolveGuids pred
  // naparsovaním modelov nič nenájde. Queue-ujú sa a flushnú v handleri
  // MODELS_LOADED (prenesené z už zmazaného ifc-viewer-embed.tsx).
  const pendingRef = useRef<Record<string, unknown>[]>([]);
  // Otázky D-085 čakajúce na QUERY_RESULT z iframu, podľa id.
  const queriesRef = useRef(new Map<string, (r: LiveReplyPayload) => void>());
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
    for (const o of parseOps(raw)) {
      if (o.op === "lens" && lensZoneIds(o.wire).length > 0) {
        // Zóna z grafu AIM (D-096): GUIDy jej miestností a prvkov si klient stiahne sám.
        void fetchZoneGuids(lensZoneIds(o.wire)).then((zones) => post(lensBridgeMessage(o.mode, o.wire, zones, o.rev)));
        continue;
      }
      post(opToBridgeMessage(o));
      // Reset farieb vypne aj AIM chat lens, zobraziť všetko zruší jej izoláciu (D-096).
      if (o.op === "reset_colors") post({ type: "APPLY_LENS", mode: "clear" });
      if (o.op === "show_all") post({ type: "APPLY_LENS", mode: "unisolate" });
    }
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
          // Overlay zhoď už na READY: počas ?models= autoloadu si viewer
          // úvodku prekrýva sám vlastným veilom (AimBridge vo forku) a po
          // prvom modeli sa odkrýva progresívne — držať overlay do
          // MODELS_LOADED by znamenalo čakať naslepo na celú federáciu.
          setStatus("ready");
          // Naplň ViewerApi až po READY — presne ako pôvodný kontrakt, kde
          // apiRef.current bol null pred načítaním scény.
          if (apiRef) apiRef.current = makeApi();
          break;
        }
        case "MODELS_LOADED": {
          // Modely sú naparsované — až teraz vie resolveGuids nájsť prvok.
          // Počiatočný deep-link focus/ops (?focus=…&ops=…) aplikuj tu, nie na READY.
          loadedRef.current = true;
          setStatus("ready");
          if (focus) post({ type: "FOCUS", guids: focus.split(",") });
          // PDF podklady (D-072) — až po naparsovaní modelov, aby viewer vedel
          // resolvnúť storey GUIDy z placementov.
          if (underlays && underlays.length > 0) {
            post({ type: "UNDERLAYS_LOAD", drawings: underlays });
          }
          // Knižnica dokumentov (D-075) — rovnaký timing slot; kalibrované
          // výkresy idú v oboch správach (prepojenie cez documentId/storeyGuid).
          if (documents && documents.length > 0) {
            post({ type: "DOCUMENTS_LOAD", documents });
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
          // Ops až po podkladoch, dokumentoch a pinoch (D-083): `view:2d` potrebuje
          // vedieť, či má podlažie kalibrovaný výkres, a `doc` otvorí len dokument,
          // ktorý viewer už dostal v DOCUMENTS_LOAD.
          if (ops) applyOps(ops);
          // Flush príkazov vydaných pred načítaním modelov (viď send()).
          const queued = pendingRef.current;
          pendingRef.current = [];
          for (const msg of queued) post(msg);
          break;
        }
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
        case "DOCUMENT_EVENT":
          // D-075: zatiaľ bez host-side využitia (kandidát: recents/analytics).
          // Prijíma sa naschvál — neznámy typ by inak skončil ako šum v konzole
          // budúceho stricter handlera.
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
            .then((r) => {
              if (!r.ok) throw new Error(String(r.status));
            })
            .catch((err: unknown) => {
              // Best-effort: kalibrácia žije vo viewri aj bez zápisu; zaloguj,
              // nech je zamietnutý zápis (napr. vypnutá brána) viditeľný.
              console.error("underlay save failed", err);
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
    const unregisterQueries = setViewerQueryHandler(
      (q) =>
        new Promise<LiveReplyPayload>((resolve) => {
          if (!loadedRef.current) {
            resolve({ id: q.id, ok: false, error: "3D viewer ešte načítava model." });
            return;
          }
          const timer = setTimeout(() => {
            pendingQueries.delete(q.id);
            resolve({ id: q.id, ok: false, error: "3D viewer neodpovedal." });
          }, q.query === "lens_state" ? LENS_QUERY_TIMEOUT_MS : VIEWER_QUERY_TIMEOUT_MS);
          pendingQueries.set(q.id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
          if (q.query === "lens_state") {
            // Počty AIM chat lens (D-096): viewer počká na vyhodnotenie verzie `rev`.
            post({ type: "LENS_QUERY", id: q.id, ...(q.rev ? { rev: q.rev } : {}) });
            return;
          }
          post({ type: "QUERY", id: q.id, query: q.query, ...(q.guids ? { guids: q.guids } : {}) });
        }),
    );
    return () => {
      window.removeEventListener("message", onMessage);
      unregisterQueries();
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
    send({ type: "FOCUS", guids: focus.split(",") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, focusNonce]);

  // ── Viewer ops AI docku (ofarbenie/skrytie/izolácia, D-066) pri soft-nav.
  // Pred MODELS_LOADED nemá zmysel posielať (GUIDy sa nedajú resolvnúť) —
  // počiatočné ops aplikuje handler MODELS_LOADED vyššie.
  useEffect(() => {
    if (!loadedRef.current || !ops) return;
    applyOps(ops);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents]);

  // ── AIM dekorácie stromu (D-077) — re-send po zmene (router.refresh po ETL).
  // Pred MODELS_LOADED ich pošle handler MODELS_LOADED vyššie.
  useEffect(() => {
    if (!loadedRef.current) return;
    post({ type: "AIM_TREE_DECORATIONS", decorations: decorations ?? {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorations]);

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
            nie je platná URL: <code className="rounded bg-muted px-1">{VIEWER_URL}</code>
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
        className="h-full w-full border-0"
        onError={() => setStatus("error")}
        allow="fullscreen"
      />

      {/* Nepriehľadný overlay — kým sa nenačíta federácia, nesmie presvitať
          ifc-lite úvodná obrazovka s ich logom. */}
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">Načítavam 3D scénu…</span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <span className="text-sm font-semibold text-destructive">
            Chyba pri načítaní 3D prehliadača
          </span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Skontrolujte dostupnosť vieweru na{" "}
            <code className="rounded bg-muted px-1">{VIEWER_URL}</code> alebo
            nastavte <code className="rounded bg-muted px-1">NEXT_PUBLIC_IFC_VIEWER_URL</code>.
          </span>
        </div>
      )}
    </div>
  );
}
