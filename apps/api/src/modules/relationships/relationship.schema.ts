import { z } from "zod";

// Esquemas de validação para o CRUD de Relationship.
// ownership é derivado exclusivamente do servidor (request.user.id) através
// dos dois Characters: uma Relationship pertence ao usuário somente quando
// AMBOS os Characters (A e B) pertencem a ele.
//
// characterAId/characterBId são definidos apenas no POST. No PATCH, somente
// `dimensions` é mutável — os extremos A/B não podem ser alterados após a
// criação. Cliente NUNCA controla id/createdAt/updatedAt/ownership.

// dimensions é um objeto JSON livre. Não inventamos aqui uma estrutura
// narrativa rígida: o Prisma armazena como Json. Aceitamos qualquer objeto
// JSON serializável (não nulo, não array, não primitivo).
const dimensionsSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => value !== undefined && value !== null, {
    message: "Dimensões devem ser um objeto JSON",
  });

export const createRelationshipSchema = z
  .object({
    characterAId: z.string().uuid("Identificador de personagem A inválido"),
    characterBId: z.string().uuid("Identificador de personagem B inválido"),
    dimensions: dimensionsSchema.optional(),
  })
  .refine((value) => value.characterAId !== value.characterBId, {
    message: "Os personagens A e B devem ser diferentes",
    path: ["characterBId"],
  });

export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;

// PATCH: somente dimensions é editável.
export const updateRelationshipSchema = z.object({
  dimensions: dimensionsSchema,
});

export type UpdateRelationshipInput = z.infer<typeof updateRelationshipSchema>;

export const relationshipIdParamsSchema = z.object({
  id: z.string().uuid("Identificador de relacionamento inválido"),
});
