import { getIfcModels } from "../data/ifc-models";
import { CLASH_ACTIONS, CLASH_GROUPS } from "./clash-tests";
import type { ToolDefinition } from "../llm/provider";


/**
 * Definície `ifc_*` tools IFC motora (D-084) - bez závislostí motora, aby ich
 * MCP route mohla importovať staticky; vykonanie je v `./tools` (lenivo).
 */

export const OPS = ["=", "!=", ">", "<", ">=", "<=", "contains", "exists", "matches"] as const;

function modelEnum(): string[] {
  return getIfcModels().map((m) => m.id);
}

const whereSchema = {
  type: "array",
  maxItems: 3,
  description:
    "Podmienky na hodnoty psetov (AND), napr. [{pset:'Qto_SpaceBaseQuantities', name:'NetFloorArea', " +
    "op:'>', value:20}]. IFC atribút namiesto psetu: {attribute:'OverallWidth', op:'<', value:900} (jednotky " +
    "súboru, na ASR mm; potrebuje ifc_types). Prvá podmienka na pset smie mať aj op contains/exists/matches, " +
    "ďalšie len = != > < >= <=. Čítajú sa vlastnosti výskytu (nie zdedené z typu).",
  items: {
    type: "object",
    properties: {
      pset: { type: "string" },
      name: { type: "string" },
      attribute: { type: "string", description: "IFC atribút entity (OverallWidth, OverallHeight, LongName, Tag) namiesto pset + name" },
      op: { type: "string", enum: OPS as unknown as string[] },
      value: { description: "Číslo, text alebo boolean (pri exists netreba)" },
    },
    required: ["op"],
  },
};

/** `ifc_models` action -> prevzatý tool balíka (D-087); revisions je vlastný (D-109). */
export const MODEL_ACTIONS = {
  revisions: null,
  info: "model_info",
  materials: "materials_list",
  classifications: "classifications_list",
  audit: "model_audit",
  schema: "schema_describe",
} as const;
export type ModelAction = keyof typeof MODEL_ACTIONS;

export const QUERY_MODES = ["list", "count", "values"] as const;

