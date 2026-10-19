import { MINI_BUILDING, guid } from "./mini-building";

/**
 * Mini model rozšírený o vzťahy pre `ifc_relations` (D-097): zóna s vnorenou
 * zónou (IfcRelAssignsToGroup), systém VZT, dva prvky napojené cez porty
 * (IfcRelNests + IfcRelConnectsPorts) a ich umiestnenie na podlaží 1NP.
 */
const EXTRA = `#100= IFCZONE('${guid("ZN1")}',$,'Najomne priestory',$,$,$);
#101= IFCZONE('${guid("ZN2")}',$,'NJ 2NP',$,$,$);
#102= IFCRELASSIGNSTOGROUP('${guid("RG1")}',$,$,$,(#50,#51,#101),$,#100);
#103= IFCRELASSIGNSTOGROUP('${guid("RG2")}',$,$,$,(#52),$,#101);
#110= IFCDUCTSEGMENT('${guid("DS1")}',$,'Potrubie 1',$,$,#40,$,$,$);
#111= IFCDAMPER('${guid("DMP")}',$,'Klapka',$,$,#40,$,$,$);
#112= IFCDISTRIBUTIONPORT('${guid("PT1")}',$,'P1',$,$,#40,$,.SOURCE.,$,$);
#113= IFCDISTRIBUTIONPORT('${guid("PT2")}',$,'P2',$,$,#40,$,.SINK.,$,$);
#114= IFCRELNESTS('${guid("NE1")}',$,$,$,#110,(#112));
#115= IFCRELNESTS('${guid("NE2")}',$,$,$,#111,(#113));
#116= IFCRELCONNECTSPORTS('${guid("CPT")}',$,$,$,#112,#113,$);
#120= IFCDISTRIBUTIONSYSTEM('${guid("SYS")}',$,'Privod-1NP',$,$,$,$);
#121= IFCRELASSIGNSTOGROUP('${guid("RG3")}',$,$,$,(#110,#111),$,#120);
#122= IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("RC2")}',$,$,$,(#110,#111),#42);
`;

export const MINI_RELATIONS = MINI_BUILDING.replace(/ENDSEC;\nEND-ISO-10303-21;/, `${EXTRA}ENDSEC;\nEND-ISO-10303-21;`);

export const MINI_RELATIONS_BYTES = new TextEncoder().encode(MINI_RELATIONS);
