import type { IfcModel } from "../data/ifc-models";

import type { Project } from "./current";

/**
 * Fixture project of the tests (D-189): the request context of every vitest file (`vitest.setup.ts`)
 * unless a test sets its own with `withProject`. Its models are the OCB federation codes, so tool
 * schemas and default clash tests keep their shape in snapshots.
 */
export const TEST_PROJECT: Project = { id: "00000000-0000-4000-8000-0000000000a1", code: "TST", name: "Test project" };

export const TEST_MODELS: IfcModel[] = [
  { id: "ASR", label: "ASR", url: "https://example.invalid/ifc/ASR.ifc", containerId: "00000000-0000-4000-8000-00000000c001" },
  { id: "VZT", label: "VZT", url: "https://example.invalid/ifc/VZT.ifc", containerId: "00000000-0000-4000-8000-00000000c002" },
];
