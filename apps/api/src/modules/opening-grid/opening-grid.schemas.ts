import { z } from "zod";
import { OPENING_GRID_SOURCE } from "./opening-grid.source.js";

export const openingGridIngestParamsSchema = z.object({
  source: z.literal(OPENING_GRID_SOURCE),
});

export const openingGridIngestBodySchema = z
  .object({
    seasonYear: z.number().int().min(1950).max(2100),
  })
  .strict();