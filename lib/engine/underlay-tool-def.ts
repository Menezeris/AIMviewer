import type { ToolDefinition } from "../llm/provider";

/**
 * Definícia `calibrate_underlay` (D-133) bez závislostí motora, aby ju MCP route a zoznam
 * toolov importovali staticky (vzor `tool-defs.ts`); vykonanie je v `underlay-tool.ts`.
 */

export const CALIBRATE_UNDERLAY_MODES = ["dry_run", "auto", "manual"] as const;
export type Mode = (typeof CALIBRATE_UNDERLAY_MODES)[number];

/** Pôdorysný rez nad podlahou (m), ako 2D pohľad viewera. */
export const PLAN_CUT_M = 1.2;
/** Predvolený strop chyby pre zápis (medián, mm). */
export const DEFAULT_MAX_ERROR_MM = 50;

export const CALIBRATE_UNDERLAY_TOOL: ToolDefinition = {
  name: "calibrate_underlay",
  description:
    "KALIBRÁCIA PODKLADU výkresu (PDF strana) pod IFC model (D-133): mierka, rotácia a posun strany voči modelu, " +
    "výsledok sa ukladá do kalibrácie dokumentu (panel Underlays vo vieweri). Pôdorys: floor (inak podlažie, na " +
    "ktoré je dokument naviazaný); rez: section_plane {axis: x|y, coordinate_m} = zvislá rovina X alebo Y v IFC " +
    "metroch. mode=dry_run (predvolené) len vypočíta a ukáže kvalitu, nič neuloží; auto vypočíta (popisky " +
    "miestností alebo výškové kóty ako štart, potom zhoda čiar výkresu s rezom modelu) a uloží, ak medián chyby " +
    "nepresiahne max_error_mm; manual = vlastné dvojice bodov (pairs: bod strany v % ako region, vľavo hore, a bod " +
    "modelu v m), refine ich doladí na čiary. Ručnú kalibráciu (z panela) auto neprepíše bez force. Ukladaj (auto, " +
    "manual) len na výslovný pokyn používateľa; inak dry_run a výsledok mu ukáž. Mierka výsledku sa kontroluje " +
    "(scale_check): proti scale, mierke z textu strany (MERÍTKO 1 : 50) alebo bežným mierkam; auto pri odchýlke " +
    "neuloží ani pri nízkom mediáne. Strana bez čiar (raster) ide len cez manual s pairs.",
  inputSchema: {
    type: "object",
    properties: {
      document_id: { type: "string", description: "Dokument výkresu: UUID alebo object_ref (napr. OCB_SO01_ASR_D-1-1-01_PODORYS-1NP)" },
      page: { type: "number", description: "Strana PDF (od 1, predvolene 1)" },
      mode: { type: "string", enum: [...CALIBRATE_UNDERLAY_MODES] },
      floor: { type: "string", description: "Pôdorys: podlažie (meno alebo IFC GUID, napr. 1NP)" },
      section_plane: {
        type: "object",
        description: "Rez: zvislá rovina rezu, axis x = rovina X = coordinate_m (rez ide po Y), axis y = rovina Y = coordinate_m",
        properties: { axis: { type: "string", enum: ["x", "y"] }, coordinate_m: { type: "number" } },
        required: ["axis", "coordinate_m"],
      },
      pairs: {
        type: "array",
        maxItems: 20,
        description: "manual: dvojice {page_pct: [x, y] v % strany vľavo hore, model_m: [u, v]}; pôdorys u, v = IFC X, Y; rez u = súradnica po reze, v = Z",
        items: {
          type: "object",
          properties: {
            page_pct: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
            model_m: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          },
          required: ["page_pct", "model_m"],
        },
      },
      scale: { type: "number", description: "Mierka výkresu 1:N (napr. 50): pevná v štarte aj doladení, ICP rieši len rotáciu a posun; inak sa vezme z textu strany" },
      refine: { type: "boolean", description: "manual: doladiť dvojice na čiary výkresu (predvolene true)" },
      max_error_mm: { type: "number", description: `Strop mediánu chyby pre uloženie (predvolene ${DEFAULT_MAX_ERROR_MM})` },
      force: { type: "boolean", description: "Prepísať aj ručnú kalibráciu z panela Underlays" },
      model: { type: "string", description: "Model federácie s konštrukciami (predvolene prvý, ASR)" },
    },
    required: ["document_id"],
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};
