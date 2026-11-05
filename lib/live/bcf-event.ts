/**
 * The "BCF topics changed" event (D-099 addendum): the server sends it to the live channel
 * after a topic write (MCP tools, BCF API); the client (`components/live-channel.tsx`)
 * forwards it to the window and the viewer (`components/ifc-viewer.tsx`) reloads the topics. No
 * server dependencies, the client reads it too.
 */

/** Event in the live channel (Supabase Realtime Broadcast). */
export const LIVE_BCF_EVENT = "bcf_topics";

/** Window event between the live channel and the viewer on the same page. */
export const BCF_CHANGED_WINDOW_EVENT = "aim:bcf-topics-changed";

/**
 * Legacy BCF project id (`lib/bcf/api.ts` LEGACY_PROJECT_ID): before D-189 the only project was `aim`;
 * the API still accepts it as the request's project.
 */
export const BCF_VIEWER_PROJECT = "aim";

/**
 * Bridge message for the viewer: where to load the topics from (BCF API on this origin, no token). The BCF
 * project id is the AIM project code (D-189); the viewer calls the API cross-origin without cookies,
 * so the project rides in the path.
 */
export function bcfLoadMessage(origin: string, projectCode?: string): { type: "AIM_BCF_LOAD"; baseUrl: string; projectId: string } {
  return { type: "AIM_BCF_LOAD", baseUrl: `${origin.replace(/\/$/, "")}/api/bcf`, projectId: projectCode || BCF_VIEWER_PROJECT };
}
