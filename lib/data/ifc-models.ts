/**
 * Zoznam IFC modelov federácie - čistá funkcia bez závislostí na serveri, aby ju
 * zdieľal viewer (`lib/data/ifc.ts`) aj IFC motor (`lib/engine`, D-084) a jeho skripty.
 */

const IFC_STORAGE_BASE =
  "https://acwoupricatirhlfkhvk.supabase.co/storage/v1/object/public/ifc";

/** Jeden 3D model federácie (D-049): štítok pre UI + verejná URL IFC súboru. */
export interface IfcModel {
  id: string;
  label: string;
  url: string;
}

/**
 * IFC modely na render (D-044/D-049). Geometria je klient-side ephemerálna
 * (Postgres sa jej nedotýka); spojka na dáta = IFC GUID cez `guidMap`.
 * Default = ARCH (ASR) + vzduchotechnika (VZT) federované do jednej scény.
 * Override: `NEXT_PUBLIC_IFC_URLS` = "Label|url,Label|url" (alebo len "url,url");
 * legacy `NEXT_PUBLIC_IFC_URL` = jeden model.
 */
export function getIfcModels(): IfcModel[] {
  const multi = process.env.NEXT_PUBLIC_IFC_URLS;
  if (multi) {
    return multi
      .split(",")
      .map((entry, i) => {
        const [a, b] = entry.split("|");
        const url = (b ?? a).trim();
        const label = (b ? a : `Model ${i + 1}`).trim();
        return { id: `m${i}`, label, url };
      })
      .filter((m) => m.url.length > 0);
  }
  const single = process.env.NEXT_PUBLIC_IFC_URL;
  if (single) return [{ id: "ASR", label: "Architektúra", url: single }];
  return [
    { id: "ASR", label: "Architektúra", url: `${IFC_STORAGE_BASE}/ASR.ifc` },
    { id: "VZT", label: "Vzduchotechnika", url: `${IFC_STORAGE_BASE}/VZT.ifc` },
  ];
}
