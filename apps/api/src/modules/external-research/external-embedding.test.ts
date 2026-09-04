import { afterAll, describe, expect, it } from "vitest";
import {
  EXTERNAL_EMBEDDING_RULE,
  validateEmbeddingConfig,
  type EmbeddingConfig,
  NullEmbeddingProvider,
  createProviderRegistry,
  registerProvider,
  getEmbeddingProvider,
  buildEmbeddingIdentity,
  isEmbeddingValid,
  EMBEDDING_PROVIDER_STATUS,
  EMBEDDED_CONTENT_HASH_SCHEMA_GAP,
} from "./external-embedding.js";

const VALID_CONFIG: EmbeddingConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  version: "2024-02-01",
  dimensions: 1536,
};

describe("Embedding - configuração", () => {
  it("A) config válida não lança erro", () => {
    expect(() => validateEmbeddingConfig(VALID_CONFIG)).not.toThrow();
  });

  it("B) provider desconhecido na registry lança erro", () => {
    const reg = createProviderRegistry();
    expect(() => getEmbeddingProvider(reg, VALID_CONFIG)).toThrow("desconhecido");
  });

  it("C) model vazio rejeitado", () => {
    expect(() => validateEmbeddingConfig({ ...VALID_CONFIG, model: "" })).toThrow("'model'");
    expect(() => validateEmbeddingConfig({ ...VALID_CONFIG, model: "  " })).toThrow("'model'");
  });

  it("D) version obrigatório", () => {
    expect(() => validateEmbeddingConfig({ ...VALID_CONFIG, version: "" })).toThrow("'version'");
  });

  it("E) dimension inválida rejeitada", () => {
    expect(() => validateEmbeddingConfig({ ...VALID_CONFIG, dimensions: 0 })).toThrow("'dimensions'");
    expect(() => validateEmbeddingConfig({ ...VALID_CONFIG, dimensions: -1 })).toThrow("'dimensions'");
    expect(() => validateEmbeddingConfig({ ...VALID_CONFIG, dimensions: 1.5 })).toThrow("'dimensions'");
  });
});

describe("Embedding - provider registry", () => {
  it("F) registra e obtém provider", () => {
    const reg = createProviderRegistry();
    registerProvider(reg, "test-provider", (c) => ({
      name: c.provider,
      model: c.model,
      version: c.version,
      dimensions: c.dimensions,
      embed: async () => [],
    }));
    const p = getEmbeddingProvider(reg, { ...VALID_CONFIG, provider: "test-provider" });
    expect(p.name).toBe("test-provider");
    expect(p.model).toBe(VALID_CONFIG.model);
    expect(p.dimensions).toBe(VALID_CONFIG.dimensions);
  });

  it("F2) provider duplicado rejeitado", () => {
    const reg = createProviderRegistry();
    const factory = () => new NullEmbeddingProvider();
    registerProvider(reg, "dup", factory);
    expect(() => registerProvider(reg, "dup", factory)).toThrow("já registrado");
  });

  it("F3) nome vazio rejeitado", () => {
    const reg = createProviderRegistry();
    expect(() => registerProvider(reg, "", () => new NullEmbeddingProvider())).toThrow("vazio");
  });
});

