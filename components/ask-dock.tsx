"use client";

import dynamic from "next/dynamic";

/**
 * Global AI dock (D-056): a floating chat at the bottom of the Viewer - collapsed as a
 * pill, expanded as a panel. Lives in the (viewer) layout, so the conversation
 * survives clicking through (navigation runs below it - the "show in 3D" action opens
 * /ifc and the chat stays).
 *
 * `ssr: false`: the state (open/thread) is read from sessionStorage in the useState
 * initializer - without SSR there is no hydration mismatch or setState-in-effect.
 */
const AskDockInner = dynamic(() => import("@/components/ask-dock-inner"), {
  ssr: false,
});

export function AskDock() {
  return <AskDockInner />;
}
