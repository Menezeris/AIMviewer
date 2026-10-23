/**
 * Udalosť "uložené pohľady sa zmenili" (D-161): server ju pošle na živý kanál po zápise pohľadu z chatu
 * (premenovanie, zmazanie, prepísanie); klient (`components/live-channel.tsx`) ju prepošle oknu a viewer
 * (`components/ifc-viewer.tsx`) načíta zoznam z `/api/saved-views` znova a pošle ho ako `VIEWS_LOAD`.
 * Vzor `bcf-event.ts`, bez závislostí na serveri.
 */

/** Udalosť v živom kanáli (Supabase Realtime Broadcast). */
export const LIVE_VIEWS_EVENT = "saved_views";

/** Udalosť okna medzi živým kanálom a viewerom na tej istej stránke. */
export const VIEWS_CHANGED_WINDOW_EVENT = "aim:saved-views-changed";
