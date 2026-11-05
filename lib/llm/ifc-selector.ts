/**
 * Set selector of 3D operations (D-066 extension): IFC domains and sanitization of the
 * selector values. Shared by `style_in_3d` (tools.ts) and `set_camera` (D-094).
 */

/**
 * IFC domains -> classes for set 3D operations (D-066 extension: "all
 * HVAC", "all electrics"). The selector is expanded by the viewer from entity tables, so the
 * list may be generous - a class that is not in the model is silently
 * skipped. A curated selection by the IFC4 domain schemas.
 */
export const DOMAIN_IFC_TYPES: Record<string, string[]> = {
  hvac: [
    "IfcDuctSegment", "IfcDuctFitting", "IfcDuctSilencer", "IfcAirTerminal",
    "IfcAirTerminalBox", "IfcAirToAirHeatRecovery", "IfcFan", "IfcDamper",
    "IfcCoil", "IfcHumidifier", "IfcEvaporativeCooler", "IfcEvaporator",
    "IfcCondenser", "IfcCompressor", "IfcChiller", "IfcBoiler", "IfcBurner",
    "IfcCooledBeam", "IfcCoolingTower", "IfcHeatExchanger", "IfcSpaceHeater",
    "IfcTubeBundle", "IfcUnitaryEquipment", "IfcVibrationIsolator", "IfcFilter",
  ],
  plumbing: [
    "IfcPipeSegment", "IfcPipeFitting", "IfcSanitaryTerminal", "IfcWasteTerminal",
    "IfcInterceptor", "IfcStackTerminal", "IfcValve", "IfcPump", "IfcTank",
    "IfcFlowMeter",
  ],
  electrical: [
    "IfcCableCarrierSegment", "IfcCableCarrierFitting", "IfcCableSegment",
    "IfcCableFitting", "IfcOutlet", "IfcSwitchingDevice", "IfcLightFixture",
    "IfcLamp", "IfcElectricAppliance", "IfcElectricDistributionBoard",
    "IfcElectricFlowStorageDevice", "IfcElectricGenerator", "IfcElectricMotor",
    "IfcElectricTimeControl", "IfcJunctionBox", "IfcTransformer",
    "IfcAudioVisualAppliance", "IfcCommunicationsAppliance", "IfcProtectiveDevice",
    "IfcSensor", "IfcActuator", "IfcAlarm", "IfcController", "IfcUnitaryControlElement",
  ],
  architecture: [
    "IfcWall", "IfcCurtainWall", "IfcDoor", "IfcWindow", "IfcRoof", "IfcStair",
    "IfcStairFlight", "IfcRamp", "IfcRampFlight", "IfcRailing", "IfcCovering",
    "IfcFurniture", "IfcFurnishingElement",
  ],
  structure: [
    "IfcBeam", "IfcColumn", "IfcSlab", "IfcFooting", "IfcPile", "IfcMember",
    "IfcPlate", "IfcReinforcingBar", "IfcReinforcingMesh", "IfcTendon",
    "IfcTendonAnchor",
  ],
};

/** Wire-safe sanitization of selector values (the ops format uses : ; ~ . as separators). */
export const sanitizeIfcType = (raw: unknown): string =>
  String(raw ?? "").replace(/[^A-Za-z0-9]/g, "").trim();
export const sanitizeModelName = (raw: unknown): string =>
  String(raw ?? "").replace(/[:;~.]/g, "").trim();
