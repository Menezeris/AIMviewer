import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchAssetType } from "@/lib/data/asset";
import { fetchElementDrawings } from "@/lib/data/relations";
import { PropertySets } from "@/components/property-sets";
import { ClassificationList } from "@/components/classification-list";
import { DrawingList } from "@/components/drawing-list";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ISR — render typu sa cachuje a po 60 s revaliduje (viewer je verejný read-only).
export const revalidate = 60;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[0.8rem]">{value}</dd>
    </div>
  );
}

export default async function TypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [type, drawings] = await Promise.all([
    fetchAssetType(id),
    fetchElementDrawings(id),
  ]);
  if (!type) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          Typ assetu
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          {type.name ?? type.object_ref ?? type.id}
        </h1>
        {type.object_ref && (
          <p className="font-mono text-sm text-muted-foreground">{type.object_ref}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Typ nemá polohu v priestore — zdieľané atribúty dedia jeho occurrence (D-021).
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Atribúty</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Field label="IFC typ" value={type.ifc_type} />
            <Field label="PredefinedType" value={type.predefinedType} />
            <Field label="ElementType" value={type.userDefinedType} />
            <Field label="IFC GUID" value={type.ifc_guid} />
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Zdieľané properties</CardTitle>
        </CardHeader>
        <CardContent>
          <PropertySets groups={type.propertySets} showProvenance={false} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>
            Klasifikácie{" "}
            <span className="text-muted-foreground">
              ({type.classifications.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClassificationList facets={type.classifications} showLevel={false} />
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
            <DrawingList drawings={drawings} elementId={id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Použité v assetoch{" "}
            <span className="text-muted-foreground">({type.occurrences.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {type.occurrences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tento typ zatiaľ nepoužíva žiadny asset.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {type.occurrences.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/node/${o.id}`}
                    className="flex items-center justify-between gap-2 py-2 text-sm hover:text-foreground"
                  >
                    <span>{o.name ?? o.object_ref ?? o.id}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {o.object_ref}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
