import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { syncNewsForEvent } from "./news.js";

// Testes mutacionais que rodam exclusivamente em f1_narrative_test.
// NewsItem é derived/read-only: não testamos CRUD manual de notícia, apenas o
// fluxo determinístico Event -> NewsItem e a leitura GET /api/events/:id/news.

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type EventRecord = {
  id: string;
  type: string;
  importance: string;
  source: string;
  title: string;
  description: string | null;
  worldDate: string | null;
  createdAt: string;
};

type Character = { id: string; name: string; nationality: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdEventIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = track(createdUserIds, await prisma.user.findUniqueOrThrow({ where: { email } }));
  return { cookie, userId: user.id };
}

async function createCharacter(user: TestUser, payload: Record<string, unknown>): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdCharacterIds, res.json().character as Character);
}

async function createEvent(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { event?: EventRecord; code?: string } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/events",
    headers: { cookie: user.cookie },
    payload,
  });
  if (res.statusCode === 201 && res.json().event) {
    track(createdEventIds, res.json().event as { id: string });
  }
  return { statusCode: res.statusCode, json: res.json() };
}

async function patchEvent(
  user: TestUser,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { event?: EventRecord; code?: string } }> {
  const res = await app.inject({
    method: "PATCH",
    url: `/api/events/${eventId}`,
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: res.json() };
}

async function addParticipant(user: TestUser, eventId: string, characterId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/events/${eventId}/participants`,
    headers: { cookie: user.cookie },
    payload: { characterId },
  });
  return { statusCode: res.statusCode, json: res.json() };
}

async function getNews(user: TestUser, eventId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/events/${eventId}/news`,
    headers: { cookie: user.cookie },
  });
  return { statusCode: res.statusCode, json: res.json() };
}

async function countNews(eventId: string): Promise<number> {
  return prisma.newsItem.count({ where: { eventId } });
}

let owner: TestUser;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  owner = await createUser(`news-owner-${Date.now()}@f1nw.test`, "NewsOwner");
});

afterAll(async () => {
  // notícias referenciam Event (sem cascade em NewsItem.event): remover antes.
  await prisma.newsItem.deleteMany({
    where: { eventId: { in: createdEventIds } },
  });
  await prisma.eventCharacter.deleteMany({
    where: { characterId: { in: createdCharacterIds } },
  });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await prisma.$disconnect();
  await app.close();
});

describe("Criação do Event gera NewsItem derivado", () => {
  it("POST /api/events cria exatamente 1 NewsItem", async () => {
    const { statusCode, json } = await createEvent(owner, {
      type: "RACE",
      title: "Grande Prêmio Teste",
    });
    expect(statusCode).toBe(201);
    const eventId = (json.event as EventRecord).id;
    expect(await countNews(eventId)).toBe(1);
  });

  it("conteúdo determinístico (0 participantes)", async () => {
    const { json } = await createEvent(owner, {
      type: "RACE",
      title: "Grande Prêmio Dois",
    });
    const eventId = (json.event as EventRecord).id;
    const news = await prisma.newsItem.findFirst({ where: { eventId } });

    expect(news?.title).toBe("[Corrida] — Grande Prêmio Dois");
    expect(news?.source).toBe("GENERATED_EVENT");
    expect(news?.body).toBe("Título: Grande Prêmio Dois\nTipo: Corrida\nImportância: Média");
    // Sem participantes: a linha "Participantes" não deve existir.
    expect(news?.body).not.toContain("Participantes");
  });

  it("conteúdo determinístico com worldDate, description e importance", async () => {
    const { json } = await createEvent(owner, {
      type: "NEWS",
      title: "Fato Notável",
      description: "Uma descrição narrativa determinística.",
      worldDate: "2026-01-15T14:00:00.000Z",
      importance: "HIGH",
    });
    const eventId = (json.event as EventRecord).id;
    const news = await prisma.newsItem.findFirst({ where: { eventId } });

    expect(news?.title).toBe("[Notícia] — Fato Notável");
    expect(news?.body).toBe(
      "Título: Fato Notável\nTipo: Notícia\nImportância: Alta\nData: 2026-01-15\nDescrição: Uma descrição narrativa determinística.",
    );
  });
});

