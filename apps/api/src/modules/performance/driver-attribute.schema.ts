import { z } from "zod";
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN } from "./driver-attribute.js";

const attributeValueSchema = z
  .number()
  .min(ATTRIBUTE_MIN)
  .max(ATTRIBUTE_MAX);

export const setDriverAttributesSchema = z.object({
  speed: attributeValueSchema,
  consistency: attributeValueSchema,
  racecraft: attributeValueSchema,
  aggression: attributeValueSchema,
});

export type SetDriverAttributesInput = z.infer<
  typeof setDriverAttributesSchema
>;

export const driverAttributesParamsSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  characterId: z.string().uuid("Identificador de personagem inválido"),
});