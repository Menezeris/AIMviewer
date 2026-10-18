import { fetchUnderlayDrawings } from "@/lib/data/drawing";
import { fetchProjectDocuments } from "@/lib/data/documents";
import { fetchCapturePins } from "@/lib/data/captures";
import { fetchTreeDecorations } from "@/lib/data/decorations";
import { fetchDerivationLayer } from "@/lib/data/derivations";
import { fetchGuidMap, getCurrentIfcModels } from "@/lib/data/ifc";
import IFCWorkspace from "@/components/ifc-workspace";

// SSR na každý request — GUID mapa sa číta z DB (cache na úrovni fetchGuidMap, D-029).
export const dynamic = "force-dynamic";

export default async function IFCPage({
  searchParams,
}: {
  /** `focus` = IFC GUID(y) na zvýraznenie (čiarkou oddelené); `ops` = viewer
   *  operácie AI docku (ofarbenie/skrytie/izolácia, D-066); `r` = nonce
   *  akcie AI docku — nová hodnota vynúti re-aplikáciu focusu/ops (D-056);
   *  `doc` = id dokumentu na otvorenie ako karta vo viewri (D-075). */
  searchParams: Promise<{ focus?: string; ops?: string; r?: string; doc?: string }>;
}) {
  const { focus, ops, r, doc } = await searchParams;

  const [models, guidMap, underlays, documents, captures, decorations, derivations] = await Promise.all([
    // Aktuálne revízie modelov (D-086) — `?rev=` v URL obnoví iframe po novej revízii.
    getCurrentIfcModels(),
    fetchGuidMap(),
    // Georeferencované PDF podklady (D-072) — viewer ich dostane po MODELS_LOADED.
    fetchUnderlayDrawings(),
    // Knižnica dokumentov pre in-viewer Documents panel (D-075).
    fetchProjectDocuments(),
    // Reality Capture piny (D-073) — world-ukotvené capture pointy do 3D.
    fetchCapturePins(),
    // AIM dekorácie stromu (D-077) — per-GUID badge counts pre embed viewer.
    fetchTreeDecorations(),
    // Vrstva AIM nad modelmi (D-089) — bez migrácie null, viewer beží bez nej.
    fetchDerivationLayer().catch(() => null),
  ]);

  // Full-bleed: viewer zaberá celú plochu main-u (layout zruší padding aj
  // scroll cez :has(.full-bleed)); navigácia a strom ostávajú v ľavom sidebari.
  return (
    <div className="full-bleed h-full">
      <IFCWorkspace models={models} guidMap={guidMap} focus={focus} focusNonce={r} ops={ops} underlays={underlays} documents={documents} openDocumentId={doc} captures={captures} decorations={decorations} derivations={derivations} />
    </div>
  );
}
