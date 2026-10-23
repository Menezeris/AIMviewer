import { LoadingLogo } from "@/components/loading-logo";

/** Server render `/ifc` (D-163): rovnaká obrazovka ako pri načítaní iframe, aby nebliklo nič iné. */
export default function Loading() {
  return (
    <LoadingLogo label="Načítavam" />
  );
}
