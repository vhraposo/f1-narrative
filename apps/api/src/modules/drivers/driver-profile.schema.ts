import { z } from "zod";

// Esquemas de validação para o PUT de DriverProfile (Gestão de Pilotos).
// O Client pode controlar `teamId` (vinculação Team <-> piloto, opcional),
// mas NUNCA controla userId/characterId/controlledBy:
// - ownership deriva do Character vinculado (request.user.id no servidor);
// - a Team informada em teamId é validada pelo servidor contra o usuário autenticado.
//
// Semântica de teamId no PUT:
// - omitido      -> não altera a Team atual (preserva);
// - null         -> remove a vinculação;
// - "<uuid>"     -> define/troca a vinculação.

export const upsertDriverSchema = z.object({
  number: z
    .number()
    .int("O número precisa ser um inteiro")
    .min(2, "O número precisa ser entre 2 e 99")
    .max(99, "O número precisa ser entre 2 e 99")
    .nullable()
    .optional(),
  teamId: z
    .string()
    .uuid("Identificador de equipe inválido")
    .nullable()
    .optional(),
});

export type UpsertDriverInput = z.infer<typeof upsertDriverSchema>;

export const driverCharacterIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});
