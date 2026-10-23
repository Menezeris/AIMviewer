import { randomUUID } from "node:crypto";

import { documentLabel } from "./documents";
import {
  elementsInRegion,
  pickCalibration,
  regionDepth,
  regionFrame,
  regionViewpoint,
  storeyTop,
  type RegionElement,
} from "./region-model";
import { snapshotPlan } from "./snapshot-plan";
import type { BcfTopicWrite } from "./store";
import { BcfInputError, DEFAULT_AUTHOR, loadTopic, MAX_COMPONENTS, summary, type BcfDeps } from "./tools";

/**
 * `bcf_topic action=locate` (D-158 krok 4): oblasť strany z odkazu témy -> IFC svet cez
 * kalibráciu strany (`_georef`, D-133) -> návrh prvkov v oblasti, nadradené priestory a
 * podlažie a BCF pohľad nad oblasťou. Predvolene len návrh; `apply` zapíše prvky do
 * `components` (zjednotenie) a pohľad (existujúci len s `replace`). Modul je lenivý.
 */

const APPLY = ["components", "viewpoint", "all"] as const;
type Apply = (typeof APPLY)[number];
const SAMPLE = 40;

const r2 = (v: number) => Math.round(v * 100) / 100;

function applyArg(v: unknown): Apply | null {
  if (v === undefined || v === null || v === "" || v === false) return null;
  if (v === true) return "all";
  if (typeof v === "string" && (APPLY as readonly string[]).includes(v)) return v as Apply;
  throw new BcfInputError(`apply: ${APPLY.join(" | ")} (bez neho len návrh).`);
}

export async function locate(args: Record<string, unknown>, deps: BcfDeps) {
  const apply = applyArg(args.apply);
  const topic = await loadTopic(deps, args.guid);
  const docs = (await deps.store.documents([topic.id])).filter((d) => d.document_id && d.page);
  const want = typeof args.document_guid === "string" ? args.document_guid.trim().toLowerCase() : "";
  const doc = want ? docs.find((d) => d.id === want) : docs[0];
  if (!doc) {
    throw new BcfInputError(
      want
        ? `Odkaz ${want} pri téme nie je alebo nemá stranu (bcf_topic_list s guid témy ukáže documents).`
        : "Téma nemá odkaz na stranu dokumentu; pripoj ho cez bcf_topic update document = {id_or_ref, page, region}.",
    );
  }
  const cal = pickCalibration(await deps.store.georef(doc.document_id as string), doc.page as number, doc.region);
  if (!cal) {
    throw new BcfInputError(
      `Strana ${doc.page} dokumentu ${documentLabel(doc)} nie je kalibrovaná na model (_georef, D-133). ` +
        `Kalibruj ju cez calibrate_underlay (document_id ${doc.document_id}, page ${doc.page}, floor alebo section_plane; najprv mode=dry_run).`,
    );
  }
  if (!deps.regionModel) throw new BcfInputError("Model federácie nie je v tomto prostredí k dispozícii (IFC motor).");
  const model = await deps.regionModel();
  const frame = regionFrame(cal, doc.region);
  const top = frame.kind === "plan" ? storeyTop(model.elevations, frame.storey_z) : null;
  const match = elementsInRegion(frame, model.elements as Iterable<RegionElement>, regionDepth(frame, top));
  const size = doc.page_size ?? cal.page_size;
  const plan = snapshotPlan(size, doc.region);
  const viewpoint = { guid: randomUUID(), ...regionViewpoint(frame, { storeyTop: top, aspect: plan.width / plan.height }) };

  const byType: Record<string, number> = {};
  for (const h of match.components) byType[h.ifcType] = (byType[h.ifcType] ?? 0) + 1;
  const suggested = match.components.map((h) => h.globalId);
  const parents = [...(cal.storey_guid ? [cal.storey_guid] : []), ...match.spaces.map((s) => s.globalId)];

  let written: { components_added: number; viewpoint_saved: boolean; note: string | null } | null = null;
  let row = topic;
  if (apply) {
    const patch: BcfTopicWrite = { modified_by: DEFAULT_AUTHOR };
    let added = 0;
    let note: string | null = null;
    if (apply !== "viewpoint") {
      const next = [...new Set([...topic.components, ...suggested, ...(args.include_parents === true ? parents : [])])].slice(0, MAX_COMPONENTS);
      added = next.length - topic.components.length;
      patch.components = next;
    }
    let saved = false;
    if (apply !== "components") {
      if (topic.viewpoint && args.replace !== true) {
        note = "Téma už má pohľad; nový sa neuložil (replace=true ho nahradí).";
      } else {
        patch.viewpoint = { guid: viewpoint.guid, source: "bcf", bcf: viewpoint, from_document: doc.id };
        saved = true;
      }
    }
    row = await deps.store.update(topic.id, patch);
    written = { components_added: added, viewpoint_saved: saved, note };
  }

  return {
    topic: summary(row, docs.length),
    document: { guid: doc.id, label: documentLabel(doc) },
    calibration: {
      kind: frame.kind,
      source: cal.source,
      ...(cal.quality ? { median_mm: cal.quality.median_mm, p90_mm: cal.quality.p90_mm } : {}),
      storey_guid: frame.storey_guid,
      storey_z: frame.storey_z,
      storey_top: top,
    },
    region_ifc: {
      center: frame.center.map(r2),
      size_m: frame.size.map(r2),
      corners: frame.corners.map((c) => c.map(r2)),
    },
    components: {
      count: suggested.length,
      by_type: byType,
      sample: match.components.slice(0, SAMPLE).map((h) => ({ global_id: h.globalId, type: h.ifcType, name: h.name, model: h.model, inside: h.inside })),
      global_ids: suggested.slice(0, MAX_COMPONENTS),
    },
    parents: {
      storey: cal.storey_guid ?? null,
      spaces: match.spaces.slice(0, SAMPLE).map((s) => ({ global_id: s.globalId, name: s.name, inside: s.inside })),
    },
    viewpoint,
    ...(written ? { applied: written } : {}),
    hint: apply
      ? "Prvky témy ukáž cez show_in_3d(global_ids); pohľad otvorí BCF panel pri téme."
      : "Návrh, nič sa nezapísalo. Ukáž ho cez show_in_3d(global_ids = components.global_ids); zápis apply=components|viewpoint|all " +
        "(include_parents=true pridá aj podlažie a priestory).",
  };
}
