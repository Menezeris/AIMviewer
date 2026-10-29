import type { ToolDefinition } from "../llm/provider";

/**
 * Definícia `calibrate_underlay` (D-133) bez závislostí motora, aby ju MCP route a zoznam
 * toolov importovali staticky (vzor `tool-defs.ts`); vykonanie je v `underlay-tool.ts`.
 */

export const CALIBRATE_UNDERLAY_MODES = ["dry_run", "auto", "manual"] as const;
export type Mode = (typeof CALIBRATE_UNDERLAY_MODES)[number];

/** Režimy ovládania podkladov (D-168): menia len viditeľnosť a priehľadnosť, nie polohu; logika v `underlay-control.ts`. */
export const UNDERLAY_CONTROL_MODE_NAMES = ["list", "show_in_3d", "hide", "set_opacity", "history", "restore"] as const;

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
    "neuloží ani pri nízkom mediáne. Strana bez čiar (raster) ide len cez manual s pairs. " +
    "OVLÁDANIE PODKLADOV (D-168, nič sa nepočíta; list, show_in_3d, hide a set_opacity polohu nemenia): mode=list = zoznam kalibrovaných podkladov bez document_id " +
    "(document_id, object_ref, name, page, floor, visible a opacity vo vieweri, saved_visible a saved_opacity z DB, source auto|manual, " +
    "calibrated_at, underlays_3d; bez otvoreného viewera len z DB). mode=show_in_3d zapne podklad v 3D (document_id alebo floor; " +
    "only=true vypne ostatné kalibrované podklady, pre 'len 2NP'), mode=hide ho vypne, mode=set_opacity nastaví opacity 0 až 1. " +
    "Zmena je stav viewera; persist=true ju uloží do kalibrácie (visible a opacity, poloha a source ostanú) na pokyn používateľa. " +
    "HISTÓRIA KALIBRÁCIÍ: každý prepis polohy alebo kalibrácie strany (mode=auto, manual, úprava v paneli) uloží predošlú kalibráciu do " +
    "_georef.history (posledných 10, zmena len visible a opacity sa nezapisuje); mode=history (document_id alebo floor, page) vráti zoznam s index " +
    "(0 = najnovší), mode=restore (document_id alebo floor, page, index) vráti záznam do kalibrácie, aktuálnu uloží do histórie (obnova sa dá vrátiť) " +
    "a pošle viewerovi podklady nanovo; ukladaj ho len na výslovný pokyn. Globálny vypínač podkladov v 3D je set_view_mode(underlays_3d). Uložený pohľad (saved_view) nesie aj stav podkladov. " +
    "Vyžaduje nový viewer: starší jednotlivé podklady nezmení (tool to povie).",
  inputSchema: {
    type: "object",
    properties: {
      document_id: { type: "string", description: "Dokument výkresu: UUID alebo object_ref (napr. OCB_SO01_ASR_D-1-1-01_PODORYS-1NP); povinné okrem mode=list (show_in_3d, hide, set_opacity: alternatíva k floor)" },
      page: { type: "number", description: "Strana PDF (od 1, predvolene 1); pri ovládaní podkladov len kontrola: viewer pozná na dokumente jednu kalibrovanú stranu; history a restore: strana, ktorej história sa berie" },
      mode: { type: "string", enum: [...CALIBRATE_UNDERLAY_MODES, ...UNDERLAY_CONTROL_MODE_NAMES] },
      floor: { type: "string", description: "Pôdorys: podlažie (meno alebo IFC GUID, napr. 1NP); show_in_3d, hide, set_opacity: podklad podlažia (podľa storey_guid kalibrácie) namiesto document_id" },
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
      opacity: { type: "number", minimum: 0, maximum: 1, description: "set_opacity: priehľadnosť podkladu 0 až 1 (povinné)" },
      only: { type: "boolean", description: "show_in_3d: ostatné kalibrované podklady v 3D vypne (predvolene false)" },
      index: { type: "number", minimum: 0, description: "restore: index záznamu z mode=history (0 = najnovší)" },
      persist: { type: "boolean", description: "show_in_3d, hide, set_opacity: uložiť visible a opacity do kalibrácie (predvolene false = len stav viewera)" },
    },
    required: [],
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};
