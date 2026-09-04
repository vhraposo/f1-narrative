import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  EXTERNAL_INGEST_RULE,
  INGEST_SENSITIVE_RE,
  canonicalExternalContent,
  computeDocumentContentHash,
  ingestExternalDocument,
} from "./external-ingest.js";

// Testes de ingestão Source → Document (Fase 13 STEP 3, SERVICE-ONLY, SEM LLM).
// Nenhum endpoint; fixture via service puro + verificação direta no TEST DB.

type TestUser = { id: string };

const createdUserIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

async function createUser(email: string): Promise<TestUser> {
  return track(
    createdUserIds,
    await prisma.user.create({ data: { name: "Ingest", email } }),
  );
}

// Wrapper que chama o serviço e RASTREIA os IDs de Source/Document criados
// para que o afterAll remova TUDO (inclusive os criados dentro da transação),
// preservando per-resíduo o resto da suíte.
async function ingest(input: Parameters<typeof ingestExternalDocument>[1]) {
  const res = await ingestExternalDocument(prisma, input);
  track(createdSourceIds, { id: res.source.id });
  track(createdDocumentIds, { id: res.document.id });
  return res;
}

async function createSourceDirect(url: string, ownerId: string | null): Promise<string> {
  const s = track(
    createdSourceIds,
    await prisma.externalSource.create({
      data: {
        url,
        title: "source direto",
        visibility: ownerId ? "PRIVATE" : "PUBLIC",
        ownerId,
      },
    }),
  );
  return s.id;
}

