import { IfcParser, unwrapIfcZipView, type IfcDataStore } from "@ifc-lite/parser";
import { createBimContext } from "@ifc-lite/sdk";
import { HeadlessLikeBackend, type LoadedModel } from "@ifc-lite/mcp";

/**
 * IFC motor (D-084) - načítanie modelu pre `@ifc-lite/mcp` z bajtov.
 *
 * Balík exportuje len `loadIfcModel(path)`; ekvivalent z bajtov
 * (`loadIfcModelFromBytes`) nie je v jeho exports mape, preto je tu jeho
 * zrkadlo. Rozdelené na dva kroky zámerne: parsovaný `IfcDataStore` sa
 * nemení a dá sa zdieľať v cache inštancie, kým `LoadedModel` (backend)
 * nesie úpravy (overlay), ktoré balík nevie zmazať - každý request preto
 * dostane nový backend nad tým istým storeom (`modelFromStore`).
 */

export async function parseIfcBytes(bytes: Uint8Array, label: string): Promise<IfcDataStore> {
  if (bytes.byteLength === 0) throw new Error(`'${label}' je prázdny (0 bajtov)`);
  const buffer = await unwrapIfcZipView(bytes);
  const head = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256)));
  if (!head.includes("ISO-10303-21")) throw new Error(`'${label}' nie je IFC/STEP súbor`);

  // Parser píše priebeh do console.* - počas parsovania ho stíšime (vzor
  // loader.ts balíka), inak by zahltil logy funkcie.
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    const store = await new IfcParser().parseColumnar(buffer);
    store.fileSize = buffer.byteLength;
    return store;
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

/** Nový `LoadedModel` (čerstvý backend bez úprav) nad zdieľaným storeom. */
export function modelFromStore(store: IfcDataStore, name: string, id: string): LoadedModel {
  const backend = new HeadlessLikeBackend(store, name, id);
  const bim = createBimContext({ backend });
  return { id, name, bim, store, backend, loadedAt: Date.now() };
}
