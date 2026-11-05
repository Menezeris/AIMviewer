import { IfcParser, unwrapIfcZipView, type IfcDataStore } from "@ifc-lite/parser";
import { createBimContext } from "@ifc-lite/sdk";
import { HeadlessLikeBackend, type LoadedModel } from "@ifc-lite/mcp";

/**
 * IFC engine (D-084) - loading a model for `@ifc-lite/mcp` from bytes.
 *
 * The bundle exports only `loadIfcModel(path)`; the equivalent from bytes
 * (`loadIfcModelFromBytes`) is not in its exports map, hence its
 * mirror is here. Split into two steps on purpose: the parsed `IfcDataStore` does not
 * change and can be shared in the instance cache, while `LoadedModel` (the backend)
 * carries edits (overlay) that the bundle cannot delete - so every request
 * gets a new backend over the same store (`modelFromStore`).
 */

export async function parseIfcBytes(bytes: Uint8Array, label: string): Promise<IfcDataStore> {
  if (bytes.byteLength === 0) throw new Error(`'${label}' je prázdny (0 bajtov)`);
  const buffer = await unwrapIfcZipView(bytes);
  const head = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256)));
  if (!head.includes("ISO-10303-21")) throw new Error(`'${label}' nie je IFC/STEP súbor`);

  // The parser writes progress to console.* - we silence it while parsing (pattern
  // of the bundle loader.ts), otherwise it would flood the function logs.
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

/** A new `LoadedModel` (fresh backend without edits) over a shared store. */
export function modelFromStore(store: IfcDataStore, name: string, id: string): LoadedModel {
  const backend = new HeadlessLikeBackend(store, name, id);
  const bim = createBimContext({ backend });
  return { id, name, bim, store, backend, loadedAt: Date.now() };
}
