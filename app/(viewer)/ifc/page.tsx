import { fetchUnderlayDrawings } from "@/lib/data/drawing";
import { fetchProjectDocuments } from "@/lib/data/documents";
import { fetchViewerDocumentLinks } from "@/lib/data/drawing-links";
import { fetchCapturePins } from "@/lib/data/captures";
import { fetchTreeDecorations } from "@/lib/data/decorations";
import { fetchDerivationLayer } from "@/lib/data/derivations";
import { fetchGuidMap, getCurrentIfcModels } from "@/lib/data/ifc";
import IFCWorkspace from "@/components/ifc-workspace";
import { currentPageProject } from "@/lib/project/page";

// SSR on every request - the GUID map is read from the DB (cache at the fetchGuidMap level, D-029).
export const dynamic = "force-dynamic";

export default async function IFCPage({
  searchParams,
}: {
  /** `focus` = IFC GUID(s) to highlight (comma-separated); `ops` = viewer
   *  operations of the AI dock (coloring/hiding/isolation, D-066); `r` = nonce
   *  of the AI dock action - a new value forces re-applying focus/ops (D-056);
   *  `doc` = id of the document to open as a tab in the viewer (D-075). */
  searchParams: Promise<{ focus?: string; ops?: string; r?: string; doc?: string }>;
}) {
  const project = await currentPageProject();
  const projectId = project.id;
  const { focus, ops, r, doc } = await searchParams;

  const documentsP = fetchProjectDocuments(projectId);
  const [models, guidMap, underlays, documents, captures, decorations, derivations, documentLinks] = await Promise.all([
    // Current model revisions (D-086) - `?rev=` in the URL refreshes the iframe after a new revision.
    getCurrentIfcModels(projectId),
    fetchGuidMap(projectId),
    // Georeferenced PDF underlays (D-072) - the viewer receives them after MODELS_LOADED.
    fetchUnderlayDrawings(projectId),
    // Document library for the in-viewer Documents panel (D-075).
    documentsP,
    // Reality Capture pins (D-073) - world-anchored capture points in 3D.
    fetchCapturePins(projectId),
    // AIM tree decorations (D-077) - per-GUID badge counts for the embed viewer.
    fetchTreeDecorations(projectId),
    // AIM layer over the models (D-089) - null without the migration, the viewer runs without it.
    fetchDerivationLayer(projectId).catch(() => null),
    // Floor plan labels as links to an element (D-130, AIM layer); without them the viewer keeps running.
    documentsP
      .then((docs) => fetchViewerDocumentLinks(projectId, docs.filter((d) => d.kind === "drawing").map((d) => d.documentId)))
      .catch(() => null),
  ]);

  // Full-bleed: the viewer takes the whole area of main (the layout removes padding and
  // scroll via :has(.full-bleed)); navigation and tree stay in the left sidebar.
  return (
    <div className="full-bleed h-full">
      <IFCWorkspace projectCode={project.code} models={models} guidMap={guidMap} focus={focus} focusNonce={r} ops={ops} underlays={underlays} documents={documents} openDocumentId={doc} captures={captures} decorations={decorations} derivations={derivations} documentLinks={documentLinks} />
    </div>
  );
}
