import type { BcfTopicRow, TopicDocumentRow } from "./store";

/**
 * Filter tém podľa nadradenej entity (D-158 krok 4): podlažie, priestor, budova, ľubovoľný
 * objekt AIM alebo IfcProject. Téma padne do rozsahu, keď jej `components` obsahujú entitu
 * alebo niečo v nej (priestory, prvky contained a referenced, D-080), alebo jej odkaz smeruje
 * na dokument priradený entite či jej priestorom (pôdorys podlažia). IfcProject berie len
 * témy na celý projekt (GlobalId projektu v `components`), inak by to boli všetky témy.
 * Čistá časť; rozsah z DB zostaví `entity-scope-runtime.ts`.
 */

export interface EntityScope {
  /** Čo sa našlo (object_ref alebo názov) a aký je to uzol AIM. */
  label: string;
  object_type: string;
  /** GlobalId entity samotnej. */
  self: string | null;
  /** GlobalId entity a všetkého v nej (pri projekte len projekt). */
  guids: Set<string>;
  /** objects.id dokumentov priradených entite alebo jej priestorom. */
  documents: Set<string>;
}

export type EntityMatch = "self" | "within" | "document";

/** Prečo téma patrí do rozsahu; null = nepatrí. */
export function topicInScope(topic: Pick<BcfTopicRow, "components">, docs: Pick<TopicDocumentRow, "document_id">[], scope: EntityScope): EntityMatch | null {
  if (scope.self && topic.components.includes(scope.self)) return "self";
  if (topic.components.some((g) => scope.guids.has(g))) return "within";
  if (docs.some((d) => d.document_id && scope.documents.has(d.document_id))) return "document";
  return null;
}
