/**
 * Popisky na výkrese ako odkazy na prvok (D-130) - čisté funkcie nad riadkami strany.
 *
 * `document_pages.blocks` (D-123) = riadky textu s bbox v % strany. Bublina prvku na
 * pôdoryse je dvojriadková: hlava `DD01` (typ prvku) a tesne pod ňou `05.04` (plný kód
 * DD01.05.04) alebo len `08` (typ DD01.08; číslo výskytu na výkrese nie je). Kód
 * miestnosti je riadok `1.01`. Párovanie je AIM vrstva (odvodenie), nič nezapisuje.
 */

import { foldText, type PageRegion, type TextBlock } from "@/lib/llm/document-text";

/** Hlava bubliny: kategória a číslo typu prvku (DD01, SN05, OV01). */
const HEAD_RE = /^[A-Z]{2}\d{2}$/;
/** Riadok pod hlavou: `NN` = číslo typu, `NN.NN(NN)` = typ a výskyt. */
const TAIL_RE = /^\d{2}(?:\.\d{2,4})?$/;
/** Kód napísaný v jednom riadku (DD01.05.04, DD01.08). */
const INLINE_RE = /^[A-Z]{2}\d{2}\.\d{2}(?:\.\d{2,4})?$/;
/** Kód miestnosti (1.01); platí len pre miestnosť na podlaží výkresu. */
const SPACE_RE = /^\d\.\d{2}$/;
/** Riadok pod hlavou: najviac toľko % strany nižšie (bublina 1NP má 0,29 %). */
const TAIL_MAX_DY = 1.2;
/** Stred riadku pod hlavou na osi x: tolerancia v % strany. */
const TAIL_MAX_DX = 0.6;
/** Najviac kandidátov na popisok (zvyšok zoznam skráti). */
export const MAX_CANDIDATES = 12;

export type LabelKind = "element" | "type" | "space" | "zone";

/** Popisok na strane: kód, ako je napísaný, a obal jeho riadkov v % strany. */
export interface DrawingLabel {
  /** Text, ako je na výkrese (riadky oddelené medzerou). */
  text: string;
  /** Kód na párovanie (DD01.05.04, DD01.08, 1.01). */
  code: string;
  kind: LabelKind;
  bbox: PageRegion;
}

/** Objekt, na ktorý môže popisok ukazovať (výskyt, typ alebo miestnosť). */
export interface LabelObject {
  id: string;
  ref: string;
  guid: string | null;
  name: string | null;
  ifcType: string | null;
  objectType: string;
  /** Je na podlaží výkresu (priamo alebo cez miestnosť)? */
  onFloor: boolean;
}

export type LinkStatus = "unique" | "candidates" | "none";

export interface LinkTarget {
  ref: string;
  guid: string | null;
  name: string | null;
  ifc_type: string | null;
  /** Zóna: GUIDy členských miestností (klik vyberie aspoň ich, keď zóna nemá geometriu). */
  members?: string[];
}

