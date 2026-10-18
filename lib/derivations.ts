/**
 * Vrstva AIM nad modelmi (D-089 fáza B): tvar správ pre embed viewer (fork, `aim/`).
 * Bez závislostí na serveri — typy zdieľa dátová vrstva, most (`components/ifc-viewer.tsx`)
 * aj panel AIM (`lib/aim-panel.ts`). Fork drží zrkadlo v `aim/bridge-protocol.ts`.
 *
 *   host -> viewer: AIM_DERIVATIONS_LOAD { layer }  po MODELS_LOADED a po každej zmene
 *   AIM_PANEL_DATA.data.derivedRelations             odvodené vzťahy vybraného prvku
 */

/** Pravidlo odvodenia v registri (`derivation_rules`, D-089) so stavom pre záložku AIM. */
export interface DerivationRuleWire {
  id: string;
  name: string;
  kind: "geometry" | "via_space";
  enabled: boolean;
  mode: "auto" | "manual";
  /** IFC triedy cieľov (IfcSpace, IfcSpatialZone, IfcZone). */
  targetClasses: string[];
  roles: string[];
  /** Aktívne vzťahy pravidla (hrany alebo riadky pohľadu pri `via_space`). */
  count: number;
  lastRun: { at: string; status: string; written: number; closed: number } | null;
}

/** Aktuálna revízia modelu federácie (D-086). */
export interface ModelRevisionWire {
  model: string;
  revision: number;
}

export interface DerivationsLayerWire {
  version: 1;
  rules: DerivationRuleWire[];
  models: ModelRevisionWire[];
  /** Kde sa pravidlá spravujú (zapnúť, vypnúť, prepočítať), kým zápis z viewera nie je (fáza 3). */
  manageUrl?: string;
}

/**
 * Odvodený vzťah vybraného prvku pre Relationship records s odznakom AIM.
 * `outgoing` = vybraný prvok je v cieli (prvok -> priestor/zóna), `incoming` = vybraný je cieľ
 * (zóna <- prvky). `ifcRelation` je IFC vzťah, ktorý odvodenie predstavuje; NULL pri pravidle
 * cez priestory (IfcZone), kde IFC vzťah nemá a `viaSpaceRef` hovorí, cez ktorý priestor.
 */
export interface DerivedRelationWire {
  ruleId: string;
  ruleName: string;
  ifcRelation: "IfcRelReferencedInSpatialStructure" | null;
  direction: "outgoing" | "incoming";
  role: string | null;
  other: {
    objectId: string;
    guid: string | null;
    ref: string | null;
    name: string | null;
    ifcType: string | null;
  };
  viaSpaceRef?: string | null;
}

/** Strop vzťahov na jeden smer (zóna môže mať stovky prvkov); `derivedTotal` nesie celkový počet. */
export const DERIVED_RELATIONS_CAP = 200;
