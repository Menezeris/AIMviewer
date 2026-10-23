import type { ToolDefinition } from "../llm/provider";

/** Definícia diagnostického toolu (D-084 fáza 0) - bez závislostí motora, aby
 * ju route mohla importovať staticky; implementácia je v `./probe` (lenivo). */
export const PROBE_TOOL: ToolDefinition = {
  name: "ifc_engine_probe",
  description:
    "DIAGNOSTIKA (len preview, D-084 fáza 0): zmeria IFC motor @ifc-lite/mcp v tejto " +
    "funkcii - načítanie modelov federácie, dotaz s číselným filtrom, voliteľne kolízie. " +
    "Nepoužívaj na otázky používateľa.",
  inputSchema: {
    type: "object",
    properties: {
      runs: { type: "number", description: "Počet opakovaní dotazu (1-10, default 3)" },
      clash: { type: "boolean", description: "Zmerať aj clash_check na VZT (default false)" },
      clash_asr_vzt: { type: "boolean", description: "Zmerať kolízie ASR x VZT federovane (D-164): tesselácia, oba predvolené testy" },
    },
  },
};