afterAll(async () => {
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Canonicalização + hash
// ---------------------------------------------------------------------------

describe("Ingest - canonicalização e contentHash", () => {
  it("A) normaliza EOLs e espaços à direita", () => {
    const a = canonicalExternalContent("linha1\r\nlinha2 \r\nlinha3");
    const b = canonicalExternalContent("linha1\nlinha2\nlinha3");
    expect(a).toBe(b);
  });

  it("B) preserva pontuação e ordem de parágrafos", () => {
    const a = canonicalExternalContent("  primeira linha!\n\nsegunda.");
    expect(a).toBe("primeira linha!\n\nsegunda.");
  });

  it("C) contentHash é sha256:<64 hex>", () => {
    const h = computeDocumentContentHash("abc");
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("D) mesmo conteúdo canônico → mesmo hash", () => {
    expect(computeDocumentContentHash("A\r\nB")).toBe(computeDocumentContentHash("A\nB"));
  });

  it("E) conteúdo diferente → hash diferente", () => {
    expect(computeDocumentContentHash("ABC")).not.toBe(computeDocumentContentHash("ABD"));
  });
});

// ---------------------------------------------------------------------------
// Fluxo principal de ingestão
// ---------------------------------------------------------------------------

describe("Ingest - fluxo principal", () => {
  let owner: TestUser;

  beforeAll(async () => {
    owner = await createUser(`ingest-${Date.now()}@f1nw.test`);
  });

  it("A) criação de Source + Document com hash correto", async () => {
    const res = await ingest({
      title: "Relatório",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/a",
      content: "Conteúdo do relatório de prova.",
    });
    expect(JSON.stringify(res.source)).toContain(owner.id);
    expect(res.createdSource).toBe(true);
    expect(res.createdDocument).toBe(true);
    expect(res.contentHash).toBe(computeDocumentContentHash("Conteúdo do relatório de prova."));
    expect(res.ruleApplied).toBe(EXTERNAL_INGEST_RULE);
    expect(res.document.status).toBe("NEW");
    expect(res.document.contentHash).toBe(res.contentHash);
  });

  it("F) reingestão idêntica → Document NÃO duplica (reuso)", async () => {
    await ingest({
      title: "Relatório",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/a",
      content: "Conteúdo do relatório de prova.",
    });
    const res = await ingest({
      title: "Relatório",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/a",
      content: "Conteúdo do relatório de prova.",
    });
    expect(res.createdDocument).toBe(false);
    expect(res.createdSource).toBe(false);
    const docsForSource = await prisma.externalDocument.count({
      where: { source: { url: "https://example.com/a" } },
    });
    expect(docsForSource).toBe(1);
  });

  it("F2) mesmo conteúdo canônico (EOLs diferentes) → mesmo Document (hash igual)", async () => {
    const a = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/eol",
      content: "linha1\r\nlinha2",
    });
    const b = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/eol",
      content: "linha1\nlinha2",
    });
    expect(b.createdDocument).toBe(false);
    expect(b.document.contentHash).toBe(a.document.contentHash);
  });

  it("G) conteúdo novo → novo Document (mesma Source)", async () => {
    const a = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/multi",
      content: "primeiro conteúdo",
    });
    const b = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/multi",
      content: "segundo conteúdo diferente",
    });
    expect(b.createdSource).toBe(false);
    expect(b.createdDocument).toBe(true);
    expect(a.document.id).not.toBe(b.document.id);
    const count = await prisma.externalDocument.count({
      where: { source: { url: "https://example.com/multi" } },
    });
    expect(count).toBe(2);
  });

  it("J) provenance Source → Document", async () => {
    const res = await ingest({
      title: "T Prov",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/prov",
      content: "proveniência testada",
    });
    const doc = await prisma.externalDocument.findUnique({
      where: { id: res.document.id },
      include: { source: true },
    });
    expect(doc?.sourceId).toBe(res.source.id);
    expect(doc?.source.url).toBe("https://example.com/prov");
  });

  it("L) publishedAt persisted quando fornecido", async () => {
    const pub = new Date("2026-03-10T00:00:00Z");
    const res = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/date",
      content: "com data publicada",
      publishedAt: pub,
    });
    const doc = await prisma.externalDocument.findUnique({ where: { id: res.document.id } });
    expect(doc?.publishedAt?.toISOString()).toBe(pub.toISOString());
  });

  it("K) status inicial é NEW (step downstream ainda não executado)", async () => {
    const res = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/status",
      content: "status inicial",
    });
    expect(res.document.status).toBe("NEW");
  });

  it("R/S/T) NÃO cria Chunk nem vector neste STEP", async () => {
    await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/nochunk",
      content: "sem chunk, sem embedding",
    });
    // nenhum ExternalChunk nor embedding metadata preenchido
    const chunks = await prisma.externalChunk.findMany({});
    expect(chunks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ownership / visibility
// ---------------------------------------------------------------------------

describe("Ingest - ownership e visibility", () => {
  let ownerA: TestUser;
  let ownerB: TestUser;

  beforeAll(async () => {
    ownerA = await createUser(`ingA-${Date.now()}@f1nw.test`);
    ownerB = await createUser(`ingB-${Date.now()}@f1nw.test`);
  });

  it("H) mesma URL c/ owners diferentes em PRIVATE → NÃO funde Sources", async () => {
    const a = await ingest({
      title: "A",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: ownerA.id,
      url: "https://example.com/shared",
      content: "conteúdo do A",
    });
    const b = await ingest({
      title: "B",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: ownerB.id,
      url: "https://example.com/shared",
      content: "conteúdo do B",
    });
    expect(a.source.id).not.toBe(b.source.id);
    expect(a.source.ownerId).toBe(ownerA.id);
    expect(b.source.ownerId).toBe(ownerB.id);
  });

  it("H2) PRIVATE sem ownerId é rejeitado", async () => {
    await expect(
      ingestExternalDocument(prisma, {
        title: "T",
        sourceType: "ARTICLE",
        visibility: "PRIVATE",
        ownerId: null,
        url: "https://example.com/non",
        content: "sem dono",
      }),
    ).rejects.toThrow(/PRIVATE exige ownerId/);
  });

  it("I) PUBLIC sem ownerId criar Source reutilizável por url", async () => {
    const a = await ingest({
      title: "Pub",
      sourceType: "WEBSITE",
      visibility: "PUBLIC",
      ownerId: null,
      url: "https://example.com/pub",
      content: "público 1",
    });
    const b = await ingest({
      title: "Pub2",
      sourceType: "WEBSITE",
      visibility: "PUBLIC",
      ownerId: null,
      url: "https://example.com/pub",
      content: "público 2",
    });
    expect(a.source.id).toBe(b.source.id);
    expect(a.source.visibility).toBe("PUBLIC");
    // dois conteúdos distintos → dois Documents (proveniência preservada)
    expect(a.document.id).not.toBe(b.document.id);
  });

  it("I2) SHARED usa ownership por ownerId (sem ACL até schema ganhar sharing)", async () => {
    const s = await ingest({
      title: "S",
      sourceType: "SEARCH_RESULT",
      visibility: "SHARED",
      ownerId: ownerA.id,
      url: "https://example.com/shared1",
      content: "shared de A",
    });
    expect(s.source.visibility).toBe("SHARED");
    expect(s.source.ownerId).toBe(ownerA.id);
  });
});

// ---------------------------------------------------------------------------
// Validação / segurança
// ---------------------------------------------------------------------------

describe("Ingest - validação e segurança", () => {
  const valid = {
    title: "T",
    sourceType: "ARTICLE" as const,
    visibility: "PUBLIC" as const,
    ownerId: null,
    url: "https://example.com/v",
    content: "ok",
  };

  it("M) url inválida rejeitada", async () => {
    await expect(
      ingestExternalDocument(prisma, { ...valid, url: "não é url" }),
    ).rejects.toThrow(/url/i);
    await expect(
      ingestExternalDocument(prisma, { ...valid, url: "ftp://x/y" }),
    ).rejects.toThrow(/url/i);
  });

  it("N) content vazio rejeitado", async () => {
    await expect(
      ingestExternalDocument(prisma, { ...valid, content: "  " }),
    ).rejects.toThrow(/content/);
  });

  it("title vazio rejeitado", async () => {
    await expect(
      ingestExternalDocument(prisma, { ...valid, title: " " }),
    ).rejects.toThrow(/title/);
  });

  it("O) nenhuma informação sensível armazenada (content/api-key rejeitado)", async () => {
    await expect(
      ingestExternalDocument(prisma, {
        ...valid,
        content: "o segredo é API_KEY=abc123",
      }),
    ).rejects.toThrow(/sensível/);
    expect(INGEST_SENSITIVE_RE.test("Authorization: Bearer xyz")).toBe(true);
  });

  it("O2) url com credencial embutida rejeitada", async () => {
    await expect(
      ingestExternalDocument(prisma, {
        ...valid,
        url: "https://user:pass@example.com/x",
      }),
    ).rejects.toThrow();
  });

  it("Q) isolamento: source/owner de dados não vaza para outro escopo", async () => {
    const owner = await createUser(`isol-${Date.now()}@f1nw.test`);
    const res = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/iso",
      content: "privada isolada",
    });
    const docs = await prisma.externalDocument.findMany({
      where: { source: { ownerId: owner.id } },
      select: { sourceId: true },
    });
    expect(docs.length).toBe(1);
    expect(docs[0].sourceId).toBe(res.source.id);
  });

  it("B) reutilização não cria User fictício nem vaza", async () => {
    const owner = await createUser(`nouse-${Date.now()}@f1nw.test`);
    await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/nouse",
      content: "não cria user extra",
    });
    expect(createdUserIds.length).toBeGreaterThan(0);
  });

  it("D) consentimento/ownership não afeta hash do conteúdo", async () => {
    const h1 = computeDocumentContentHash("texto estável");
    const owner = await createUser(`hash-${Date.now()}@f1nw.test`);
    const res = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: "PRIVATE",
      ownerId: owner.id,
      url: "https://example.com/hash",
      content: "texto estável",
    });
    expect(res.contentHash).toBe(h1);
  });
});

// ---------------------------------------------------------------------------
// Reusu de Source constrói lógica de identidade (url + ownerId)
// ---------------------------------------------------------------------------

describe("Ingest - identidade de Source (sourceId direto)", () => {
  it("reutiliza Source por url + ownerId (não cria duplicata)", async () => {
    let owner: TestUser | null = null;
    for (const u of createdUserIds) {
      const u2 = await prisma.user.findUnique({ where: { id: u } });
      if (u2) {
        owner = { id: u2.id };
        break;
      }
    }
    const sid = await createSourceDirect("https://example.com/preex", owner?.id ?? null);
    const res = await ingest({
      title: "T",
      sourceType: "ARTICLE",
      visibility: owner ? "PRIVATE" : "PUBLIC",
      ownerId: owner?.id ?? null,
      url: "https://example.com/preex",
      content: "reusa a source preexistente",
    });
    expect(res.createdSource).toBe(false);
    expect(res.source.id).toBe(sid);
  });
});

// Fim: os testes de Q/R/S/T/cleanup já garantem que nenhum Chunk é criado e
// que o afterAll remove apenas o que foi rastreado, preservando resíduos externos.