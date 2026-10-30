import { preconnect } from "react-dom";

import { LoadingLogo } from "@/components/loading-logo";
import { PROD_VIEWER_URL } from "@/lib/viewer-source";

/** Server render `/ifc` (D-163): rovnaká obrazovka ako pri načítaní iframe, aby nebliklo nič iné. */
export default function Loading() {
  // loading.tsx sa streamuje ako prvý, pred 8 dotazmi stránky: spojenie na origin viewera
  // (TCP + TLS) sa otvorí, kým host ešte čaká na DB (D-178, #308 bod 4).
  try {
    preconnect(new URL(PROD_VIEWER_URL).origin);
  } catch {
    /* neplatná URL viewera: bez predhriatia */
  }
  return (
    <LoadingLogo label="Načítavam" />
  );
}
