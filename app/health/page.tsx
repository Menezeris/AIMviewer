import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Vždy čerstvý fetch (žiadny statický cache) — je to live connection test.
export const dynamic = "force-dynamic";

async function fetchObjectsCount(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    const supabase = getSupabaseAdmin();
    // head:true => nevracia riadky, len count (select count(*) from objects).
    const { count, error } = await supabase
      .from("objects")
      .select("*", { count: "exact", head: true })
      .is("valid_until", null);

    if (error) return { ok: false, error: error.message };
    return { ok: true, count: count ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function Health() {
  const result = await fetchObjectsCount();

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>AIM Viewer — health</CardTitle>
          <CardDescription>Supabase connection test</CardDescription>
        </CardHeader>
        <CardContent>
          {result.ok ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-600 dark:text-green-500">
                Supabase connected ✅
              </p>
              <p className="text-sm text-muted-foreground">
                <code>select count(*) from objects</code>
              </p>
              <p className="text-4xl font-semibold tabular-nums">{result.count}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-600 dark:text-red-500">
                Supabase connection failed ❌
              </p>
              <p className="break-words text-sm text-muted-foreground">
                {result.error}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
