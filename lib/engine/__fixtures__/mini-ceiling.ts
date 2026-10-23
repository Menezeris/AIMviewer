import { MINI_BUILDING, guid } from "./mini-building";

/**
 * Mini model s podhľadom (D-140, #230): na 2.NP (úroveň 3,5 m) miestnosť s Qto
 * FinishCeilingHeight 3,05 m a krytina CEILING 4 x 4 x 0,013 m so spodkom na z = 6,6 m
 * (Qto by dalo 6,55 m, teda nezhoda 5 cm). 1NP krytinu nemá.
 */
const EXTRA = `#300= IFCDIRECTION((0.,0.,1.));
#301= IFCCARTESIANPOINT((2.,2.));
#302= IFCAXIS2PLACEMENT2D(#301,$);
#303= IFCRECTANGLEPROFILEDEF(.AREA.,$,#302,4.,4.);
#304= IFCCARTESIANPOINT((0.,0.,0.));
#305= IFCAXIS2PLACEMENT3D(#304,$,$);
#306= IFCEXTRUDEDAREASOLID(#303,#305,#300,0.013);
#307= IFCSHAPEREPRESENTATION(#20,'Body','SweptSolid',(#306));
#308= IFCPRODUCTDEFINITIONSHAPE($,$,(#307));
#309= IFCCARTESIANPOINT((0.,0.,6.6));
#310= IFCAXIS2PLACEMENT3D(#309,$,$);
#311= IFCLOCALPLACEMENT(#40,#310);
#312= IFCCOVERING('${guid("CV1")}',$,'PH01',$,$,#311,#308,$,.CEILING.);
#313= IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("RC4")}',$,$,$,(#312),#43);
`;

const QC_OLD = `#67= IFCELEMENTQUANTITY('${guid("QC")}',$,'Qto_SpaceBaseQuantities',$,$,(#66));`;
const QC_NEW = `#314= IFCQUANTITYLENGTH('FinishCeilingHeight',$,$,3.05,$);
#67= IFCELEMENTQUANTITY('${guid("QC")}',$,'Qto_SpaceBaseQuantities',$,$,(#66,#314));`;

export const MINI_CEILING = MINI_BUILDING.replace(QC_OLD, QC_NEW).replace(/ENDSEC;\nEND-ISO-10303-21;/, `${EXTRA}ENDSEC;\nEND-ISO-10303-21;`);

export const MINI_CEILING_BYTES = new TextEncoder().encode(MINI_CEILING);
