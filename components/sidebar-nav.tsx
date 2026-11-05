"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Box,
  Building2,
  ChevronRight,
  Cuboid,
  FileText,
  User,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import type { NavItem, SidebarNavData } from "@/lib/data/nav";

/**
 * Flat navigation lists of non-spatial nodes below the tree (S3 polish).
 * Asset types lead to `/type/[id]`, the rest to `/node/[id]`. The active link is
 * highlighted via `usePathname` (same as the tree). Each section is collapsible
 * and collapsed by default (review polish - 149 types would otherwise flood the panel).
 */
function Section({
  title,
  icon: Icon,
  items,
  hrefBase,
}: {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
  hrefBase: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{title}</span>
        <span className="ml-auto shrink-0 font-mono normal-case tracking-normal">
          {items.length}
        </span>
      </button>
      {open && (
      <ul className="space-y-0.5">
        {items.map((it) => {
          const href = `${hrefBase}/${it.id}`;
          const active = pathname === href;
          return (
            <li key={it.id}>
              <Link
                href={href}
                prefetch={true}
                className={cn(
                  "flex items-center gap-2 rounded-md py-1.5 pl-8 pr-2 text-sm",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60"
                )}
              >
                <LinkPendingSpinner />
                <span className="truncate">{it.name ?? it.object_ref ?? it.id}</span>
                {it.object_ref && (
                  <span className="ml-auto shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground">
                    {it.object_ref}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}

export function SidebarNav({ nav }: { nav: SidebarNavData }) {
  const pathname = usePathname();
  const empty =
    nav.assetTypes.length === 0 &&
    nav.systems.length === 0 &&
    nav.persons.length === 0 &&
    nav.organizations.length === 0 &&
    nav.documents.length === 0;

  return (
    <div className="mt-2 border-t pt-1">
      <Link
        href="/ifc"
        className={cn(
          "mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          pathname === "/ifc"
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        )}
      >
        <Cuboid className="size-4 shrink-0" />
        <span>3D Model</span>
      </Link>
      {!empty && (
        <>
          <Section title="Typy assetov" icon={Box} items={nav.assetTypes} hrefBase="/type" />
          <Section title="Systémy" icon={Waypoints} items={nav.systems} hrefBase="/node" />
          <Section title="Osoby" icon={User} items={nav.persons} hrefBase="/node" />
          <Section
            title="Organizácie"
            icon={Building2}
            items={nav.organizations}
            hrefBase="/node"
          />
          <Section title="Dokumenty" icon={FileText} items={nav.documents} hrefBase="/drawing" />
        </>
      )}
    </div>
  );
}
