import { Suspense } from "react";
import Link from "next/link";
import { Cuboid } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { fetchNode, type NodeDetail, type NodeRef } from "@/lib/data/spatial";
import { fetchAsset } from "@/lib/data/asset";
import {
  fetchNodeSections,
  fetchFloorDrawingsCached,
  fetchSystemMembership,
  type NodeSectionsData,
} from "@/lib/data/relations";
import {
  fetchObjectMeta,
  fetchPerson,
  fetchOrganization,
  fetchSystem,
} from "@/lib/data/object";
import {
  OBJECT_TYPE_LABEL,
  SPATIAL_ZONE_TYPE_LABEL,
  SYSTEM_TYPE_LABEL,
  roleLabel,
  type GroupLikeType,
} from "@/lib/object-type";
import { formatDate } from "@/lib/utils";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { PropertySets } from "@/components/property-sets";
import { ClassificationList } from "@/components/classification-list";
import { DocumentList } from "@/components/document-list";
import { DrawingList } from "@/components/drawing-list";
import { DrawingElements } from "@/components/drawing-elements";
import { CaptureGallery } from "@/components/capture-gallery";
import { fetchCapturesForSpace, fetchPlanDocumentForSpace } from "@/lib/data/captures";
import { ResponsibilityList } from "@/components/responsibility-list";
import { ResponsibilityOfList } from "@/components/responsibility-of-list";
import { GuidHistory } from "@/components/guid-history";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { currentPageProject } from "@/lib/project/page";

// ISR - the node render is cached and revalidated after 60 s (viewer is public read-only).
export const revalidate = 60;

function Breadcrumb({ trail }: { trail: NodeRef[] }) {
  if (trail.length === 0) return null;
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {trail.map((n, i) => (
        <span key={n.id} className="flex items-center gap-1">
          {i > 0 && <span>/</span>}
          <Link href={`/node/${n.id}`} className="hover:text-foreground hover:underline">
            {n.name ?? n.object_ref ?? n.id}
          </Link>
        </span>
      ))}
    </nav>
  );
}

/**
 * Card placeholder while a section streams (Suspense fallback) - the header
 * and the page core arrive immediately from the cached graph, the sections stream in later.
 */
function SectionSkeleton() {
  return (
    <div className="mb-6 animate-pulse rounded-xl border p-6" aria-hidden>
      <div className="h-5 w-40 rounded bg-muted" />
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
    </div>
  );
}

/** Attribute row (label : value). */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.8rem]">{value}</dd>
    </div>
  );
}

/** Card header: type badge + name + object_ref. */
function NodeHeader({
  type,
  name,
  objectRef,
}: {
  type: keyof typeof OBJECT_TYPE_LABEL;
  name: string | null;
  objectRef: string | null;
}) {
  return (
    <header className="mb-6">
      <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
        {OBJECT_TYPE_LABEL[type]}
      </span>
      <h1 className="mt-2 font-heading text-2xl font-semibold">{name ?? objectRef ?? "—"}</h1>
      {objectRef && (
        <p className="font-mono text-sm text-muted-foreground">{objectRef}</p>
      )}
    </header>
  );
}

/**
 * Generic node sections (S3, D-029): documents, responsibilities, GUID history.
 * Presentational - data comes from outside so that the caller can load it in parallel
 * with the rest of the card content.
 */
