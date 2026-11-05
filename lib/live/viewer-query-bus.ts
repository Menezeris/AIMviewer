import type { LiveQueryPayload, LiveReplyPayload } from "./protocol";

/**
 * Browser bridge between the live channel (`components/live-channel.tsx`) and the
 * embedded viewer (`components/ifc-viewer.tsx`) for D-085 questions. The viewer
 * registers when it has models loaded; without it the channel answers with an error immediately,
 * not only after the server timeout.
 */

export type ViewerQueryHandler = (q: LiveQueryPayload) => Promise<LiveReplyPayload>;

let handler: ViewerQueryHandler | null = null;

/** Returns the unregister function - cancels only its own handler, not a later one. */
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
