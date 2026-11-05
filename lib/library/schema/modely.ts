/**
 * Schéma knižnice požiadaviek v zod (D-186 krok 2; port `assetin/schema`, schéma v1.5).
 *
 * Vznikla jednorazovo nástrojom `scripts/library/zod-zo-schem.ts` z JSON Schema korpusu (pydantic) a odteraz je
 * pravdou schémy v TS: mení sa ručne a naraz s Pythonom, kým port trvá (assetin-library V30). Validátory, ktoré
 * JSON Schema nenesie, sú v `validatory.ts`; JSON Schema z tohto zdroja dáva `jsonSchema.ts`, zhodu s korpusom
 * stráži `schema.test.ts`.
 */

import { z } from "zod";

import { celeCislo, datum, odkaz, oneOf, slovnik, wikilink } from "./pomocky";
import { doplnValidator } from "./validatory";

// ---------------------------------------------------------------------------------------------- vnorené záznamy

export const Rozsah_hodnot = doplnValidator("Rozsah_hodnot", z.strictObject({
    min: z.union([z.number(), z.null()]).default(null).meta({"title":"Minimum","x-assetin":{"export":"IDS minInclusive","zdroj":"frontmatter"}}),
    max: z.union([z.number(), z.null()]).default(null).meta({"title":"Maximum","x-assetin":{"export":"IDS maxInclusive","zdroj":"frontmatter"}}),
    min_exkluzivne: z.boolean().default(false).meta({"title":"Min. exkluzívne","x-assetin":{"zdroj":"frontmatter"}}),
    max_exkluzivne: z.boolean().default(false).meta({"title":"Max. exkluzívne","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Rozsah_hodnot","title":"Rozsah_hodnot","description":"Numeric range → IDS bounds (shape not fixed in SCHEMA v1.3 either; kept minimal).\n\n[V26] The whole record is a value constraint (PAS 6.3.3 b); the class is declared on every field\nthat *holds* a ``rozsah``, not here, so a field descriptor carries it without being unpacked."});

export const FacetAttribute = doplnValidator("FacetAttribute", z.strictObject({
    facet: z.literal("attribute").meta({"title":"Facet"}),
    nazov: z.string().meta({"title":"Atribút","x-assetin":{"export":"IDS attribute/name","widget":"text","zdroj":"frontmatter"}}),
    hodnota: z.union([z.string(), celeCislo(), z.number(), z.boolean(), z.null()]).default(null).meta({"title":"Hodnota","x-assetin":{"export":"IDS simpleValue","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Výčet","x-assetin":{"export":"IDS xs:enumeration","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Slovník","x-assetin":{"cielove_typy":["STD"],"export":"IDS xs:enumeration (rozvinuté)","kotva":"povinna","trieda_obmedzenia":"hodnota","widget":"wikilink","zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor (regex)","x-assetin":{"export":"IDS xs:pattern","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    rozsah: z.union([Rozsah_hodnot, z.null()]).default(null).meta({"title":"Rozsah","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    cardinality: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Kardinalita","x-assetin":{"export":"IDS cardinality","trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
  })).meta({"id":"FacetAttribute","title":"FacetAttribute"});

export const FacetClassification = doplnValidator("FacetClassification", z.strictObject({
    facet: z.literal("classification").meta({"title":"Facet"}),
    system: z.union([z.string(), z.null()]).default(null).meta({"title":"Systém","x-assetin":{"export":"IDS classification/system","zdroj":"frontmatter"}}),
    hodnota: z.union([z.string(), z.null()]).default(null).meta({"title":"Hodnota","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Výčet","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Slovník","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","trieda_obmedzenia":"hodnota","widget":"wikilink","zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor (regex)","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"URI","x-assetin":{"export":"IDS @uri","zdroj":"frontmatter"}}),
    cardinality: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Kardinalita","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
  })).meta({"id":"FacetClassification","title":"FacetClassification"});

export const FacetEntity = doplnValidator("FacetEntity", z.strictObject({
    facet: z.literal("entity").meta({"title":"Facet"}),
    nazov: z.string().meta({"title":"IFC entita","x-assetin":{"export":"IDS entity/name","widget":"text","zdroj":"frontmatter"}}),
    predefined_type: z.union([z.string(), z.null()]).default(null).meta({"title":"PredefinedType","x-assetin":{"export":"IDS entity/predefinedType","zdroj":"frontmatter"}}),
  })).meta({"id":"FacetEntity","title":"FacetEntity"});

export const FacetMaterial = doplnValidator("FacetMaterial", z.strictObject({
    facet: z.literal("material").meta({"title":"Facet"}),
    hodnota: z.union([z.string(), z.null()]).default(null).meta({"title":"Materiál","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Výčet","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Slovník","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","trieda_obmedzenia":"hodnota","widget":"wikilink","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"URI","x-assetin":{"zdroj":"frontmatter"}}),
    cardinality: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Kardinalita","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
  })).meta({"id":"FacetMaterial","title":"FacetMaterial"});

export const FacetPartOf = doplnValidator("FacetPartOf", z.strictObject({
    facet: z.literal("partOf").meta({"title":"Facet"}),
    relation: z.enum(["IFCRELAGGREGATES","IFCRELASSIGNSTOGROUP","IFCRELCONTAINEDINSPATIALSTRUCTURE","IFCRELNESTS","IFCRELVOIDSELEMENT","IFCRELFILLSELEMENT"]).meta({"title":"Vzťah","x-assetin":{"export":"IDS partOf/@relation","zdroj":"frontmatter"}}),
    entity: z.union([z.string(), z.array(z.string())]).meta({"title":"Rodičovská entita","x-assetin":{"export":"IDS partOf/entity","zdroj":"frontmatter"}}),
    predefined_type: z.union([z.string(), z.null()]).default(null).meta({"title":"PredefinedType rodiča","x-assetin":{"zdroj":"frontmatter"}}),
    cardinality: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Kardinalita","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
  })).meta({"id":"FacetPartOf","title":"FacetPartOf"});

export const FacetProperty = doplnValidator("FacetProperty", z.strictObject({
    facet: z.literal("property").meta({"title":"Facet"}),
    pset: z.string().meta({"title":"Property set","x-assetin":{"export":"IDS propertySet","zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Vlastnosť","x-assetin":{"export":"IDS baseName","widget":"text","zdroj":"frontmatter"}}),
    datovy_typ: z.union([z.string(), z.null()]).default(null).meta({"title":"dataType","x-assetin":{"export":"IDS @dataType","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnota: z.union([z.string(), celeCislo(), z.number(), z.boolean(), z.null()]).default(null).meta({"title":"Hodnota","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Výčet","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Slovník","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","trieda_obmedzenia":"hodnota","widget":"wikilink","zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor (regex)","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    rozsah: z.union([Rozsah_hodnot, z.null()]).default(null).meta({"title":"Rozsah","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"URI","x-assetin":{"zdroj":"frontmatter"}}),
    cardinality: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Kardinalita","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
  })).meta({"id":"FacetProperty","title":"FacetProperty"});

export const Applicability = doplnValidator("Applicability", z.strictObject({
    entity: z.union([z.string(), z.array(z.string()), z.null()]).default(null).meta({"title":"Entita","description":"[V5] môže byť abstraktná – generátor rozvinie","x-assetin":{"export":"IDS applicability/entity","zdroj":"frontmatter"}}),
    predefined_type: z.union([z.string(), z.null()]).default(null).meta({"title":"PredefinedType","x-assetin":{"zdroj":"frontmatter"}}),
    filter: z.array(z.discriminatedUnion("facet", [FacetEntity, FacetAttribute, FacetClassification, FacetProperty, FacetMaterial, FacetPartOf])).default([]).meta({"title":"Filter","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Applicability","title":"Applicability"});

export const LocationModel = doplnValidator("LocationModel", z.strictObject({
    PositioningType: z.union([z.enum(["Absolute","Relative","NotDefined"]), z.null()]).default(null).meta({"title":"Positioningtype","x-assetin":{"export":"7817-3 Location","zdroj":"frontmatter"}}),
    ReferenceObject: z.union([z.string(), z.null()]).default(null).meta({"title":"Referenceobject","x-assetin":{"zdroj":"frontmatter"}}),
    crs: z.union([z.enum(["NotRequired","ProjectedCRS","EngineeringCRS","GeographicCRS"]), z.null()]).default(null).meta({"title":"CRS typ","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"LocationModel","title":"LocationModel"});

export const ThresholdDimensionModel = doplnValidator("ThresholdDimensionModel", z.strictObject({
    hodnota: z.union([z.number(), z.null()]).default(null).meta({"title":"Hodnota","x-assetin":{"zdroj":"frontmatter"}}),
    jednotka: z.union([z.string(), z.null()]).default(null).meta({"title":"Jednotka","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"ThresholdDimensionModel","title":"ThresholdDimensionModel"});

export const ShapeInfluenceModel = doplnValidator("ShapeInfluenceModel", z.strictObject({
    InsideGeometry: z.union([z.enum(["NotRequired","NoInsideGeometry","InsideGeometryAsPartOfShape","SeparateShapes"]), z.null()]).default(null).meta({"title":"Insidegeometry","x-assetin":{"export":"7817-3 ShapeInfluence","zdroj":"frontmatter"}}),
    Connections: z.union([z.enum(["NotRequired","NoConnections","ConnectionsAsPartOfShape","SeparateShapes"]), z.null()]).default(null).meta({"title":"Connections","x-assetin":{"zdroj":"frontmatter"}}),
    Openings: z.union([z.enum(["NotRequired","NoOpenings","OpeningsAsPartOfShape","SeparateShapes"]), z.null()]).default(null).meta({"title":"Openings","x-assetin":{"zdroj":"frontmatter"}}),
    OperatingAndClearanceZones: z.union([z.enum(["NotRequired","NoOperatingAndClearanceZones","OperatingAndClearanceZonesAsPartOfShape","SeparateShapes"]), z.null()]).default(null).meta({"title":"Operatingandclearancezones","x-assetin":{"zdroj":"frontmatter"}}),
    Features: z.union([z.enum(["NotRequired","NoFeatures","FeaturesAsPartOfShape","SeparateShapes"]), z.null()]).default(null).meta({"title":"Features","x-assetin":{"zdroj":"frontmatter"}}),
    ThresholdDimension: z.union([ThresholdDimensionModel, z.null()]).default(null).meta({"x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"ShapeInfluenceModel","title":"ShapeInfluenceModel"});

export const Aspekty = doplnValidator("Aspekty", z.strictObject({
    ShapeAssembly: z.union([z.enum(["NotRequired","SingleObjectSingularShape","SingleObjectMultipleShapes","MultipleObjects"]), z.null()]).default(null).meta({"title":"Shapeassembly","x-assetin":{"export":"7817-3 ShapeAssembly","zdroj":"frontmatter"}}),
    ShapeRepresentation: z.union([z.enum(["NotRequired","SingleBoundingPrimitive","OuterShellAsSingularShape","OuterShellAsSeparateShapes"]), z.null()]).default(null).meta({"title":"Shaperepresentation","x-assetin":{"export":"7817-3 ShapeRepresentation","zdroj":"frontmatter"}}),
    ShapeInfluence: z.union([ShapeInfluenceModel, z.null()]).default(null).meta({"x-assetin":{"export":"7817-3 ShapeInfluence","zdroj":"frontmatter"}}),
    Dimensionality: z.union([z.enum(["NotRequired","0D","1D","2D","3D"]), z.null()]).default(null).meta({"title":"Dimensionality","x-assetin":{"export":"7817-3 Dimensionality","zdroj":"frontmatter"}}),
    Appearance: z.union([z.enum(["NotRequired","NoAppearanceInformation","SymbolicByMapping","SingularMaterial","MultipleMaterials","ConceptualAppearance","RealisticAppearance"]), z.null()]).default(null).meta({"title":"Appearance","x-assetin":{"export":"7817-3 Appearance","zdroj":"frontmatter"}}),
    ParametricBehaviour: z.union([z.enum(["NotRequested","Requested"]), z.null()]).default(null).meta({"title":"Parametricbehaviour","x-assetin":{"export":"7817-3 ParametricBehaviour","zdroj":"frontmatter"}}),
    Location: z.union([LocationModel, z.null()]).default(null).meta({"x-assetin":{"export":"7817-3 Location","zdroj":"frontmatter"}}),
  })).meta({"id":"Aspekty","title":"Aspekty","description":"Geometry aspects shared by GEO profile and IU-O geometria (enums §14, 7817-3 literal names)."});

export const StlpecDatasetu = doplnValidator("StlpecDatasetu", z.strictObject({
    stlpec: z.union([z.string(), z.null()]).default(null).meta({"title":"Stĺpec","x-assetin":{"zdroj":"frontmatter"}}),
    typ: z.union([z.string(), z.null()]).default(null).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    jednotka: z.union([z.string(), z.null()]).default(null).meta({"title":"Jednotka","x-assetin":{"zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"StlpecDatasetu","title":"StlpecDatasetu"});

export const Dataset = doplnValidator("Dataset", z.strictObject({
    kluc: z.union([z.string(), z.null()]).default(null).meta({"title":"Kľúč","x-assetin":{"zdroj":"frontmatter"}}),
    struktura: z.array(StlpecDatasetu).default([]).meta({"title":"Štruktúra","x-assetin":{"zdroj":"frontmatter"}}),
    jeden_riadok: z.union([z.string(), z.null()]).default(null).meta({"title":"Jeden riadok =","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Dataset","title":"Dataset"});

export const Dokument = doplnValidator("Dokument", z.strictObject({
    type: z.union([z.string(), z.null()]).default(null).meta({"title":"Typ","x-assetin":{"export":"7817-3 Document @type","zdroj":"frontmatter"}}),
    form: z.union([z.string(), z.null()]).default(null).meta({"title":"Forma","x-assetin":{"export":"@form","zdroj":"frontmatter"}}),
    content: z.union([z.string(), z.null()]).default(null).meta({"title":"Obsah","x-assetin":{"export":"@content","zdroj":"frontmatter"}}),
    struktura: z.array(z.string()).default([]).meta({"title":"Štruktúra (kapitoly)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Dokument","title":"Dokument"});

export const Dokumentacia = doplnValidator("Dokumentacia", z.strictObject({
    dok: z.string().regex(new RegExp("^\\[\\[[^\\[\\]]+\\]\\]$")).meta({"title":"Dokument","description":"vždy odkaz na IU-C (A5)","x-assetin":{"cielove_typy":["IU-C"],"export":"7817-3 Documentation/Document ; IfcRelAssociatesDocument","kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    povinnost: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Povinnosť","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
    pokyn: z.union([z.string(), z.null()]).default(null).meta({"title":"Pokyn","x-assetin":{"zdroj":"frontmatter"}}),
    overenie: z.union([z.literal("manual"), z.null()]).default(null).meta({"title":"Overenie","description":"§14b: manual","x-assetin":{"zdroj":"frontmatter"}}),
    postup: z.union([z.string(), z.null()]).default(null).meta({"title":"Postup overenia","x-assetin":{"zdroj":"frontmatter"}}),
    automatizovatelne: z.union([z.boolean(), z.null()]).default(null).meta({"title":"Automatizovateľné","x-assetin":{"zdroj":"frontmatter"}}),
    dokladuje: z.array(z.string()).default([]).meta({"title":"Dokladuje položky","description":"[V4] kľúče položiek IU-O","x-assetin":{"zdroj":"frontmatter"}}),
    zavaznost: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Záväznosť","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Dokumentacia","title":"Dokumentacia"});

export const Forma = doplnValidator("Forma", z.strictObject({
    format: z.union([z.string(), z.null()]).default(null).meta({"title":"Formát","x-assetin":{"export":"7817-3 Document/Format ; IDS @ifcVersion","technicky":true,"zdroj":"frontmatter"}}),
    verzia_schemy: z.union([z.string(), z.null()]).default(null).meta({"title":"Verzia schémy","x-assetin":{"zdroj":"frontmatter"}}),
    nativny_format: z.union([z.string(), z.null()]).default(null).meta({"title":"Natívny formát","x-assetin":{"zdroj":"frontmatter"}}),
    max_velkost_mb: z.union([z.number(), z.null()]).default(null).meta({"title":"Max. veľkosť (MB)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Forma","title":"Forma"});

export const GeoPoznamka = doplnValidator("GeoPoznamka", z.strictObject({
    zahrna: z.array(z.string()).default([]).meta({"title":"Zahŕňa","x-assetin":{"zdroj":"frontmatter"}}),
    nezahrna: z.array(z.string()).default([]).meta({"title":"Nezahŕňa","x-assetin":{"zdroj":"frontmatter"}}),
    text: z.union([z.string(), z.null()]).default(null).meta({"title":"Text","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"GeoPoznamka","title":"GeoPoznamka"});

export const Geometria = doplnValidator("Geometria", z.strictObject({
    ShapeAssembly: z.union([z.enum(["NotRequired","SingleObjectSingularShape","SingleObjectMultipleShapes","MultipleObjects"]), z.null()]).default(null).meta({"title":"Shapeassembly","x-assetin":{"export":"7817-3 ShapeAssembly","zdroj":"frontmatter"}}),
    ShapeRepresentation: z.union([z.enum(["NotRequired","SingleBoundingPrimitive","OuterShellAsSingularShape","OuterShellAsSeparateShapes"]), z.null()]).default(null).meta({"title":"Shaperepresentation","x-assetin":{"export":"7817-3 ShapeRepresentation","zdroj":"frontmatter"}}),
    ShapeInfluence: z.union([ShapeInfluenceModel, z.null()]).default(null).meta({"x-assetin":{"export":"7817-3 ShapeInfluence","zdroj":"frontmatter"}}),
    Dimensionality: z.union([z.enum(["NotRequired","0D","1D","2D","3D"]), z.null()]).default(null).meta({"title":"Dimensionality","x-assetin":{"export":"7817-3 Dimensionality","zdroj":"frontmatter"}}),
    Appearance: z.union([z.enum(["NotRequired","NoAppearanceInformation","SymbolicByMapping","SingularMaterial","MultipleMaterials","ConceptualAppearance","RealisticAppearance"]), z.null()]).default(null).meta({"title":"Appearance","x-assetin":{"export":"7817-3 Appearance","zdroj":"frontmatter"}}),
    ParametricBehaviour: z.union([z.enum(["NotRequested","Requested"]), z.null()]).default(null).meta({"title":"Parametricbehaviour","x-assetin":{"export":"7817-3 ParametricBehaviour","zdroj":"frontmatter"}}),
    Location: z.union([LocationModel, z.null()]).default(null).meta({"x-assetin":{"export":"7817-3 Location","zdroj":"frontmatter"}}),
    profil: z.union([wikilink(), z.null()]).default(null).meta({"title":"Profil","description":"preset; explicitný aspekt poráža profil","x-assetin":{"cielove_typy":["GEO"],"kotva":"ziadna","technicky":true,"widget":"wikilink","zdroj":"frontmatter"}}),
    placeholder: z.union([z.boolean(), z.null()]).default(null).meta({"title":"Placeholder","x-assetin":{"zdroj":"frontmatter"}}),
    poznamka: z.union([GeoPoznamka, z.null()]).default(null).meta({"title":"Poznámka","x-assetin":{"zdroj":"frontmatter"}}),
    pokyn: z.union([z.string(), z.null()]).default(null).meta({"title":"Pokyn","x-assetin":{"export":"IDS instructions","zdroj":"frontmatter"}}),
    overenie: z.union([z.enum(["manual","clash-detection"]), z.null()]).default(null).meta({"title":"Overenie","description":"§14b: manual (predvoľba) | clash-detection","x-assetin":{"zdroj":"frontmatter"}}),
    postup: z.union([z.string(), z.null()]).default(null).meta({"title":"Postup overenia","x-assetin":{"zdroj":"frontmatter"}}),
    presnost: z.union([z.string(), z.null()]).default(null).meta({"title":"Presnosť","description":"metadáta kvality (7817-1 6.1 pozn. 3)","x-assetin":{"zdroj":"frontmatter"}}),
    zavaznost: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Záväznosť","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Geometria","title":"Geometria"});

export const ModelCS = doplnValidator("ModelCS", z.strictObject({
    FirstCoordinate: z.union([z.number(), z.null()]).default(null).meta({"title":"Firstcoordinate","x-assetin":{"zdroj":"frontmatter"}}),
    SecondCoordinate: z.union([z.number(), z.null()]).default(null).meta({"title":"Secondcoordinate","x-assetin":{"zdroj":"frontmatter"}}),
    Height: z.union([z.number(), z.null()]).default(null).meta({"title":"Height","x-assetin":{"zdroj":"frontmatter"}}),
    XAxisAbscissa: z.union([z.number(), z.null()]).default(null).meta({"title":"Xaxisabscissa","x-assetin":{"zdroj":"frontmatter"}}),
    XAxisOrdinate: z.union([z.number(), z.null()]).default(null).meta({"title":"Xaxisordinate","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"ModelCS","title":"ModelCS"});

export const Georeferencovanie = doplnValidator("Georeferencovanie", z.strictObject({
    model_cs: z.union([ModelCS, z.null()]).default(null).meta({"title":"Model CS","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Georeferencovanie","title":"Georeferencovanie"});

export const Identifikacia = doplnValidator("Identifikacia", z.strictObject({
    pravidlo: z.union([wikilink(), z.null()]).default(null).meta({"title":"Pravidlo","description":"konvencia ID kontajnera","x-assetin":{"cielove_typy":["STD"],"kotva":"volitelna","widget":"wikilink","zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor (regex)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Identifikacia","title":"Identifikacia"});

export const IfcAtribut = doplnValidator("IfcAtribut", z.strictObject({
    atribut: z.string().meta({"title":"IFC atribút","x-assetin":{"export":"IDS attribute facet","zdroj":"frontmatter"}}),
  })).meta({"id":"IfcAtribut","title":"IfcAtribut"});

export const IfcMaterial = doplnValidator("IfcMaterial", z.strictObject({
    material: z.string().meta({"title":"Materiál","x-assetin":{"export":"IDS material facet","zdroj":"frontmatter"}}),
  })).meta({"id":"IfcMaterial","title":"IfcMaterial"});

export const IfcPset = doplnValidator("IfcPset", z.strictObject({
    pset: z.string().meta({"title":"Property set","x-assetin":{"export":"IDS propertySet","zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Vlastnosť","x-assetin":{"export":"IDS baseName","widget":"text","zdroj":"frontmatter"}}),
  })).meta({"id":"IfcPset","title":"IfcPset"});

export const IfcVlastnost = doplnValidator("IfcVlastnost", z.strictObject({
    pset: z.string().meta({"title":"Property set","x-assetin":{"export":"IDS propertySet","zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Vlastnosť","x-assetin":{"export":"IDS baseName","widget":"text","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"bSDD URI","x-assetin":{"export":"dt:about","zdroj":"frontmatter"}}),
    vynimka: z.boolean().default(false).meta({"title":"Výnimka","description":"pset/vlastnosť mimo IFC šablóny (§16.7)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"IfcVlastnost","title":"IfcVlastnost"});

export const KPI = doplnValidator("KPI", z.strictObject({
    metrika: z.string().meta({"title":"Metrika","x-assetin":{"zdroj":"frontmatter"}}),
    ciel: z.union([z.string(), z.null()]).default(null).meta({"title":"Cieľ","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"KPI","title":"KPI"});

export const Klasifikacia = doplnValidator("Klasifikacia", z.strictObject({
    system: z.string().meta({"title":"Systém","x-assetin":{"export":"IDS classification facet ; 7817-3 DictionaryRef","zdroj":"frontmatter"}}),
    pravidlo: z.union([wikilink(), z.null()]).default(null).meta({"title":"Pravidlo (slovník)","description":"[V14] tabuľka a vzor kódu žijú v STD","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","widget":"wikilink","zdroj":"frontmatter"}}),
    povinnost: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Povinnosť","description":"[V25] s povinnosťou → IDS requirements (cardinality); bez nej zužuje applicability","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"URI","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Klasifikacia","title":"Klasifikacia"});

export const MetadataCDE = doplnValidator("MetadataCDE", z.strictObject({
    status: z.union([z.string(), z.null()]).default(null).meta({"title":"Status","description":"enum z STD-cde","x-assetin":{"zdroj":"frontmatter"}}),
    revizia_vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor revízie (regex)","x-assetin":{"zdroj":"frontmatter"}}),
    klasifikacia_bezpecnosti: z.union([z.string(), z.null()]).default(null).meta({"title":"Klasifikácia bezpečnosti","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"MetadataCDE","title":"MetadataCDE"});

export const Mvd = doplnValidator("Mvd", z.strictObject({
    basis: z.union([z.string(), z.null()]).default(null).meta({"title":"Základ","description":"schéma, nad ktorou MVD stojí","x-assetin":{"zdroj":"frontmatter"}}),
    name: z.union([z.string(), z.null()]).default(null).meta({"title":"Názov","description":"napr. Reference View","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Mvd","title":"Mvd","description":"[V26] Model view definition of the container → 29481-3 ``correspondingMvd``.\n\nA container says which view of the schema it is delivered in (IFC4X3_ADD2 / Reference View);\nwithout it the IDS generator has to guess which entities and property sets may appear at all.\nField names are the normative ones, like ``Dokument.type/form/content``."});

export const Objekt = doplnValidator("Objekt", z.strictObject({
    ifc_entita: z.string().meta({"title":"IFC entita","x-assetin":{"export":"7817-3 ObjectType ; IDS applicability/entity","technicky":true,"zdroj":"frontmatter"}}),
    predefined_type: z.union([z.string(), z.null()]).default(null).meta({"title":"PredefinedType","x-assetin":{"zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"bSDD URI","x-assetin":{"export":"@dt:about","zdroj":"frontmatter"}}),
  })).meta({"id":"Objekt","title":"Objekt"});

export const Osoba = doplnValidator("Osoba", z.strictObject({
    meno: z.union([z.string(), z.null()]).default(null).meta({"title":"Meno","x-assetin":{"export":"7817-3 @firstName","zdroj":"frontmatter"}}),
    priezvisko: z.union([z.string(), z.null()]).default(null).meta({"title":"Priezvisko","x-assetin":{"export":"@lastName","zdroj":"frontmatter"}}),
    email: z.union([z.string(), z.null()]).default(null).meta({"title":"E-mail","x-assetin":{"export":"EMail","zdroj":"frontmatter"}}),
    organizacia: z.union([z.string(), z.null()]).default(null).meta({"title":"Organizácia","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Osoba","title":"Osoba"});

export const Polozka = doplnValidator("Polozka", z.strictObject({
    ifc: z.union([oneOf([IfcAtribut, IfcVlastnost, IfcMaterial]), z.null()]).default(null).meta({"title":"IFC","x-assetin":{"zdroj":"frontmatter"}}),
    prop: z.union([wikilink(), z.null()]).default(null).meta({"title":"Vlastná vlastnosť","description":"iba mimo IFC (§7)","x-assetin":{"cielove_typy":["PROP"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    datovy_typ: z.union([z.string(), z.null()]).default(null).meta({"title":"Dátový typ","description":"[V24] IFC jednoduchý typ VEĽKÝMI (IFCAREAMEASURE…); len pri `ifc.pset` a `prop`","x-assetin":{"export":"IDS @dataType","trieda_obmedzenia":"hodnota","widget":"text","zdroj":"frontmatter"}}),
    rola: z.union([z.enum(["identifikacia","obsah"]), z.null()]).default(null).meta({"title":"Rola","description":"identifikacia | obsah (predvoľba obsah)","x-assetin":{"zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor (regex)","x-assetin":{"export":"IDS xs:pattern","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    pravidlo: z.union([wikilink(), z.null()]).default(null).meta({"title":"Pravidlo","description":"zdroj konvencie (nie kópia)","x-assetin":{"cielove_typy":["STD"],"kotva":"volitelna","widget":"wikilink","zdroj":"frontmatter"}}),
    povinnost: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Povinnosť","x-assetin":{"export":"IDS cardinality","trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
    pokyn: z.union([z.string(), z.null()]).default(null).meta({"title":"Pokyn","x-assetin":{"export":"IDS instructions","zdroj":"frontmatter"}}),
    definicia_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Definícia","description":"[V2] meraná hodnota","x-assetin":{"cielove_typy":["DEF"],"export":"Property.Definition + ReferenceDocumentRef","kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Hodnoty","x-assetin":{"export":"7817-3 PossibleValues ; IDS xs:enumeration","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Slovník","description":"[V14] vylučuje sa s `hodnoty`","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","trieda_obmedzenia":"hodnota","widget":"wikilink","zdroj":"frontmatter"}}),
    rozsah: z.union([Rozsah_hodnot, z.null()]).default(null).meta({"title":"Rozsah","x-assetin":{"export":"IDS bounds","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    povaha: z.union([z.enum(["informacny","technicky"]), z.null()]).default(null).meta({"title":"Povaha","x-assetin":{"zdroj":"frontmatter"}}),
    overenie: z.union([z.enum(["IDS","manual"]), z.null()]).default(null).meta({"title":"Overenie","description":"§14b: IDS (predvoľba) | manual","x-assetin":{"zdroj":"frontmatter"}}),
    postup: z.union([z.string(), z.null()]).default(null).meta({"title":"Postup overenia","x-assetin":{"zdroj":"frontmatter"}}),
    tolerancia: z.union([z.string(), z.null()]).default(null).meta({"title":"Tolerancia","description":"metadáta; zhodu s realitou overuje dokumentačná položka (§0.6)","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    dolozene_v: z.union([wikilink(), z.null()]).default(null).meta({"title":"Doložené v","description":"[V4] kontajner, ktorý položku dokladuje","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    zavaznost: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Záväznosť","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Polozka","title":"Polozka","description":"Alphanumeric requirement item → 7817-3 Property ; IDS requirements facet."});

export const Prepis = doplnValidator("Prepis", z.strictObject({
    iu: z.string().regex(new RegExp("^\\[\\[[^\\[\\]]+\\]\\]$")).meta({"title":"IU","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    polozka: z.union([z.string(), z.null()]).default(null).meta({"title":"Položka","description":"kľúč položky: `atribut` alebo `nazov`; pri nejednoznačnosti `Pset.nazov`","x-assetin":{"zdroj":"frontmatter"}}),
    povinnost: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Povinnosť","x-assetin":{"trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Hodnoty","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Slovník","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","trieda_obmedzenia":"hodnota","widget":"wikilink","zdroj":"frontmatter"}}),
    rozsah: z.union([Rozsah_hodnot, z.null()]).default(null).meta({"title":"Rozsah","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    zavaznost: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Záväznosť","x-assetin":{"zdroj":"frontmatter"}}),
    "geometria.profil": z.union([wikilink(), z.null()]).default(null).meta({"title":"Profil geometrie","x-assetin":{"cielove_typy":["GEO"],"kotva":"ziadna","widget":"wikilink","zdroj":"blok"}}),
  })).meta({"id":"Prepis","title":"Prepis","description":"Delta ER > IU (§16.9): only ``povinnost | hodnoty | rozsah | profil | zavaznost``."});

export const Priradenie = doplnValidator("Priradenie", z.strictObject({
    iu: z.string().regex(new RegExp("^\\[\\[[^\\[\\]]+\\]\\]$")).meta({"title":"Objekt","x-assetin":{"cielove_typy":["IU-O"],"export":"subInformationUnit","kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    rozsah: z.array(z.enum(["geometria","alfanumerika","dokumentacia"])).default([]).meta({"title":"Rozsah aspektov","description":"[V27] prázdne = všetky aspekty, ktoré daná IU-O definuje (7817-1 tri zložky LOIN)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Priradenie","title":"Priradenie","description":"[V27] Assignment container → object type, optionally narrowed to LOIN aspects.\n\nThe same room is in the IFC model (geometry + alphanumerics) and in the survey report (only the\ndocumentation aspect). Without ``rozsah`` the report would look as if it had to satisfy the whole\nLOIN of the room; with it, the generator takes from a container only what is in scope\n(LOIN-05 §11.5 a; PAS 6.3.2.1 b — the LOIN frame structures the unit, it does not replace it).\n\nEmpty ``rozsah`` means every aspect the IU-O defines at all, not „nothing\"."});

export const StranaProj = doplnValidator("StranaProj", z.strictObject({
    zmluvne_oznacenie: z.union([z.string(), z.null()]).default(null).meta({"title":"Zmluvné označenie","x-assetin":{"zdroj":"frontmatter"}}),
    organizacia: z.union([z.string(), z.null()]).default(null).meta({"title":"Organizácia","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"StranaProj","title":"StranaProj"});

export const TIDP = doplnValidator("TIDP", z.strictObject({
    odhad_pracnosti_h: z.union([z.number(), z.null()]).default(null).meta({"title":"Odhad prácnosti (h)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"TIDP","title":"TIDP"});

export const UdalostProj = doplnValidator("UdalostProj", z.strictObject({
    ev: z.string().regex(new RegExp("^\\[\\[[^\\[\\]]+\\]\\]$")).meta({"title":"Udalosť","x-assetin":{"cielove_typy":["EV"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    datum: z.union([datum(), z.null()]).default(null).meta({"title":"Dátum","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"UdalostProj","title":"UdalostProj"});

export const Uloha = doplnValidator("Uloha", z.strictObject({
    id: z.string().regex(new RegExp("^[A-Z][A-Za-z]*\\d+$")).meta({"title":"ID úlohy","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    typ: z.enum(["delivery","utilization"]).meta({"title":"Typ","description":"delivery | utilization (PAS 6.2.1)","x-assetin":{"zdroj":"frontmatter"}}),
    aktor: z.string().regex(new RegExp("^\\[\\[[^\\[\\]]+\\]\\]$")).meta({"title":"Aktér","x-assetin":{"cielove_typy":["ACT"],"export":"29481-3 businessContextMap","kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    vystup: z.array(wikilink()).default([]).meta({"title":"Výstup","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
  })).meta({"id":"Uloha","title":"Uloha","description":"[V17] task in ``## Business context`` (YAML block ``ulohy:``); anchor ``#T2`` → ``ulohy[].id``."});

export const Vystup = doplnValidator("Vystup", z.strictObject({
    typ: z.string().meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    subor: z.string().meta({"title":"Súbor","x-assetin":{"zdroj":"frontmatter"}}),
    hash: z.union([z.string(), z.null()]).default(null).meta({"title":"Hash","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"id":"Vystup","title":"Vystup"});

// ---------------------------------------------------------------------------------------------- typy poznámok a pod-záznamy

export const ACT = doplnValidator("ACT", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    uroven: z.enum(["strana","tim","funkcia"]).meta({"title":"Úroveň","description":"strana | tim | funkcia; odvodí sa z cesty a kontroluje (A9)","x-assetin":{"zdroj":"frontmatter"}}),
    strana: z.enum(["poverujuca","veduca-poverena","poverena"]).meta({"title":"Strana","x-assetin":{"export":"29481-3 classification ; 7817-3 @affiliation","zdroj":"frontmatter"}}),
    klasifikacia_19650: z.union([z.string(), z.null()]).default(null).meta({"title":"Klasifikácia 19650","x-assetin":{"zdroj":"frontmatter"}}),
    zmluvne_oznacenie: z.union([z.string(), z.null()]).default(null).meta({"title":"Zmluvné označenie","description":"IBA projekt","x-assetin":{"zdroj":"frontmatter"}}),
    osoby: z.array(Osoba).default([]).meta({"title":"Osoby","description":"IBA projekt","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"title":"ACT","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Popis"],"typ":"ACT"}});

export const DEF = doplnValidator("DEF", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    definicia: z.string().meta({"title":"Definícia","x-assetin":{"export":"7817-3 Property.Definition ; 29481-3 businessRule/proposition","zdroj":"frontmatter"}}),
    referencny_dokument: z.union([z.string(), z.null()]).default(null).meta({"title":"Referenčný dokument","x-assetin":{"export":"ReferenceDocumentRef","zdroj":"frontmatter"}}),
    hranica_merania: z.union([z.string(), z.null()]).default(null).meta({"title":"Hranica merania","x-assetin":{"zdroj":"frontmatter"}}),
    jednotka: z.union([z.string(), z.null()]).default(null).meta({"title":"Jednotka","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    zaokruhlenie: z.union([z.number(), z.null()]).default(null).meta({"title":"Zaokrúhlenie","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    tolerancia: z.union([z.string(), z.null()]).default(null).meta({"title":"Tolerancia","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    metoda_merania: z.union([z.string(), z.null()]).default(null).meta({"title":"Metóda merania","x-assetin":{"zdroj":"frontmatter"}}),
    zodpovedny_za_meranie: z.union([wikilink(), z.null()]).default(null).meta({"title":"Zodpovedný za meranie","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    odvodene_z: z.array(wikilink()).default([]).meta({"title":"Odvodené z","x-assetin":{"cielove_typy":["DEF"],"kotva":"ziadna","sekcia":"Poznámka","widget":"wikilink","zdroj":"inline"}}),
  })).meta({"title":"DEF","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Poznámka"],"typ":"DEF"}});

export const ER = doplnValidator("ER", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    forma: z.union([Forma, z.null()]).default(null).meta({"title":"Forma","x-assetin":{"zdroj":"frontmatter"}}),
    poskytovatel_predvoleny: z.union([wikilink(), z.null()]).default(null).meta({"title":"Predvolený poskytovateľ","description":"len pre IU bez vlastného poskytovateľa","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    prijemca: z.union([wikilink(), z.null()]).default(null).meta({"title":"Príjemca","description":"jeden na výmenu; IU dedí","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    uc: z.array(wikilink()).default([]).meta({"title":"UC","description":"práve jeden (kontroluje C3)","x-assetin":{"cielove_typy":["UC"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    spustacia_udalost: z.array(wikilink()).default([]).meta({"title":"Spúšťacia udalosť","description":"delivery, ≥1","x-assetin":{"cielove_typy":["EV"],"export":"7817-3 InformationDeliveryMilestone ; IDS info/milestone","kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    precondition: z.array(wikilink()).default([]).meta({"title":"Precondition","x-assetin":{"cielove_typy":["ER"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    referencne_info: z.array(wikilink()).default([]).meta({"title":"Referenčné informácie","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    standard: z.array(wikilink()).default([]).meta({"title":"Štandard","x-assetin":{"cielove_typy":["STD"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    zapnute: z.array(wikilink()).default([]).meta({"title":"Zapnuté pravidlá","description":"plati: na_vyziadanie","x-assetin":{"cielove_typy":["STD"],"kotva":"volitelna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    obsahuje: z.array(wikilink()).default([]).meta({"title":"Obsahuje","x-assetin":{"cielove_typy":["IU-O","IU-C"],"export":"informationUnit / subInformationUnit","kotva":"ziadna","sekcia":"Informačné jednotky","widget":"wikilink","zdroj":"inline"}}),
    prepisy: z.array(Prepis).default([]).meta({"title":"Prepisy","x-assetin":{"sekcia":"Prepisy pre túto výmenu","zdroj":"blok"}}),
  })).meta({"title":"ER","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Popis","Informačné jednotky","Prepisy pre túto výmenu"],"typ":"ER"}});

export const EV = doplnValidator("EV", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    typ_udalosti: z.enum(["delivery","impact"]).meta({"title":"Typ udalosti","x-assetin":{"zdroj":"frontmatter"}}),
    planovana: z.union([z.boolean(), z.null()]).default(null).meta({"title":"Plánovaná","x-assetin":{"zdroj":"frontmatter"}}),
    relativny_termin: z.union([z.string(), z.null()]).default(null).meta({"title":"Relatívny termín","x-assetin":{"zdroj":"frontmatter"}}),
    objekt: z.union([wikilink(), z.enum(["#aktivum","#proces"]), z.null()]).default(null).meta({"title":"Objekt","description":"iba impact (IU-O alebo #aktivum)","x-assetin":{"cielove_typy":["IU-O"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    faza_iso22263: z.array(z.enum(["inception","brief","design","production","maintenance","demolition"])).default([]).meta({"title":"Fáza ISO 22263","description":"[V1] impact = stav aktíva, delivery = fáza výmeny","x-assetin":{"zdroj":"frontmatter"}}),
    faza_lokalna: z.array(z.string()).default([]).meta({"title":"Fáza (lokálna)","x-assetin":{"zdroj":"frontmatter"}}),
    datum: z.union([datum(), z.null()]).default(null).meta({"title":"Dátum","description":"IBA v projekte","x-assetin":{"export":"7817-3 InformationDeliveryMilestone/@Date","zdroj":"frontmatter"}}),
    vyvolava: z.array(wikilink()).default([]).meta({"title":"Vyvoláva","description":"iba impact","x-assetin":{"cielove_typy":["EV"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
  })).meta({"title":"EV","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Popis"],"typ":"EV"}});

export const GOAL = doplnValidator("GOAL", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    uroven: z.enum(["organizacia","aktivum","projekt"]).meta({"title":"Úroveň","description":"organizacia (OIR) | aktivum (AIR) | projekt (PIR)","x-assetin":{"zdroj":"frontmatter"}}),
    zdroj_ir: z.enum(["OIR","AIR","PIR"]).meta({"title":"Zdroj IR","description":"perspektíva stakeholdera (DIS 2026)","x-assetin":{"zdroj":"frontmatter"}}),
    aktivum: z.union([z.string(), z.null()]).default(null).meta({"title":"Aktívum","description":"iba uroven: aktivum | projekt","x-assetin":{"zdroj":"frontmatter"}}),
    termin: z.union([datum(), z.null()]).default(null).meta({"title":"Termín","description":"iba uroven: projekt","x-assetin":{"zdroj":"frontmatter"}}),
    kpi: z.array(KPI).default([]).meta({"title":"KPI","description":"metrika organizácie/aktíva/projektu, nie modelu","x-assetin":{"zdroj":"frontmatter"}}),
    prispieva_k: z.array(wikilink()).default([]).meta({"title":"Prispieva k","description":"nižšia → vyššia úroveň","x-assetin":{"cielove_typy":["GOAL"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
    zdroj_oir: z.array(wikilink()).default([]).meta({"title":"Zdroj OIR","x-assetin":{"cielove_typy":["GOAL","IU-C"],"kotva":"ziadna","sekcia":"Popis","widget":"wikilink","zdroj":"inline"}}),
  })).meta({"title":"GOAL","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Popis"],"typ":"GOAL"}});

export const IU_C = doplnValidator("IU_C", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    druh: z.enum(["model","dokument","dataset"]).meta({"title":"Druh","description":"model | dokument | dataset (dataset len bez nositeľa v modeli, V10)","x-assetin":{"zdroj":"frontmatter"}}),
    datovy_typ_29481: z.union([z.string(), z.null()]).default(null).meta({"title":"Dátový typ 29481","x-assetin":{"export":"informationUnit/dataType","zdroj":"frontmatter"}}),
    mvd: z.union([Mvd, z.null()]).default(null).meta({"title":"MVD","description":"[V26] pohľad na schému, v ktorom sa kontajner odovzdáva (len `druh: model`)","x-assetin":{"export":"informationUnit/correspondingMvd","zdroj":"frontmatter"}}),
    forma: z.union([Forma, z.null()]).default(null).meta({"title":"Forma","x-assetin":{"export":"7817-3 Document/Format","zdroj":"frontmatter"}}),
    identifikacia: z.union([Identifikacia, z.null()]).default(null).meta({"title":"Identifikácia","x-assetin":{"zdroj":"frontmatter"}}),
    metadata_cde: z.union([MetadataCDE, z.null()]).default(null).meta({"title":"Metadáta CDE","x-assetin":{"zdroj":"frontmatter"}}),
    georeferencovanie_prepis: z.union([Georeferencovanie, z.null()]).default(null).meta({"title":"Georeferencovanie (prepis)","description":"iba ak sa líši od STD-FED-01","x-assetin":{"zdroj":"frontmatter"}}),
    tidp: z.union([TIDP, z.null()]).default(null).meta({"title":"TIDP","x-assetin":{"zdroj":"frontmatter"}}),
    dokument: z.union([Dokument, z.null()]).default(null).meta({"title":"Dokument","description":"iba druh: dokument","x-assetin":{"zdroj":"frontmatter"}}),
    dataset: z.union([Dataset, z.null()]).default(null).meta({"title":"Dataset","description":"iba druh: dataset","x-assetin":{"zdroj":"frontmatter"}}),
    pokyn: z.union([z.string(), z.null()]).default(null).meta({"title":"Pokyn","x-assetin":{"zdroj":"frontmatter"}}),
    overenie: z.union([z.literal("manual"), z.null()]).default(null).meta({"title":"Overenie","description":"§14b: manual","x-assetin":{"zdroj":"frontmatter"}}),
    postup: z.union([z.string(), z.null()]).default(null).meta({"title":"Postup overenia","x-assetin":{"zdroj":"frontmatter"}}),
    automatizovatelne: z.union([z.boolean(), z.null()]).default(null).meta({"title":"Automatizovateľné","x-assetin":{"zdroj":"frontmatter"}}),
    zavaznost: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Záväznosť","x-assetin":{"zdroj":"frontmatter"}}),
    viaze_sa_na: z.array(z.union([wikilink(), z.enum(["#aktivum","#proces"])])).default([]).meta({"title":"Viaže sa na","description":"alebo literál #aktivum / #proces (vedome)","x-assetin":{"cielove_typy":["IU-O","IU-C","STD"],"kotva":"volitelna","sekcia":"Ukotvenie (povinné, ≥1)","widget":"wikilink","zdroj":"inline"}}),
    obsahuje: z.array(Priradenie).default([]).meta({"title":"Obsahuje","description":"[V27] priradenie objektov kontajneru; `rozsah` zužuje na aspekty LOIN","x-assetin":{"export":"subInformationUnit","sekcia":"Obsah (M:N)","zdroj":"blok"}}),
    poskytovatel: z.array(wikilink()).default([]).meta({"title":"Poskytovateľ","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","sekcia":"Roly","widget":"wikilink","zdroj":"inline"}}),
    overuje: z.array(wikilink()).default([]).meta({"title":"Overuje","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","sekcia":"Roly","widget":"wikilink","zdroj":"inline"}}),
    predchodca: z.array(wikilink()).default([]).meta({"title":"Predchodca","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","sekcia":"TIDP väzby","widget":"wikilink","zdroj":"inline"}}),
    nadvaznost: z.array(wikilink()).default([]).meta({"title":"Nadväznosť","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","sekcia":"TIDP väzby","widget":"wikilink","zdroj":"inline"}}),
    nadradene_pri_rozpore: z.array(wikilink()).default([]).meta({"title":"Nadradené pri rozpore","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    odvodene_z: z.array(wikilink()).default([]).meta({"title":"Odvodené z","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    doplnuje: z.array(wikilink()).default([]).meta({"title":"Dopĺňa","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    dokladuje: z.array(wikilink()).default([]).meta({"title":"Dokladuje","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    dolozene_v: z.array(wikilink()).default([]).meta({"title":"Doložené v","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    typ_poziadavky: z.union([z.string(), z.null()]).default(null).meta({"title":"Typ požiadavky","description":"odvodené: C (model/dataset) | E (dokument)","x-assetin":{"odvodene":true,"zdroj":"frontmatter"}}),
  })).meta({"title":"IU_C","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Ukotvenie (povinné, ≥1)","Obsah (M:N)","Roly","TIDP väzby","Väzby"],"typ":"IU-C"}});

export const IU_O = doplnValidator("IU_O", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    objekt: odkaz(Objekt, undefined, {"x-assetin":{"zdroj":"frontmatter"}}),
    klasifikacia: z.array(Klasifikacia).default([]).meta({"title":"Klasifikácia","x-assetin":{"zdroj":"frontmatter"}}),
    filter: z.array(z.discriminatedUnion("facet", [FacetEntity, FacetAttribute, FacetClassification, FacetProperty, FacetMaterial, FacetPartOf])).default([]).meta({"title":"Filter","description":"[V9] iba zužuje applicability","x-assetin":{"zdroj":"frontmatter"}}),
    pritomnost_v_modeli: z.enum(["required","optional","prohibited"]).meta({"title":"Prítomnosť v modeli","x-assetin":{"export":"IDS minOccurs/maxOccurs","trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
    uroven: z.enum(["typ","vyskyt"]).meta({"title":"Úroveň","description":"typ | vyskyt","x-assetin":{"zdroj":"frontmatter"}}),
    zdovodnenie: z.union([z.string(), z.null()]).default(null).meta({"title":"Zdôvodnenie","x-assetin":{"export":"IDS description","zdroj":"frontmatter"}}),
    pokyn: z.union([z.string(), z.null()]).default(null).meta({"title":"Pokyn","x-assetin":{"export":"IDS instructions","zdroj":"frontmatter"}}),
    zavaznost_predvolena: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Predvolená záväznosť","description":"predvoľba pre položky","x-assetin":{"zdroj":"frontmatter"}}),
    geometria: z.union([Geometria, z.null()]).default(null).meta({"title":"Geometria","x-assetin":{"export":"7817-3 GeometricalInformation","zdroj":"frontmatter"}}),
    alfanumerika: z.array(Polozka).default([]).meta({"title":"Alfanumerika","x-assetin":{"export":"7817-3 AlphanumericalInformation ; IDS requirements","polozky":true,"zdroj":"frontmatter"}}),
    dokumentacia: z.array(Dokumentacia).default([]).meta({"title":"Dokumentácia","x-assetin":{"export":"7817-3 Documentation","zdroj":"frontmatter"}}),
    clenenie: z.array(wikilink()).default([]).meta({"title":"Členenie","description":"dedí; tu len prepis/výnimka (IDS partOf)","x-assetin":{"cielove_typy":["STD"],"kotva":"ziadna","sekcia":"Členenie (iba výnimky voči STD-clenenie)","widget":"wikilink","zdroj":"inline"}}),
    poskytovatel: z.array(wikilink()).default([]).meta({"title":"Poskytovateľ","description":"autoritatívny; delí Specification/IDS","x-assetin":{"cielove_typy":["ACT"],"export":"7817-3 ProvidingActor","kotva":"ziadna","sekcia":"Roly","widget":"wikilink","zdroj":"inline"}}),
    overuje: z.array(wikilink()).default([]).meta({"title":"Overuje","description":"reviewer (19650-4)","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","sekcia":"Roly","widget":"wikilink","zdroj":"inline"}}),
    pre_task: z.array(wikilink()).default([]).meta({"title":"Pre úlohu","x-assetin":{"cielove_typy":["UC"],"kotva":"povinna","sekcia":"Trasovateľnosť","widget":"wikilink","zdroj":"inline"}}),
    odvodene_z: z.array(wikilink()).default([]).meta({"title":"Odvodené z","x-assetin":{"cielove_typy":["IU-O","IU-C","DEF"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    nadradene_pri_rozpore: z.array(wikilink()).default([]).meta({"title":"Nadradené pri rozpore","description":"cieľ má prednosť (§0.3)","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    doplnuje: z.array(wikilink()).default([]).meta({"title":"Dopĺňa","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    dokladuje: z.array(wikilink()).default([]).meta({"title":"Dokladuje","x-assetin":{"cielove_typy":["IU-O","IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    dolozene_v: z.array(wikilink()).default([]).meta({"title":"Doložené v","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","sekcia":"Väzby","widget":"wikilink","zdroj":"inline"}}),
    typ_poziadavky: z.array(z.string()).default([]).meta({"title":"Typ požiadavky","description":"odvodené: geometria = D2, alfanumerika = D1, dokumentacia = D3","x-assetin":{"odvodene":true,"zdroj":"frontmatter"}}),
  })).meta({"title":"IU_O","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Členenie (iba výnimky voči STD-clenenie)","Roly","Trasovateľnosť","Väzby"],"typ":"IU-O"}});

export const PROJ = doplnValidator("PROJ", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    projekt: z.string().meta({"title":"Projekt","x-assetin":{"zdroj":"frontmatter"}}),
    spustacia_udalost: z.string().regex(new RegExp("^\\[\\[[^\\[\\]]+\\]\\]$")).meta({"title":"Spúšťacia udalosť","description":"impact event – POVINNÉ (PAS 6.1.3)","x-assetin":{"cielove_typy":["EV"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    aktivum: z.union([wikilink(), z.string(), z.null()]).default(null).meta({"title":"Aktívum","x-assetin":{"zdroj":"frontmatter"}}),
    ciele: z.array(wikilink()).default([]).meta({"title":"Ciele","x-assetin":{"cielove_typy":["GOAL"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    poverenie: z.union([z.string(), z.null()]).default(null).meta({"title":"Poverenie","x-assetin":{"zdroj":"frontmatter"}}),
    strany: slovnik(StranaProj).default({}).meta({"title":"Strany","description":"kľúč = \"[[ACT-…]]\"","x-assetin":{"widget":"wikilink-map","zdroj":"frontmatter"}}),
    er: z.array(wikilink()).default([]).meta({"title":"ER","x-assetin":{"cielove_typy":["ER"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    udalosti: z.array(UdalostProj).default([]).meta({"title":"Udalosti","x-assetin":{"zdroj":"frontmatter"}}),
    std_projekt: z.union([wikilink(), z.null()]).default(null).meta({"title":"STD projekt","x-assetin":{"cielove_typy":["STD"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    vystupy: z.array(Vystup).default([]).meta({"title":"Výstupy","description":"generované, s hash","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"title":"PROJ","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Popis"],"typ":"PROJ"}});

export const PROP = doplnValidator("PROP", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    zdroj_importu: z.union([z.string(), z.null()]).default(null).meta({"title":"Zdroj importu","x-assetin":{"zdroj":"frontmatter"}}),
    aplikovatelne_na: z.array(z.string()).default([]).meta({"title":"Aplikovateľné na","description":"ako IfcPropertySetTemplate.ApplicableEntity","x-assetin":{"zdroj":"frontmatter"}}),
    template_type: z.union([z.string(), z.null()]).default(null).meta({"title":"Template type","x-assetin":{"zdroj":"frontmatter"}}),
    definicia: z.union([z.string(), z.null()]).default(null).meta({"title":"Definícia","x-assetin":{"export":"Definition","zdroj":"frontmatter"}}),
    definicia_ref: z.union([wikilink(), z.null()]).default(null).meta({"title":"Definícia (ref)","x-assetin":{"cielove_typy":["DEF"],"export":"ReferenceDocumentRef","kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    odvodene_z: z.union([wikilink(), z.null()]).default(null).meta({"title":"Odvodené z","description":"[V2] zmluvná/odvodená hodnota odkazuje na meranú","x-assetin":{"cielove_typy":["DEF"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    datovy_typ: z.union([z.enum(["string","number","integer","boolean","date","enum","uri"]), z.null()]).default(null).meta({"title":"Dátový typ","x-assetin":{"export":"DataType (23387)","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    jednotka: z.union([z.string(), z.null()]).default(null).meta({"title":"Jednotka","x-assetin":{"export":"UnitRef","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    velicina: z.union([z.string(), z.null()]).default(null).meta({"title":"Veličina","x-assetin":{"export":"QuantityKindRef","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Hodnoty","x-assetin":{"export":"PossibleValues ; IDS enum","trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"URI","x-assetin":{"export":"dt:about","zdroj":"frontmatter"}}),
    ifc: z.union([IfcPset, z.null()]).default(null).meta({"title":"IFC","x-assetin":{"export":"IDS propertySet/baseName","zdroj":"frontmatter"}}),
  })).meta({"title":"PROP","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Popis"],"typ":"PROP"}});

export const PROT = doplnValidator("PROT", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    odkazuje_na: z.array(wikilink()).default([]).meta({"title":"Odkazuje na","x-assetin":{"cielove_typy":["PROJ","STD"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    funkcie: z.array(wikilink()).default([]).meta({"title":"Funkcie","x-assetin":{"cielove_typy":["ACT"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    prednost_dokumentov: z.array(z.enum(["PROT","EIR","STD","BEP"])).default([]).meta({"title":"Prednosť dokumentov","x-assetin":{"zdroj":"frontmatter"}}),
    zavaznost: z.literal("zmluvne").default("zmluvne").meta({"title":"Záväznosť","description":"vždy zmluvne, bez overenia (F11)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"title":"PROT","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":[],"typ":"PROT"}});

export const STD = doplnValidator("STD", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    prepisuje: z.array(wikilink()).default([]).meta({"title":"Prepisuje","description":"projekt: STD-projekt prepisuje:: [[STD]]","x-assetin":{"cielove_typy":["STD"],"kotva":"ziadna","widget":"wikilink","zdroj":"inline"}}),
  })).meta({"title":"STD","x-assetin":{"pod_zaznamy":["pravidlo","profil","slovnik"],"schema_verzia":"1.5","sekcie":[],"typ":"STD"}});

export const UC = doplnValidator("UC", z.strictObject({
    id: z.string().meta({"title":"ID","description":"prefix + číslo alebo cesta; nesie ho cesta súboru (§0.4), vo frontmatter kópia","x-assetin":{"export":"29481-3 specId/localCode ; 7817-3 name","zdroj":"frontmatter"}}),
    guid: z.union([z.string(), z.null()]).default(null).meta({"title":"GUID","description":"generuje nástroj","x-assetin":{"export":"specId/guid ; dt:GUID","zdroj":"frontmatter"}}),
    typ: z.enum(["GOAL","UC","ER","IU-O","IU-C","STD","GEO","PROP","DEF","EV","ACT","PROT","PROJ"]).meta({"title":"Typ","x-assetin":{"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    nazov_en: z.string().min(1).meta({"title":"Názov (EN)","x-assetin":{"export":"specId/shortTitle ; 7817-3 Purpose/Language","zdroj":"frontmatter"}}),
    stav: z.enum(["NP","WD","PUB","WDRL"]).meta({"title":"Stav","x-assetin":{"export":"documentStatus","zdroj":"frontmatter"}}),
    verzia: z.string().meta({"title":"Verzia","x-assetin":{"export":"specId/version","zdroj":"frontmatter"}}),
    jazyk: z.string().default("sk").meta({"title":"Jazyk","description":"ISO 639-1","x-assetin":{"export":"uc/language","zdroj":"frontmatter"}}),
    autor: z.union([z.string(), z.null()]).default(null).meta({"title":"Autor","x-assetin":{"export":"authoring/author","zdroj":"frontmatter"}}),
    licencia: z.union([z.string(), z.null()]).default(null).meta({"title":"Licencia","x-assetin":{"export":"authoring/copyright","zdroj":"frontmatter"}}),
    aliases: z.array(z.string()).default([]).meta({"title":"Aliasy","description":"[V18] udržiava writer: vždy obsahuje `id` (Obsidian návrhár, Dataview)","x-assetin":{"zdroj":"frontmatter"}}),
    kratky_nazov_en: z.union([z.string(), z.null()]).default(null).meta({"title":"Krátky názov (EN)","x-assetin":{"export":"specId/shortTitle","zdroj":"frontmatter"}}),
    typ_ulohy: z.enum(["delivery","utilization","oboje"]).meta({"title":"Typ úlohy","description":"[V6] sumár taskov poskytovateľov","x-assetin":{"zdroj":"frontmatter"}}),
    region: z.array(z.string()).default([]).meta({"title":"Región","description":"ISO 3166-1 alpha-3","x-assetin":{"export":"uc/region","zdroj":"frontmatter"}}),
    faza_iso22263: z.array(z.enum(["inception","brief","design","production","maintenance","demolition"])).min(1).meta({"title":"Fáza ISO 22263","description":"[V1] prípustnosť scenára","x-assetin":{"export":"standardProjectPhase","zdroj":"frontmatter"}}),
    faza_lokalna: z.array(z.string()).default([]).meta({"title":"Fáza (lokálna)","x-assetin":{"export":"localProjectPhase","zdroj":"frontmatter"}}),
    construction_entity: z.array(z.string()).default([]).meta({"title":"Construction entity","x-assetin":{"export":"constructionEntity","zdroj":"frontmatter"}}),
    zrelost: z.union([z.enum(["Outlook","Example","Proven"]), z.null()]).default(null).meta({"title":"Zrelosť","description":"UCM","x-assetin":{"zdroj":"frontmatter"}}),
    pouzitie: z.array(z.string()).default([]).meta({"title":"Použitie","description":"sloveso + podstatné meno (29481-1 tab. 1)","x-assetin":{"export":"use","zdroj":"frontmatter"}}),
    norma: z.array(z.string()).default([]).meta({"title":"Norma","x-assetin":{"export":"reference{basisStandard, fullCitation}","sekcia":"Rámcové podmienky","zdroj":"inline"}}),
    podporuje_ciel: z.array(wikilink()).default([]).meta({"title":"Podporuje cieľ","x-assetin":{"cielove_typy":["GOAL"],"kotva":"ziadna","sekcia":"Prínosy","widget":"wikilink","zdroj":"inline"}}),
    spustacia_udalost: z.array(wikilink()).default([]).meta({"title":"Spúšťacia udalosť","description":"iba impact","x-assetin":{"cielove_typy":["EV"],"kotva":"ziadna","sekcia":"Spúšťacia udalosť","widget":"wikilink","zdroj":"inline"}}),
    aktor: z.array(wikilink()).default([]).meta({"title":"Aktéri","x-assetin":{"cielove_typy":["ACT"],"export":"actor","kotva":"ziadna","sekcia":"Aktéri","widget":"wikilink","zdroj":"inline"}}),
    nadradeny_uc: z.array(wikilink()).default([]).meta({"title":"Nadradený UC","x-assetin":{"cielove_typy":["UC"],"export":"subUc / subIdm","kotva":"ziadna","sekcia":"Hierarchia","widget":"wikilink","zdroj":"inline"}}),
    ulohy: z.array(Uloha).default([]).meta({"title":"Úlohy","description":"[V17]","x-assetin":{"export":"businessContextMap","sekcia":"Business context","zdroj":"blok"}}),
    pravidlo: z.array(wikilink()).default([]).meta({"title":"Business rules","x-assetin":{"cielove_typy":["DEF"],"export":"businessRule","kotva":"ziadna","sekcia":"Business rules","widget":"wikilink","zdroj":"inline"}}),
  })).meta({"title":"UC","x-assetin":{"pod_zaznamy":[],"schema_verzia":"1.5","sekcie":["Zhrnutie","Cieľ a rozsah","Vymedzenie (čo use case nie je)","Rámcové podmienky","Prínosy","Spúšťacia udalosť","Aktéri","Hierarchia","Business context","Business rules","Fázy → ER"],"typ":"UC"}});

export const PravidloSTD = doplnValidator("PravidloSTD", z.strictObject({
    id: z.string().meta({"title":"ID","description":"== prvý token nadpisu (A11)","x-assetin":{"zdroj":"frontmatter"}}),
    poznamka: z.union([z.string(), z.null()]).default(null).meta({"title":"Poznámka (rodič)","x-assetin":{"odvodene":true,"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    rozsah: z.enum(["objekt","kontajner","federacia"]).meta({"title":"Rozsah","description":"objekt | kontajner | federacia (federacia = LEN relačné cross-file)","x-assetin":{"zdroj":"frontmatter"}}),
    plati: z.enum(["vzdy","na_vyziadanie"]).meta({"title":"Platí","description":"vzdy | na_vyziadanie (ER zapína cez `zapnute::`)","x-assetin":{"zdroj":"frontmatter"}}),
    ucel_federacie: z.boolean().default(false).meta({"title":"Účel federácie","x-assetin":{"zdroj":"frontmatter"}}),
    overenie: z.union([z.enum(["IDS","manual","clash-detection"]), z.null()]).default(null).meta({"title":"Overenie","description":"§14b","x-assetin":{"zdroj":"frontmatter"}}),
    zavaznost: z.union([z.enum(["zmluvne","musi","ma","informativne"]), z.null()]).default(null).meta({"title":"Záväznosť","x-assetin":{"zdroj":"frontmatter"}}),
    zdroj_normy: z.union([z.string(), z.null()]).default(null).meta({"title":"Zdroj (norma)","x-assetin":{"zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), slovnik(z.unknown()), z.null()]).default(null).meta({"title":"Hodnoty","description":"[V11] vylučuje sa so `zdroj_hodnot`","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    zdroj_hodnot: z.union([wikilink(), z.null()]).default(null).meta({"title":"Zdroj hodnôt","description":"[V11] master DiMS","x-assetin":{"cielove_typy":["IU-C"],"kotva":"ziadna","widget":"wikilink","zdroj":"frontmatter"}}),
    applicability: z.union([Applicability, z.null()]).default(null).meta({"title":"Applicability","x-assetin":{"export":"IDS applicability","zdroj":"frontmatter"}}),
    pritomnost_v_modeli: z.union([z.enum(["required","optional","prohibited"]), z.null()]).default(null).meta({"title":"Prítomnosť v modeli","x-assetin":{"export":"IDS minOccurs/maxOccurs","trieda_obmedzenia":"pritomnost","zdroj":"frontmatter"}}),
    requirements: z.array(z.discriminatedUnion("facet", [FacetEntity, FacetAttribute, FacetClassification, FacetProperty, FacetMaterial, FacetPartOf])).default([]).meta({"title":"Requirements","x-assetin":{"export":"IDS requirements","zdroj":"frontmatter"}}),
    text: z.union([z.string(), z.null()]).default(null).meta({"title":"Text","x-assetin":{"zdroj":"frontmatter"}}),
    pokyn: z.union([z.string(), z.null()]).default(null).meta({"title":"Pokyn","x-assetin":{"zdroj":"frontmatter"}}),
    postup: z.union([z.string(), z.null()]).default(null).meta({"title":"Postup (fallback)","x-assetin":{"zdroj":"frontmatter"}}),
    vynimka: z.boolean().default(false).meta({"title":"Výnimka","description":"núdzový ```ids blok len s vynimka: true (F7)","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"title":"PravidloSTD","x-assetin":{"pod_zaznam":"pravidlo","schema_verzia":"1.5"}});

export const ProfilGEO = doplnValidator("ProfilGEO", z.strictObject({
    id: z.string().meta({"title":"ID","description":"== prvý token nadpisu (A11)","x-assetin":{"zdroj":"frontmatter"}}),
    poznamka: z.union([z.string(), z.null()]).default(null).meta({"title":"Poznámka (rodič)","x-assetin":{"odvodene":true,"zdroj":"frontmatter"}}),
    nazov: z.string().meta({"title":"Názov","x-assetin":{"zdroj":"frontmatter"}}),
    aspekty: odkaz(Aspekty, undefined, {"x-assetin":{"export":"7817-3 GeometricalInformation","zdroj":"frontmatter"}}),
    dictionary: z.union([z.string(), z.null()]).default(null).meta({"title":"Dictionary","x-assetin":{"export":"7817-3 Detail/Dictionary","zdroj":"frontmatter"}}),
    vhodne_pre: z.union([z.string(), z.null()]).default(null).meta({"title":"Vhodné pre","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"title":"ProfilGEO","description":"§6a GEO — geometrický profil (v STD-geo-profily).","x-assetin":{"pod_zaznam":"profil","schema_verzia":"1.5"}});

export const Slovnik = doplnValidator("Slovnik", z.strictObject({
    id: z.string().meta({"title":"ID","description":"== prvý token nadpisu (A11)","x-assetin":{"zdroj":"frontmatter"}}),
    poznamka: z.union([z.string(), z.null()]).default(null).meta({"title":"Poznámka (rodič)","x-assetin":{"odvodene":true,"zdroj":"frontmatter"}}),
    system: z.union([z.string(), z.null()]).default(null).meta({"title":"Systém","x-assetin":{"zdroj":"frontmatter"}}),
    hodnoty: z.union([z.array(z.union([z.string(), celeCislo(), z.number(), z.boolean()])), z.null()]).default(null).meta({"title":"Hodnoty","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    vzor: z.union([z.string(), z.null()]).default(null).meta({"title":"Vzor (regex)","x-assetin":{"trieda_obmedzenia":"hodnota","zdroj":"frontmatter"}}),
    odvodene_z: z.union([wikilink(), z.null()]).default(null).meta({"title":"Odvodené z","x-assetin":{"cielove_typy":["STD"],"kotva":"povinna","widget":"wikilink","zdroj":"frontmatter"}}),
    uri: z.union([z.string(), z.null()]).default(null).meta({"title":"URI","x-assetin":{"zdroj":"frontmatter"}}),
  })).meta({"title":"Slovnik","description":"Dictionary in STD-klasifikacia (§0.10): ``hodnoty`` or ``vzor``, optionally ``odvodene_z``.","x-assetin":{"pod_zaznam":"slovnik","schema_verzia":"1.5"}});

/** Súbor korpusu `schema/<kľúč>.json` -> model. */
export const SCHEMY = {
  "ACT": ACT,
  "DEF": DEF,
  "ER": ER,
  "EV": EV,
  "GOAL": GOAL,
  "IU-C": IU_C,
  "IU-O": IU_O,
  "PROJ": PROJ,
  "PROP": PROP,
  "PROT": PROT,
  "STD": STD,
  "UC": UC,
  "pod-pravidlo": PravidloSTD,
  "pod-profil": ProfilGEO,
  "pod-slovnik": Slovnik,
} as const;
