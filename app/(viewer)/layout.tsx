import { fetchSpatialTree } from "@/lib/data/spatial";
import { fetchSidebarNav } from "@/lib/data/nav";
import { SpatialTree } from "@/components/spatial-tree";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarShell } from "@/components/sidebar-shell";
import { SidebarGate } from "@/components/sidebar-gate";
import { AskDock } from "@/components/ask-dock";
import { LiveChannel } from "@/components/live-channel";
import { currentPageProject } from "@/lib/project/page";

// D-189: the project comes from the session cookie (`?project=`), so the layout renders per
// request; the data stays cached per project in `unstable_cache` (60 s, tag `aim:<project>`).

/** AI chat panel in the viewer (D-056) - hidden by default (D-100). */
const ASK_PANEL = process.env.NEXT_PUBLIC_ASK_PANEL === "1";

export default async function ViewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const project = await currentPageProject();
  const [tree, nav] = await Promise.all([fetchSpatialTree(project.id), fetchSidebarNav(project.id)]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* On /ifc the sidebar is not rendered (D-077 viewer-first) - the only tree is
          the native HierarchyPanel of the embed viewer with AIM decorations. */}
      <SidebarGate>
        <SidebarShell>
          <SpatialTree tree={tree} />
          <SidebarNav nav={nav} />
        </SidebarShell>
      </SidebarGate>

      {/* Pages with a `.full-bleed` root (3D viewer) get the whole area without
          padding and without scroll - the content manages its height itself. */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8 [&:has(.full-bleed)]:overflow-hidden [&:has(.full-bleed)]:p-0">
        {children}
      </main>

      {/* Global AI chat at the bottom - the conversation survives navigating between pages (D-056).
          Hidden until NEXT_PUBLIC_ASK_PANEL=1: Claude works via the MCP connector (D-100). */}
      {ASK_PANEL && <AskDock />}

      {/* Live channel: commands from Claude via the MCP connector (D-079), only with ?live=. */}
      <LiveChannel />
    </div>
  );
}
