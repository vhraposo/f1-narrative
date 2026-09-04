import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { COHERE_DIMENSIONS, CohereEmbeddingProvider } from "./external-embedding-provider.js";
import { type EmbeddingConfig, type EmbeddingProvider } from "./external-embedding.js";
import { computeDocumentContentHash } from "./external-ingest.js";
import { chunkExternalDocument } from "./external-chunking.js";
import {
  EXTERNAL_EMBEDDING_STORE_RULE,
  embedExternalDocumentChunks,
  inspectChunkEmbedding,
  storedEmbeddingStillValid,
} from "./external-embedding-store.js";

// Testes de INTEGRAÇÃO do store (Fase 13 STEP 7), contra o TEST DB.
// Usam um MOCK EXPLÍCITO de provider: determinístico, 1024 dims, NUNCA HTTP.
// Verificam quando um vetor é gravado com dims=1024, embeddedContentHash,
// metadata de provider e proveniência — SEM retrieval/similarity.

const COHERE_CONFIG: EmbeddingConfig = {
  provider: "cohere",
  model: "embed-multilingual-v3.0",
  version: "v3.0",
  dimensions: COHERE_DIMENSIONS,
};

const createdUserIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

/**
 * Mock determinístico identificado como mock. Gera 1024 floats [0,1) derivados
 * do SHA-256 do texto. NUNCA faz HTTP. Padrão do ARNco: provider mock nunca é
 * usado como padrão da aplicação — apenas em testes.
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock-cohere-1024";
  readonly model = "embed-multilingual-v3.0";
  readonly version = "v3.0";
  readonly dimensions = 1024;
  callCount = 0;

  async embed(input: string): Promise<number[]> {
    this.callCount += 1;
    const digest = createHash("sha256").update(input, "utf8").digest();
    const out: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      out.push((digest[i % digest.length] / 255) * 0.999 + 0.0005);
    }
    return out;
  }
}

async function createFixture(content: string): Promise<{
  documentId: string;
  mock: MockEmbeddingProvider;
}> {
  const user = track(
    createdUserIds,
    await prisma.user.create({ data: { name: "Store", email: `store-${Date.now()}-${Math.random()}@x.com` } }),
  );
  const source = track(
    createdSourceIds,
    await prisma.externalSource.create({
      data: { url: `https://x.test/${Date.now()}/${Math.random()}`, title: "src", visibility: "PRIVATE", ownerId: user.id },
    }),
  );
  const doc = track(
    createdDocumentIds,
    await prisma.externalDocument.create({
      data: {
        sourceId: source.id,
        title: "doc",
        content,
        contentHash: computeDocumentContentHash(content),
        status: "NEW",
      },
    }),
  );
  await chunkExternalDocument(prisma, doc.id);
  return { documentId: doc.id, mock: new MockEmbeddingProvider() };
}

async function readChunkMeta(chunkId: string) {
  return prisma.externalChunk.findUnique({
    where: { id: chunkId },
    select: {
      id: true,
      contentHash: true,
      embeddedContentHash: true,
      embeddingProvider: true,
      embeddingModel: true,
      embeddingVersion: true,
      embeddingDimensions: true,
    },
  });
}

afterAll(async () => {
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("embedExternalDocumentChunks", () => {
  it("A) grava vetor vector(1024) + embeddedContentHash + metadata de provider", async () => {
    const { documentId, mock } = await createFixture("Parágrafo um.\n\nParágrafo dois.\n\nParágrafo três.");
    const res = await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);

    const chunks = await prisma.externalChunk.findMany({
      where: { documentId },
      orderBy: { orderOriginal: "asc" },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(res.embedded).toBe(chunks.length);
    expect(res.reused).toBe(0);
    expect(res.total).toBe(chunks.length);
    expect(res.ruleApplied).toBe(EXTERNAL_EMBEDDING_STORE_RULE);
    expect(mock.callCount).toBe(chunks.length);

    for (const c of chunks) {
      const insp = await inspectChunkEmbedding(prisma, c.id);
      expect(insp.dims).toBe(1024);
      expect(insp.embeddedContentHash).toBe(c.contentHash);
      expect(insp.currentContentHash).toBe(c.contentHash);
      const meta = await readChunkMeta(c.id);
      expect(meta?.embeddedContentHash).toBe(c.contentHash);
      expect(meta?.embeddingProvider).toBe("cohere");
      expect(meta?.embeddingModel).toBe("embed-multilingual-v3.0");
      expect(meta?.embeddingVersion).toBe("v3.0");
      expect(meta?.embeddingDimensions).toBe(1024);
      expect(storedEmbeddingStillValid(COHERE_CONFIG, {
        contentHash: c.contentHash,
        embeddedContentHash: meta?.embeddedContentHash ?? null,
        embeddingProvider: meta?.embeddingProvider ?? null,
        embeddingModel: meta?.embeddingModel ?? null,
        embeddingVersion: meta?.embeddingVersion ?? null,
        embeddingDimensions: meta?.embeddingDimensions ?? null,
      })).toBe(true);
    }
  });

  it("B) idempotente: segunda chamada reutiliza (reused) e NÃO chama provider", async () => {
    const { documentId, mock } = await createFixture("Texto simples para idempotência.");
    const first = await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);
    const before = mock.callCount;

    const second = await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);
    expect(second.reused).toBe(first.embedded);
    expect(second.embedded).toBe(0);
    expect(mock.callCount).toBe(before); // nenhuma chamada a mais
  });

  it("C) re-embed quando o contentHash do chunk muda", async () => {
    const { documentId, mock } = await createFixture("Conteúdo original.");
    await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);

    // Muda só o texto do primeiro chunk (sem mexer nos outros campos).
    const first = await prisma.externalChunk.findFirst({ where: { documentId }, orderBy: { orderOriginal: "asc" } });
    expect(first).not.toBeNull();
    const newHash = (await import("./external-chunking.js")).computeChunkContentHash("Conteúdo ALTERADO.");
    await prisma.externalChunk.update({
      where: { id: first!.id },
      data: { text: "Conteúdo ALTERADO.", contentHash: newHash },
    });

    const before = mock.callCount;
    const res = await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);
    // Apenas o chunk alterado deve ser re-embedado.
    expect(res.embedded).toBe(1);
    expect(mock.callCount).toBe(before + 1);

    const insp = await inspectChunkEmbedding(prisma, first!.id);
    expect(insp.embeddedContentHash).toBe(newHash);
    expect(insp.dims).toBe(1024);
  });

  it("D) metadata de provider divergente → erro explícito (nunca mistura modelos)", async () => {
    const { documentId, mock } = await createFixture("Proveniência deve bater.");
    await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);

    // Simula que o vetor veio de outro modelo (divergência de config).
    const chunk = await prisma.externalChunk.findFirst({ where: { documentId } });
    await prisma.externalChunk.update({
      where: { id: chunk!.id },
      data: { embeddingModel: "embed-english-v3.0" },
    });

    await expect(
      embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock),
    ).rejects.toThrow(/incompatível|diverge|metadata/);
  });

  it("E) chunk sem conteúdo (nenhum chunk) → total 0, sem falha", async () => {
    const { documentId, mock } = await createFixture("  \n\n  ");
    // createFixture com conteúdo que normaliza para vazio não cria chunks.
    const res = await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, mock);
    expect(res.total).toBe(0);
    expect(res.embedded).toBe(0);
    expect(res.reused).toBe(0);
    expect(mock.callCount).toBe(0);
  });

  it("F) dimensão errada na resposta do provider → falha e NÃO persiste metadata", async () => {
    const { documentId } = await createFixture("Vetor com dimensão errada.");
    const bad = {
      name: "bad",
      model: "m",
      version: "v",
      dimensions: 2,
      async embed(): Promise<number[]> {
        return [1, 2];
      },
    };
    await expect(
      embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, bad),
    ).rejects.toThrow(/dimens/);
    // Nada persistido: metadata permanece null.
    const chunks = await prisma.externalChunk.findMany({ where: { documentId } });
    for (const c of chunks) {
      const meta = await readChunkMeta(c.id);
      expect(meta?.embeddedContentHash).toBeNull();
      expect(meta?.embeddingProvider).toBeNull();
    }
  });

  it("G) CohereEmbeddingProvider é compatível com o store (usando fetch mockado)", async () => {
    // Prova que o provider REAL (com fetch injetado determinístico) também
    // persiste corretamente através do store.
    const { documentId } = await createFixture("Provider cohere real via store.");
    const fetcher = (async (_info: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body));
      const vector = Array.from({ length: COHERE_DIMENSIONS }, (_, i) =>
        (body.inputs?.[0]?.content?.[0]?.text ?? "").length * 0 + (i / COHERE_DIMENSIONS),
      );
      return new Response(JSON.stringify({ embeddings: { float: [vector] } }), { status: 200 });
    }) as typeof fetch;
    const provider = new CohereEmbeddingProvider({ apiKey: "sk-test", fetchImpl: fetcher });

    const res = await embedExternalDocumentChunks(prisma, documentId, COHERE_CONFIG, provider);
    expect(res.embedded).toBeGreaterThan(0);
    const chunk = await prisma.externalChunk.findFirst({ where: { documentId } });
    const insp = await inspectChunkEmbedding(prisma, chunk!.id);
    expect(insp.dims).toBe(1024);
    expect(insp.embeddedContentHash).toBe(chunk!.contentHash);
  });
});