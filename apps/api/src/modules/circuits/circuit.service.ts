import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export async function ensureCircuitForUniverse(
  tx: Tx,
  universeId: string,
  externalCircuitId: string,
): Promise<string> {
  const binding = await tx.externalBindingCircuit.findUnique({
    where: {
      universeId_externalCircuitId: { universeId, externalCircuitId },
    },
    select: { circuitId: true },
  });
  if (binding) return binding.circuitId;

  const external = await tx.externalCircuit.findUniqueOrThrow({
    where: { id: externalCircuitId },
  });

  const existing = await tx.circuit.findFirst({
    where: { universeId, name: external.name },
    select: { id: true },
  });

  const circuitId =
    existing?.id ??
    (
      await tx.circuit.create({
        data: {
          universeId,
          name: external.name,
          locality: external.locality,
          country: external.country,
          latitude: external.latitude,
          longitude: external.longitude,
          lengthMeters: external.lengthMeters,
          turns: external.turns,
          direction: external.direction,
          layoutKey: external.layoutKey,
          provenance: "IMPORTED",
        },
        select: { id: true },
      })
    ).id;

  await tx.externalBindingCircuit.create({
    data: {
      universeId,
      externalCircuitId,
      circuitId,
      confidence: "CONFIRMED",
      boundBy: null,
    },
  });

  return circuitId;
}