function NodeSectionsCards({
  data,
  ifcGuid,
  nodeId,
}: {
  data: NodeSectionsData;
  ifcGuid: string | null;
  /** `objects.id` of the node - for the `?focus=` link into the drawing viewer (D-042 D). */
  nodeId: string;
}) {
  const { documents, drawings, responsibilities, guidHistory } = data;

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Dokumenty{" "}
            <span className="text-muted-foreground">({documents.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentList documents={documents} />
        </CardContent>
      </Card>

      {drawings.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Zobrazený vo výkrese{" "}
              <span className="text-muted-foreground">({drawings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DrawingList drawings={drawings} elementId={nodeId} />
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Zodpovednosti{" "}
            <span className="text-muted-foreground">({responsibilities.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsibilityList items={responsibilities} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>História IFC GUID</CardTitle>
        </CardHeader>
        <CardContent>
          <GuidHistory currentGuid={ifcGuid} history={guidHistory} />
        </CardContent>
      </Card>
    </>
  );
}

/** Async wrapper - loads the sections itself (spatial nodes, where there is nothing to parallelize). */
async function NodeSections({ id, ifcGuid }: { id: string; ifcGuid: string | null }) {
  const projectId = (await currentPageProject()).id;
  const data = await fetchNodeSections(projectId, id);
  return <NodeSectionsCards data={data} ifcGuid={ifcGuid} nodeId={id} />;
}

/**
 * "Elements in drawing" (E4, D-041) - for a spatial node (storey/building): drawings
 * attached to the node and elements auto-detected in each of them. Hidden if no
 * drawing of the node has detected elements.
 */
async function FloorDrawingsSection({ id }: { id: string }) {
  const projectId = (await currentPageProject()).id;
  const drawings = await fetchFloorDrawingsCached(projectId, id);
  if (drawings.length === 0) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          Prvky vo výkrese{" "}
          <span className="text-muted-foreground">({drawings.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DrawingElements drawings={drawings} />
      </CardContent>
    </Card>
  );
}

/**
 * Reality Capture gallery of a space (D-073, F1): photos + 360° panoramas linked to
 * the IfcSpace, bidirectionally (click on a space -> its shots). Hidden for a space without
 * shots if upload is not enabled (`CAPTURE_WRITE_ENABLED`).
 */
async function CapturesSection({
  spaceId,
  spaceName,
}: {
  spaceId: string;
  spaceName: string | null;
}) {
  const projectId = (await currentPageProject()).id;
  const canUpload = process.env.CAPTURE_WRITE_ENABLED === "true";
  const [captures, planDocumentId] = await Promise.all([
    fetchCapturesForSpace(projectId, spaceId),
    // Load the storey floor plan (target "place on the plan") only when upload is enabled.
    canUpload ? fetchPlanDocumentForSpace(projectId, spaceId) : Promise.resolve(null),
  ]);
  if (captures.length === 0 && !canUpload) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          Reality Capture{" "}
          <span className="text-muted-foreground">({captures.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CaptureGallery
          spaceId={spaceId}
          spaceName={spaceName}
          initialCaptures={captures}
          canUpload={canUpload}
          planDocumentId={planDocumentId}
        />
      </CardContent>
    </Card>
  );
}

/**
 * "Part of system" (D-047) - systems the element is a member of (`rel_assigns_to_group`).
 * Hidden if the element is in no system (e.g. ARCH building elements).
 */
async function SystemMembershipSection({ id }: { id: string }) {
  const projectId = (await currentPageProject()).id;
  const systems = await fetchSystemMembership(projectId, id);
  if (systems.length === 0) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          Súčasť systému{" "}
          <span className="text-muted-foreground">({systems.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {systems.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link
                href={`/node/${s.id}`}
                className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                {s.name ?? s.objectRef ?? s.id}
              </Link>
              {s.predefinedType && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium text-secondary-foreground">
                  {roleLabel(SYSTEM_TYPE_LABEL, s.predefinedType)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Core of the asset detail (S2): attributes, properties, classifications. S3 sections
 *  stream concurrently in their own Suspense boundaries (see SpatialView). */
async function AssetDetailView({ id }: { id: string }) {
  const projectId = (await currentPageProject()).id;
  const asset = await fetchAsset(projectId, id);
  if (!asset) notFound();

  const predef = asset.predefinedType.value && (
    <span className="flex flex-wrap items-center gap-2">
      <span>{asset.predefinedType.value}</span>
      {asset.predefinedType.inherited && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-secondary-foreground">
          zdedené z typu
        </span>
      )}
    </span>
  );

  return (
    <>
      {asset.ifc_guid && (
        <div className="mb-4">
          <Link
            href={`/ifc?focus=${asset.ifc_guid}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80"
          >
            <Cuboid className="size-4" />
            Zobraziť v 3D
          </Link>
        </div>
      )}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Atribúty</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="IFC typ" value={asset.ifc_type} />
            <Field label="PredefinedType" value={predef} />
            <Field label="ObjectType" value={asset.userDefinedType} />
            <Field label="IFC GUID" value={asset.ifc_guid} />
            <Field
              label="Typ"
              value={
                asset.type ? (
                  <Link
                    href={`/type/${asset.type.id}`}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {asset.type.name ?? asset.type.object_ref ?? asset.type.id}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">bez typu</span>
                )
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Properties</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertySets groups={asset.propertySets} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Klasifikácie{" "}
            <span className="text-muted-foreground">
              ({asset.classifications.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClassificationList facets={asset.classifications} />
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Spatial node (S1) + generic S3 sections.
 *
 * Breadcrumb, header and core arrive immediately from the cached graph; each
 * data-dependent section streams in its own Suspense boundary. Async sections are
 * siblings -> their fetches run in parallel and the page does not wait for the slowest of them.
 */
function SpatialView({ detail }: { detail: NodeDetail }) {
  const { node, breadcrumb, children } = detail;
  const isAsset = node.object_type === "asset";
  const childLabel = node.object_type === "space" ? "Assety" : "Obsahuje";

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb trail={breadcrumb} />
      <NodeHeader type={node.object_type} name={node.name} objectRef={node.object_ref} />

      {isAsset ? (
        <>
          <Suspense fallback={<SectionSkeleton />}>
            <AssetDetailView id={node.id} />
          </Suspense>
          <Suspense fallback={null}>
            <SystemMembershipSection id={node.id} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton />}>
            <NodeSections id={node.id} ifcGuid={node.ifc_guid} />
          </Suspense>
        </>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>
                {childLabel}{" "}
                <span className="text-muted-foreground">({children.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {children.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Tento uzol zatiaľ nič neobsahuje.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {children.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/node/${c.id}`}
                        prefetch={true}
                        className="flex items-center gap-2 py-2 text-sm hover:text-foreground"
                      >
                        <LinkPendingSpinner />
                        <span>{c.name ?? c.object_ref ?? c.id}</span>
                        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                          {c.object_ref}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {node.object_type === "space" && (
            <Suspense fallback={null}>
              <CapturesSection spaceId={node.id} spaceName={node.name} />
            </Suspense>
          )}

          <Suspense fallback={null}>
            <FloorDrawingsSection id={node.id} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton />}>
            <NodeSections id={node.id} ifcGuid={node.ifc_guid} />
          </Suspense>
        </>
      )}
    </div>
  );
}

/** Person detail (S3): contact, memberships in companies, what they are responsible for. */
async function PersonView({ id }: { id: string }) {
  const projectId = (await currentPageProject()).id;
  const person = await fetchPerson(projectId, id);
  if (!person) notFound();

  const fullName =
    [person.givenName, person.familyName].filter(Boolean).join(" ") || null;

  return (
    <div className="mx-auto max-w-3xl">
      <NodeHeader type="person" name={person.name} objectRef={person.object_ref} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Kontakt</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="Meno" value={fullName} />
            <Field
              label="E-mail"
              value={
                person.email ? (
                  <a
                    href={`mailto:${person.email}`}
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {person.email}
                  </a>
                ) : null
              }
            />
            <Field label="Telefón" value={person.phone} />
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Členstvo{" "}
            <span className="text-muted-foreground">({person.memberships.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {person.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bez členstva v organizácii.
            </p>
          ) : (
            <ul className="space-y-2">
              {person.memberships.map((m) => (
                <li
                  key={m.orgId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <Link
                    href={`/node/${m.orgId}`}
                    className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {m.orgName ?? m.orgRef ?? m.orgId}
                  </Link>
                  {m.role && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium text-secondary-foreground">
                      {m.role}
                    </span>
                  )}
                  {formatDate(m.validFrom) && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      od {formatDate(m.validFrom)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Zodpovedá za{" "}
            <span className="text-muted-foreground">
              ({person.responsibilities.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsibilityOfList items={person.responsibilities} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Organization detail (S3): captured contact, members, what they are responsible for. */
async function OrganizationView({ id }: { id: string }) {
  const projectId = (await currentPageProject()).id;
  const org = await fetchOrganization(projectId, id);
  if (!org) notFound();

  const contactEntries = org.contact
    ? Object.entries(org.contact).filter(([k]) => !k.startsWith("__"))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <NodeHeader type="organization" name={org.name} objectRef={org.object_ref} />

      {contactEntries.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Kontakt{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (zachytené, _contact)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {contactEntries.map(([k, v]) => (
                <Field
                  key={k}
                  label={k}
                  value={typeof v === "object" ? JSON.stringify(v) : String(v)}
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Členovia{" "}
            <span className="text-muted-foreground">({org.members.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {org.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žiadni evidovaní členovia.</p>
          ) : (
            <ul className="space-y-2">
              {org.members.map((m) => (
                <li
                  key={m.personId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <Link
                    href={`/node/${m.personId}`}
                    className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {m.personName ?? m.personRef ?? m.personId}
                  </Link>
                  {m.role && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium text-secondary-foreground">
                      {m.role}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Zodpovedá za{" "}
            <span className="text-muted-foreground">
              ({org.responsibilities.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsibilityOfList items={org.responsibilities} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Texts of the group node card by type (D-047, D-088). */
const GROUP_VIEW_TEXT: Record<
  GroupLikeType,
  { kindLabel: string; kinds: Record<string, string>; members: string; empty: string }
> = {
  system: { kindLabel: "Druh systému", kinds: SYSTEM_TYPE_LABEL, members: "Prvky systému", empty: "Systém nemá evidované prvky." },
  project: { kindLabel: "Druh", kinds: {}, members: "Časti projektu", empty: "Projekt nemá evidované časti." },
  zone: { kindLabel: "Druh", kinds: {}, members: "Členovia zóny", empty: "Zóna nemá evidovaných členov." },
  spatial_zone: { kindLabel: "Druh zóny", kinds: SPATIAL_ZONE_TYPE_LABEL, members: "Priestory a prvky v zóne", empty: "V zóne nie sú evidované priestory ani prvky." },
  group: { kindLabel: "Druh", kinds: {}, members: "Prvky skupiny", empty: "Skupina nemá evidované prvky." },
};

/**
 * Detail of a system (D-047) and other group nodes - project, zone, spatial
 * zone, group (D-088): members and parts of groupings by IFC type. Shows
 * the "system -> elements" linkage (headline graph for S-LLM).
 */
async function SystemView({ id }: { id: string }) {
  const projectId = (await currentPageProject()).id;
  const system = await fetchSystem(projectId, id);
  if (!system) notFound();
  const text = GROUP_VIEW_TEXT[system.objectType];

  return (
    <div className="mx-auto max-w-3xl">
      <NodeHeader type={system.objectType} name={system.name} objectRef={system.object_ref} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Atribúty</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field
              label={text.kindLabel}
              value={
                system.predefinedType && system.predefinedType !== "NOTDEFINED"
                  ? roleLabel(text.kinds, system.predefinedType)
                  : null
              }
            />
            <Field label="Počet prvkov" value={system.memberCount || null} />
            {system.objectType === "project" && (
              <Field
                label="Knižnica požiadaviek"
                value={
                  <Link href="/library" className="hover:underline" data-testid="project-kniznica-link">
                    Prehliadač knižnice (len na čítanie)
                  </Link>
                }
              />
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {text.members}{" "}
            <span className="text-muted-foreground">({system.memberCount})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {system.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{text.empty}</p>
          ) : (
            <div className="space-y-5">
              {system.groups.map((g) => (
                <div key={g.ifcType ?? "—"}>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <span className="font-mono text-[0.8rem]">{g.ifcType ?? "—"}</span>
                    <span className="text-muted-foreground">({g.count})</span>
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {g.members.map((m) => (
                      <li key={m.id}>
                        <Link
                          href={`/node/${m.id}`}
                          className="inline-block rounded bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground hover:bg-secondary/80"
                        >
                          {m.object_ref ?? m.name ?? m.id}
                        </Link>
                      </li>
                    ))}
                    {g.count > g.members.length && (
                      <li className="self-center text-xs text-muted-foreground">
                        +{g.count - g.members.length} ďalších
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Generic object route (D-029): spatial nodes via `fetchNode` (S1), otherwise
 * dispatch by `object_type`. `asset_type` belongs to `/type/[id]`.
 */
export default async function NodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const projectId = (await currentPageProject()).id;
  const { id } = await params;

  // Spatial detail and meta for the dispatch at once - for non-spatial nodes (person,
  // organization, system, document) this removes the sequential second step; for spatial
  // nodes it costs just one cheap cached single-row query on top.
  const [spatial, meta] = await Promise.all([fetchNode(projectId, id), fetchObjectMeta(projectId, id)]);

  // Spatial nodes (site...asset) - the usual path, breadcrumb + tree.
  if (spatial) return <SpatialView detail={spatial} />;

  // Not spatial - decide by object type.
  if (!meta) notFound();

  switch (meta.object_type) {
    case "asset_type":
      redirect(`/type/${id}`);
    case "person":
      return <PersonView id={id} />;
    case "organization":
      return <OrganizationView id={id} />;
    case "system":
    case "project":
    case "zone":
    case "spatial_zone":
    case "group":
      return <SystemView id={id} />;
    case "document":
    case "document_reference":
      // Documents are shown in the viewer (PDF + side panel, D-042 D+);
      // a link to a part of a document opens it on its page (D-104).
      redirect(`/drawing/${id}`);
    default:
      notFound();
  }
}
