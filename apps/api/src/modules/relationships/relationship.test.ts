import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// Importante: o rate limit da API é de 100 requests/min por instância de app.
// Como cada arquivo de teste cria sua própria instância (buildApp), este
// arquivo compartilha usuários/personagens entre os testes (via beforeAll)
// para permanecer bem abaixo desse limite, preservando a granularidade da
// matriz de testes.

let app: FastifyInstance;

type TestUser = {
  cookie: string;
  userId: string;
};

type Character = {
  id: string;
};

type Relationship = {
  id: string;
  characterAId: string;
  characterBId: string;
  dimensions: Record<string, unknown>;
};

async function createUser(
  email: string,
  name: string,
): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });

  expect(res.statusCode).toBe(200);

  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, userId: user.id };
}

async function createCharacter(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().character as Character;
}

async function createRelationship(
  user: TestUser,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: { relationship?: Relationship } }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/relationships",
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: res.json() };
}

// Identifica se uma relationship envolve dois Characters (em qualquer ordem,
// pois a ordem A/B é canônica — menor/malhor UUID).
function involves(rel: Relationship, x: string, y: string): boolean {
  const ids = new Set([rel.characterAId, rel.characterBId]);
  return ids.has(x) && ids.has(y);
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("Auth", () => {
  it("todos os endpoints → 401 sem sessão", async () => {
    const uuid = "00000000-0000-0000-0000-000000000000";
    const cases: Array<{ method: string; url: string; payload?: unknown }> = [
      { method: "GET", url: "/api/relationships" },
      { method: "POST", url: "/api/relationships", payload: {} },
      { method: "GET", url: `/api/relationships/${uuid}` },
      { method: "PATCH", url: `/api/relationships/${uuid}`, payload: { dimensions: {} } },
      { method: "DELETE", url: `/api/relationships/${uuid}` },
    ];
    for (const c of cases) {
      const res = await app.inject({
        method: c.method as "GET",
        url: c.url,
        payload: c.payload as Record<string, unknown>,
      });
      expect(res.statusCode).toBe(401);
    }
  });
});

describe("POST /api/relationships", () => {
  let u: TestUser;
  let a: Character;
  let b: Character;
  let owner: TestUser;
  let intruder: TestUser;
  let oa: Character;
  let ob: Character;
  let ib: Character;

  beforeAll(async () => {
    const suffix = Date.now();
    u = await createUser(`rel-u-${suffix}@f1nw.test`, "U");
    a = await createCharacter(u, { name: "A", nationality: "Brasileira", birthDate: "1995-01-01" });
    b = await createCharacter(u, { name: "B", nationality: "Argentina", birthDate: "1996-01-01" });

    owner = await createUser(`rel-owner-${suffix}@f1nw.test`, "Owner");
    intruder = await createUser(`rel-intru-${suffix}@f1nw.test`, "Intru");
    oa = await createCharacter(owner, { name: "OA", nationality: "Italiana", birthDate: "1990-01-01" });
    ob = await createCharacter(owner, { name: "OB", nationality: "Alemã", birthDate: "1991-01-01" });
    ib = await createCharacter(intruder, { name: "IB", nationality: "Francesa", birthDate: "1992-01-01" });
  });

  it("cria relationship válida → 201, dimensions ausente → {}", async () => {
    const { statusCode, json } = await createRelationship(u, {
      characterAId: a.id,
      characterBId: b.id,
    });
    expect(statusCode).toBe(201);
    expect(involves(json.relationship as Relationship, a.id, b.id)).toBe(true);
    const [minId, maxId] = [a.id, b.id].sort();
    expect((json.relationship as Relationship).characterAId).toBe(minId);
    expect((json.relationship as Relationship).characterBId).toBe(maxId);
    expect((json.relationship as Relationship).dimensions).toEqual({});
  });

  it("aceita dimensions como objeto JSON", async () => {
    const extra = await createCharacter(u, { name: "C", nationality: "Portuguesa", birthDate: "1997-01-01" });
    const { statusCode, json } = await createRelationship(u, {
      characterAId: a.id,
      characterBId: extra.id,
      dimensions: { amizade: 80, confianca: 50 },
    });
    expect(statusCode).toBe(201);
    expect((json.relationship as Relationship).dimensions).toEqual({ amizade: 80, confianca: 50 });
  });

  it("Character A inexistente → 404", async () => {
    const { statusCode } = await createRelationship(u, {
      characterAId: "00000000-0000-0000-0000-000000000000",
      characterBId: a.id,
    });
    expect(statusCode).toBe(404);
  });

  it("Character B inexistente → 404", async () => {
    const { statusCode } = await createRelationship(u, {
      characterAId: a.id,
      characterBId: "00000000-0000-0000-0000-000000000000",
    });
    expect(statusCode).toBe(404);
  });

  it("Character A de outro usuário → 404", async () => {
    const { statusCode } = await createRelationship(intruder, {
      characterAId: oa.id,
      characterBId: ib.id,
    });
    expect(statusCode).toBe(404);
  });

  it("Character B de outro usuário → 404", async () => {
    const { statusCode } = await createRelationship(intruder, {
      characterAId: ib.id,
      characterBId: ob.id,
    });
    expect(statusCode).toBe(404);
  });

  it("ambos de outro usuário → 404", async () => {
    const { statusCode } = await createRelationship(intruder, {
      characterAId: oa.id,
      characterBId: ob.id,
    });
    expect(statusCode).toBe(404);
  });

  it("Character com userId = null → 404", async () => {
    const aiCharacter = await prisma.character.create({
      data: { userId: null, name: "IA Global", nationality: "Global", birthDate: new Date("1990-01-01") },
      select: { id: true },
    });
    const { statusCode } = await createRelationship(u, {
      characterAId: aiCharacter.id,
      characterBId: a.id,
    });
    expect(statusCode).toBe(404);
  });

  it("A = B → 400", async () => {
    const { statusCode } = await createRelationship(u, {
      characterAId: a.id,
      characterBId: a.id,
    });
    expect(statusCode).toBe(400);
  });

  it("IDs inválidos → 400", async () => {
    const { statusCode } = await createRelationship(u, {
      characterAId: "nao-e-uuid",
      characterBId: "tambem-nao",
    });
    expect(statusCode).toBe(400);
  });

  it("duplicata (A,B) → 409", async () => {
    const d = await createCharacter(u, { name: "D", nationality: "Russa", birthDate: "1990-01-01" });
    const e = await createCharacter(u, { name: "E", nationality: "Chinesa", birthDate: "1991-01-01" });
    const first = await createRelationship(u, { characterAId: d.id, characterBId: e.id });
    expect(first.statusCode).toBe(201);
    const second = await createRelationship(u, { characterAId: d.id, characterBId: e.id });
    expect(second.statusCode).toBe(409);
  });

  it("duplicata reversa (B,A) → 409", async () => {
    const f = await createCharacter(u, { name: "F", nationality: "Indiana", birthDate: "1990-01-01" });
    const g = await createCharacter(u, { name: "G", nationality: "Japonesa", birthDate: "1991-01-01" });
    const first = await createRelationship(u, { characterAId: f.id, characterBId: g.id });
    expect(first.statusCode).toBe(201);
    const reversed = await createRelationship(u, { characterAId: g.id, characterBId: f.id });
    expect(reversed.statusCode).toBe(409);
  });

  it("ordem reversa (B,A) → 201 com par canônico persistido e leitura preservando o par", async () => {
    const j = await createCharacter(u, { name: "J", nationality: "Sul-africana", birthDate: "1987-01-01" });
    const k = await createCharacter(u, { name: "K", nationality: "Canadense", birthDate: "1986-01-01" });
    const { statusCode, json } = await createRelationship(u, {
      characterAId: k.id,
      characterBId: j.id,
    });
    expect(statusCode).toBe(201);
    const created = json.relationship as Relationship;
    const [minId, maxId] = [j.id, k.id].sort();
    expect(created.characterAId).toBe(minId);
    expect(created.characterBId).toBe(maxId);

    const read = await app.inject({
      method: "GET",
      url: `/api/relationships/${created.id}`,
      headers: { cookie: u.cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().relationship.characterAId).toBe(minId);
    expect(read.json().relationship.characterBId).toBe(maxId);

    const dup = await createRelationship(u, { characterAId: j.id, characterBId: k.id });
    expect(dup.statusCode).toBe(409);
  });

  it("concorrência (A,B) e (B,A) — apenas uma vence, a outra 409", async () => {
    const h = await createCharacter(u, { name: "H", nationality: "Coreana", birthDate: "1989-01-01" });
    const i = await createCharacter(u, { name: "I", nationality: "Turca", birthDate: "1988-01-01" });
    const [first, second] = await Promise.all([
      createRelationship(u, { characterAId: h.id, characterBId: i.id }),
      createRelationship(u, { characterAId: i.id, characterBId: h.id }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
  });
});

describe("GET /api/relationships", () => {
  let la: TestUser;
  let lb: TestUser;
  let la1Id: string;
  let la2Id: string;
  let lb1Id: string;
  let lb2Id: string;

  beforeAll(async () => {
    const suffix = Date.now();
    la = await createUser(`rel-la-${suffix}@f1nw.test`, "LA");
    lb = await createUser(`rel-lb-${suffix}@f1nw.test`, "LB");

    const la1 = await createCharacter(la, { name: "LA1", nationality: "Norueguesa", birthDate: "1990-01-01" });
    const la2 = await createCharacter(la, { name: "LA2", nationality: "Polonesa", birthDate: "1991-01-01" });
    const lb1 = await createCharacter(lb, { name: "LB1", nationality: "Suíça", birthDate: "1992-01-01" });
    const lb2 = await createCharacter(lb, { name: "LB2", nationality: "Australiana", birthDate: "1993-01-01" });
    la1Id = la1.id;
    la2Id = la2.id;
    lb1Id = lb1.id;
    lb2Id = lb2.id;

    await createRelationship(la, { characterAId: la1.id, characterBId: la2.id });
    await createRelationship(lb, { characterAId: lb1.id, characterBId: lb2.id });
  });

  it("lista somente relationships do usuário", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/relationships",
      headers: { cookie: la.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Deve conter a relationship (LA1<->LA2), em qualquer ordem canônica.
    expect(
      (body.relationships as Relationship[]).some((r) => involves(r, la1Id, la2Id)),
    ).toBe(true);
    // Nenhuma relationship de LB pode aparecer para LA.
    expect(
      (body.relationships as Relationship[]).some((r) => involves(r, lb1Id, lb2Id)),
    ).toBe(false);
  });

  it("relationship do usuário A não aparece para usuário B", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/relationships",
      headers: { cookie: lb.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // LB vê apenas a própria relationship (LB1<->LB2), não a de LA.
    expect(
      (body.relationships as Relationship[]).some((r) => involves(r, la1Id, la2Id)),
    ).toBe(false);
    expect(
      (body.relationships as Relationship[]).some((r) => involves(r, lb1Id, lb2Id)),
    ).toBe(true);
  });
});

describe("GET /api/relationships/:id", () => {
  let u: TestUser;
  let relId: string;
  let otherRelId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    u = await createUser(`rel-g-${suffix}@f1nw.test`, "G");
    const a = await createCharacter(u, { name: "GA", nationality: "Austríaca", birthDate: "1990-01-01" });
    const b = await createCharacter(u, { name: "GB", nationality: "Neozelandesa", birthDate: "1991-01-01" });
    relId = (await createRelationship(u, { characterAId: a.id, characterBId: b.id })).json.relationship!.id;

    const other = await createUser(`rel-go-${suffix}@f1nw.test`, "GO");
    const oa = await createCharacter(other, { name: "GX", nationality: "Grega", birthDate: "1990-01-01" });
    const ob = await createCharacter(other, { name: "GY", nationality: "Húngara", birthDate: "1991-01-01" });
    otherRelId = (await createRelationship(other, { characterAId: oa.id, characterBId: ob.id })).json.relationship!.id;
  });

  it("lê relationship próprio → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/relationships/${relId}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().relationship.id).toBe(relId);
  });

  it("relationship de outro usuário → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/relationships/${otherRelId}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/relationships/:id", () => {
  let u: TestUser;
  let relId: string;
  let pairA: string;
  let pairB: string;
  let otherRelId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    u = await createUser(`rel-p-${suffix}@f1nw.test`, "P");
    const a = await createCharacter(u, { name: "PA", nationality: "Tailandesa", birthDate: "1990-01-01" });
    const b = await createCharacter(u, { name: "PB", nationality: "Vietnamita", birthDate: "1991-01-01" });
    const created = (await createRelationship(u, { characterAId: a.id, characterBId: b.id, dimensions: { antigo: 1 } })).json.relationship!;
    relId = created.id;
    pairA = created.characterAId;
    pairB = created.characterBId;

    const other = await createUser(`rel-po-${suffix}@f1nw.test`, "PO");
    const oa = await createCharacter(other, { name: "PX", nationality: "Chilena", birthDate: "1990-01-01" });
    const ob = await createCharacter(other, { name: "PY", nationality: "Colombiana", birthDate: "1991-01-01" });
    otherRelId = (await createRelationship(other, { characterAId: oa.id, characterBId: ob.id })).json.relationship!.id;
  });

  it("edita dimensions → 200 e preserva A/B", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/relationships/${relId}`,
      headers: { cookie: u.cookie },
      payload: { dimensions: { novo: 99 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().relationship.dimensions).toEqual({ novo: 99 });
    // A/B (ordem canônica) preservado após o PATCH.
    expect(res.json().relationship.characterAId).toBe(pairA);
    expect(res.json().relationship.characterBId).toBe(pairB);
  });

  it("PATCH de outro usuário → 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/relationships/${otherRelId}`,
      headers: { cookie: u.cookie },
      payload: { dimensions: { hack: true } },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/relationships/:id", () => {
  let u: TestUser;
  let relId: string;
  let otherRelId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    u = await createUser(`rel-d-${suffix}@f1nw.test`, "D");
    const a = await createCharacter(u, { name: "DA", nationality: "Marroquina", birthDate: "1990-01-01" });
    const b = await createCharacter(u, { name: "DB", nationality: "Egípcia", birthDate: "1991-01-01" });
    relId = (await createRelationship(u, { characterAId: a.id, characterBId: b.id })).json.relationship!.id;

    const other = await createUser(`rel-do-${suffix}@f1nw.test`, "DO");
    const oa = await createCharacter(other, { name: "DX", nationality: "Romena", birthDate: "1990-01-01" });
    const ob = await createCharacter(other, { name: "DY", nationality: "Búlgara", birthDate: "1991-01-01" });
    otherRelId = (await createRelationship(other, { characterAId: oa.id, characterBId: ob.id })).json.relationship!.id;
  });

  it("exclui relationship próprio → 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/relationships/${relId}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(204);
    const gone = await prisma.relationship.findUnique({ where: { id: relId } });
    expect(gone).toBeNull();
  });

  it("DELETE de outro usuário → 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/relationships/${otherRelId}`,
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