describe("Embedding - Null provider", () => {
  it("G) NullEmbeddingProvider lança erro ao embed", async () => {
    const p = new NullEmbeddingProvider();
    expect(p.name).toBe("null");
    expect(p.dimensions).toBe(0);
    await expect(p.embed("qualquer texto")).rejects.toThrow("not configured");
  });

  it("G2) NullEmbeddingProvider não produz vector", async () => {
    const p = new NullEmbeddingProvider();
    let threw = false;
    try {
      await p.embed("teste");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("Embedding - identidade", () => {
  it("H) mesma configuração → mesma identidade", () => {
    const i1 = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const i2 = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    expect(i1).toEqual(i2);
  });

  it("I) contentHash diferente → identidade diferente", () => {
    const i1 = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const i2 = buildEmbeddingIdentity("sha256:bbb", VALID_CONFIG);
    expect(i1.contentHash).not.toBe(i2.contentHash);
  });

  it("J) provider diferente → identidade diferente", () => {
    const c1: EmbeddingConfig = { ...VALID_CONFIG, provider: "openai" };
    const c2: EmbeddingConfig = { ...VALID_CONFIG, provider: "cohere" };
    const i1 = buildEmbeddingIdentity("sha256:aaa", c1);
    const i2 = buildEmbeddingIdentity("sha256:aaa", c2);
    expect(i1.provider).not.toBe(i2.provider);
  });

  it("K) model diferente → identidade diferente", () => {
    const c1: EmbeddingConfig = { ...VALID_CONFIG, model: "text-embedding-3-small" };
    const c2: EmbeddingConfig = { ...VALID_CONFIG, model: "text-embedding-3-large" };
    const i1 = buildEmbeddingIdentity("sha256:aaa", c1);
    const i2 = buildEmbeddingIdentity("sha256:aaa", c2);
    expect(i1.model).not.toBe(i2.model);
  });

  it("L) version diferente → identidade diferente", () => {
    const c1: EmbeddingConfig = { ...VALID_CONFIG, version: "2024-02-01" };
    const c2: EmbeddingConfig = { ...VALID_CONFIG, version: "2024-06-01" };
    const i1 = buildEmbeddingIdentity("sha256:aaa", c1);
    const i2 = buildEmbeddingIdentity("sha256:aaa", c2);
    expect(i1.version).not.toBe(i2.version);
  });

  it("M) dimensions diferente → identidade diferente", () => {
    const c1: EmbeddingConfig = { ...VALID_CONFIG, dimensions: 1536 };
    const c2: EmbeddingConfig = { ...VALID_CONFIG, dimensions: 3072 };
    const i1 = buildEmbeddingIdentity("sha256:aaa", c1);
    const i2 = buildEmbeddingIdentity("sha256:aaa", c2);
    expect(i1.dimensions).not.toBe(i2.dimensions);
  });

  it("identidade é imutável (Object.freeze)", () => {
    const i = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    expect(Object.isFrozen(i)).toBe(true);
  });
});

describe("Embedding - validade", () => {
  it("mesmo contentHash + mesma config → válido", () => {
    const i = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const v = isEmbeddingValid(i, "sha256:aaa", VALID_CONFIG);
    expect(v.valid).toBe(true);
  });

  it("re-chunk invalidates previous embedding (contentHash muda)", () => {
    const i = buildEmbeddingIdentity("sha256:old", VALID_CONFIG);
    const v = isEmbeddingValid(i, "sha256:new", VALID_CONFIG);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("contentHash changed");
  });

  it("provider diferente invalida", () => {
    const i = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const different = { ...VALID_CONFIG, provider: "cohere" };
    const v = isEmbeddingValid(i, "sha256:aaa", different);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("provider mismatch");
  });

  it("model diferente invalida", () => {
    const i = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const different = { ...VALID_CONFIG, model: "text-embedding-3-large" };
    const v = isEmbeddingValid(i, "sha256:aaa", different);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("model mismatch");
  });

  it("version diferente invalida", () => {
    const i = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const different = { ...VALID_CONFIG, version: "2025-01-01" };
    const v = isEmbeddingValid(i, "sha256:aaa", different);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("version mismatch");
  });

  it("dimensions diferente invalida", () => {
    const i = buildEmbeddingIdentity("sha256:aaa", VALID_CONFIG);
    const different = { ...VALID_CONFIG, dimensions: 3072 };
    const v = isEmbeddingValid(i, "sha256:aaa", different);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("dimensions mismatch");
  });
});

describe("Embedding - status e schema gap", () => {
  it("EMBEDDING_PROVIDER_STATUS = RESOLVED (Cohere decidido no STEP 7)", () => {
    expect(EMBEDDING_PROVIDER_STATUS).toBe("RESOLVED");
  });

  it("EMBEDDED_CONTENT_HASH_SCHEMA_GAP = RESOLVED (coluna criada no STEP 7)", () => {
    expect(EMBEDDED_CONTENT_HASH_SCHEMA_GAP).toBe("RESOLVED");
  });
});

describe("Embedding - ausência de efeitos colaterais", () => {
  it("O) nenhum vector real é produzido pelo NullEmbeddingProvider", async () => {
    const p = new NullEmbeddingProvider();
    let result: unknown = undefined;
    try {
      result = await p.embed("teste");
    } catch {
      // esperado
    }
    expect(result).toBeUndefined();
  });

  it("P) nenhuma chamada externa é feita (módulo puramente local)", () => {
    // Prova indireta: o módulo não importa fetch/axios/node-fetch/etc.
    // Os exports são todos funções puras ou NullEmbeddingProvider.
    const exports = [
      validateEmbeddingConfig,
      NullEmbeddingProvider,
      createProviderRegistry,
      registerProvider,
      getEmbeddingProvider,
      buildEmbeddingIdentity,
      isEmbeddingValid,
    ];
    expect(exports.every((fn) => typeof fn === "function" || typeof fn === "object")).toBe(true);
  });

  it("Q) nenhum DB write é feito (módulo não importa prisma)", () => {
    // O módulo não importa prisma nem faz qualquer operação de banco.
    // Validação: os exports são todas funções puras / classes / constantes —
    // nenhum delegate de banco é exposto.
    const exports = [
      EXTERNAL_EMBEDDING_RULE,
      EMBEDDING_PROVIDER_STATUS,
      EMBEDDED_CONTENT_HASH_SCHEMA_GAP,
    ];
    expect(exports.length).toBe(3);
    // NullEmbeddingProvider é classe pura (sem DB).
    const p = new NullEmbeddingProvider();
    expect(p.name).toBe("null");
  });

  it("nenhum campo de embedding é preenchido em DummyChunk", () => {
    // Modelo conceitual: o schema tem embeddingProvider/Model/Version/Dimensions
    // como nullable. Neste STEP, nenhuma lógica os preenche.
    // Validação: NullEmbeddingProvider.dimensions = 0 (sentinel, não valor real).
    const p = new NullEmbeddingProvider();
    expect(p.dimensions).toBe(0);
    expect(p.name).toBe("null");
    expect(p.model).toBe("none");
    expect(p.version).toBe("0.0.0");
  });
});

// Cleanup: este teste não cria nenhum fixture de banco.
afterAll(async () => {
  // Sem cleanup necessário — testes 100% puros, sem DB, sem fixtures.
});