describe("GET /api/events/:id/news", () => {
  it("retorna 200 com a notícia derivada", async () => {
    const { json } = await createEvent(owner, { type: "SOCIAL", title: "Social na Mira" });
    const eventId = (json.event as EventRecord).id;
    const { statusCode, json: body } = await getNews(owner, eventId);
    expect(statusCode).toBe(200);
    expect(body.news.eventId).toBe(eventId);
    expect(body.news.title).toBe("[Social] — Social na Mira");
    expect(body.news.source).toBe("GENERATED_EVENT");
  });

  it("retorna 401 sem sessão", async () => {
    const { json } = await createEvent(owner, { type: "SOCIAL", title: "Sem Sessão" });
    const eventId = (json.event as EventRecord).id;
    const res = await app.inject({ method: "GET", url: `/api/events/${eventId}/news` });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("retorna 404 para Event inexistente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/events/00000000-0000-4000-8000-000000000000/news",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("retorna 404 para Event sem notícia (inconsistência documentada)", async () => {
    const { json } = await createEvent(owner, { type: "SOCIAL", title: "Sem Notícia" });
    const eventId = (json.event as EventRecord).id;
    await prisma.newsItem.deleteMany({ where: { eventId } });
    const { statusCode, json: body } = await getNews(owner, eventId);
    expect(statusCode).toBe(404);
    expect(body.code).toBe("NOT_FOUND");

    // Restaura a notícia para o fluxo normal terminar consistente (os demais
    // testes assumem todo Event persistido com 1 notícia).
    await syncNewsForEvent(prisma, eventId);
    expect(await countNews(eventId)).toBe(1);
  });
});

describe("Participantes refletidos de forma determinística", () => {
  it("Event com 1 participante → body contém o participante (após add)", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Um Participante" });
    const eventId = (json.event as EventRecord).id;
    const ch = await createCharacter(owner, {
      name: "Ana Piloto",
      nationality: "Brasileira",
      birthDate: "1995-01-01",
    });
    // Sem PATCH antes: a própria associação do participante já regenera a
    // notícia (Correção 1) e a GET deve refletir Ana imediatamente.
    await addParticipant(owner, eventId, ch.id);

    const { statusCode, json: body } = await getNews(owner, eventId);
    expect(statusCode).toBe(200);
    expect(body.news.body).toContain("Participantes: Ana Piloto");
  });

  it("Event com múltiplos participantes → nomes ordenados", async () => {
    const { json } = await createEvent(owner, { type: "WORLD", title: "Múltiplos" });
    const eventId = (json.event as EventRecord).id;
    const zeta = await createCharacter(owner, { name: "Zeta XP", nationality: "Italiana", birthDate: "1990-01-01" });
    const alpha = await createCharacter(owner, { name: "Alpha A", nationality: "Alemã", birthDate: "1991-01-01" });
    await addParticipant(owner, eventId, zeta.id);
    await addParticipant(owner, eventId, alpha.id);

    const news = await prisma.newsItem.findFirst({ where: { eventId } });
    // Ordem crescente por nome: Alpha A antes de Zeta XP.
    expect(news?.body).toContain("Participantes: Alpha A, Zeta XP");
  });

  it("remover participante → notícia deixa de refleti-lo (após remove)", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Remoção" });
    const eventId = (json.event as EventRecord).id;
    const ch = await createCharacter(owner, {
      name: "Bruno Sai",
      nationality: "Britânica",
      birthDate: "1993-01-01",
    });
    await addParticipant(owner, eventId, ch.id);

    let { statusCode, json: body } = await getNews(owner, eventId);
    expect(statusCode).toBe(200);
    expect(body.news.body).toContain("Participantes: Bruno Sai");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/events/${eventId}/participants/${ch.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    // A remoção regenera a notícia: o participante some da linha e a linha
    // "Participantes" deixa de existir (0 participantes restantes).
    ({ statusCode, json: body } = await getNews(owner, eventId));
    expect(statusCode).toBe(200);
    expect(body.news.body).not.toContain("Bruno Sai");
    expect(body.news.body).not.toContain("Participantes:");
  });
});

describe("Atualização do Event regenera a MESMA notícia", () => {
  it("PATCH mantém o id e não gera uma segunda notícia; GET reflete o novo conteúdo", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Antes" });
    const eventId = (json.event as EventRecord).id;
    const before = await prisma.newsItem.findFirst({ where: { eventId } });
    expect(before).not.toBeNull();

    const patch = await patchEvent(owner, eventId, { title: "Depois" });
    expect(patch.statusCode).toBe(200);

    const after = await prisma.newsItem.findFirst({ where: { eventId } });
    expect(after).not.toBeNull();
    expect(after!.id).toBe(before!.id); // mesma linha, não duplicação
    expect(await countNews(eventId)).toBe(1);
    expect(after!.title).toBe("[Corrida] — Depois");

    const { statusCode, json: body } = await getNews(owner, eventId);
    expect(statusCode).toBe(200);
    expect(body.news.title).toBe("[Corrida] — Depois");
  });

  it("repetir a operação (PATCH duas vezes) nunca cria múltiplas notícias", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Idempotente" });
    const eventId = (json.event as EventRecord).id;
    await patchEvent(owner, eventId, { importance: "LOW" });
    await patchEvent(owner, eventId, { importance: "HIGH" });
    expect(await countNews(eventId)).toBe(1);
  });
});

