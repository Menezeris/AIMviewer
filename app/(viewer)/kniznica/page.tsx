import { KniznicaPrehliadac } from "@/components/kniznica-prehliadac";

/** Read-only prehliadač knižnice požiadaviek (hlava v DB, port do TS krok 1). Stránka je len obal. */
export default async function KniznicaPage({ searchParams }: { searchParams: Promise<{ kniznica?: string; cesta?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto w-full max-w-6xl">
      <KniznicaPrehliadac initial={{ kniznica: sp.kniznica, cesta: sp.cesta }} />
    </div>
  );
}
