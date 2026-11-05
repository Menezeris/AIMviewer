import type { BcfTopicRow, TopicDocumentRow } from "./store";

/**
 * Topic filter by parent entity (D-158 step 4): storey, space, building, any
 * AIM object or IfcProject. A topic falls into the scope when its `components` contain the entity
 * or something in it (spaces, contained and referenced elements, D-080), or its reference points
 * to a document assigned to the entity or its spaces (storey floor plan). IfcProject takes only
 * topics for the whole project (the project GlobalId in `components`), otherwise it would be all topics.
 * The pure part; the scope from the DB is assembled by `entity-scope-runtime.ts`.
 */

export interface EntityScope {
  /** What was found (object_ref or name) and what kind of AIM node it is. */
  label: string;
  object_type: string;
  /** GlobalId entity samotnej. */
  self: string | null;
  /** GlobalId of the entity and of everything in it (for a project only the project). */
  guids: Set<string>;
  /** objects.id of documents assigned to the entity or its spaces. */
  documents: Set<string>;
}

export type EntityMatch = "self" | "within" | "document";

/** Why the topic belongs to the scope; null = it does not. */
export function topicInScope(topic: Pick<BcfTopicRow, "components">, docs: Pick<TopicDocumentRow, "document_id">[], scope: EntityScope): EntityMatch | null {
  if (scope.self && topic.components.includes(scope.self)) return "self";
  if (topic.components.some((g) => scope.guids.has(g))) return "within";
  if (docs.some((d) => d.document_id && scope.documents.has(d.document_id))) return "document";
  return null;
}
