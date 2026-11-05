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

/** Panel AI chatu vo vieweri (D-056) - predvolene skrytý (D-100). */
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
      {/* Na /ifc sa sidebar nerenderuje (D-077 viewer-first) — jediný strom je
          natívny HierarchyPanel embed viewera s AIM dekoráciami. */}
      <SidebarGate>
        <SidebarShell>
          <SpatialTree tree={tree} />
          <SidebarNav nav={nav} />
        </SidebarShell>
      </SidebarGate>

      {/* Stránky s koreňom `.full-bleed` (3D viewer) dostanú celú plochu bez
          paddingu a bez scrollu — obsah si výšku manažuje sám. */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8 [&:has(.full-bleed)]:overflow-hidden [&:has(.full-bleed)]:p-0">
        {children}
      </main>

      {/* Globálny AI chat pri spodku — konverzácia prežíva preklikávanie (D-056).
          Skrytý, kým nie je NEXT_PUBLIC_ASK_PANEL=1: Claude pracuje cez MCP konektor (D-100). */}
      {ASK_PANEL && <AskDock />}

      {/* Živý kanál: príkazy od Claude cez MCP konektor (D-079), len s ?live=. */}
      <LiveChannel />
    </div>
  );
}
