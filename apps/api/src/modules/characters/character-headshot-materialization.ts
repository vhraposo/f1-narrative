import { prisma } from "../../infrastructure/database/prisma.js";
import { normalizeF1HeadshotUrl } from "../external-openf1/openf1.images.js";

export interface CharacterHeadshotMaterializationReport {
  considered: number;
  charactersUpdated: number;
  charactersPreserved: number;
  charactersWithoutHeadshot: number;
  durationMs: number;
}

export class CharacterHeadshotMaterializationService {
  async materialize(): Promise<CharacterHeadshotMaterializationReport> {
    const startedAt = Date.now();

    const bindings = await prisma.externalBindingDriver.findMany({
      select: {
        characterId: true,
        character: { select: { imageUrl: true } },
        externalDriver: { select: { headshotUrl: true } },
      },
    });

    let charactersUpdated = 0;
    let charactersPreserved = 0;
    let charactersWithoutHeadshot = 0;

    for (const binding of bindings) {
      const headshotUrl = binding.externalDriver.headshotUrl;
      if (headshotUrl == null) {
        charactersWithoutHeadshot += 1;
        continue;
      }
      const currentImageUrl = binding.character.imageUrl;
      const targetImageUrl = normalizeF1HeadshotUrl(headshotUrl) as string;
      if (
        currentImageUrl !== null &&
        currentImageUrl !== "" &&
        currentImageUrl !== headshotUrl
      ) {
        charactersPreserved += 1;
        continue;
      }
      if (currentImageUrl === targetImageUrl) {
        charactersPreserved += 1;
        continue;
      }
      await prisma.character.update({
        where: { id: binding.characterId },
        data: { imageUrl: targetImageUrl },
      });
      charactersUpdated += 1;
    }

    return {
      considered: bindings.length,
      charactersUpdated,
      charactersPreserved,
      charactersWithoutHeadshot,
      durationMs: Date.now() - startedAt,
    };
  }
}