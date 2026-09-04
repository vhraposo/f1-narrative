import type { Prisma } from "@prisma/client";
import type { CanonSource, EventImportance, EventType } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";

// Geração determinística de NewsItem a partir de um Event.
//
// NewsItem é derived/read-only nesta fase: não há CRUD manual de notícia.
// buildNewsFromEvent é pura e determinística — dado o mesmo Event + os mesmos
// participantes, produz exatamente a mesma notícia. Não usa random, hora
// atual, estado externo nem chamadas de rede.
//
// A unicidade "uma notícia por Event" não é garantida por constraint no banco
// (NewsItem.eventId NÃO possui @unique). Para evitar duplicidade sem alterar o
// schema, usamos um advisory lock do PostgreSQL por evento dentro de uma
// transação: operações que sincronizam a notícia do MESMO evento ficam
// serializadas, então a segunda sempre atualiza a notícia criada pela primeira.

const eventTypeLabels: Record<EventType, string> = {
  RACE: "Corrida",
  RACE_INCIDENT: "Incidente de Corrida",
  RELATIONSHIP: "Relacionamento",
  SOCIAL: "Social",
  PERSONAL: "Pessoal",
  NEWS: "Notícia",
  WORLD: "Mundo",
};

const importanceLabels: Record<EventImportance, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export type NewsSourceEvent = {
  type: EventType;
  title: string;
  importance: EventImportance;
  description: string | null;
  worldDate: Date | null;
};

export type NewsDraft = {
  title: string;
  body: string;
};

// Contrato determinístico de conteúdo.
export function buildNewsFromEvent(
  event: NewsSourceEvent,
  participantNames: string[],
): NewsDraft {
  const typeLabel = eventTypeLabels[event.type];
  const title = `[${typeLabel}] — ${event.title}`;

  const lines: string[] = [
    `Título: ${event.title}`,
    `Tipo: ${typeLabel}`,
    `Importância: ${importanceLabels[event.importance]}`,
  ];
  if (event.worldDate) {
    lines.push(`Data: ${event.worldDate.toISOString().slice(0, 10)}`);
  }
  if (event.description) {
    lines.push(`Descrição: ${event.description}`);
  }

  // Participantes ordenados por nome, de forma determinística. Sem
  // participantes, a linha simplesmente não existe.
  const names = [...participantNames].sort((a, b) => a.localeCompare(b));
  if (names.length > 0) {
    lines.push(`Participantes: ${names.join(", ")}`);
  }

  return { title, body: lines.join("\n") };
}

// Sincroniza (cria ou regenera) a notícia de um Event de forma idempotente.
// Atualização do Event regenera a MESMA notícia; nunca cria uma segunda.
//
// `client` é o cliente transacional onde a operação roda. Exigir um
// transaction client permite que a notícia seja sincronizada DENTRO da mesma
// transação da escrita do Event/participante, garantindo a consistência
// "Event + News derivada" após create/update (sem schema alterado).
export async function syncNewsForEvent(
  client: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  // Serializa operações sobre o mesmo evento (sem schema alterado).
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId})::bigint)`;

  const event = await client.event.findUnique({
    where: { id: eventId },
    select: {
      type: true,
      title: true,
      importance: true,
      description: true,
      worldDate: true,
    },
  });
  if (!event) {
    return;
  }

  const eventCharacters = await client.eventCharacter.findMany({
    where: { eventId },
    select: { character: { select: { name: true } } },
  });
  const names = eventCharacters.map((ec) => ec.character.name);

  const draft = buildNewsFromEvent(event, names);

  const existing = await client.newsItem.findFirst({
    where: { eventId },
    select: { id: true },
  });

  const data = {
    eventId,
    title: draft.title,
    body: draft.body,
    source: "GENERATED_EVENT" as CanonSource,
    worldDate: event.worldDate,
  };

  if (existing) {
    await client.newsItem.update({ where: { id: existing.id }, data });
  } else {
    await client.newsItem.create({ data });
  }
}