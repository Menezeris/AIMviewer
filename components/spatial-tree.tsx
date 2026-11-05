"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  Building2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  DoorOpen,
  Layers,
  Loader2,
  MapPin,
  Shapes,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { SpatialNode, SpatialType } from "@/lib/data/spatial";

const ICONS: Record<SpatialType, LucideIcon> = {
  site: MapPin,
  building: Building2,
  floor: Layers,
  space: DoorOpen,
  asset: Box,
};

/** Order of the types in the tree (`SPATIAL_TYPES` is in a server-only module). */
const TYPE_ORDER: SpatialType[] = ["site", "building", "floor", "space", "asset"];

/** Nodes without `ifc_type` (should not happen) fall into the catch-all bucket. */
const UNCLASSIFIED = "Bez IFC triedy";

/**
 * Children grouped by IFC class - an intermediate layer of the tree (e.g. `IfcSpace`,
 * `IfcWall`) above the elements of a storey/space.
 */
interface ClassGroup {
  /** Synthetic id for the open state: `${parentId}::${ifcType}`. */
  id: string;
  label: string;
  members: SpatialNode[];
}

/**
 * Splits children by `ifc_type`. Returns `null` when grouping is not needed -
 * purely structural levels (site->building->floor) stay flat, the intermediate layer
 * only makes sense where spaces are mixed with elements.
 */
function groupByIfcClass(parentId: string, children: SpatialNode[]): ClassGroup[] | null {
  if (!children.some((c) => c.object_type === "asset")) return null;

  const groups = new Map<string, ClassGroup>();
  for (const child of children) {
    const label = child.ifc_type ?? UNCLASSIFIED;
    const group = groups.get(label);
    if (group) group.members.push(child);
    else groups.set(label, { id: `${parentId}::${label}`, label, members: [child] });
  }
  if (groups.size < 2) return null;

  // Order: spatial structure (IfcSpace) before elements, then alphabetically.
  return [...groups.values()].sort((a, b) => {
    const ra = TYPE_ORDER.indexOf(a.members[0].object_type);
    const rb = TYPE_ORDER.indexOf(b.members[0].object_type);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label, "sk");
  });
}

// Default: expanded down to storeys (site->building->floor visible, space and below collapsed).
const DEFAULT_OPEN_DEPTH = 2;

/**
 * Shared open state of the tree. The `default` mode (rule by depth) can be switched globally
 * to `all`/`none` via "Rozbaliť/Zbaliť všetko" (expand/collapse all); individual nodes are overridden by
 * `overrides`. Toggle stores the opposite of the currently effective value.
 */
type TreeMode = "default" | "all" | "none";

interface TreeCtx {
  isOpen: (id: string, depth: number) => boolean;
  toggle: (id: string, depth: number) => void;
}

const TreeContext = createContext<TreeCtx | null>(null);

/**
 * Node icon which, during an ongoing navigation from this link, changes into a
 * spinning wheel (`useLinkStatus`) - the click has an immediate visible response.
 */
function TreeLinkIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <Loader2
        aria-label="Načítava sa"
        className="size-4 shrink-0 animate-spin text-muted-foreground"
      />
    );
  }
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

function useTree() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("TreeContext chýba");
  return ctx;
}

/**
 * IFC class group row - it is not an object in AIM, so unlike
 * `TreeNode` it has no link to the detail, it only expands its members.
 */
function ClassGroupNode({ group, depth }: { group: ClassGroup; depth: number }) {
  const { isOpen, toggle } = useTree();
  const open = isOpen(group.id, depth);

  return (
    <li>
      <div
        className="group/row flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-sidebar-accent/60"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => toggle(group.id, depth)}
          aria-label={open ? "Zbaliť" : "Rozbaliť"}
          aria-expanded={open}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
          />
        </button>

        <button
          type="button"
          onClick={() => toggle(group.id, depth)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <Shapes className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{group.label}</span>
          <span className="ml-auto shrink-0 font-mono text-[0.7rem] text-muted-foreground">
            {group.members.length}
          </span>
        </button>
      </div>

      {open && (
        <ul>
          {group.members.map((member) => (
            <TreeNode key={member.id} node={member} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreeNode({ node, depth }: { node: SpatialNode; depth: number }) {
  const pathname = usePathname();
  const { isOpen, toggle } = useTree();
  const isActive = pathname === `/node/${node.id}`;
  const hasChildren = node.children.length > 0;
  const open = isOpen(node.id, depth);
  const groups = groupByIfcClass(node.id, node.children);

  return (
    <li>
      <div
        className={cn(
          "group/row flex items-center gap-1 rounded-md pr-1 text-sm",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id, depth)}
            aria-label={open ? "Zbaliť" : "Rozbaliť"}
            aria-expanded={open}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        <Link
          href={`/node/${node.id}`}
          // Full prefetch of the RSC payload of visible nodes - a click is then served
          // from the client cache instead of a server round-trip.
          prefetch={true}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
        >
          <TreeLinkIcon icon={ICONS[node.object_type]} />
          <span className="truncate">{node.name ?? node.object_ref ?? node.id}</span>
          {node.object_ref && (
            <span className="ml-auto shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground">
              {node.object_ref}
            </span>
          )}
        </Link>
      </div>

      {hasChildren && open && (
        <ul>
          {groups
            ? groups.map((group) => (
                <ClassGroupNode key={group.id} group={group} depth={depth + 1} />
              ))
            : node.children.map((child) => (
                <TreeNode key={child.id} node={child} depth={depth + 1} />
              ))}
        </ul>
      )}
    </li>
  );
}

export function SpatialTree({ tree }: { tree: SpatialNode[] }) {
  const [mode, setMode] = useState<TreeMode>("default");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const effectiveOpen = useCallback(
    (id: string, depth: number) => {
      if (id in overrides) return overrides[id];
      if (mode === "all") return true;
      if (mode === "none") return false;
      return depth < DEFAULT_OPEN_DEPTH;
    },
    [overrides, mode]
  );

  const toggle = useCallback(
    (id: string, depth: number) => {
      setOverrides((o) => ({ ...o, [id]: !effectiveOpen(id, depth) }));
    },
    [effectiveOpen]
  );

  const expandAll = useCallback(() => {
    setMode("all");
    setOverrides({});
  }, []);
  const collapseAll = useCallback(() => {
    setMode("none");
    setOverrides({});
  }, []);

  if (tree.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted-foreground">
        Žiadne dáta — priestorová hierarchia je prázdna.
      </p>
    );
  }

  return (
    <TreeContext.Provider value={{ isOpen: effectiveOpen, toggle }}>
      <div className="mb-1 flex items-center justify-end gap-0.5 px-1">
        <button
          type="button"
          onClick={expandAll}
          title="Rozbaliť všetko"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[0.7rem] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <ChevronsUpDown className="size-3.5" />
          Rozbaliť
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title="Zbaliť všetko"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[0.7rem] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <ChevronsDownUp className="size-3.5" />
          Zbaliť
        </button>
      </div>

      <ul className="space-y-0.5">
        {tree.map((root) => (
          <TreeNode key={root.id} node={root} depth={0} />
        ))}
      </ul>
    </TreeContext.Provider>
  );
}
