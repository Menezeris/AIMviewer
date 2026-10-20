import { guid } from "./mini-building";

/**
 * Malý IFC4 model pre `ifc_material_layers` (D-108): typ steny so zloženou
 * skladbou (omietka, EPS v kategórii "Tepelná izolácia", betón) priradenou
 * typu, dve steny toho typu (materiál len z typu), betónová stena s jedným
 * materiálom a doska so zložkami (minerálna vlna).
 */
export const MINI_MATERIALS = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mini-materials','2026',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1= IFCPROJECT('${guid("MPROJ")}',$,'Proj',$,$,$,$,(#20),#30);
#20= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#21,$);
#21= IFCAXIS2PLACEMENT3D(#22,$,$);
#22= IFCCARTESIANPOINT((0.,0.,0.));
#30= IFCUNITASSIGNMENT((#31));
#31= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#40= IFCLOCALPLACEMENT($,#21);
#41= IFCBUILDING('${guid("MBLDG")}',$,'B',$,$,#40,$,$,.ELEMENT.,$,$,$);
#42= IFCBUILDINGSTOREY('${guid("MST1")}',$,'1NP',$,$,#40,$,$,.ELEMENT.,0.);
#44= IFCRELAGGREGATES('${guid("MAGG1")}',$,$,$,#1,(#41));
#45= IFCRELAGGREGATES('${guid("MAGG2")}',$,$,$,#41,(#42));
#100= IFCMATERIAL('Omietka silikonova',$,'Omietky');
#101= IFCMATERIAL('EPS 70F',$,'Tepelná izolácia');
#102= IFCMATERIAL('Betón C25/30',$,'Betón');
#103= IFCMATERIAL('Minerálna vlna',$,'Tepelná izolácia');
#104= IFCMATERIAL('Doska OSB',$,'Drevo');
#110= IFCMATERIALLAYER(#100,0.01,$,'Vonkajšia omietka',$,'Finish',$);
#111= IFCMATERIALLAYER(#101,0.15,$,'Izolant',$,'Insulation',$);
#112= IFCMATERIALLAYER(#102,0.2,$,'Nosná vrstva',$,'LoadBearing',$);
#120= IFCMATERIALLAYERSET((#110,#111,#112),'FS01.10 ETICS',$);
#121= IFCWALLTYPE('${guid("MWTYP")}',$,'FS01.10',$,$,$,$,$,$,.STANDARD.);
#122= IFCRELASSOCIATESMATERIAL('${guid("MRAM1")}',$,$,$,(#121),#120);
#130= IFCWALL('${guid("MWAL1")}',$,'Stena 1',$,$,#40,$,$,$);
#131= IFCWALL('${guid("MWAL2")}',$,'Stena 2',$,$,#40,$,$,$);
#132= IFCRELDEFINESBYTYPE('${guid("MRDT1")}',$,$,$,(#130,#131),#121);
#140= IFCWALL('${guid("MWAL3")}',$,'Stena betón',$,$,#40,$,$,$);
#141= IFCRELASSOCIATESMATERIAL('${guid("MRAM2")}',$,$,$,(#140),#102);
#150= IFCMATERIALCONSTITUENT('Výplň',$,#103,0.7,'Insulation');
#151= IFCMATERIALCONSTITUENT('Plášť',$,#104,0.3,$);
#152= IFCMATERIALCONSTITUENTSET('SK02 strecha',$,(#150,#151));
#160= IFCSLAB('${guid("MSLB1")}',$,'Doska strechy',$,$,#40,$,$,.ROOF.);
#161= IFCRELASSOCIATESMATERIAL('${guid("MRAM3")}',$,$,$,(#160),#152);
#170= IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("MRELC")}',$,$,$,(#130,#131,#140,#160),#42);
ENDSEC;
END-ISO-10303-21;
`;

export const MINI_MATERIALS_BYTES = new TextEncoder().encode(MINI_MATERIALS);
