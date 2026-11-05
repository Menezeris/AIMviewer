import "server-only";

import { defaultBcfDeps } from "./runtime";
import type { BcfDeps } from "./tools";

/**
 * Dependencies of the BCF tools in the MCP connector: as the BCF API (`defaultBcfDeps`) plus the IFC engine and
 * the entity graph for `bcf_topic action=locate` and `bcf_topic_list entity` (D-158 step 4). Separate,
 * so that the BCF API route (viewer) does not bundle an IFC engine it does not use.
 */
export function bcfToolDeps(): BcfDeps {
  return {
    ...defaultBcfDeps(),
    regionModel: async () => (await import("./region-runtime")).loadRegionModel(),
    entityScope: async (ref) => (await import("./entity-scope-runtime")).entityScope(ref),
  };
}