export function engineToolDefinitions(): ToolDefinition[] {
  const models = modelEnum();
  const model = { type: "string", enum: models, description: `Model federácie (${models.join(", ")})` };
  return [
    {
      name: "ifc_models",
      description:
        "IFC MOTOR: IFC SCHÉMA, modely federácie a údaje súboru. action=schema: z ktorej triedy IFC trieda " +
        "dedí, celá línia dedičnosti a atribúty (type, napr. IfcAirTerminal; bez modelu) - neodpovedaj z pamäti. " +
        "revisions (default): aktuálna revízia modelu (vNNN, dátum, autor, zmeny), history = aj predchádzajúce; " +
        "info: schéma IFC, jednotky, georeferencovanie; materials / classifications: zoznam materiálov a " +
        "klasifikácií s počtami; audit: zdravie modelu.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: Object.keys(MODEL_ACTIONS) },
          model: { ...model, description: "Pri info, materials, classifications a audit povinný" },
          history: { type: "number", description: "revisions: koľko posledných revízií na model (1-20)" },
          type: { type: "string", description: "schema: IFC trieda, napr. IfcWall" },
          include_inherited: { type: "boolean", description: "schema: aj zdedené atribúty (default true)" },
        },
      },
    },
    {
      name: "ifc_query",
      description:
        "IFC MOTOR: prvky v IFC súbore podľa MATERIÁLU (material: izolácia, minerálna vlna, EPS, betón - aj " +
        "vrstva skladby a materiál z typu; graf AIM materiály nenesie), triedy, podlažia a hodnôt psetov vrátane " +
        "ČÍSELNÝCH porovnaní (plocha > 20). mode=list (default): prvky s object_ref a show_in_3d; count: presný " +
        "počet zo súboru, aj group_by trieda/podlažie/materiál; values: aké hodnoty má vlastnosť psetu alebo Qto " +
        "a koľko prvkov má ktorú (pset + name). Číta vlastnosti výskytu, nie zdedené z typu.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: [...QUERY_MODES] },
          model: { ...model, description: "Model; bez neho len s material (inak všetky)" },
          ifc_types: { type: "array", items: { type: "string" }, description: "IFC triedy, napr. [IfcSpace]; count a values berú prvú" },
          where: whereSchema,
          storey: { type: "string", description: "list: podlažie podľa štítku AIM (2NP, 3NP)" },
          group_by: { type: "string", enum: ["type", "storey", "material"], description: "count: zoskupiť (s where sa nekombinuje)" },
          pset: { type: "string", description: "values: pset alebo Qto, napr. Pset_DoorCommon" },
          name: { type: "string", description: "values: vlastnosť, napr. FireRating" },
          material: { type: "string", description: "Časť názvu materiálu, vrstvy alebo kategórie; s mode=count len počet" },
          limit: { type: "number", description: "Max prvkov alebo hodnôt vo výsledku" },
        },
      },
    },
    {
      name: "ifc_get",
      description:
        "IFC MOTOR: všetky údaje prvkov priamo z IFC súboru - atribúty, psety výskytu, množstvá (Qto), " +
        "klasifikácie, materiály (vrstvy skladby s hrúbkou a kategóriou, aj z typu), dokumenty a voliteľne " +
        "psety z typu. Ciele = object_ref, objects.id alebo IFC GlobalId.",
      inputSchema: {
        type: "object",
        properties: {
          targets: { type: "array", items: { type: "string" }, description: "1-50 cieľov" },
          model: { ...model, description: "Voliteľne model; inak sa prvok hľadá vo všetkých" },
          include_type_properties: { type: "boolean", description: "Pridať psety z typu (default true)" },
        },
        required: ["targets"],
      },
    },
    {
      name: "ifc_ids_validate",
      description:
        "IFC MOTOR: skontroluje model TERAZ voči IDS uloženému v AIM (ids_document, kód a voliteľne version; záložne " +
        "register IDS_SOURCES). Vráti verdikt každej špecifikácie a nesplnené prvky s dôvodmi a object_ref. " +
        "save=true uloží beh ako záznam kontroly (v_ids_summary/v_ids_latest cez query_view, engine=ifc-lite); " +
        "žiadny beh nie je záväzný.",
      inputSchema: {
        type: "object",
        properties: {
          model,
          ids: { type: "string", description: "Kód IDS v AIM (ids_document action=list)" },
          version: { type: "number", description: "Verzia IDS v AIM (default posledná)" },
          save: { type: "boolean", description: "Uložiť beh do DB (celý beh, bez spec)" },
          spec: { type: "string", description: "Voliteľne len špecifikácia (identifikátor alebo názov)" },
          failures_per_spec: { type: "number", description: "Max nesplnených prvkov na špecifikáciu (1-100, default 20)" },
        },
        required: ["model", "ids"],
      },
    },
    {
      name: "ifc_relations",
      description:
        "IFC MOTOR: všetky IFC vzťahy jednej entity priamo zo súboru, aj entity mimo grafu AIM (zóna, " +
        "systém, port): členovia zón/skupín/systémov (IfcRelAssignsToGroup), kam prvok patrí, podlažie a " +
        "miestnosť (IfcRelContainedIn/ReferencedInSpatialStructure), agregácia a vnorenie (IfcRelAggregates/" +
        "IfcRelNests), typ, otvory a výplne (Voids/Fills), hranice priestoru, porty, dokumenty, klasifikácie, " +
        "materiály. direction: forward = entita je Relating (skupina -> členovia, podlažie -> prvky, celok -> " +
        "časti, prvok -> porty), inverse = kam entita patrí. Priestorové väzby nesú kind (contained = patrí do " +
        "priestoru, referenced = je aj v ňom); referenced odvodené geometriou naprieč modelmi (výustka VZT -> " +
        "miestnosť z ASR) má derived=true a role. recursive rozvinie vnorené zóny/systémy (bez rel_types len cez IfcRelAssignsToGroup). " +
        "through_ports = prvky napojené cez porty (IfcRelConnectsPorts), jeden krok; s recursive=true prechod " +
        "celou sieťou cez porty a stop_at (napr. IfcUnitaryEquipment, IfcDamper.FIREDAMPER) = najbližšia jednotka " +
        "alebo klapka s cestou (reached, path_show_in_3d). Úplný zoznam bez stropu: " +
        "stránkuj cez next_cursor, kým nie je null; total a counts platia pre celý výsledok.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "object_ref, objects.id alebo IFC GlobalId" },
          model: { ...model, description: "Voliteľne model; inak sa entita hľadá vo všetkých" },
          rel_types: {
            type: "array",
            items: { type: "string" },
            description: "Len tieto triedy vzťahov, napr. [IfcRelAssignsToGroup]. Bez filtra všetky okrem psetov (IfcRelDefinesByProperties)",
          },
          direction: { type: "string", enum: ["forward", "inverse", "both"], description: "Default both" },
          recursive: { type: "boolean", description: "Rozvinúť do hĺbky (max 10) cez tie isté vzťahy, bez rel_types len cez IfcRelAssignsToGroup; len s direction forward alebo inverse" },
          through_ports: { type: "boolean", description: "Prvky napojené cez porty namiesto priamych vzťahov" },
          stop_at: {
            type: "array",
            items: { type: "string" },
            description: "S through_ports a recursive: zastaviť na triede, voliteľne Trieda.PREDEFINED (IfcDamper.FIREDAMPER); PredefinedType typovaného výskytu sa berie z jeho typu",
          },
          max_steps: { type: "number", description: "S through_ports a recursive: max krokov sieťou (1-200, default 50)" },
          limit: { type: "number", description: "Max vzťahov na stránku (1-200, default 100)" },
          cursor: { type: "string", description: "next_cursor z predchádzajúcej stránky" },
        },
        required: ["target"],
      },
    },
    {
      name: "ifc_measure",
      description:
        "IFC MOTOR: meranie z geometrie (nie z Qto). clear_opening + items (dvere z ifc_query, max 50) = svetlá " +
        "šírka a výška dverí medzi zárubňami a od prahu po nadpražie z geometrie, nie z psetov (OverallWidth je so " +
        "zárubňou); s min_width_m / min_height_m aj pass/fail a check.style_pass / style_fail pre style_in_3d. " +
        "KÓTA vo vieweri: show=true (a + b čiara medzi najbližšími bodmi s dĺžkou, len a hrany obálky X, Y, Z, " +
        "s axis len jedna os, clear_opening šírka a výška dverí). PLOCHY (face_a + face_b, a alebo a + b): kolmá " +
        "vzdialenosť dvoch rovnobežných plôch v osiach prvku a (x = width, dlhšia strana pôdorysu; y = depth; z = hore), " +
        "napr. vnútorné líca zárubne face_a=+x face_b=-x, hrúbka steny +y a -y, svetlá výška +z a -z (prah k nadpražiu). " +
        "a + b = svetlá vzdialenosť povrchov dvoch prvkov (aj ASR " +
        "voči VZT; záporná = prienik), vzdialenosť stredov, medzera obálok po osiach X/Y/Z a vodorovne, " +
        "a_above_b_m = výška spodku a nad vrchom b (napr. klapka nad doskou: b = doska). \"Od steny k stene\" = " +
        "jedno volanie a + b (dve steny), clear_distance_m je svetlá vzdialenosť; šírka obdĺžnikovej miestnosti " +
        "alebo chodby = a = miestnosť (IfcSpace), bbox_m x/y. Len a alebo items = " +
        "rozmery obálky, povrch, pôdorys a objem z meshu, porovnané s Qto zo súboru (vs_qto, mismatch nad 5 %), " +
        "pri viacerých aj súčet. Objem množiny podľa filtra: GUIDy z ifc_query do items (max 50). CESTA PO BUDOVE " +
        "(route): shortest = najkratšia cesta z a do b (miestnosť, dvere alebo prvok), escape = úniková cesta z a " +
        "k najbližším vonkajším dverám na teréne; dĺžka v m je DOLNÝ ODHAD (priamky v pôdoryse cez miestnosti a " +
        "dvere zo súboru, IfcRelSpaceBoundary), poradie miestností a dverí, zmeny podlaží, show_in_3d; route + show=true " +
        "nakreslí trasu vo vieweri červenou plnou čiarou 1,6 m nad podlahou a stupňami, stredom dverí. Prvé volanie " +
        "nad modelom ho tesseluje (ASR ~4 s), ďalšie sú rýchle. kóty sa pridávajú (keep, predvolene pri " +
        "show=true; keep=false nahradí predošlé), nad 12 kót na plátne odporúčanie clear. clear=true zmaže všetky kóty a trasu, ktoré Claude " +
        "nakreslil (show=true), vlastné merania používateľa nechá; jednu konkrétnu kótu zmazať nejde; bez ďalších parametrov.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "string", description: "Prvý prvok: object_ref, objects.id alebo IFC GlobalId; pri route štart" },
          b: { type: "string", description: "Druhý prvok na vzdialenosť; pri route=shortest cieľ" },
          route: {
            type: "string",
            enum: ["shortest", "escape"],
            description: "Cesta po budove (dolný odhad): shortest z a do b, escape z a k najbližšiemu východu",
          },
          items: { type: "array", items: { type: "string" }, description: "Prvky na rozmery a výmery (max 50)" },
          model: { ...model, description: "Voliteľne model; inak sa prvky hľadajú vo všetkých" },
          qto: {
            type: "boolean",
            description: "Len plocha a objem z Qto v súbore (a alebo items), bez tesselácie geometrie - rýchle",
          },
          clear_opening: {
            type: "boolean",
            description: "Svetlá šírka a výška dverí (IfcDoor, a alebo items) z geometrie zárubne, bez krídla a kovania",
          },
          axis: {
            type: "string",
            enum: ["x", "y", "z", "width", "depth", "height"],
            description: "Len a: jedna os namiesto troch hrán obálky; x/y/z osi IFC sveta, width/depth/height osi prvku",
          },
          face_a: {
            type: "string",
            enum: ["+x", "-x", "+y", "-y", "+z", "-z"],
            description:
              "Plocha prvku a podľa smeru normály v osiach prvku a; s face_b kolmá vzdialenosť plôch. Plochy oproti sebe = " +
              "svetlá medzera (najbližšie), odvrátené = hrúbka. Pri dverách bez krídla a kovania",
          },
          face_b: {
            type: "string",
            enum: ["+x", "-x", "+y", "-y", "+z", "-z"],
            description: "Druhá plocha: na prvku b, bez b na prvku a; rovnaká os ako face_a (osi prvku a)",
          },
          min_width_m: { type: "number", description: "clear_opening: limit svetlej šírky v m od používateľa -> pass/fail" },
          min_height_m: { type: "number", description: "clear_opening: limit svetlej výšky v m od používateľa -> pass/fail" },
          clear: {
            type: "boolean",
            description: "true = zmazať všetky kóty a čiaru trasy od Claude vo vieweri (D-152); merania používateľa ostanú, nič sa nemeria",
          },
          show: {
            type: "boolean",
            description:
              "true = kóta v živom vieweri (nástroj Measure); predošlé kóty od Claude ostanú (keep), vlastné merania sa nemenia. " +
              "S route = čiara trasy (červená, 1,6 m nad podlahou), nahradí predošlú; zmaže ju reset farieb",
          },
          keep: {
            type: "boolean",
            description:
              "S show=true (bez route): true (predvolené) = kóty sa pridajú k predošlým od Claude, false = nahradia ich. " +
              "Limit 12 úsekov je na jednu správu; nad 12 kót na plátne odpoveď odporučí clear",
          },
        },
      },
    },
    {
      name: "clash",
      description:
        "IFC MOTOR: KOLÍZIE modelov federácie (ASR x VZT) počíta server, testy a behy sa ukladajú. list: predvolené testy (VZT-NOSNE hard, " +
        "VZT-ASR odstup 50 mm) a vlastné s posledným behom; s test jeho behy. save: vlastný test (test = kód, name, a, b, a_model, " +
        "b_model, a_storey, b_storey, mode, clearance_mm); delete: confirm=true. run: test alebo ad hoc a, b (selektor tried " +
        "'IfcDuct*|IfcPipe*', '!IfcSpace'), tolerance_mm; save=true uloží beh (run_id UUID prežije reštart). Celé modely proti sebe " +
        "sú drahé: zužuj na podlažie a konkrétne triedy. results: group_by storey | system | type_pair | element | rule | cluster, " +
        "filtre status, severity, review, run_id (aj uložený) alebo test (posledný beh); group rozbalí kolízie a vráti show_in_3d " +
        "(a_global_ids, b_global_ids pre show_in_3d / style_in_3d). compare: nový beh proti predošlému alebo base_run_id " +
        "(added, resolved, persistent, unretested = beh ich prvky nemohol overiť; bucket rozbalí). review: review_status " +
        "open | resolved | accepted + comment pre keys alebo group; platí v ďalších behoch testu. bcf: návrh témy za skupinu, " +
        "create=true ju založí (typ Clash, model VZT). open: panel clash vo vieweri s testom (test) a uloženým behom (run_id UUID " +
        "alebo latest), používateľ vidí stavy; from_viewer: uloží test a zmenené stavy z panela (beh uloží tlačidlo v paneli).",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...CLASH_ACTIONS] },
          test: { type: "string", description: "run, results, list, open: kód alebo názov testu; save, delete: kód vlastného testu; from_viewer: iný kód = uložiť ako to" },
          name: { type: "string", description: "save: názov testu" },
          description: { type: "string", description: "save: popis testu" },
          a: { type: "string", description: "run, save: selektor IFC tried strany a (ad hoc alebo prepíše test)" },
          b: { type: "string", description: "run, save: strana b; bez b sa a testuje samo so sebou" },
          a_model: { ...model, description: "run, save: model strany a" },
          b_model: { ...model, description: "run, save: model strany b" },
          a_storey: { type: "string", description: "run, save: podlažie strany a (1NP, 2.NP)" },
          b_storey: { type: "string", description: "run, save: podlažie strany b" },
          mode: { type: "string", enum: ["hard", "clearance"], description: "run, save: prienik alebo odstup" },
          clearance_mm: { type: "number", description: "run, save: odstup v mm (pri clearance)" },
          tolerance_mm: { type: "number", description: "run, save: tolerancia v mm (default 2)" },
          save: { type: "boolean", description: "run: uložiť beh a kolízie do DB" },
          confirm: { type: "boolean", description: "delete: potvrdiť zmazanie testu s behmi a stavmi kolízií" },
          run_id: { type: "string", description: "results, compare, review, bcf: beh (run-N alebo UUID uloženého; default posledný); open: UUID alebo latest" },
          base_run_id: { type: "string", description: "compare: základný beh (default predošlý uložený beh testu)" },
          bucket: { type: "string", enum: ["added", "resolved", "persistent", "unretested"], description: "compare: rozbaliť kolízie skupiny výsledku" },
          group_by: { type: "string", enum: [...CLASH_GROUPS], description: "results, review, bcf: zoskupenie (default storey)" },
          group: { type: "string", description: "results, review: kľúč alebo poradie skupiny; bcf: skupina témy" },
          status: { type: "string", enum: ["hard", "clearance"], description: "results: len tento druh kolízie" },
          severity: { type: "string", enum: ["critical", "major", "minor", "info"], description: "results: len táto závažnosť" },
          review: { type: "string", enum: ["open", "resolved", "accepted"], description: "results: len kolízie v tomto stave" },
          review_status: { type: "string", enum: ["open", "resolved", "accepted"], description: "review: nový stav" },
          comment: { type: "string", description: "review: poznámka ku kolíziám" },
          keys: { type: "array", items: { type: "string" }, description: "review: kľúče kolízií (key z results)" },
          limit: { type: "number", description: "results, compare: skupín (default 10) alebo kolízií (default 20)" },
          offset: { type: "number", description: "results, compare: posun strany" },
          model: { type: "string", description: "bcf: model témy (default VZT)" },
          create: { type: "boolean", description: "bcf: založiť tému (inak len návrh); len na pokyn používateľa" },
        },
        required: ["action"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

export const ENGINE_TOOL_NAMES = new Set(engineToolDefinitions().map((t) => t.name));
