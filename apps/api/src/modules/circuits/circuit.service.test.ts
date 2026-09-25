import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureCircuitForUniverse } from "./circuit.service.js";

const RUN = Date.now().toString(36);
const EXT_ID = `circuit-svc-${RUN}`;

let userId1 = "";
let userId2 = "";
let universeId1 = "";
let universeId2 = "";
let externalCircuitId = "";

beforeAll(async () => {
  const u1 = await prisma.user.create({
    data: {
      email: `circuit-a-${RUN}@f1nw.test`,
      name: "Circuit A",
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  const u2 = await prisma.user.create({
    data: {
      email: `circuit-b-${RUN}@f1nw.test`,
      name: "Circuit B",
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  userId1 = u1.id;
  userId2 = u2.id;

  const universe1 = await prisma.universe.create({
    data: { userId: userId1, status: "READY" },
    select: { id: true },
  });
  const universe2 = await prisma.universe.create({
    data: { userId: userId2, status: "READY" },
    select: { id: true },
  });
  universeId1 = universe1.id;
  universeId2 = universe2.id;

  const external = await prisma.externalCircuit.create({
    data: {
      source: "jolpica",
      externalId: EXT_ID,
      name: `Circuito Svc ${RUN}`,
      locality: "São Paulo",
      country: "Brazil",
      latitude: -23.7036,
      longitude: -46.6997,
      contentHash: `ch-${RUN}`,
    },
    select: { id: true },
  });
  externalCircuitId = external.id;
});

afterAll(async () => {
  await prisma.externalCircuit.deleteMany({ where: { id: externalCircuitId } });
  await prisma.universe.deleteMany({
    where: { userId: { in: [userId1, userId2] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId1, userId2] } },
  });
  await prisma.$disconnect();
});

describe("ensureCircuitForUniverse", () => {
  it("materializa o circuito do universo de forma idempotente", async () => {
    const first = await prisma.$transaction((tx) =>
      ensureCircuitForUniverse(tx, universeId1, externalCircuitId),
    );
    const second = await prisma.$transaction((tx) =>
      ensureCircuitForUniverse(tx, universeId1, externalCircuitId),
    );
    expect(second).toBe(first);

    const circuits = await prisma.circuit.count({
      where: { universeId: universeId1 },
    });
    expect(circuits).toBe(1);

    const bindings = await prisma.externalBindingCircuit.count({
      where: { universeId: universeId1, externalCircuitId },
    });
    expect(bindings).toBe(1);

    const circuit = await prisma.circuit.findUniqueOrThrow({
      where: { id: first },
      select: { name: true, country: true, universeId: true },
    });
    expect(circuit.name).toBe(`Circuito Svc ${RUN}`);
    expect(circuit.country).toBe("Brazil");
    expect(circuit.universeId).toBe(universeId1);
  });

  it("isola universos: o mesmo circuito externo gera Circuit próprio em cada Universe", async () => {
    const a = await prisma.$transaction((tx) =>
      ensureCircuitForUniverse(tx, universeId1, externalCircuitId),
    );
    const b = await prisma.$transaction((tx) =>
      ensureCircuitForUniverse(tx, universeId2, externalCircuitId),
    );
    expect(a).not.toBe(b);

    const forB = await prisma.circuit.findUniqueOrThrow({
      where: { id: b },
      select: { universeId: true, name: true },
    });
    expect(forB.universeId).toBe(universeId2);
    expect(forB.name).toBe(`Circuito Svc ${RUN}`);
  });
});