export interface DrawingLink extends DrawingLabel {
  /** unique = jeden prvok, candidates = viac výskytov typu na podlaží, none = nič. */
  status: LinkStatus;
  /** Ako sa prvok našiel: presný kód, jediný výskyt typu na podlaží, miestnosť. */
  via?: "ref" | "type_on_floor" | "space_on_floor" | "zone_name" | "manual";
  targets: LinkTarget[];
  /** Kandidátov bolo viac ako MAX_CANDIDATES. */
  targets_total?: number;
  /** Typový popisok s viac výskytmi: IFC typ (`asset_type` s presným kódom), ktorý klik otvorí. */
  type?: LinkTarget;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const cx = (b: TextBlock) => b.x + b.w / 2;

function union(blocks: TextBlock[]): PageRegion {
  const x0 = Math.min(...blocks.map((b) => b.x));
  const y0 = Math.min(...blocks.map((b) => b.y));
  const x1 = Math.max(...blocks.map((b) => b.x + b.w));
  const y1 = Math.max(...blocks.map((b) => b.y + b.h));
  return { x: r2(x0), y: r2(y0), width: r2(x1 - x0), height: r2(y1 - y0) };
}

/**
 * Popisky strany zhora nadol. Hlava sa spojí s riadkom tesne pod ňou (najbližšie dvojice
 * prvé, aby susedné bubliny nekradli riadky); hlava bez neho (legenda "SN05 - murivo") popiskom nie je.
 */
export function pairLabels(blocks: readonly TextBlock[]): DrawingLabel[] {
  const out: DrawingLabel[] = [];
  const tails = blocks.filter((b) => TAIL_RE.test(b.t.trim()));
  // Všetky prípustné dvojice, najbližšie prvé: riadok aj hlava patria najviac jednej dvojici.
  const pairs: { head: TextBlock; tail: TextBlock; dy: number }[] = [];
  for (const head of blocks) {
    if (!HEAD_RE.test(head.t.trim())) continue;
    for (const tail of tails) {
      const dy = tail.y - head.y;
      if (dy <= 0 || dy > TAIL_MAX_DY) continue;
      if (Math.abs(cx(tail) - cx(head)) > Math.max(TAIL_MAX_DX, head.w)) continue;
      pairs.push({ head, tail, dy });
    }
  }
  pairs.sort((a, b) => a.dy - b.dy);
  const used = new Set<TextBlock>();
  for (const { head, tail: best } of pairs) {
    if (used.has(head) || used.has(best)) continue;
    used.add(head);
    used.add(best);
    const tail = best.t.trim();
    out.push({
      text: `${head.t.trim()} ${tail}`,
      code: `${head.t.trim()}.${tail}`,
      kind: tail.includes(".") ? "element" : "type",
      bbox: union([head, best]),
    });
  }
  for (const b of blocks) {
    const t = b.t.trim();
    if (INLINE_RE.test(t)) {
      out.push({ text: t, code: t, kind: t.split(".").length > 2 ? "element" : "type", bbox: union([b]) });
    } else if (SPACE_RE.test(t)) {
      out.push({ text: t, code: t, kind: "space", bbox: union([b]) });
    }
  }
  return out.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
}

/** Kódy, ktoré treba načítať z DB: presné `object_ref` a predpony typov. */
export function labelCodes(labels: readonly DrawingLabel[]): { refs: string[]; typePrefixes: string[] } {
  const refs = new Set<string>();
  const types = new Set<string>();
  for (const l of labels) {
    if (l.kind === "type") {
      types.add(l.code);
      refs.add(l.code); // samotný IFC typ (asset_type) s presným kódom
    } else refs.add(l.code);
  }
  return { refs: [...refs].sort(), typePrefixes: [...types].sort() };
}

const target = (o: LabelObject): LinkTarget => ({ ref: o.ref, guid: o.guid, name: o.name, ifc_type: o.ifcType });

/**
 * Priradí popiskom objekty: plný kód = objekt s tým `object_ref`; typový kód = výskyty
 * typu na podlaží výkresu (jeden = unique, viac = candidates); miestnosť len na podlaží
 * výkresu, inak to bola kóta a popisok vypadne.
 */
export function resolveLabels(labels: readonly DrawingLabel[], objects: readonly LabelObject[]): DrawingLink[] {
  const byRef = new Map(objects.map((o) => [o.ref, o]));
  const out: DrawingLink[] = [];
  for (const label of labels) {
    if (label.kind === "space") {
      const o = byRef.get(label.code);
      if (o && o.objectType === "space" && o.onFloor) {
        out.push({ ...label, status: "unique", via: "space_on_floor", targets: [target(o)] });
      }
      continue;
    }
    if (label.kind === "element") {
      const o = byRef.get(label.code);
      out.push(
        o && o.objectType !== "space"
          ? { ...label, status: "unique", via: "ref", targets: [target(o)] }
          : { ...label, status: "none", targets: [] }
      );
      continue;
    }
    const prefix = `${label.code}.`;
    const occ = objects
      .filter((o) => o.objectType === "asset" && o.onFloor && o.ref.startsWith(prefix))
      .sort((a, b) => a.ref.localeCompare(b.ref));
    if (occ.length === 0) {
      out.push({ ...label, status: "none", targets: [] });
    } else if (occ.length === 1) {
      out.push({ ...label, status: "unique", via: "type_on_floor", targets: [target(occ[0])] });
    } else {
      const typeObj = byRef.get(label.code);
      out.push({
        ...label,
        status: "candidates",
        via: "type_on_floor",
        ...(typeObj && typeObj.objectType === "asset_type" && typeObj.guid ? { type: target(typeObj) } : {}),
        targets: occ.slice(0, MAX_CANDIDATES).map(target),
        ...(occ.length > MAX_CANDIDATES ? { targets_total: occ.length } : {}),
      });
    }
  }
  return out;
}

const insideRegion = (inner: PageRegion, outer: PageRegion, eps = 0.02) =>
  inner.x >= outer.x - eps &&
  inner.y >= outer.y - eps &&
  inner.x + inner.width <= outer.x + outer.width + eps &&
  inner.y + inner.height <= outer.y + outer.height + eps;

/** Zóna stavby (IfcZone, IfcSpatialZone) na párovanie podľa mena (D-160). */
export interface ZoneObject {
  id: string;
  ref: string;
  guid: string | null;
  name: string | null;
  ifcType: string | null;
  members: string[];
}

/** Normalizovaný zápis na porovnanie textu výkresu s menom: bez diakritiky, veľkosti písmen a medzier navyše. */
export const normLabel = (s: string) => foldText(s).replace(/\s+/g, " ").trim();

/** Najviac členských miestností v cieli zóny. */
export const MAX_ZONE_MEMBERS = 40;

/**
 * Popisky zón: riadok strany, ktorého text sa po normalizácii rovná menu zóny (IfcRoot.Name).
 * Riadky, ktoré už sú popiskom (kód miestnosti, bublina), preskočí. Viac zón s rovnakým menom =
 * candidates. Meno rozlomené na dva riadky automatika nezachytí - to je prípad ručného priradenia.
 */
export function resolveZoneLabels(
  blocks: readonly TextBlock[],
  zones: readonly ZoneObject[],
  taken: readonly DrawingLabel[] = []
): DrawingLink[] {
  const byName = new Map<string, ZoneObject[]>();
  for (const z of zones) {
    const key = z.name ? normLabel(z.name) : "";
    if (key.length < 2) continue;
    byName.set(key, [...(byName.get(key) ?? []), z]);
  }
  const out: DrawingLink[] = [];
  for (const b of blocks) {
    const t = b.t.trim();
    const hits = byName.get(normLabel(t));
    if (!hits) continue;
    const bbox = union([b]);
    if (taken.some((l) => insideRegion(bbox, l.bbox))) continue;
    const sorted = [...hits].sort((a, c) => a.ref.localeCompare(c.ref));
    const targets = sorted.slice(0, MAX_CANDIDATES).map((z) => ({
      ...target({ id: z.id, ref: z.ref, guid: z.guid, name: z.name, ifcType: z.ifcType, objectType: "zone", onFloor: true }),
      ...(z.members.length > 0 ? { members: z.members.slice(0, MAX_ZONE_MEMBERS) } : {}),
    }));
    out.push({
      text: t,
      code: normLabel(t),
      kind: "zone",
      bbox,
      status: sorted.length === 1 ? "unique" : "candidates",
      via: "zone_name",
      targets,
      ...(sorted.length > MAX_CANDIDATES ? { targets_total: sorted.length } : {}),
    });
  }
  return out;
}

export interface PageLinks {
  page: number;
  links: DrawingLink[];
}

/** Wire formát `DOCUMENT_LINKS` (zrkadlí fork `aim/docLinks.ts`): zlomky strany, len spárované. */
export interface DocumentLinksWire {
  documentId: string;
  page: number;
  links: {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    status: "unique" | "candidates";
    /** Ručné priradenie (D-160), nie odvodenie z popisku. */
    manual?: true;
    targets: { guid: string; ref: string; name?: string; members?: string[] }[];
    /** Typový popisok s viac výskytmi: klik otvorí tento IFC typ, výskyty sú vedľajšia voľba. */
    type?: { guid: string; ref: string; name?: string };
  }[];
}

const frac = (pct: number) => Math.round(pct * 100) / 10_000;

/** Odkazy pre viewer: bez nespárovaných a bez cieľov, ktoré nemajú GUID (nie sú v 3D). */
export function toLinksWire(documentId: string, pages: readonly PageLinks[]): DocumentLinksWire[] {
  const out: DocumentLinksWire[] = [];
  for (const p of pages) {
    const links: DocumentLinksWire["links"] = [];
    for (const l of p.links) {
      if (l.status === "none") continue;
      const wireTarget = (t: LinkTarget) => ({
        guid: t.guid as string,
        ref: t.ref,
        ...(t.name && t.name !== t.ref ? { name: t.name } : {}),
        ...(t.members && t.members.length > 0 ? { members: t.members } : {}),
      });
      const targets = l.targets.filter((t) => t.guid).map(wireTarget);
      if (targets.length === 0) continue;
      links.push({
        x: frac(l.bbox.x),
        y: frac(l.bbox.y),
        w: frac(l.bbox.width),
        h: frac(l.bbox.height),
        label: l.text,
        status: targets.length === 1 ? "unique" : "candidates",
        ...(l.via === "manual" ? { manual: true as const } : {}),
        targets,
        ...(targets.length > 1 && l.type?.guid ? { type: wireTarget(l.type) } : {}),
      });
    }
    if (links.length > 0) out.push({ documentId, page: p.page, links });
  }
  return out;
}

/** Súhrn pre výsledok toolu a záznam rozhodnutia. */
export function linkSummary(links: readonly DrawingLink[]) {
  const count = (kind: LabelKind | null, status: LinkStatus) =>
    links.filter(
      (l) => (kind === null ? l.kind !== "space" && l.kind !== "zone" : l.kind === kind) && l.status === status
    ).length;
  return {
    elements: {
      unique: count(null, "unique"),
      candidates: count(null, "candidates"),
      none: count(null, "none"),
    },
    spaces: count("space", "unique"),
    zones: { unique: count("zone", "unique"), candidates: count("zone", "candidates") },
    manual: links.filter((l) => l.via === "manual").length,
  };
}
