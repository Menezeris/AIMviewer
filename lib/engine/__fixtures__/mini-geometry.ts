import { MINI_BUILDING, guid } from "./mini-building";

/**
 * Mini model s geometriou pre `ifc_measure` (D-112): dve steny 1 x 0,2 x 3 m
 * (extrúzia obdĺžnika) s medzerou 1 m v osi X a doska 4 x 4 x 0,2 m pod nimi,
 * spodok dosky -0,5 m (medzera 0,3 m). Qto: stena W1 má správny objem 0,6 m³,
 * stena W2 nesie zlý objem 1,0 m³ (nezhoda s geometriou).
 */
const EXTRA = `#200= IFCDIRECTION((0.,0.,1.));
#201= IFCCARTESIANPOINT((0.5,0.1));
#202= IFCAXIS2PLACEMENT2D(#201,$);
#203= IFCRECTANGLEPROFILEDEF(.AREA.,$,#202,1.,0.2);
#204= IFCCARTESIANPOINT((0.,0.,0.));
#205= IFCAXIS2PLACEMENT3D(#204,$,$);
#206= IFCEXTRUDEDAREASOLID(#203,#205,#200,3.);
#207= IFCSHAPEREPRESENTATION(#20,'Body','SweptSolid',(#206));
#208= IFCPRODUCTDEFINITIONSHAPE($,$,(#207));
#210= IFCLOCALPLACEMENT(#40,#205);
#211= IFCWALL('${guid("W1")}',$,'W1',$,$,#210,#208,$,$);
#212= IFCCARTESIANPOINT((2.,0.,0.));
#213= IFCAXIS2PLACEMENT3D(#212,$,$);
#214= IFCLOCALPLACEMENT(#40,#213);
#215= IFCEXTRUDEDAREASOLID(#203,#205,#200,3.);
#216= IFCSHAPEREPRESENTATION(#20,'Body','SweptSolid',(#215));
#217= IFCPRODUCTDEFINITIONSHAPE($,$,(#216));
#218= IFCWALL('${guid("W2")}',$,'W2',$,$,#214,#217,$,$);
#220= IFCCARTESIANPOINT((1.5,0.1));
#221= IFCAXIS2PLACEMENT2D(#220,$);
#222= IFCRECTANGLEPROFILEDEF(.AREA.,$,#221,4.,4.);
#223= IFCCARTESIANPOINT((0.,0.,-0.5));
#224= IFCAXIS2PLACEMENT3D(#223,$,$);
#225= IFCEXTRUDEDAREASOLID(#222,#205,#200,0.2);
#226= IFCSHAPEREPRESENTATION(#20,'Body','SweptSolid',(#225));
#227= IFCPRODUCTDEFINITIONSHAPE($,$,(#226));
#228= IFCLOCALPLACEMENT(#40,#224);
#229= IFCSLAB('${guid("SL1")}',$,'SL1',$,$,#228,#227,$,.FLOOR.);
#230= IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("RC3")}',$,$,$,(#211,#218,#229),#42);
#240= IFCQUANTITYVOLUME('NetVolume',$,$,0.6,$);
#241= IFCELEMENTQUANTITY('${guid("EQ1")}',$,'Qto_WallBaseQuantities',$,$,(#240));
#242= IFCRELDEFINESBYPROPERTIES('${guid("DQ1")}',$,$,$,(#211),#241);
#243= IFCQUANTITYVOLUME('NetVolume',$,$,1.,$);
#244= IFCELEMENTQUANTITY('${guid("EQ2")}',$,'Qto_WallBaseQuantities',$,$,(#243));
#245= IFCRELDEFINESBYPROPERTIES('${guid("DQ2")}',$,$,$,(#218),#244);
`;

export const MINI_GEOMETRY = MINI_BUILDING.replace(/ENDSEC;\nEND-ISO-10303-21;/, `${EXTRA}ENDSEC;\nEND-ISO-10303-21;`);

export const MINI_GEOMETRY_BYTES = new TextEncoder().encode(MINI_GEOMETRY);
