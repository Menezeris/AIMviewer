import { LibraryBrowser } from "@/components/library-browser";

/** Read-only browser of the requirements library (head in the DB, port to TS step 1). The page is just a wrapper. */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ kniznica?: string; cesta?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto w-full max-w-6xl">
      <LibraryBrowser initial={{ kniznica: sp.kniznica, cesta: sp.cesta }} />
    </div>
  );
}
