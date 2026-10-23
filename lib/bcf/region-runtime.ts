import "server-only";

import { getIfcModels } from "../data/ifc-models";
import { installArchiveSource } from "../engine/archive-source";
import { ifcBox, meshModel } from "../engine/measure";
import { modelsFor, type EngineDeps } from "../engine/tools";
import { ifcPositions } from "../engine/underlay-model";

import type { RegionElement } from "./region-model";

/**
 * Prvky federácie pre `bcf_topic action=locate` (D-158 krok 4): meshe IFC motora (cache na
 * revíziu, D-124) v IFC svete, tom istom rámci ako `_georef` a viewer. Body trojuholníkov sa
 * prepočítajú až pre prvok, ktorého obálka prešla predvýberom (lenivý getter).
 */

// D-135: modely motora z nemenného archívu revízie.
installArchiveSource();

export interface RegionModel {
  elements: RegionElement[];
  /** Výšky podlaží (m) zo všetkých modelov, vzostupne; horná hrana podlažia = ďalšia. */
  elevations: number[];
}

export async function loadRegionModel(): Promise<RegionModel> {
  const ids = getIfcModels().map((m) => m.id);
  const { models } = await modelsFor(ids, {} as EngineDeps);
  const elements: RegionElement[] = [];
  const levels = new Set<number>();
  for (const m of models) {
    const elev = (m.store as { spatialHierarchy?: { storeyElevations?: Map<number, number> } }).spatialHierarchy?.storeyElevations;
    for (const z of elev?.values() ?? []) if (Number.isFinite(z)) levels.add(Math.round(z * 1000) / 1000);
    for (const e of (await meshModel(m)).values()) {
      const off = e.worldOffset ?? [0, 0, 0];
      const b = ifcBox(e.bounds);
      let cached: Float64Array | null = null;
      elements.push({
        globalId: e.globalId,
        ifcType: e.ifcType,
        name: e.name,
        model: e.model,
        indices: e.indices,
        get positions() {
          cached ??= ifcPositions(e);
          return cached;
        },
        min: [b.min[0] + off[0], b.min[1] + off[1], b.min[2] + off[2]],
        max: [b.max[0] + off[0], b.max[1] + off[1], b.max[2] + off[2]],
      });
    }
  }
  return { elements, elevations: [...levels].sort((a, b) => a - b) };
}
