/**
 * Malý IFC4 model pre testy IFC motora (D-084) - vzor upstream testov
 * `@ifc-lite/mcp` (`read-after-write.test.ts`). Dve podlažia, tri miestnosti
 * s plochou v `Qto_SpaceBaseQuantities.NetFloorArea`, stena s psetom.
 */

/** 22-znakový IFC GlobalId z krátkej skratky. */
export function guid(mnemonic: string): string {
  return (mnemonic + "0".repeat(22)).slice(0, 22);
}

export const MINI_BUILDING = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mini','2026',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1= IFCPROJECT('${guid("PROJ")}',$,'Proj',$,$,$,$,(#20),#30);
#20= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#21,$);
#21= IFCAXIS2PLACEMENT3D(#22,$,$);
#22= IFCCARTESIANPOINT((0.,0.,0.));
#30= IFCUNITASSIGNMENT((#31));
#31= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#40= IFCLOCALPLACEMENT($,#21);
#41= IFCBUILDING('${guid("BLDG")}',$,'B',$,$,#40,$,$,.ELEMENT.,$,$,$);
#42= IFCBUILDINGSTOREY('${guid("ST1")}',$,'1NP',$,$,#40,$,$,.ELEMENT.,0.);
#43= IFCBUILDINGSTOREY('${guid("ST2")}',$,'2.NP',$,$,#40,$,$,.ELEMENT.,3.5);
#44= IFCRELAGGREGATES('${guid("AGG1")}',$,$,$,#1,(#41));
#45= IFCRELAGGREGATES('${guid("AGG2")}',$,$,$,#41,(#42,#43));
#50= IFCSPACE('${guid("SPA")}',$,'1.01',$,$,#40,$,'Kancelaria',.ELEMENT.,.INTERNAL.,$);
#51= IFCSPACE('${guid("SPB")}',$,'1.02',$,$,#40,$,'Sklad',.ELEMENT.,.INTERNAL.,$);
#52= IFCSPACE('${guid("SPC")}',$,'2.01',$,$,#40,$,'Zasadacka',.ELEMENT.,.INTERNAL.,$);
#53= IFCRELAGGREGATES('${guid("AGG3")}',$,$,$,#42,(#50,#51));
#54= IFCRELAGGREGATES('${guid("AGG4")}',$,$,$,#43,(#52));
#60= IFCQUANTITYAREA('NetFloorArea',$,$,25.5,$);
#61= IFCELEMENTQUANTITY('${guid("QA")}',$,'Qto_SpaceBaseQuantities',$,$,(#60));
#62= IFCRELDEFINESBYPROPERTIES('${guid("RQA")}',$,$,$,(#50),#61);
#63= IFCQUANTITYAREA('NetFloorArea',$,$,8.,$);
#64= IFCELEMENTQUANTITY('${guid("QB")}',$,'Qto_SpaceBaseQuantities',$,$,(#63));
#65= IFCRELDEFINESBYPROPERTIES('${guid("RQB")}',$,$,$,(#51),#64);
#66= IFCQUANTITYAREA('NetFloorArea',$,$,42.,$);
#67= IFCELEMENTQUANTITY('${guid("QC")}',$,'Qto_SpaceBaseQuantities',$,$,(#66));
#68= IFCRELDEFINESBYPROPERTIES('${guid("RQC")}',$,$,$,(#52),#67);
#72= IFCWALL('${guid("WALA")}',$,'Wall A',$,$,#40,$,'tagA',$);
#73= IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("RELC")}',$,$,$,(#72),#42);
#81= IFCPROPERTYSET('${guid("PSET")}',$,'Pset_WallCommon',$,(#82));
#82= IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.F.),$);
#84= IFCRELDEFINESBYPROPERTIES('${guid("RELA")}',$,$,$,(#72),#81);
ENDSEC;
END-ISO-10303-21;
`;

export const MINI_BUILDING_BYTES = new TextEncoder().encode(MINI_BUILDING);
