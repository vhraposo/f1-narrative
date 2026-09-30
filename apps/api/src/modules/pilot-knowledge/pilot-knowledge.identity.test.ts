import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  canonicalCandidateHash,
  ensureExternalDriverForProvider,
  identityMatchScore,
  normalizeIdentityName,
  requireResolvedIdentity,
  resolveExternalDriverIdentity,
} from "./pilot-knowledge.identity.js";

const PREFIX = "pk-id";
const createdDriverIds: string[] = [];

async function createDriver(input: {
  externalId: string;
  name: string;
  fullName?: string;
  nationality?: string;
  number?: number;
  dateOfBirth?: string;
  wikidataQid?: string;
  f1dbDriverId?: string;
}) {
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${input.externalId}`,
      name: input.name,
      fullName: input.fullName ?? null,
      nationality: input.nationality ?? null,
      number: input.number ?? null,
      contentHash: `hash-${input.externalId}`,
      knowledgeProfile:
        input.dateOfBirth || input.wikidataQid || input.f1dbDriverId
          ? {
              create: {
                dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
                wikidataQid: input.wikidataQid ?? null,
                f1dbDriverId: input.f1dbDriverId ?? null,
              },
            }
          : undefined,
    },
  });
  createdDriverIds.push(driver.id);
  return driver;
}

afterAll(async () => {
  if (createdDriverIds.length > 0) {
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  await prisma.$disconnect();
});

describe("pilot knowledge identity resolution", () => {
  it("1) normaliza nomes e pontua por match exato/contido/tokens", () => {
    expect(normalizeIdentityName("Max  VERSTAPPEN-Júnior")).toBe("max verstappen junior");
    const driver = { name: "Max Verstappen", fullName: "Max Emilian Verstappen", nationality: "NED", number: 33 };
    expect(identityMatchScore({ name: "Max Verstappen" }, driver, null)).toBe(1);
    expect(identityMatchScore({ name: "max verstappen", nationality: "NED", number: 33 }, driver, null)).toBeCloseTo(1.2, 5);
    expect(identityMatchScore({ name: "Piloto Fantasma" }, driver, null)).toBeLessThan(0.75);
  });

  it("2) resolve por nome único e por nacionalidade+número", async () => {
    const max = await createDriver({
      externalId: "max",
      name: "Max Verstappen",
      fullName: "Max Emilian Verstappen",
      nationality: "NED",
      number: 33,
    });
    const byName = await resolveExternalDriverIdentity(
      { name: "Max Verstappen" },
      { provider: "F1DB" },
    );
    expect(byName).toMatchObject({ kind: "RESOLVED", driverId: max.id, basis: "NAME_ONLY" });

    const byFacts = await resolveExternalDriverIdentity(
      { name: "Max Verstappen", nationality: "NED", number: 33 },
      { provider: "F1DB" },
    );
    expect(byFacts).toMatchObject({ kind: "RESOLVED", driverId: max.id, basis: "NAME_NATIONALITY" });
  });

  it("3) fast path por provider id e por Wikidata QID", async () => {
    const lando = await createDriver({
      externalId: "lando",
      name: "Lando Norris",
      nationality: "GBR",
      number: 4,
      wikidataQid: "Q30000",
    });
    const byProviderId = await resolveExternalDriverIdentity(
      { name: "Lando Norris" },
      { provider: "F1DB", externalId: `${PREFIX}-lando` },
    );
    expect(byProviderId).toMatchObject({ kind: "RESOLVED", driverId: lando.id, basis: "PROVIDER_ID" });

    const byQid = await resolveExternalDriverIdentity(
      { name: "Lando Norris", wikidataQid: "Q30000" },
      { provider: "WIKIDATA" },
    );
    expect(byQid).toMatchObject({ kind: "RESOLVED", driverId: lando.id, basis: "WIKIDATA_QID" });
  });

  it("4) colisão Sainz/Sainz Jr. exige desambiguação", async () => {
    await createDriver({
      externalId: "sainz",
      name: "Carlos Sainz",
      fullName: "Carlos Sainz Cenamor",
      nationality: "ESP",
    });
    const jr = await createDriver({
      externalId: "sainz-jr",
      name: "Carlos Sainz Jr.",
      fullName: "Carlos Sainz Vázquez de Castro",
      nationality: "ESP",
      number: 55,
      dateOfBirth: "1994-09-01",
    });

    const ambiguous = await resolveExternalDriverIdentity(
      { name: "Carlos Sainz" },
      { provider: "F1DB" },
    );
    expect(ambiguous.kind).toBe("AMBIGUOUS_IDENTITY");
    if (ambiguous.kind !== "AMBIGUOUS_IDENTITY") throw new Error("unreachable");
    expect(ambiguous.candidates.length).toBeGreaterThanOrEqual(2);

    const resolved = await resolveExternalDriverIdentity(
      { name: "Carlos Sainz", dateOfBirth: new Date("1994-09-01T00:00:00.000Z") },
      { provider: "F1DB" },
    );
    expect(resolved).toMatchObject({ kind: "RESOLVED", driverId: jr.id });

    const byProviderId = await resolveExternalDriverIdentity(
      { name: "Carlos Sainz" },
      { provider: "F1DB", externalId: `${PREFIX}-sainz-jr` },
    );
    expect(byProviderId).toMatchObject({ kind: "RESOLVED", driverId: jr.id, basis: "PROVIDER_ID" });
  });

  it("5) piloto histórico sem número resolve por nome completo distinto", async () => {
    const historical = await createDriver({
      externalId: "fangio",
      name: "Juan Manuel Fangio",
      fullName: "Juan Manuel Fangio",
      nationality: "ARG",
    });
    const resolved = await resolveExternalDriverIdentity(
      { name: "Juan Manuel Fangio" },
      { provider: "F1DB" },
    );
    expect(resolved).toMatchObject({ kind: "RESOLVED", driverId: historical.id });
  });

  it("6) piloto inexistente não é inventado", async () => {
    const result = await resolveExternalDriverIdentity(
      { name: "Nenhum Piloto Aqui" },
      { provider: "F1DB" },
    );
    expect(result.kind).toBe("NOT_FOUND");
    expect(() => requireResolvedIdentity(result)).toThrow(/Nenhum piloto/);
  });

  it("7) ensureExternalDriverForProvider cria e reusa sem duplicar", async () => {
    const candidate = {
      externalId: `${PREFIX}-new-driver`,
      name: "Novo Piloto",
      fullName: "Novo Piloto da Silva",
      nationality: "BRA",
      number: 99,
      dateOfBirth: new Date("2001-05-05T00:00:00.000Z"),
      f1dbDriverId: `${PREFIX}-new-driver`,
    };
    const first = await ensureExternalDriverForProvider("F1DB", candidate);
    createdDriverIds.push(first.id);
    expect(first.source).toBe("f1db");
    expect(first.contentHash).toBe(canonicalCandidateHash(candidate));
    expect(JSON.stringify(first.sourceRecord)).not.toContain("content");

    const second = await ensureExternalDriverForProvider("F1DB", candidate, new Date(Date.now() + 1000));
    expect(second.id).toBe(first.id);
    const count = await prisma.externalDriver.count({
      where: { source: "f1db", externalId: candidate.externalId },
    });
    expect(count).toBe(1);
  });

  it("8) identidade ambígua exige confirmação", () => {
    const ambiguous = {
      kind: "AMBIGUOUS_IDENTITY" as const,
      candidates: [{ driverId: "a", name: "A", score: 0.9 }],
    };
    expect(() => requireResolvedIdentity(ambiguous)).toThrow(/ambígua/i);
    expect(requireResolvedIdentity({ kind: "RESOLVED", driverId: "x", basis: "NAME_ONLY", score: 1 })).toEqual({
      driverId: "x",
      basis: "NAME_ONLY",
      score: 1,
    });
  });
});
