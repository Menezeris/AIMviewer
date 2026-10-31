/**
 * AIM vrstva ako IFCX (IFC5, alfa) overlay: voliteľný payload `aim-layer.ifcx` pre nástroje, ktoré čítajú IFCX
 * (D-181 bod 9, Samuel 31. 10.: "daj zatiaľ toto"). Generuje sa z tých istých väzieb ako linksety; normatívny
 * nosič väzieb ostáva linkset. Cesta (`path`) = 22-znakový IFC GlobalId, ako pri exporte IFC -> IFCX v ifc-lite.
 * ifc-lite overlay nad STEP modelom nezloží (fork 31. 10.), takže náš viewer ho nečíta.
 */

import type { IcddLink, IcddPlan } from "./model";

export const IFCX_FILE = "aim-layer.ifcx";

/** Atribúty AIM v IFCX (menný priestor `aim::`). Jeden záznam = jedna väzba linksetu. */
export const IFCX_ATTR: Record<IcddLink["kind"], string> = {
  IsElaboratedBy: "aim::documents",
  IsReferencedInSpatialStructure: "aim::referencedInSpatialStructure",
  IsIdenticalTo: "aim::identicalTo",
};

type Entry = Record<string, string | number>;

const str = { dataType: "String" };
const entrySchema = (fields: string[]) => ({
  value: {
    dataType: "Array",
    arrayRestrictions: {
      value: { dataType: "Object", objectRestrictions: { values: Object.fromEntries(fields.map((f) => [f, str])) } },
    },
  },
});

export function buildIfcx(plan: IcddPlan): string {
  const file = new Map(plan.payloads.map((p) => [p.id, p.filename]));
  const nodes = new Map<string, Record<string, Entry[] | string>>();
  const node = (guid: string, modelFile: string) => {
    let n = nodes.get(guid);
    if (!n) {
      n = { "aim::modelFile": modelFile };
      nodes.set(guid, n);
    }
    return n;
  };
  const clean = (e: Record<string, unknown>): Entry => {
    const out: Entry = {};
    for (const [k, v] of Object.entries(e)) if (v !== null && v !== undefined && v !== "") out[k] = v as string | number;
    return out;
  };
  for (const l of plan.links) {
    if (!l.from.guid) continue;
    const n = node(l.from.guid, file.get(l.from.payload) ?? "");
    const attr = IFCX_ATTR[l.kind];
    const entry =
      l.kind === "IsElaboratedBy"
        ? clean({ file: file.get(l.to.payload), page: l.to.page, source: l.source })
        : clean({ path: l.to.guid, file: file.get(l.to.payload), source: l.source, role: l.role, rule: l.rule, basedOn: l.basedOn });
    const arr = (n[attr] as Entry[] | undefined) ?? [];
    arr.push(entry);
    n[attr] = arr;
  }
  const key = (e: Entry) => JSON.stringify(e);
  const data = [...nodes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, attrs]) => {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(attrs).sort()) {
        const v = attrs[k];
        sorted[k] = Array.isArray(v) ? [...v].sort((a, b) => (key(a) < key(b) ? -1 : 1)) : v;
      }
      return { path, attributes: sorted };
    });
  const doc = {
    header: {
      id: `aim-layer-${plan.versionID}`,
      ifcxVersion: "ifcx_alpha",
      dataVersion: "1.0.0",
      author: plan.publisher.name,
      timestamp: plan.createdAt,
    },
    imports: [],
    schemas: {
      "aim::modelFile": { value: str },
      "aim::documents": entrySchema(["file", "page", "source"]),
      "aim::referencedInSpatialStructure": entrySchema(["path", "file", "source", "role", "rule", "basedOn"]),
      "aim::identicalTo": entrySchema(["path", "file", "source"]),
    },
    data,
  };
  return `${JSON.stringify(doc, null, 1)}\n`;
}

/** Počet väzieb v IFCX a cesty (GlobalId) pre kontrolu súladu s linksetmi. */
export function readIfcx(text: string): { links: number; paths: string[] } {
  const doc = JSON.parse(text) as { data?: { path?: string; attributes?: Record<string, unknown> }[] };
  let links = 0;
  const paths: string[] = [];
  for (const n of doc.data ?? []) {
    if (n.path) paths.push(n.path);
    for (const attr of Object.values(IFCX_ATTR)) {
      const v = n.attributes?.[attr];
      if (Array.isArray(v)) links += v.length;
    }
  }
  return { links, paths };
}
