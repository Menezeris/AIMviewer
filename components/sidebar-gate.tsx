"use client";

import { usePathname } from "next/navigation";

/**
 * Hiding the left sidebar on `/ifc` (D-077 viewer-first): the only tree in the 3D
 * context is the native HierarchyPanel of the embed viewer (decorated with AIM badges);
 * the host tree + nav would duplicate it. The server fetch of the tree in the layout
 * stays (cached, shared with the other routes) - only the render is hidden.
 */
export function SidebarGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/ifc" || pathname.startsWith("/ifc/")) return null;
  return <>{children}</>;
}
