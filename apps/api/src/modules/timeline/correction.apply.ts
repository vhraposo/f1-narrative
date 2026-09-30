import type { TimelineEvent } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { invalidatePilotExperienceForCorrection } from "../pilot-experience/pilot-experience.reconcile.js";
import {
  applyCorrectionWithinTransaction,
  type CorrectionCommand,
} from "./correction.service.js";
import {
  buildCorrectionPreviewToken,
  resolveCorrectionSeasonId,
} from "./correction.preview.js";
import { lockUniverseTimeline, TimelineError } from "./timeline.service.js";

export async function applyCorrection(
  universeId: string,
  command: CorrectionCommand,
  previewToken: string,
): Promise<TimelineEvent> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);

    const seasonId = await resolveCorrectionSeasonId(tx, universeId, command);
    const currentToken = await buildCorrectionPreviewToken(
      tx,
      universeId,
      command,
      seasonId,
    );
    if (currentToken !== previewToken) {
      throw new TimelineError(
        "PREVIEW_STALE",
        "O estado do universo mudou desde o preview; gere um novo preview.",
        409,
      );
    }

    const event = await applyCorrectionWithinTransaction(tx, universeId, command);

    if (
      command.kind === "RACE_RESULT_CORRECTED" ||
      command.kind === "RACE_SESSION_RESULT_CORRECTED"
    ) {
      await invalidatePilotExperienceForCorrection(
        tx,
        universeId,
        { raceId: command.raceId, seasonId },
        "resultado corrigido pela Timeline",
      );
    } else if (command.kind === "STANDING_CORRECTED") {
      await invalidatePilotExperienceForCorrection(
        tx,
        universeId,
        { seasonId },
        "classificação corrigida pela Timeline",
      );
    }

    const persisted = await tx.timelineEvent.findUnique({
      where: { id: event.id },
      select: { id: true, sequence: true, kind: true, supersedesId: true },
    });
    if (!persisted || persisted.kind !== event.kind) {
      throw new TimelineError(
        "INVARIANT_VIOLATION",
        "A correção não foi persistida corretamente.",
        500,
      );
    }

    return event;
  });
}
