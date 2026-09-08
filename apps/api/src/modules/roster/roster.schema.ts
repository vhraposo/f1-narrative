import { z } from "zod";

// Esquemas de validação para o domínio de Roster (escalação por temporada).
// Season/DriverProfile/Team são validados por UUID; a existência e a
// propriedade são verificadas no serviço (Team e DriverProfile são do usuário
// autenticado; Season é global).

export const seasonIdParamSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
});

export const driverRoleSchema = z.enum(["RACE_SEAT", "RESERVE"]);

export const seatSchema = z.union([z.literal(1), z.literal(2)]);

export const numberSchema = z
  .number()
  .int("Número deve ser inteiro")
  .min(1, "Número mínimo 1")
  .max(99, "Número máximo 99");

export const assignDriverSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  teamId: z.string().uuid("Identificador de equipe inválido"),
  driverProfileId: z.string().uuid("Identificador de piloto inválido"),
  seat: seatSchema,
  number: numberSchema.optional().nullable(),
});

export const teamDriverSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  teamId: z.string().uuid("Identificador de equipe inválido"),
  driverProfileId: z.string().uuid("Identificador de piloto inválido"),
});

export const hireDriverSchema = z
  .object({
    seasonId: z.string().uuid("Identificador de temporada inválido"),
    teamId: z.string().uuid("Identificador de equipe inválido"),
    driverProfileId: z.string().uuid("Identificador de piloto inválido"),
    role: driverRoleSchema,
    seat: seatSchema.optional().nullable(),
    number: numberSchema.optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "RACE_SEAT" && data.seat == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seat"],
        message: "Assento é obrigatório para contratação como titular",
      });
    }
  });

export const promoteDriverSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  teamId: z.string().uuid("Identificador de equipe inválido"),
  driverProfileId: z.string().uuid("Identificador de piloto inválido"),
  seat: seatSchema,
  number: numberSchema.optional().nullable(),
});

export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type TeamDriverInput = z.infer<typeof teamDriverSchema>;
export type HireDriverInput = z.infer<typeof hireDriverSchema>;
export type PromoteDriverInput = z.infer<typeof promoteDriverSchema>;