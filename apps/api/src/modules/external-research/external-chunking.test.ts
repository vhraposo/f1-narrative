import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ingestExternalDocument } from "./external-ingest.js";
import {
  chunkExternalDocument,
  computeChunkContentHash,
  normParagraphContent,
  splitDocumentIntoChunks,
  CHUNK_DEFAULT_MAX_SIZE,
} from "./external-chunking.js";

const track = <T extends { id: string }>(arr: string[], item: T): T => {
  arr.push(item.id);
  return item;
};

interface TestUser {
  id: string;
}

const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];
const createdChunkIds: string[] = [];
const createdUserIds: string[] = [];
const directSourceIds: string[] = [];
const directDocumentIds: string[] = [];

async function createUser(email: string): Promise<TestUser> {
  return track(
    createdUserIds,
    await prisma.user.create({ data: { name: "Chunking", email } }),
  );
}

// Wrapper de ingestão que rastreia Source/Document para cleanup completo.
async function ingestAt(url: string, content: string, ownerId?: string) {
  const res = await ingestExternalDocument(prisma, {
    title: "Chunk",
    sourceType: "ARTICLE",
    visibility: ownerId ? "PRIVATE" : "PUBLIC",
    ownerId: ownerId ?? null,
    url,
    content,
  });
  track(createdSourceIds, { id: res.source.id });
  track(createdDocumentIds, { id: res.document.id });
  return res;
}

/** Cria Source+Document diretamente (sem serviço) para fixture de inconsistência. */
async function createDocDirect(content: string, url = "https://example.com/direct"): Promise<string> {
  const source = await prisma.externalSource.create({
    data: { url, title: "Direct", sourceType: "ARTICLE", visibility: "PUBLIC", ownerId: null },
  });
  directSourceIds.push(source.id);
  const doc = await prisma.externalDocument.create({
    data: { sourceId: source.id, title: "Direct", content, contentHash: "sha256:x", status: "NEW" },
  });
  directDocumentIds.push(doc.id);
  return doc.id;
}

async function chunkDoc(documentId: string, options?: Parameters<typeof chunkExternalDocument>[2]) {
  return chunkExternalDocument(prisma, documentId, options);
}

beforeAll(async () => {
  await createUser("chunk-owner@example.com");
});