describe("Concorrência na regeneração", () => {
  it("PATCHs simultâneos no mesmo Event → exatamente 1 notícia (sem duplicidade)", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Concorrente" });
    const eventId = (json.event as EventRecord).id;

    const [a, b] = await Promise.all([
      patchEvent(owner, eventId, { title: "Conc A" }),
      patchEvent(owner, eventId, { title: "Conc B" }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    // O advisory lock por evento serializa a sincronização: no máximo 1 linha.
    expect(await countNews(eventId)).toBe(1);
    const all = await prisma.newsItem.findMany({ where: { eventId } });
    expect(all.length).toBe(1);
  });

  it("criação inicial concorrente (Event sem NewsItem) → exatamente 1 notícia", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Criação Inicial" });
    const eventId = (json.event as EventRecord).id;
    // Remove a notícia para simular um Event que ainda não possui NewsItem
    // (o mesmo cenário de dois syncs simultâneos logo após o create).
    await prisma.newsItem.deleteMany({ where: { eventId } });
    expect(await countNews(eventId)).toBe(0);

    // Duas sincronizações simultâneas para o mesmo Event inicialmente sem
    // notícia, nos MESMOS moldes das rotas (cada uma dentro de uma transação
    // interativa). O advisory lock por evento é adquirido por transação e
    // liberado apenas no commit: a segunda bloqueia até a primeira terminar,
    // então encontra a linha já criada e a atualiza — nunca cria uma segunda.
    const run = () => prisma.$transaction((tx) => syncNewsForEvent(tx, eventId));
    await Promise.all([run(), run()]);

    const all = await prisma.newsItem.findMany({ where: { eventId } });
    expect(all.length).toBe(1);
    expect(all[0].source).toBe("GENERATED_EVENT");
  });
});

describe("Consistência Event + News derivada", () => {
  it("todo Event persistido via API possui exatamente 1 NewsItem", async () => {
    // Reaproveita eventos já criados nas rodadas anteriores da suíte.
    for (const eventId of createdEventIds) {
      expect(await countNews(eventId)).toBe(1);
    }
  });

  it("conteúdo da News corresponde ao estado atual do Event + participantes", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Consistência" });
    const eventId = (json.event as EventRecord).id;
    const ch = await createCharacter(owner, {
      name: "Carla Coerente",
      nationality: "Canadense",
      birthDate: "1994-01-01",
    });

    const news = await prisma.newsItem.findFirstOrThrow({ where: { eventId } });
    expect(news.title).toBe("[Corrida] — Consistência");
    expect(news.body).toContain("Importância: Média");
    expect(news.body).not.toContain("Participantes");

    await addParticipant(owner, eventId, ch.id);
    const afterAdd = await prisma.newsItem.findFirstOrThrow({ where: { eventId } });
    expect(afterAdd.body).toContain("Participantes: Carla Coerente");

    await patchEvent(owner, eventId, { importance: "HIGH" });
    const afterPatch = await prisma.newsItem.findFirstOrThrow({ where: { eventId } });
    expect(afterPatch.body).toContain("Importância: Alta");
  });
});

describe("DELETE do Event remove a notícia derivada", () => {
  it("DELETE Event → NewsItem e EventCharacter somem, sem órfã", async () => {
    const { json } = await createEvent(owner, { type: "RACE", title: "Excluir News" });
    const eventId = (json.event as EventRecord).id;
    const ch = await createCharacter(owner, {
      name: "Char do Evento",
      nationality: "Francesa",
      birthDate: "1992-01-01",
    });
    await addParticipant(owner, eventId, ch.id);
    await patchEvent(owner, eventId, { title: "Excluir News Final" });

    expect(await countNews(eventId)).toBe(1);
    expect(await prisma.eventCharacter.count({ where: { eventId } })).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/events/${eventId}`,
      headers: { cookie: owner.cookie },
    });
    expect(del.statusCode).toBe(204);

    expect(await countNews(eventId)).toBe(0);
    expect(await prisma.eventCharacter.count({ where: { eventId } })).toBe(0);
    expect(await prisma.event.findUnique({ where: { id: eventId } })).toBeNull();
    // Character permanece (não é removido em cascata).
    expect(await prisma.character.findUnique({ where: { id: ch.id } })).not.toBeNull();
  });

  it("mais de 100 sincronizações (repetidas) → contagem máxima segue 1 por Event", async () => {
    const { json } = await createEvent(owner, { type: "WORLD", title: "Estresse" });
    const eventId = (json.event as EventRecord).id;
    for (let i = 0; i < 5; i++) {
      await patchEvent(owner, eventId, { title: `Estresse ${i}` });
    }
    expect(await countNews(eventId)).toBe(1);
  });
});