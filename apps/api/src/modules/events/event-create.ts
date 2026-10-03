import { Prisma, type CanonSource, type EventImportance, type EventType, type EventVisibility } from "@prisma/client";

import { applyEventEvolution } from "./event-evolution.js";
import { syncNewsForEvent } from "./news.js";

export type CreateEventData = {
  type: EventType;
  title: string;
  description?: string | null;
  importance?: EventImportance;
  source?: CanonSource;
  visibility?: EventVisibility;
  worldDate?: Date | string | null;
  payload?: Prisma.InputJsonValue | null | undefined;
  createdById?: string | null;
};

export async function createEventWithDerivations(
  client: Prisma.TransactionClient,
  data: CreateEventData,
  participantIds: string[] = [],
): Promise<{ id: string }> {
  const created = await client.event.create({
    data: {
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      ...(data.importance !== undefined ? { importance: data.importance } : {}),
      ...(data.source !== undefined ? { source: data.source } : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      worldDate: data.worldDate ?? null,
      payload:
        data.payload === undefined || data.payload === null
          ? Prisma.DbNull
          : data.payload,
      createdById: data.createdById ?? null,
    },
    select: { id: true },
  });

  if (participantIds.length > 0) {
    await client.eventCharacter.createMany({
      data: participantIds.map((characterId) => ({
        eventId: created.id,
        characterId,
      })),
      skipDuplicates: true,
    });
  }

  await syncNewsForEvent(client, created.id);
  await applyEventEvolution(client, created.id);
  return created;
}
