import type { PrismaClient } from "@prisma/client";

// Catálogo oficial de AI Characters (dados de sistema, userId = null). IDs
// estáveis garantem identidade determinística entre ambientes e seed
// idempotente via upsert, sem depender de unique constraints novas.
export const aiCatalog = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Luca Moretti",
    nationality: "Italiana",
    birthDate: "1991-03-14T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Mia Sorensen",
    nationality: "Sueca",
    birthDate: "1994-07-02T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Ravi Chandra",
    nationality: "Indiana",
    birthDate: "1988-11-23T00:00:00.000Z",
  },
] as const;

type AICatalogSyncClient = Pick<PrismaClient, "character">;

// Sincroniza o catálogo via upsert pelo id estável: repetições não criam
// duplicatas e o estado do AI Character permanece determinístico.
export async function syncAiCatalog(
  client: AICatalogSyncClient,
): Promise<number> {
  for (const c of aiCatalog) {
    await client.character.upsert({
      where: { id: c.id },
      update: {
        name: c.name,
        nationality: c.nationality,
        birthDate: new Date(c.birthDate),
        controlledBy: "AI",
        userId: null,
      },
      create: {
        id: c.id,
        name: c.name,
        nationality: c.nationality,
        birthDate: new Date(c.birthDate),
        controlledBy: "AI",
        userId: null,
      },
    });
  }
  return aiCatalog.length;
}