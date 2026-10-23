import { documentWrite, parseDocumentReferenceDto } from "./documents";
import type { BcfTopicRow, TopicDocumentWrite, TopicStatus } from "./store";
import { BcfInputError, DEFAULT_AUTHOR, isClaude, normalizeStatus, summary, type BcfDeps } from "./tools";
import { viewpointFromDto } from "./viewpoint";
import { localTopicsFromState } from "./viewer-local";

/**
 * Lokálne BCF témy viewera (D-158): téma založená v BCF paneli (upstream "New
 * topic", aj pripomienka na PDF s oblasťou strany) je len v prehliadači.
 * `view_state.bcf_local` ich vypíše a `bcf_topic action=from_viewer` ich na
 * pokyn uloží do `model_tasks` + `model_task_documents` s tým istým guid, takže
 * opakované uloženie nič nezdvojí a viewer po obnove ukáže uloženú kópiu.
 * Dáta z viewera sú nedôveryhodné: každé pole sa overí a oreže.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(v: string | null): TopicStatus {
  try {
    return normalizeStatus(v) ?? "open";
  } catch {
    return "open";
  }
}

/** Odkaz z viewera -> riadok; adresa `/drawing/<id>` sa overí voči dokumentom AIM, inak ostane ako url. */
async function documentRow(deps: BcfDeps, topicId: string, ref: { url: string; description: string | null }, author: string) {
  let origin = "https://aim.invalid";
  try {
    origin = new URL(ref.url, origin).origin;
  } catch {
    // relatívna alebo chybná adresa: parse ju vyhodnotí ako cudziu
  }
  const parsed = parseDocumentReferenceDto({ url: ref.url, description: ref.description ?? undefined }, origin);
  const info = parsed.document_id ? await deps.store.findDocument(parsed.document_id) : null;
  if (info) {
    // Opis z viewera je len hlavička (názov, strana, oblasť); kód a revíziu doplní AIM.
    return documentWrite(info, { page: parsed.page ?? undefined, region: parsed.region ?? undefined }, topicId, author);
  }
  const row: TopicDocumentWrite = {
    task_id: topicId,
    document_id: null,
    document_ref: null,
    document_name: null,
    document_revision: null,
    page: null,
    region: null,
    markup: null,
    url: ref.url,
    description: ref.description,
    author,
  };
  return row;
}

/** `bcf_topic action=from_viewer`: uloží lokálne témy viewera (všetky alebo `guids`). */
export async function fromViewer(args: Record<string, unknown>, deps: BcfDeps) {
  if (!deps.viewState) throw new BcfInputError("Stav viewera sa nedá čítať (živý kanál nie je nastavený).");
  const state = await deps.viewState();
  if (typeof state === "string") throw new BcfInputError(`Témy z viewera sa nedajú prečítať: ${state}.`);
  const { count, topics } = localTopicsFromState(state);
  const wanted = Array.isArray(args.guids)
    ? new Set(args.guids.filter((g): g is string => typeof g === "string").map((g) => g.trim().toLowerCase()))
    : null;
  const chosen = topics.filter((t) => !wanted || wanted.has(t.guid.toLowerCase()));
  if (chosen.length === 0) {
    return {
      saved: [],
      skipped: [],
      local_in_viewer: count,
      note: count === 0 ? "Vo vieweri nie sú neuložené BCF témy (BCF panel, pripomienky na PDF)." : "Žiadna z tém guids vo vieweri nie je.",
    };
  }
  const saved: ReturnType<typeof summary>[] = [];
  const skipped: { guid: string; title: string; reason: string }[] = [];
  const claude: number[] = [];
  for (const t of chosen) {
    if (!UUID_RE.test(t.guid)) {
      skipped.push({ guid: t.guid, title: t.title, reason: "guid nie je UUID, nedá sa uložiť bez zmeny identity" });
      continue;
    }
    const id = t.guid.toLowerCase();
    const existing = await deps.store.get({ id });
    if (existing) {
      skipped.push({ guid: id, title: t.title, reason: `už je uložená ako #${existing.number}` });
      continue;
    }
    const author = t.creation_author || DEFAULT_AUTHOR;
    const vp = t.viewpoint ? viewpointFromDto(t.viewpoint) : null;
    const due = t.due_date && /^\d{4}-\d{2}-\d{2}/.test(t.due_date) ? t.due_date.slice(0, 10) : null;
    const row: BcfTopicRow = await deps.store.create({
      id,
      title: t.title,
      description: t.description,
      topic_type: t.topic_type || "Issue",
      status: statusOf(t.topic_status),
      priority: t.priority,
      assigned_to: t.assigned_to,
      due_date: due,
      labels: t.labels,
      author,
      modified_by: author,
      components: vp?.selection ?? [],
      viewpoint: vp?.viewpoint ?? null,
    });
    for (const ref of t.document_references) await deps.store.addDocument(await documentRow(deps, row.id, ref, author));
    for (const c of t.comments) await deps.store.addComment(row.id, c.author || author, c.comment);
    // Session pre Claude sa pri uložení z viewera nespúšťa (D-158): spustí ju chat na pokyn.
    if (isClaude(row.assigned_to)) claude.push(row.number);
    saved.push(summary(row, t.document_references.length));
  }
  return {
    saved,
    skipped,
    local_in_viewer: count,
    ...(count > topics.length ? { note: `Viewer poslal ${topics.length} z ${count} tém; ulož zvyšok ďalším volaním.` } : {}),
    ...(claude.length
      ? { session_note: `Témy ${claude.map((n) => `#${n}`).join(", ")} sú priradené Claudovi; session sa nespustila, spustí ju bcf_topic(action=update, start_session=true).` }
      : {}),
    hint: "Viewer si témy obnoví sám; uložené dostanú číslo #N.",
  };
}
