/**
 * The "saved views changed" event (D-161): the server sends it to the live channel after a view is written from the chat
 * (rename, delete, overwrite); the client (`components/live-channel.tsx`) forwards it to the window and the viewer
 * (`components/ifc-viewer.tsx`) reloads the list from `/api/saved-views` and sends it as `VIEWS_LOAD`.
 * Pattern of `bcf-event.ts`, no server dependencies.
 */

/** Event in the live channel (Supabase Realtime Broadcast). */
export const LIVE_VIEWS_EVENT = "saved_views";

/** Window event between the live channel and the viewer on the same page. */
export const VIEWS_CHANGED_WINDOW_EVENT = "aim:saved-views-changed";
