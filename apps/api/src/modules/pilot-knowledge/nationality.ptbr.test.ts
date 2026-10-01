import { describe, expect, it } from "vitest";

import { feminizeNationalityPtBr, resolveNationalityPtBr } from "./nationality.ptbr.js";

describe("resolveNationalityPtBr", () => {
  it("1) traduz nacionalidades em inglês do espelho para pt-BR", () => {
    expect(resolveNationalityPtBr("British")).toBe("Britânico");
    expect(resolveNationalityPtBr("Dutch")).toBe("Neerlandês");
    expect(resolveNationalityPtBr("Thai")).toBe("Tailandês");
    expect(resolveNationalityPtBr("Monegasque")).toBe("Monegasco");
    expect(resolveNationalityPtBr("New Zealander")).toBe("Neozelandês");
    expect(resolveNationalityPtBr("South African")).toBe("Sul-africano");
  });

  it("2) traduz siglas ISO de três letras usadas por fontes estruturadas", () => {
    expect(resolveNationalityPtBr("GBR")).toBe("Britânico");
    expect(resolveNationalityPtBr("NED")).toBe("Neerlandês");
    expect(resolveNationalityPtBr("THA")).toBe("Tailandês");
    expect(resolveNationalityPtBr("GER")).toBe("Alemão");
    expect(resolveNationalityPtBr("BRA")).toBe("Brasileiro");
  });

  it("3) aceita países e formas já em pt-BR sem devolver texto cru", () => {
    expect(resolveNationalityPtBr("United Kingdom")).toBe("Britânico");
    expect(resolveNationalityPtBr("Netherlands")).toBe("Neerlandês");
    expect(resolveNationalityPtBr("Países Baixos")).toBe("Neerlandês");
    expect(resolveNationalityPtBr("Brasileira")).toBe("Brasileiro");
    expect(resolveNationalityPtBr("italiana")).toBe("Italiano");
  });

  it("4) devolve null para vazio e preserva valores desconhecidos", () => {
    expect(resolveNationalityPtBr(null)).toBeNull();
    expect(resolveNationalityPtBr(undefined)).toBeNull();
    expect(resolveNationalityPtBr("   ")).toBeNull();
    expect(resolveNationalityPtBr("Atlantean")).toBe("Atlantean");
  });
});

describe("feminizeNationalityPtBr", () => {
  it("5) flexiona adjetivos regulares", () => {
    expect(feminizeNationalityPtBr("Italiano")).toBe("Italiana");
    expect(feminizeNationalityPtBr("Britânico")).toBe("Britânica");
    expect(feminizeNationalityPtBr("Alemão")).toBe("Alemã");
    expect(feminizeNationalityPtBr("Letão")).toBe("Letã");
    expect(feminizeNationalityPtBr("Espanhol")).toBe("Espanhola");
    expect(feminizeNationalityPtBr("Monegasco")).toBe("Monegasca");
  });

  it("6) flexiona terminados em ês", () => {
    expect(feminizeNationalityPtBr("Francês")).toBe("Francesa");
    expect(feminizeNationalityPtBr("Neerlandês")).toBe("Neerlandesa");
    expect(feminizeNationalityPtBr("Português")).toBe("Portuguesa");
    expect(feminizeNationalityPtBr("Norueguês")).toBe("Norueguesa");
    expect(feminizeNationalityPtBr("Tailandês")).toBe("Tailandesa");
  });

  it("7) preserva invariáveis e valores desconhecidos", () => {
    expect(feminizeNationalityPtBr("Belga")).toBe("Belga");
    expect(feminizeNationalityPtBr("Canadense")).toBe("Canadense");
    expect(feminizeNationalityPtBr("Croata")).toBe("Croata");
    expect(feminizeNationalityPtBr("Atlantean")).toBe("Atlantean");
  });
});
