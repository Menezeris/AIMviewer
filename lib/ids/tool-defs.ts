import type { ToolDefinition } from "../llm/provider";

/**
 * Definície toolu `ids_document` (D-162) - bez závislostí motora, aby ich MCP route mohla
 * importovať staticky; vykonanie je v `./tools` (lenivo).
 */

export const IDS_ACTIONS = ["list", "get", "create", "apply_ops", "versions", "diff", "export", "open", "from_viewer"] as const;
export type IdsAction = (typeof IDS_ACTIONS)[number];

export const DEFAULT_IDS_AUTHOR = "Claude (MCP)";

export const IDS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "ids_document",
    description:
      "IDS DOKUMENTY v AIM (D-162): požiadavky na model (IDS 1.0), ktoré Claude tvorí, upravuje a ukladá s verziami. " +
      "Pôvod library = snímka z knižnice požiadaviek, len na čítanie (úprava = create s derived_from); chat = pracovné IDS, " +
      "nie je z knižnice. Nositeľ je XML, každá zmena je nová nemenná verzia. action: list | get (špecifikácie a facety, " +
      "include_xml) | create (code, title + jedno z xml / derived_from / ops; prázdne IDS neprejde auditom) | apply_ops " +
      "(ids, ops = typované operácie IDS ops v1 z @ifc-lite/mcp ids_apply_ops, brána voči IFC schéme; odmietnutá dávka " +
      "vráti kódy, cesty a kandidátov a nič neuloží; bez ops vráti schému operácií; ids špecifikácií a facetov dá get) | " +
      "versions | diff (from_version, to_version) | export (XML, odkaz na stiahnutie) | open (ukáže IDS vo vieweri: target=studio " +
      "(editor) alebo validation (Data validation, kontrola s počtami po špecifikáciách a ofarbením 3D); run=true spustí kontrolu, " +
      "spec zúži beh na jednu špecifikáciu) | from_viewer (uloží IDS upravené používateľom vo vieweri ako novú verziu; ids_local " +
      "v get_viewer_state; konflikt verzie vráti zmeny). " +
      "Kontrola modelu voči IDS = ifc_ids_validate(ids=kód, save). Žiadny beh IDS nie je záväzný.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...IDS_ACTIONS] },
        ids: { type: "string", description: "Kód IDS (ER-0101_ARCH); pre všetky akcie okrem list, create a from_viewer (tam voliteľne iný kód = uložiť ako to)" },
        version: { type: "number", description: "get, export, open: číslo verzie (default posledná)" },
        include_xml: { type: "boolean", description: "get: pridať XML" },
        code: { type: "string", description: "create: kód nového IDS (písmená, čísla, . _ -; max 80)" },
        title: { type: "string", description: "create: názov (ids:info/title); default z XML alebo zdroja" },
        xml: { type: "string", description: "create: hotové IDS XML (musí prejsť auditom)" },
        derived_from: { type: "string", description: "create: kód knižničného IDS, z ktorého sa urobí pracovná kópia" },
        derived_from_version: { type: "number", description: "create: verzia snímky (default posledná)" },
        ops: { type: "array", items: { type: "object" }, description: "create (do prázdneho IDS) a apply_ops: operácie (chýbajúce opId sa doplní)" },
        target: { type: "string", enum: ["studio", "validation"], description: "open, from_viewer: panel IDS Studio alebo Data validation (open: default studio, s run alebo spec validation)" },
        spec: { type: "string", description: "open: identifikátor alebo názov špecifikácie; run sa obmedzí na ňu" },
        run: { type: "boolean", description: "open (target=validation): spustiť kontrolu po otvorení" },
        base_version: { type: "number", description: "apply_ops, from_viewer: z ktorej verzie úprava vychádza; ak nie je posledná, konflikt" },
        note: { type: "string", description: "create, apply_ops: poznámka k verzii" },
        from_version: { type: "number", description: "diff: starší stav (default predposledná)" },
        to_version: { type: "number", description: "diff: novší stav (default posledná)" },
        author: { type: "string", description: `Kto ukladá (default '${DEFAULT_IDS_AUTHOR}')` },
      },
      required: ["action"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

export const IDS_TOOL_NAMES: ReadonlySet<string> = new Set(IDS_TOOL_DEFINITIONS.map((t) => t.name));
