import { z } from "zod";

// Esquemas de validação para o domínio de WorldState (Estado do mundo).
//
// WorldState é uma entidade GLOBAL e SINGLETON (sem userId, sem cópia por
// usuário): o schema o identifica unicamente pelo campo `key`
// (@unique @default("default")). Não existe crição manual de um segundo
// estado paralelo.
//
// currentSeasonId / currentRaceId são referências ESCALARES (sem @relation)
// a Season e Race — o vínculo é validado pelo servidor no PATCH; não há FK
// no banco. currentSession usa o enum RaceSession real (PRACTICE/QUALIFYING/RACE).
//
// Nesta fase NÃO introduzimos regras de calendário, avanço automático de
// data, transição de sessão ou consistência complexa entre season/race:
// apenas os campos que existem no modelo Prisma.

export const raceSessionSchema = z.enum(["PRACTICE", "QUALIFYING", "RACE"]);

// Campos aceitos na atualização do WorldState (todos opcionais — PATCH).
// O cliente nunca controla id/key/createdAt/updatedAt.
export const updateWorldSchema = z.object({
  currentDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .refine((value) => value !== "", {
      message: "Data inválida",
    }),
  currentSeasonId: z
    .string()
    .uuid("Identificador de temporada inválido")
    .optional()
    .nullable(),
  currentRaceId: z
    .string()
    .uuid("Identificador de corrida inválido")
    .optional()
    .nullable(),
  currentSession: raceSessionSchema.optional().nullable(),
});

export type UpdateWorldInput = z.infer<typeof updateWorldSchema>;