import { guid } from "./mini-building";

/**
 * Mini budova pre trasu `ifc_measure route` (D-121). Pôdorys 10 x 4 m, výška
 * miestností 3 m, podlažia 0 a 3,5 m:
 * - 1NP: R1 (x 0-4), R2 (x 4-8), schodiskový priestor S1 (x 8-10);
 * - 2NP: R3 (x 0-8), schodiskový priestor S2 (x 8-10);
 * - dvere (stred y = 2): DX vonkajšie v R1 (x = 0, IsExternal), D1 R1|R2 (x = 4),
 *   DR karuselové vonkajšie v R2 (y = 0, x = 6, typ s OperationType REVOLVING),
 *   D2 R2|S1 (x = 8), D3 R3|S2 (x = 8, 2NP), DT na streche 2NP (vonkajšie, x = 0);
 * - schodisko ST v S1 (x 8,2-9,8, y 0,5-3,5, z 0-3,5) s ramenom 3 x 3,5 m;
 * - stôl DESK v R2 (stred x 6, y 1);
 * - čiara trasy (D-137): doska 1NP (vrch z = 0), podlahová krytina v R1 (x 0,1-3,9, vrch z = 0,05),
 *   doska 2NP len nad R3 (x 0-8, vrch z = 3,5; nad S2 nie je, tam platí spodok IfcSpace), rameno ST
 *   má 10 stupňov po 0,3 m (y 0,5 -> 3,5) a 0,35 m;
 * - hranice priestorov (IfcRelSpaceBoundary1stLevel) pre všetky dvere, DX a DT EXTERNAL.
 */

let next = 1000;
const lines: string[] = [];
const id = () => `#${next++}`;
const add = (body: string) => {
  const ref = id();
  lines.push(`${ref}= ${body};`);
  return ref;
};

const zUp = add("IFCDIRECTION((0.,0.,1.))");
const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
const axis = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${axis},$)`);
const world = add(`IFCLOCALPLACEMENT($,${axis})`);
const units = add(`IFCUNITASSIGNMENT((${add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")}))`);

type Extent = [number, number, number, number, number, number];

/** Extrúzia obdĺžnika [x0,x1] x [y0,y1] od z0 do z1. */
function solid([x0, x1, y0, y1, z0, z1]: Extent) {
  const c = add(`IFCCARTESIANPOINT((${(x0 + x1) / 2},${(y0 + y1) / 2}))`);
  const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${c},$)`)},${x1 - x0},${y1 - y0})`);
  const pos = add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((0.,0.,${z0}))`)},$,$)`);
  return add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zUp},${z1 - z0})`);
}

/** Tvar z viacerých kvádrov (stupne ramena). */
function boxes(list: Extent[]) {
  const rep = add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${list.map(solid).join(",")}))`);
  return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
}

