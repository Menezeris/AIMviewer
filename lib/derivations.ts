/**
 * AIM layer over models (D-089 phase B): shape of messages for the embed viewer (fork, `aim/`).
 * No server dependencies - the types are shared by the data layer, the bridge (`components/ifc-viewer.tsx`)
 * and the AIM panel (`lib/aim-panel.ts`). The fork keeps a mirror in `aim/bridge-protocol.ts`.
 *
 *   host -> viewer: AIM_DERIVATIONS_LOAD { layer }  after MODELS_LOADED and after every change
 *   AIM_PANEL_DATA.data.derivedRelations             derived relations of the selected element
 */

/** Derivation rule in the registry (`derivation_rules`, D-089) with state for the AIM tab. */
export interface DerivationRuleWire {
  id: string;
  name: string;
  kind: "geometry" | "via_space";
  enabled: boolean;
  mode: "auto" | "manual";
  /** IFC classes of the targets (IfcSpace, IfcSpatialZone, IfcZone). */
  targetClasses: string[];
  roles: string[];
  /** Active relations of the rule (edges or view rows for `via_space`). */
  count: number;
  lastRun: { at: string; status: string; written: number; closed: number } | null;
}

/** Current revision of the federation model (D-086). */
export interface ModelRevisionWire {
  model: string;
  revision: number;
}

export interface DerivationsLayerWire {
  version: 1;
  rules: DerivationRuleWire[];
  models: ModelRevisionWire[];
  /** Where the rules are managed (enable, disable, recompute) until writing from the viewer exists (phase 3). */
  manageUrl?: string;
}

/**
 * Derived relation of the selected element for Relationship records with an AIM badge.
 * `outgoing` = the selected element is in the target (element -> space/zone), `incoming` = the selected one is the target
 * (zone <- elements). `ifcRelation` is the IFC relation that the derivation represents; NULL for a rule
 * via spaces (IfcZone), where it has no IFC relation and `viaSpaceRef` says through which space.
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
    /** IFC PredefinedType (THERMAL, FIRESAFETY...) for grouping in the panel tree (D-106); NOTDEFINED = null. */
    predefinedType?: string | null;
  };
  viaSpaceRef?: string | null;
}

/** Cap on relations per direction (a zone can have hundreds of elements); `derivedTotal` carries the total count. */
export const DERIVED_RELATIONS_CAP = 200;
