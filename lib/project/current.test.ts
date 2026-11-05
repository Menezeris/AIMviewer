import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectNotFoundError,
  clearProjectCache,
  defaultProjectCode,
  requestedProjectCode,
  resolveProject,
  setProjectLoader,
  type Project,
} from "./current";
import { TEST_PROJECT } from "./testing";

const OCB: Project = { id: "9e2dfcba-437b-43d3-a925-0dd29f195b38", code: "OCB", name: "OCB" };
const XYZ: Project = { id: "11111111-2222-4333-8444-555555555555", code: "XYZ", name: "Druhý projekt" };

function useProjects(...projects: Project[]) {
  const loader = vi.fn(async (key: { code?: string; id?: string }) =>
    projects.find((p) => (key.id ? p.id === key.id : p.code === key.code)) ?? null,
  );
  setProjectLoader(loader);
  return loader;
}

afterEach(() => {
  // back to the fixture loader of vitest.setup.ts
  setProjectLoader(async (key) => (key.id === TEST_PROJECT.id || key.code === TEST_PROJECT.code ? TEST_PROJECT : null));
  vi.unstubAllEnvs();
});

describe("resolveProject (D-189)", () => {
  it("code and id resolve the IfcProject node to { id, code, name }", async () => {
    useProjects(OCB, XYZ);
    expect(await resolveProject({ code: "XYZ" })).toEqual(XYZ);
    expect(await resolveProject({ id: OCB.id })).toEqual(OCB);
  });

  it("without code the default project from AIM_DEFAULT_PROJECT, else OCB", async () => {
    useProjects(OCB, XYZ);
    vi.stubEnv("AIM_DEFAULT_PROJECT", "XYZ");
    expect((await resolveProject()).code).toBe("XYZ");
    vi.stubEnv("AIM_DEFAULT_PROJECT", "");
    expect(defaultProjectCode()).toBe("OCB");
    expect((await resolveProject()).code).toBe("OCB");
  });

  it("unknown code or id = ProjectNotFoundError with status 404", async () => {
    useProjects(OCB);
    await expect(resolveProject({ code: "NOPE" })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(resolveProject({ id: XYZ.id })).rejects.toMatchObject({ status: 404 });
  });

  it("invalid code or id never reaches the DB", async () => {
    const loader = useProjects(OCB);
    await expect(resolveProject({ code: "OCB;drop" })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(resolveProject({ code: "a,b" })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(resolveProject({ id: "not-a-uuid" })).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(loader).not.toHaveBeenCalled();
  });

  it("cached for 60 s by code and by id", async () => {
    const loader = useProjects(OCB);
    let t = 1_000;
    const now = () => t;
    await resolveProject({ code: "OCB" }, now);
    await resolveProject({ code: "OCB" }, now);
    await resolveProject({ id: OCB.id }, now);
    expect(loader).toHaveBeenCalledTimes(1);
    t += 61_000;
    await resolveProject({ code: "OCB" }, now);
    expect(loader).toHaveBeenCalledTimes(2);
    clearProjectCache();
  });
});

describe("requestedProjectCode", () => {
  it("first non-empty candidate; empty and 'default' = the default project", () => {
    vi.stubEnv("AIM_DEFAULT_PROJECT", "OCB");
    expect(requestedProjectCode(null, "XYZ")).toBe("XYZ");
    expect(requestedProjectCode(" XYZ ", "OCB")).toBe("XYZ");
    expect(requestedProjectCode("", undefined)).toBe("OCB");
    // `default` wins over a sticky cookie: it clears the choice
    expect(requestedProjectCode("default", "XYZ")).toBe("OCB");
  });
});