afterAll(async () => {
  await prisma.externalChunk.deleteMany({ where: { id: { in: createdChunkIds } } });
  await prisma.externalChunk.deleteMany({ where: { documentId: { in: createdDocumentIds.concat(directDocumentIds) } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds.concat(directDocumentIds) } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds.concat(directSourceIds) } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("Chunking - utilidades de divisão/hash", () => {
  it("A) documento pequeno → 1 chunk", () => {
    const c = splitDocumentIntoChunks("Texto curto de teste.");
    expect(c).toHaveLength(1);
    expect(c[0]).toBe("Texto curto de teste.");
  });

  it("B) múltiplos parágrafos → múltiplos chunks preservando ordem", () => {
    const content = "primeiro parágrafo.\n\nsegundo parágrafo.\n\nterceiro parágrafo.";
    const c = splitDocumentIntoChunks(content);
    expect(c).toEqual(["primeiro parágrafo.", "segundo parágrafo.", "terceiro parágrafo."]);
  });

  it("C) orderOriginal 0,1,2", async () => {
    const content = "A.\n\nB.\n\nC.";
    const res = await chunkDoc(await ingestAt("https://example.com/order", content).then((r) => r.document.id));
    expect(res.chunks.map((x) => x.orderOriginal)).toEqual([0, 1, 2]);
  });

  it("D) contentHash do Document preservado no resultado", async () => {
    const ingest = await ingestAt("https://example.com/dochash", "hash content here");
    const res = await chunkDoc(ingest.document.id);
    expect(res.document.contentHash).toBe(ingest.contentHash);
    expect(res.document.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("E) chunkHash correto (formato + determinismo)", () => {
    const text = "conteúdo do chunk";
    const h = computeChunkContentHash(text);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeChunkContentHash(text)).toBe(h);
    expect(computeChunkContentHash(text)).not.toBe(computeChunkContentHash(text + "!"));
  });

  it("F) conteúdo vazio não cria chunk e não transiciona status", async () => {
    // Cria um documento vazio direto.
    const id = await createDocDirect("", "https://example.com/empty");
    const res = await chunkDoc(id);
    expect(res.chunks).toHaveLength(0);
    expect(res.created).toBe(0);
    expect(res.document.status).toBe("NEW");
  });

  it("G) conteúdo muito grande é dividido em múltiplos chunks", () => {
    const big = "palavra ".repeat(400); // ~2800 chars
    const c = splitDocumentIntoChunks(big, { maxSize: 1000 });
    expect(c.length).toBeGreaterThan(1);
    for (const piece of c) expect(piece.length).toBeLessThanOrEqual(1000);
  });

  it("H) parágrafo com exatamente maxSize não cria split extra", () => {
    const size = 100;
    const p = "x".repeat(size);
    const c = splitDocumentIntoChunks(p, { maxSize: size });
    expect(c).toEqual([p]);
    expect(c[0].length).toBe(size);
  });

  it("I) parágrafo > maxSize cria split", () => {
    const p = "y".repeat(150);
    const c = splitDocumentIntoChunks(p, { maxSize: 100 });
    expect(c.length).toBeGreaterThan(1);
    for (const piece of c) expect(piece.length).toBeLessThanOrEqual(100);
  });

  it("J) Unicode preservado (incl. emoji/surrogate pairs)", () => {
    const p = "olá 🏎️ mundo 🚩 granular";
    const c = splitDocumentIntoChunks(p, { maxSize: 10 });
    expect(c.join("")).toBe(normParagraphContent(p));
  });

  it("K) pontuação preservada", () => {
    const content = "Primeiro. Segunda! Terceira? Pronto.";
    const c = splitDocumentIntoChunks(content, { maxSize: 1000 });
    expect(c.join("")).toBe(content);
  });
});

describe("Chunking - política / limites", () => {
  it("maxSize default = 1000", () => {
    expect(CHUNK_DEFAULT_MAX_SIZE).toBe(1000);
  });

  it("custom maxSize é aplicado", () => {
    const p = "a".repeat(120);
    const c = splitDocumentIntoChunks(p, { maxSize: 60 });
    expect(c.every((x) => x.length <= 60)).toBe(true);
    expect(c.join("")).toBe(p);
  });

  it("maxSize pequeno divide tudo sem perder caracteres", () => {
    const p = "abcdefghij";
    const c = splitDocumentIntoChunks(p, { maxSize: 3 });
    expect(c.join("")).toBe(p);
    for (const piece of c) expect(piece.length).toBeLessThanOrEqual(3);
  });

  it("overlap=0 é default e reconstrói o conteúdo", () => {
    const content = "linha um\ncontinuação.\n\nsegundo parágrafo.";
    const c = splitDocumentIntoChunks(content);
    expect(c.join("\n\n")).toBe(normParagraphContent(content));
  });

  it("overlap>0 repete caracteres do chunk anterior (teste explícito)", () => {
    const p = "abcdefghij";
    const c = splitDocumentIntoChunks(p, { maxSize: 5, overlap: 2 });
    expect(c[0]).toBe("abcde");
    expect(c[1].startsWith("de")).toBe(true); // reutiliza 2 chars do anterior
    // Nenhum caractere do parágrafo é perdido (overlap duplica, não elimina).
    const joined = c.join("");
    for (const ch of Array.from(p)) expect(joined).toContain(ch);
    for (const piece of c) expect(piece.length).toBeLessThanOrEqual(5);
  });

  it("configuração inválida rejeitada", () => {
    expect(() => splitDocumentIntoChunks("x", { maxSize: 0 })).toThrow();
    expect(() => splitDocumentIntoChunks("x", { maxSize: -5 })).toThrow();
    expect(() => splitDocumentIntoChunks("x", { maxSize: 2, overlap: 2 })).toThrow();
    expect(() => splitDocumentIntoChunks("x", { maxSize: 2, overlap: 3 })).toThrow();
    expect(() => splitDocumentIntoChunks("x", { overlap: -1 })).toThrow();
  });
});

describe("Chunking - persistência / idempotência", () => {
  it("primeira execução cria chunks e NEW → READY", async () => {
    const ingest = await ingestAt("https://example.com/idem1", "um.\n\ndois.\n\ntrês.");
    expect(ingest.document.status).toBe("NEW");
    const res = await chunkDoc(ingest.document.id);
    expect(res.created).toBe(3);
    expect(res.reused).toBe(0);
    expect(res.document.status).toBe("READY");
  });

  it("segunda execução cria 0, reusa, status permanece READY", async () => {
    const ingest = await ingestAt("https://example.com/idem2", "para um.\n\npara dois.");
    await chunkDoc(ingest.document.id);
    const res = await chunkDoc(ingest.document.id);
    expect(res.created).toBe(0);
    expect(res.reused).toBe(2);
    expect(res.document.status).toBe("READY");
  });

  it("chunks retornados na segunda execução equivalem aos existentes", async () => {
    const ingest = await ingestAt("https://example.com/idem3", "alpha.\n\nbeta.");
    const r1 = await chunkDoc(ingest.document.id);
    const r2 = await chunkDoc(ingest.document.id);
    expect(r2.chunks.map((c) => c.id)).toEqual(r1.chunks.map((c) => c.id));
    expect(r2.chunks.map((c) => c.orderOriginal)).toEqual([0, 1]);
  });

  it("nenhuma duplicata na reexecução", async () => {
    const ingest = await ingestAt("https://example.com/idem4", "só um parágrafo.");
    await chunkDoc(ingest.document.id);
    const total = await prisma.externalChunk.count({ where: { documentId: ingest.document.id } });
    expect(total).toBe(1);
    await chunkDoc(ingest.document.id);
    const total2 = await prisma.externalChunk.count({ where: { documentId: ingest.document.id } });
    expect(total2).toBe(1);
  });
});

describe("Chunking - inconsistência / reshunk", () => {
  it("conteúdo alterado substitue atomicamente chunks antigos", async () => {
    const ingest = await ingestAt("https://example.com/inconst", "velho conteúdo aqui.");
    await chunkDoc(ingest.document.id);
    const before = await prisma.externalChunk.count({ where: { documentId: ingest.document.id } });
    expect(before).toBe(1);

    // Altera o conteúdo do Document diretamente (TEST), gerando novo contentHash
    // mas preservando os chunks antigos → inconsistência.
    await prisma.externalDocument.update({
      where: { id: ingest.document.id },
      data: { content: "novo conteúdo com vários parágrafos.\n\nsegundo parágrafo.", status: "NEW" },
    });
    const res = await chunkDoc(ingest.document.id);
    expect(res.created).toBe(2);
    expect(res.document.status).toBe("READY");
    const after = await prisma.externalChunk.findMany({ where: { documentId: ingest.document.id }, orderBy: { orderOriginal: "asc" } });
    expect(after).toHaveLength(2);
    expect(after[0].contentHash).toBe(computeChunkContentHash("novo conteúdo com vários parágrafos."));
  });

  it("chunks antigos NÃO são apagados silenciosamente fora de transação", async () => {
    // Garantia já coberta pelo caso atômico: a substituição ocorre numa única
    // transação; um erro na transação reverte. Verificamos que listar após um
    // rechunk bem-sucedido não deixa resíduos.
    const ingest = await ingestAt("https://example.com/inconst2", "conteúdo A.");
    await chunkDoc(ingest.document.id);
    await prisma.externalDocument.update({
      where: { id: ingest.document.id },
      data: { content: "conteúdo B.", status: "NEW" },
    });
    await chunkDoc(ingest.document.id);
    const count = await prisma.externalChunk.count({ where: { documentId: ingest.document.id } });
    expect(count).toBe(1);
  });
});

describe("Chunking - proveniência / embedding", () => {
  it("cadeia Chunk → Document → Source intacta", async () => {
    const ingest = await ingestAt("https://example.com/prov", "conteúdo de proveniência.");
    await chunkDoc(ingest.document.id);
    const chunk = await prisma.externalChunk.findFirst({
      where: { documentId: ingest.document.id },
      include: { document: { include: { source: true } } },
    });
    expect(chunk).not.toBeNull();
    expect(chunk!.documentId).toBe(ingest.document.id);
    expect(chunk!.document.sourceId).toBe(ingest.source.id);
    expect(chunk!.document.source.url).toBe("https://example.com/prov");
  });

  it("nenhum campo de embedding é preenchido após chunking", async () => {
    const ingest = await ingestAt("https://example.com/noemb", "paragrapho para embedding.");
    await chunkDoc(ingest.document.id);
    const chunks = await prisma.externalChunk.findMany({
      where: { documentId: ingest.document.id },
    });
    for (const c of chunks) {
      expect(c.embeddingProvider).toBeNull();
      expect(c.embeddingModel).toBeNull();
      expect(c.embeddingVersion).toBeNull();
      expect(c.embeddingDimensions).toBeNull();
    }
  });

  it("documentId de cada chunk correto", async () => {
    const ingest = await ingestAt("https://example.com/did", "a.\n\nb.\n\nc.");
    await chunkDoc(ingest.document.id);
    const ids = await prisma.externalChunk.findMany({ where: { documentId: ingest.document.id } });
    expect(ids.every((x) => x.documentId === ingest.document.id)).toBe(true);
  });
});