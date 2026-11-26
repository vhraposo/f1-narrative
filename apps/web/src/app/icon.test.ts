import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ICON_PATH = path.resolve(process.cwd(), "src", "app", "icon.svg");

describe("favicon (V4.0)", () => {
  it("icon.svg existe, é SVG próprio e não referencia recursos externos", () => {
    const svg = readFileSync(ICON_PATH, "utf8");
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("href=");
    expect(svg).not.toContain("url(http");
    expect(svg).toContain("#E10600");
    expect(svg).toContain('aria-label="F1 Narrative Universe"');
  });
});
