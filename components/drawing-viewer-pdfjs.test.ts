import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

// drawing-viewer.tsx self-hosts the pdf.js worker from the top-level `pdfjs-dist`, while the API
// comes from the copy `react-pdf` resolves. Two different versions = every drawing fails to load
// ("The API version ... does not match the Worker version ..."), so both must be one package.
describe("pdf.js worker of the drawing viewer", () => {
  it("uses the same pdfjs-dist as react-pdf", () => {
    const req = createRequire(import.meta.url);
    const topLevel = req.resolve("pdfjs-dist/package.json");
    const reactPdfDir = path.dirname(req.resolve("react-pdf/package.json"));
    const viaReactPdf = createRequire(path.join(reactPdfDir, "package.json")).resolve("pdfjs-dist/package.json");
    expect(viaReactPdf).toBe(topLevel);
  });
});
