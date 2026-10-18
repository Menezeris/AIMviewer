import type { LiveQueryPayload, LiveReplyPayload } from "./protocol";

/**
 * Most v prehliadači medzi živým kanálom (`components/live-channel.tsx`) a
 * vloženým viewerom (`components/ifc-viewer.tsx`) pre otázky D-085. Viewer sa
 * zaregistruje, keď má načítané modely; bez neho kanál odpovie chybou hneď,
 * nie až po timeoute servera.
 */

export type ViewerQueryHandler = (q: LiveQueryPayload) => Promise<LiveReplyPayload>;

let handler: ViewerQueryHandler | null = null;

/** Vráti odregistrovanie - zruší len vlastný handler, nie neskorší. */
export function setViewerQueryHandler(h: ViewerQueryHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

export function answerViewerQuery(q: LiveQueryPayload): Promise<LiveReplyPayload> {
  if (!handler) return Promise.resolve({ id: q.id, ok: false, error: "3D viewer nemá načítaný model." });
  return handler(q);
}
