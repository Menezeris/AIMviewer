import { vi } from "vitest";

import { setTestRequestContext } from "./lib/project/context";
import { setProjectLoader } from "./lib/project/current";
import { TEST_MODELS, TEST_PROJECT } from "./lib/project/testing";

// Server modules are imported by route tests; the `server-only` guard is for bundles, not vitest.
vi.mock("server-only", () => ({}));

// D-189: code outside a request runs in the fixture project; the resolver knows only it.
setTestRequestContext({ project: TEST_PROJECT, models: TEST_MODELS });
setProjectLoader(async (key) =>
  key.id === TEST_PROJECT.id || key.code === TEST_PROJECT.code ? TEST_PROJECT : null,
);