/** Kváder [x0,x1] x [y0,y1] x [z0,z1] ako extrúzia obdĺžnika. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return boxes([[x0, x1, y0, y1, z0, z1]]);
}

const project = add(`IFCPROJECT('${guid("RPROJ")}',$,'Proj',$,$,$,$,(${ctx}),${units})`);
const building = add(`IFCBUILDING('${guid("RBLDG")}',$,'B',$,$,${world},$,$,.ELEMENT.,$,$,$)`);
const st1 = add(`IFCBUILDINGSTOREY('${guid("RST1")}',$,'1NP',$,$,${world},$,$,.ELEMENT.,0.)`);
const st2 = add(`IFCBUILDINGSTOREY('${guid("RST2")}',$,'2NP',$,$,${world},$,$,.ELEMENT.,3.5)`);
add(`IFCRELAGGREGATES('${guid("RAGG1")}',$,$,$,${project},(${building}))`);
add(`IFCRELAGGREGATES('${guid("RAGG2")}',$,$,$,${building},(${st1},${st2}))`);

const space = (key: string, name: string, x0: number, x1: number, z0: number) =>
  add(`IFCSPACE('${guid(key)}',$,'${name}',$,$,${world},${box(x0, x1, 0, 4, z0, z0 + 3)},'${name}',.ELEMENT.,.INTERNAL.,$)`);
const r1 = space("R1", "1.01", 0, 4, 0);
const r2 = space("R2", "1.02", 4, 8, 0);
const s1 = space("S1", "1.03", 8, 10, 0);
const r3 = space("R3", "2.01", 0, 8, 3.5);
const s2 = space("S2", "2.02", 8, 10, 3.5);
add(`IFCRELAGGREGATES('${guid("RAGG3")}',$,$,$,${st1},(${r1},${r2},${s1}))`);
add(`IFCRELAGGREGATES('${guid("RAGG4")}',$,$,$,${st2},(${r3},${s2}))`);

const door = (key: string, x: number, z0: number) =>
  add(`IFCDOOR('${guid(key)}',$,'${key}',$,$,${world},${box(x - 0.1, x + 0.1, 1.55, 2.45, z0, z0 + 2)},$,2.,0.9,.DOOR.,$,$)`);
const dx = door("DX", 0, 0);
const d1 = door("D1", 4, 0);
const d2 = door("D2", 8, 0);
const d3 = door("D3", 8, 3.5);
const dt = door("DT", 0, 3.5);
const revolvingType = add(`IFCDOORTYPE('${guid("DRT")}',$,'DRT',$,$,$,$,$,$,.DOOR.,.REVOLVING.,.F.,$)`);
const dr = add(`IFCDOOR('${guid("DR")}',$,'DR',$,$,${world},${box(5.55, 6.45, -0.1, 0.1, 0, 2)},$,2.,0.9,.DOOR.,$,$)`);
add(`IFCRELDEFINESBYTYPE('${guid("RDT")}',$,$,$,(${dr}),${revolvingType})`);
const treads = Array.from({ length: 10 }, (_, i): Extent => [8.2, 9.8, +(0.5 + 0.3 * i).toFixed(2), +(0.8 + 0.3 * i).toFixed(2), 0, +(0.35 * (i + 1)).toFixed(2)]);
const flight = add(`IFCSTAIRFLIGHT('${guid("FL")}',$,'FL',$,$,${world},${boxes(treads)},$,$,$,$,$,.STRAIGHT.)`);
const stair = add(`IFCSTAIR('${guid("ST")}',$,'ST',$,$,${world},$,$,.STRAIGHT_RUN_STAIR.)`);
add(`IFCRELAGGREGATES('${guid("RAGG5")}',$,$,$,${stair},(${flight}))`);
const desk = add(`IFCFURNITURE('${guid("DESK")}',$,'DESK',$,$,${world},${box(5.5, 6.5, 0.5, 1.5, 0, 0.75)},$,$)`);
const slab1 = add(`IFCSLAB('${guid("SL1")}',$,'SL1',$,$,${world},${box(0, 10, 0, 4, -0.2, 0)},$,.FLOOR.)`);
const cover = add(`IFCCOVERING('${guid("CV1")}',$,'CV1',$,$,${world},${box(0.1, 3.9, 0, 4, 0, 0.05)},$,.FLOORING.)`);
const slab2 = add(`IFCSLAB('${guid("SL2")}',$,'SL2',$,$,${world},${box(0, 8, 0, 4, 3.3, 3.5)},$,.FLOOR.)`);
add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("RC1")}',$,$,$,(${dx},${dr},${d1},${d2},${stair},${desk},${slab1},${cover}),${st1})`);
add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("RC2")}',$,$,$,(${d3},${dt},${slab2}),${st2})`);

const ext = add(`IFCPROPERTYSET('${guid("PEXT")}',$,'Pset_DoorCommon',$,(${add("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$)")}))`);
add(`IFCRELDEFINESBYPROPERTIES('${guid("RPEXT")}',$,$,$,(${dx},${dr},${dt}),${ext})`);

let n = 0;
const boundary = (sp: string, el: string, kind: "INTERNAL" | "EXTERNAL") =>
  add(`IFCRELSPACEBOUNDARY1STLEVEL('${guid(`RSB${n++}`)}',$,$,$,${sp},${el},$,.PHYSICAL.,.${kind}.,$)`);
boundary(r1, dx, "EXTERNAL");
boundary(r1, d1, "INTERNAL");
boundary(r2, d1, "INTERNAL");
boundary(r2, d2, "INTERNAL");
boundary(s1, d2, "INTERNAL");
boundary(s2, d3, "INTERNAL");
boundary(r3, d3, "INTERNAL");
boundary(r3, dt, "EXTERNAL");
boundary(r2, dr, "EXTERNAL");

export const MINI_ROUTE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mini-route','2026',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${lines.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;

export const MINI_ROUTE_BYTES = new TextEncoder().encode(MINI_ROUTE);
