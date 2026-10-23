import "server-only";

import { defaultBcfDeps } from "./runtime";
import type { BcfDeps } from "./tools";

/**
 * Závislosti BCF tools v MCP konektore: ako BCF API (`defaultBcfDeps`) a navyše IFC motor a
 * graf entít pre `bcf_topic action=locate` a `bcf_topic_list entity` (D-158 krok 4). Oddelené,
 * aby si route BCF API (viewer) nepribalila IFC motor, ktorý nepoužíva.
 */
export function bcfToolDeps(): BcfDeps {
  return {
    ...defaultBcfDeps(),
    regionModel: async () => (await import("./region-runtime")).loadRegionModel(),
    entityScope: async (ref) => (await import("./entity-scope-runtime")).entityScope(ref),
  };
}
