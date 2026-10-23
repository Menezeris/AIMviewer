import { randomUUID } from "node:crypto";

/**
 * BCF viewpoint DTO (BCF API 2.1, snake_case) -> uložený pohľad témy (D-099).
 * Spoločné pre BCF API (pohľad z panela) a uloženie lokálnych tém z viewera (D-158).
 */

/** BCF viewpoint DTO z panela -> uložený pohľad a GlobalId výberu. */
export function viewpointFromDto(dto: Record<string, unknown>): { viewpoint: Record<string, unknown>; selection: string[] } {
  const comps = (dto.components ?? {}) as { selection?: { ifc_guid?: unknown }[] };
  const selection = [
    ...new Set(
      (comps.selection ?? []).map((c) => c?.ifc_guid).filter((g): g is string => typeof g === "string" && g !== ""),
    ),
  ];
  const rest: Record<string, unknown> = { ...dto };
  // Snímka zatiaľ nie je (D-099 fáza D); prvky idú do `components` témy.
  delete rest.snapshot;
  delete rest.components;
  delete rest.guid;
  const guid = typeof dto.guid === "string" && dto.guid ? dto.guid : randomUUID();
  return { viewpoint: { guid, source: "bcf", bcf: rest }, selection };
}
