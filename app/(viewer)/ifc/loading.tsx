import { preconnect } from "react-dom";

import { LoadingLogo } from "@/components/loading-logo";
import { PROD_VIEWER_URL } from "@/lib/viewer-source";

/** Server render of `/ifc` (D-163): the same screen as while the iframe loads, so nothing else flashes. */
export default function Loading() {
  // loading.tsx is streamed first, before the page's 8 queries: the connection to the viewer origin
  // (TCP + TLS) opens while the host is still waiting for the DB (D-178, #308 point 4).
  try {
    preconnect(new URL(PROD_VIEWER_URL).origin);
  } catch {
    /* invalid viewer URL: no pre-warming */
  }
  return (
    <LoadingLogo label="Načítavam" />
  );
}
