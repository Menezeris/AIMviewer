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

// ISR — render uzla sa cachuje a po 60 s revaliduje (viewer je verejný read-only).
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
 * Placeholder karty počas streamovania sekcie (Suspense fallback) — hlavička
 * a jadro stránky prídu okamžite z cachovaného grafu, sekcie sa dostreamujú.
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

/** Riadok atribútu (label : hodnota). */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.8rem]">{value}</dd>
    </div>
  );
}

/** Hlavička karty: typový badge + názov + object_ref. */
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
 * Generické sekcie uzla (S3, D-029): dokumenty, zodpovednosti, história GUID.
 * Presentational — dáta dostane zvonku, aby ich volajúci mohol načítať paralelne
 * s ostatným obsahom karty.
 */
function NodeSectionsCards({
  data,
  ifcGuid,
  nodeId,
}: {
  data: NodeSectionsData;
  ifcGuid: string | null;
  /** `objects.id` uzla — pre `?focus=` odkaz do prehliadačky výkresov (D-042 D). */
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

/** Async wrapper — načíta sekcie sám (priestorové uzly, kde nie je čo paralelizovať). */
async function NodeSections({ id, ifcGuid }: { id: string; ifcGuid: string | null }) {
  const data = await fetchNodeSections(id);
  return <NodeSectionsCards data={data} ifcGuid={ifcGuid} nodeId={id} />;
}

/**
 * „Prvky vo výkrese" (E4, D-041) — pre priestorový uzol (podlažie/budova): výkresy
 * pripojené na uzol a prvky auto-detegované v každom z nich. Skryje sa, ak žiadny
 * výkres uzla nemá detegované prvky.
 */
async function FloorDrawingsSection({ id }: { id: string }) {
  const drawings = await fetchFloorDrawingsCached(id);
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
 * Reality Capture galéria priestoru (D-073, F1): fotky + 360° panorámy naviazané na
 * IfcSpace, obojsmerne (klik na priestor → jeho snímky). Skryje sa pre priestor bez
 * snímok, ak nie je povolený upload (`CAPTURE_WRITE_ENABLED`).
 */
async function CapturesSection({
  spaceId,
  spaceName,
}: {
  spaceId: string;
  spaceName: string | null;
}) {
  const canUpload = process.env.CAPTURE_WRITE_ENABLED === "true";
  const [captures, planDocumentId] = await Promise.all([
    fetchCapturesForSpace(spaceId),
    // Pôdorys podlažia (cieľ „umiestniť na pláne") načítaj len keď je upload povolený.
    canUpload ? fetchPlanDocumentForSpace(spaceId) : Promise.resolve(null),
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
 * „Súčasť systému" (D-047) — systémy, ktorých je prvok členom (`rel_assigns_to_group`).
 * Skryje sa, ak prvok nie je v žiadnom systéme (napr. stavebné prvky ARCH).
 */
async function SystemMembershipSection({ id }: { id: string }) {
  const systems = await fetchSystemMembership(id);
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

/** Jadro detailu assetu (S2): atribúty, properties, klasifikácie. S3 sekcie
 *  streamujú súbežne vo vlastných Suspense hraniciach (viď SpatialView). */
async function AssetDetailView({ id }: { id: string }) {
  const asset = await fetchAsset(id);
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
 * Priestorový uzol (S1) + generické S3 sekcie.
 *
 * Breadcrumb, hlavička a jadro prichádzajú okamžite z cachovaného grafu; každá
 * dátovo závislá sekcia streamuje vo vlastnej Suspense hranici. Async sekcie sú
 * súrodenci → ich fetche bežia paralelne a stránka nečaká na najpomalší z nich.
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

/** Detail osoby (S3): kontakt, členstvá vo firmách, za čo zodpovedá. */
async function PersonView({ id }: { id: string }) {
  const person = await fetchPerson(id);
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

/** Detail organizácie (S3): zachytený kontakt, členovia, za čo zodpovedá. */
async function OrganizationView({ id }: { id: string }) {
  const org = await fetchOrganization(id);
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

/** Texty karty skupinového uzla podľa typu (D-047, D-087). */
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
 * Detail systému (D-047) a ďalších skupinových uzlov - projekt, zóna, priestorová
 * zóna, skupina (D-087): členovia a časti zoskupení podľa IFC typu. Ukazuje
 * previazanosť „systém → prvky" (headline graf pre S-LLM).
 */
async function SystemView({ id }: { id: string }) {
  const system = await fetchSystem(id);
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
 * Generický object route (D-029): priestorové uzly cez `fetchNode` (S1), inak
 * dispatch podľa `object_type`. `asset_type` patrí na `/type/[id]`.
 */
export default async function NodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Spatial detail aj meta pre dispatch naraz — pre ne-priestorové uzly (osoba,
  // organizácia, systém, dokument) to odstráni sekvenčný druhý krok; priestorové
  // uzly stojí navyše len jeden lacný cachovaný single-row dotaz.
  const [spatial, meta] = await Promise.all([fetchNode(id), fetchObjectMeta(id)]);

  // Spatial uzly (site…asset) — bežná cesta, breadcrumb + strom.
  if (spatial) return <SpatialView detail={spatial} />;

  // Nie je priestorový — rozhodni podľa typu objektu.
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
      // Dokumenty sa zobrazujú v prehliadačke (PDF + bočný panel, D-042 D+).
      redirect(`/drawing/${id}`);
    default:
      notFound();
  }
}
