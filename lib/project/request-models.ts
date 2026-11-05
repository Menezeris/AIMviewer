import { envIfcModels, type IfcModel } from "../data/ifc-models";

import { currentModels } from "./context";

/**
 * Models of the request project for synchronous callers (IFC engine, tool schemas, D-189): loaded
 * once by the request wrapper (`withRequestProject`, the MCP route). Outside a request only the env
 * override; otherwise none, no model code is assumed.
 */
export function requestIfcModels(): IfcModel[] {
  return currentModels() ?? envIfcModels() ?? [];
}
