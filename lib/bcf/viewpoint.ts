import { randomUUID } from "node:crypto";

/**
 * BCF viewpoint DTO (BCF API 2.1, snake_case) -> stored topic viewpoint (D-099).
 * Shared by the BCF API (viewpoint from the panel) and saving local topics from the viewer (D-158).
 */

/** BCF viewpoint DTO from the panel -> stored viewpoint and GlobalId of the selection. */
export function viewpointFromDto(dto: Record<string, unknown>): { viewpoint: Record<string, unknown>; selection: string[] } {
  const comps = (dto.components ?? {}) as { selection?: { ifc_guid?: unknown }[] };
  const selection = [
    ...new Set(
      (comps.selection ?? []).map((c) => c?.ifc_guid).filter((g): g is string => typeof g === "string" && g !== ""),
    ),
  ];
  const rest: Record<string, unknown> = { ...dto };
  // The snapshot is not there yet (D-099 phase D); elements go to the topic `components`.
  delete rest.snapshot;
  delete rest.components;
  delete rest.guid;
  const guid = typeof dto.guid === "string" && dto.guid ? dto.guid : randomUUID();
  return { viewpoint: { guid, source: "bcf", bcf: rest }, selection };
}
