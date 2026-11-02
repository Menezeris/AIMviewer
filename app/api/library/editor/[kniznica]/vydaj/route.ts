import { vydaj } from "@/lib/kniznica/editor-api";
import { odpoved } from "@/lib/kniznica/editor-server";

/** `POST vydaj`: vydanie IDS z knižnice je krok 6 portu (D-186); do vtedy 403. */
export const dynamic = "force-dynamic";

export async function POST() {
  return odpoved(vydaj());
}
