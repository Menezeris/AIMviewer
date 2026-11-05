/**
 * Udalosť "témy BCF sa zmenili" (D-099 dodatok): server ju pošle na živý kanál
 * po zápise témy (MCP tools, BCF API); klient (`components/live-channel.tsx`) ju
 * prepošle oknu a viewer (`components/ifc-viewer.tsx`) témy načíta znova. Bez
 * závislostí na serveri, číta ju aj klient.
 */

/** Udalosť v živom kanáli (Supabase Realtime Broadcast). */
export const LIVE_BCF_EVENT = "bcf_topics";

/** Udalosť okna medzi živým kanálom a viewerom na tej istej stránke. */
export const BCF_CHANGED_WINDOW_EVENT = "aim:bcf-topics-changed";

/**
 * Legacy BCF project id (`lib/bcf/api.ts` LEGACY_PROJECT_ID): before D-189 the only project was `aim`;
 * the API still accepts it as the request's project.
 */
export const BCF_VIEWER_PROJECT = "aim";

/**
 * Správa mostu pre viewer: odkiaľ si má témy načítať (BCF API na tomto origine, bez tokenu). The BCF
 * project id is the AIM project code (D-189); the viewer calls the API cross-origin without cookies,
 * so the project rides in the path.
 */
export function bcfLoadMessage(origin: string, projectCode?: string): { type: "AIM_BCF_LOAD"; baseUrl: string; projectId: string } {
  return { type: "AIM_BCF_LOAD", baseUrl: `${origin.replace(/\/$/, "")}/api/bcf`, projectId: projectCode || BCF_VIEWER_PROJECT };
}
