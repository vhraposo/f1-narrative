import { z } from "zod";

// Esquemas de validação para o domínio de Campeonato (Season / Race /
// RaceResult / ChampionshipStanding).
//
// Season e Race são entidades globais compartilhadas (sem userId) — qualquer
// usuário autenticado pode consultá-las e gerenciá-las.
// RaceResult e ChampionshipStanding têm ownership indireta via
// DriverProfile -> Character -> userId; o cliente nunca controla
// owner/ids de ownership/createdAt/updatedAt.

export const seasonStatusSchema = z.enum(["PRE_SEASON", "ACTIVE", "FINISHED"]);
export const raceStatusSchema = z.enum([
  "UPCOMING",
  "QUALIFYING",
  "RACE",
  "FINISHED",
]);

const YEAR_MIN = 1950;
const YEAR_MAX = 2100;

export const createSeasonSchema = z.object({
  year: z
    .number()
    .int("O ano precisa ser um inteiro")
    .min(YEAR_MIN, `Ano fora da faixa (${YEAR_MIN}-${YEAR_MAX})`)
    .max(YEAR_MAX, `Ano fora da faixa (${YEAR_MIN}-${YEAR_MAX})`),
  name: z
    .string()
    .trim()
    .max(120, "Nome muito longo (máx. 120 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  status: seasonStatusSchema.optional(),
});

export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;

export const updateSeasonSchema = createSeasonSchema
  .pick({ name: true, status: true })
  .partial();

export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;

export const seasonIdParamsSchema = z.object({
  id: z.string().uuid("Identificador de temporada inválido"),
});
export const seasonIdPathParamsSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
});

export const createRaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da corrida")
    .max(120, "Nome muito longo (máx. 120 caracteres)"),
  circuit: z
    .string()
    .trim()
    .max(120, "Circuito muito longo (máx. 120 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  country: z
    .string()
    .trim()
    .max(80, "País muito longo (máx. 80 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  date: z.string().datetime({ offset: true }).optional().nullable(),
  round: z
    .number()
    .int("A rodada precisa ser um inteiro")
    .min(1, "Rodada deve ser maior que zero")
    .optional()
    .nullable(),
  status: raceStatusSchema.optional(),
});

export type CreateRaceInput = z.infer<typeof createRaceSchema>;

export const updateRaceSchema = createRaceSchema.partial();

export type UpdateRaceInput = z.infer<typeof updateRaceSchema>;

export const raceParamsSchema = z.object({
  id: z.string().uuid("Identificador de corrida inválido"),
});
export const raceIdPathParamsSchema = z.object({
  raceId: z.string().uuid("Identificador de corrida inválido"),
});

export const createRaceResultSchema = z.object({
  driverProfileId: z.string().uuid("Identificador de piloto inválido"),
  position: z
    .number()
    .int("A posição precisa ser um inteiro")
    .min(1, "Posição deve ser maior que zero")
    .optional()
    .nullable(),
  points: z
    .number()
    .min(0, "Pontos não podem ser negativos")
    .optional()
    .default(0),
  grid: z
    .number()
    .int("A posição de largada precisa ser um inteiro")
    .min(1, "Posição de largada deve ser maior que zero")
    .optional()
    .nullable(),
  fastestLap: z.boolean().optional().default(false),
  status: z
    .string()
    .trim()
    .max(40, "Status muito longo (máx. 40 caracteres)")
    .optional()
    .nullable(),
});

export type CreateRaceResultInput = z.infer<typeof createRaceResultSchema>;

export const updateRaceResultSchema = createRaceResultSchema.partial();

export type UpdateRaceResultInput = z.infer<typeof updateRaceResultSchema>;

export const raceResultParamsSchema = z.object({
  id: z.string().uuid("Identificador de resultado inválido"),
});

export const createStandingSchema = z.object({
  driverProfileId: z.string().uuid("Identificador de piloto inválido"),
  points: z.number().min(0, "Pontos não podem ser negativos").optional().default(0),
  position: z
    .number()
    .int("A posição precisa ser um inteiro")
    .min(1, "Posição deve ser maior que zero")
    .optional()
    .nullable(),
  wins: z.number().int("Vitórias precisam ser inteiro").min(0).optional().default(0),
  podiums: z
    .number()
    .int("Pódios precisam ser inteiro")
    .min(0)
    .optional()
    .default(0),
});

export type CreateStandingInput = z.infer<typeof createStandingSchema>;

export const updateStandingSchema = createStandingSchema.partial();

export type UpdateStandingInput = z.infer<typeof updateStandingSchema>;

export const standingParamsSchema = z.object({
  id: z.string().uuid("Identificador de classificação inválido"),
});
