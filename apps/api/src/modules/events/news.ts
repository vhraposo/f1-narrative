import type { Prisma } from "@prisma/client";
import type { CanonSource, EventImportance, EventType } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";


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

  const names = [...participantNames].sort((a, b) => a.localeCompare(b));
  if (names.length > 0) {
    lines.push(`Participantes: ${names.join(", ")}`);
  }

  return { title, body: lines.join("\n") };
}

export async function syncNewsForEvent(
  client: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
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