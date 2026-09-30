import { describe, expect, it } from "vitest";

import { resolveCircuitSvg, sanitizeCircuitSvg } from "./f1db.svg.js";

describe("SVG de circuito (f1-circuits-svg sanitizado)", () => {
  it("1) remove script, foreignObject e handlers de evento", () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><path d="M0 0" onclick="evil()" style="fill:none;stroke:#000"/></svg>';
    const sanitized = sanitizeCircuitSvg(malicious);
    expect(sanitized).not.toBeNull();
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("foreignObject");
    expect(sanitized).not.toContain("onload");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain("<path");
  });

  it("2) rejeita conteúdo que não é SVG e acima do limite", () => {
    expect(sanitizeCircuitSvg("<html><body>x</body></html>")).toBeNull();
    expect(sanitizeCircuitSvg(`<svg>${"a".repeat(250_000)}</svg>`)).toBeNull();
  });

  it("3) resolve o layout real do Interlagos do asset local", () => {
    const layout = resolveCircuitSvg({
      externalId: "interlagos",
      name: "Autódromo José Carlos Pace",
    });
    expect(layout).not.toBeNull();
    expect(layout?.svg.startsWith("<svg")).toBe(true);
    expect(layout?.layoutId).toBe("interlagos-2");
    expect(layout?.source).toBe("f1db-circuits-svg");
    expect(layout?.license).toBe("CC_BY_4_0");
    expect(layout?.attribution).toContain("CC BY 4.0");
  });

  it("4) circuito sem asset devolve null (sem inventar)", () => {
    expect(
      resolveCircuitSvg({ externalId: "circuito-inventado", name: "Inventado" }),
    ).toBeNull();
  });
});
