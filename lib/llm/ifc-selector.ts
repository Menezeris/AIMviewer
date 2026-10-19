/**
 * Množinový selektor 3D operácií (D-066 rozšírenie): IFC domény a očista hodnôt
 * selektora. Zdieľa ho `style_in_3d` (tools.ts) aj `set_camera` (D-094).
 */

/**
 * IFC domény → triedy pre množinové 3D operácie (D-066 rozšírenie: „všetko
 * HVAC", „celá elektrika"). Selektor rozkladá viewer z entity tables, takže
 * zoznam smie byť veľkorysý — trieda, ktorá v modeli nie je, sa ticho
 * preskočí. Kurátorský výber podľa IFC4 domain schém.
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

/** Wire-safe očista selektorových hodnôt (ops formát používa : ; ~ . ako oddeľovače). */
export const sanitizeIfcType = (raw: unknown): string =>
  String(raw ?? "").replace(/[^A-Za-z0-9]/g, "").trim();
export const sanitizeModelName = (raw: unknown): string =>
  String(raw ?? "").replace(/[:;~.]/g, "").trim();
