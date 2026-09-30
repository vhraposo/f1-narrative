import { describe, expect, it } from "vitest";

import { localizeNationalityPtBr } from "./nationality-pt-br";

describe("localizeNationalityPtBr", () => {
  it("1) traduz demonimos em inglês do espelho", () => {
    expect(localizeNationalityPtBr("British")).toBe("Britânico");
    expect(localizeNationalityPtBr("Dutch")).toBe("Neerlandês");
    expect(localizeNationalityPtBr("Thai")).toBe("Tailandês");
    expect(localizeNationalityPtBr("New Zealander")).toBe("Neozelandês");
  });

  it("2) traduz siglas ISO e países", () => {
    expect(localizeNationalityPtBr("NED")).toBe("Neerlandês");
    expect(localizeNationalityPtBr("THA")).toBe("Tailandês");
    expect(localizeNationalityPtBr("United Kingdom")).toBe("Britânico");
  });

  it("3) preserva valores já localizados e desconhecidos", () => {
    expect(localizeNationalityPtBr("Brasileira")).toBe("Brasileira");
    expect(localizeNationalityPtBr("Atlantean")).toBe("Atlantean");
    expect(localizeNationalityPtBr(null)).toBeNull();
    expect(localizeNationalityPtBr("  ")).toBeNull();
  });
});
