/**
 * Import späť a roundtrip (D-181, Samuel 30. 10.: "export -> import -> rovnaký stav"). Kontajner sa prečíta
 * na kanonické väzby (typ, konce ako súbor + GlobalId / strana, pôvod, rola, pravidlo, revízie) a porovná
 * so stavom AIM (plán z DB). Rovnaký stav = rovnaké payloady (meno, sha256) a 0 rozdielov vo väzbách.
 * Zápis importovaného kontajnera do DB je ďalší krok (pripravená migrácia, D-181 bod 7).
 */

import { endKey, linkKey } from "./build";
import { CT, ELS, LS, type IcddPlan, type LinkKind } from "./model";
import { type Graph, type Term } from "./rdf";
import type { IcddContents } from "./validate";

export interface CanonicalLink {
  key: string;
  kind: LinkKind;
  layer: string;
}

export interface CanonicalState {
  versionID: string | null;
  /** filename -> sha256 */
  payloads: Map<string, string>;
  links: Map<string, CanonicalLink>;
}

export interface RoundtripDiff {
  same: boolean;
  payloadsOnlyInContainer: string[];
  payloadsOnlyInAim: string[];
  payloadsChanged: string[];
  linksOnlyInContainer: string[];
  linksOnlyInAim: string[];
  counts: { containerLinks: number; aimLinks: number; payloads: number };
}

const KIND_BY_TYPE = (aimNs: string): Record<string, LinkKind> => ({
  [`${ELS}IsElaboratedBy`]: "IsElaboratedBy",
  [`${ELS}IsIdenticalTo`]: "IsIdenticalTo",
  [`${aimNs}IsReferencedInSpatialStructure`]: "IsReferencedInSpatialStructure",
});

/** Namespace AIM z kontajnera: ontológia, ktorá deklaruje `IsReferencedInSpatialStructure`. */
export function detectAimNamespace(c: IcddContents, fallback: string): string {
  for (const t of c.data.triples) {
    if (t.o.t === "iri" && t.o.v.endsWith("IsReferencedInSpatialStructure")) return t.o.v.slice(0, -"IsReferencedInSpatialStructure".length);
  }
  return fallback;
}

export function stateFromContainer(c: IcddContents, aimNamespace: string): CanonicalState {
  const g: Graph = c.data;
  const kinds = KIND_BY_TYPE(aimNamespace);
  const payloads = new Map<string, string>();
  // súbory generované z väzieb (IFCX, xlsx) nie sú stav AIM; ich obsah kryjú väzby linksetov
  for (const d of c.documents.values()) if (d.filename && !d.generated) payloads.set(d.filename, d.checksum ?? "");

  const end = (e: Term) => {
    const doc = g.value(e, `${LS}hasDocument`);
    const d = doc && doc.t === "iri" ? c.documents.get(doc.v) : undefined;
    const file = d?.filename ?? "?";
    const id = g.value(e, `${LS}hasIdentifier`);
    let guid: string | null = null;
    let page: number | null = null;
    if (id) {
      if (g.types(id).includes(`${LS}StringBasedIdentifier`)) guid = g.str(id, `${LS}identifier`) ?? null;
      const u = g.str(id, `${LS}uri`);
      const m = u ? /#page=(\d+)$/.exec(decodeURI(u)) : null;
      if (m) page = Number(m[1]);
    }
    return endKey({ file, guid, page });
  };
  const str = (s: Term, local: string) => g.str(s, `${aimNamespace}${local}`) ?? "";

  const links = new Map<string, CanonicalLink>();
  for (const [layerFile, triples] of Object.entries(c.linksets)) {
    const layer = layerFile.replace(/\.rdf$/, "");
    const subjects = new Map<string, Term>();
    for (const t of triples) if (t.s.t === "iri") subjects.set(t.s.v, t.s);
    for (const s of subjects.values()) {
      const kind = g.types(s).map((t) => kinds[t]).find(Boolean);
      if (!kind) continue;
      let a: string;
      let b: string;
      if (kind === "IsIdenticalTo") {
        const els = g.values(s, `${LS}hasLinkElement`).map(end).sort();
        [a, b] = [els[0] ?? "", els[1] ?? ""];
      } else {
        a = end(g.value(s, `${LS}hasFromLinkElement`)!);
        b = end(g.value(s, `${LS}hasToLinkElement`)!);
      }
      const key = [kind, a, b, str(s, "source"), str(s, "role"), str(s, "derivationRule"), str(s, "basedOnRevision")].join(" ");
      links.set(key, { key, kind, layer });
    }
  }
  const versionID = c.container ? (c.index.str(c.container, `${CT}versionID`) ?? null) : null;
  return { versionID, payloads, links };
}

export function stateFromPlan(plan: IcddPlan): CanonicalState {
  const links = new Map<string, CanonicalLink>();
  for (const l of plan.links) {
    const key = linkKey(plan, l);
    links.set(key, { key, kind: l.kind, layer: "" });
  }
  return { versionID: plan.versionID, payloads: new Map(plan.payloads.map((p) => [p.filename, p.sha256])), links };
}

export function compareStates(container: CanonicalState, aim: CanonicalState): RoundtripDiff {
  const onlyIn = <T>(a: Map<string, T>, b: Map<string, T>) => [...a.keys()].filter((k) => !b.has(k)).sort();
  const payloadsChanged = [...container.payloads.keys()]
    .filter((k) => aim.payloads.has(k) && aim.payloads.get(k) !== container.payloads.get(k))
    .sort();
  const d: RoundtripDiff = {
    same: false,
    payloadsOnlyInContainer: onlyIn(container.payloads, aim.payloads),
    payloadsOnlyInAim: onlyIn(aim.payloads, container.payloads),
    payloadsChanged,
    linksOnlyInContainer: onlyIn(container.links, aim.links),
    linksOnlyInAim: onlyIn(aim.links, container.links),
    counts: { containerLinks: container.links.size, aimLinks: aim.links.size, payloads: container.payloads.size },
  };
  d.same =
    !d.payloadsOnlyInContainer.length &&
    !d.payloadsOnlyInAim.length &&
    !d.payloadsChanged.length &&
    !d.linksOnlyInContainer.length &&
    !d.linksOnlyInAim.length;
  return d;
}
