"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreatePlayerEntry,
  usePlayerEntrySetup,
} from "@/hooks/use-player-entry";
import {
  formatSeatLabel,
  type PlayerEntryCreateInput,
  type PlayerEntryCreateResult,
  type PlayerEntrySeason,
  type PlayerEntrySeat,
  type PlayerEntryTeam,
} from "@/lib/player-entry";
import { cn } from "@/lib/utils";

const pilotSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome")
    .max(120, "Nome muito longo (máx. 120 caracteres)"),
  nationality: z
    .string()
    .trim()
    .min(1, "Informe a nacionalidade")
    .max(80, "Nacionalidade muito longa (máx. 80 caracteres)"),
  gender: z
    .string()
    .trim()
    .max(40, "Gênero muito longo (máx. 40 caracteres)")
    .optional(),
  birthDate: z
    .string()
    .min(1, "Informe a data de nascimento")
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Data de nascimento inválida",
    })
    .refine(
      (value) => new Date(value).getTime() <= Date.now() + 24 * 60 * 60 * 1000,
      { message: "A data de nascimento não pode estar no futuro" },
    ),
});

type PilotFormValues = z.infer<typeof pilotSchema>;

const STEPS = [
  { id: 1, label: "Temporada" },
  { id: 2, label: "Equipe" },
  { id: 3, label: "Assento" },
  { id: 4, label: "Piloto" },
  { id: 5, label: "Confirmação" },
] as const;

const PILOT_FORM_ID = "player-entry-pilot-form";

export function PlayerEntryFlow() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [seat, setSeat] = useState<1 | 2 | null>(null);
  const [pilot, setPilot] = useState<PilotFormValues | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setupQuery = usePlayerEntrySetup(seasonId ?? undefined);
  const setup = setupQuery.data;
  const createMutation = useCreatePlayerEntry();

  const season = setup?.seasons.find((item) => item.id === seasonId) ?? null;
  const teams =
    seasonId && setup?.selection ? setup.selection.teams : null;
  const team =
    teams?.find((item) => item.id === teamId) ?? null;
  const seatInfo = team?.seats.find((item) => item.seat === seat) ?? null;

  function selectSeason(id: string) {
    setSeasonId(id);
    setTeamId(null);
    setSeat(null);
    setPilot(null);
    setSubmitError(null);
  }

  function selectTeam(id: string) {
    setTeamId(id);
    setSeat(null);
    setPilot(null);
    setSubmitError(null);
  }

  function selectSeat(value: 1 | 2) {
    setSeat(value);
    setPilot(null);
    setSubmitError(null);
  }

  function handlePilotSubmit(values: PilotFormValues) {
    setPilot(values);
    setSubmitError(null);
    setStep(5);
  }

  function handleCreate() {
    if (!seasonId || !teamId || !seat || !pilot) return;
    setSubmitError(null);
    const input: PlayerEntryCreateInput = {
      seasonId,
      teamId,
      seat,
      name: pilot.name,
      nationality: pilot.nationality,
      gender: pilot.gender || null,
      birthDate: new Date(pilot.birthDate).toISOString(),
    };
    createMutation.mutate(input, {
      onError: (err) => {
        setSubmitError(err instanceof Error ? err.message : "Falha ao registrar a entrada");
      },
    });
  }

  function resetFlow() {
    setStep(1);
    setSeasonId(null);
    setTeamId(null);
    setSeat(null);
    setPilot(null);
    setSubmitError(null);
    createMutation.reset();
  }

  if (createMutation.isSuccess && createMutation.data) {
    return (
      <StepResult
        seasonYear={season?.year ?? null}
        team={team}
        result={createMutation.data}
        onRestart={resetFlow}
        onFinish={() => router.push("/app/drivers")}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <StepIndicator step={step} />
      </CardHeader>
      <CardContent>
        {step === 1 && (
          <StepSeason
            setupQuery={{
              isPending: setupQuery.isPending,
              isError: setupQuery.isError,
              error: setupQuery.error,
              refetch: setupQuery.refetch,
            }}
            seasons={setup?.seasons ?? null}
            seasonId={seasonId}
            onSelect={selectSeason}
          />
        )}
        {step === 2 && (
          <StepTeam
            teams={teams}
            isPending={setupQuery.isPending}
            isError={setupQuery.isError}
            teamId={teamId}
            onSelect={selectTeam}
          />
        )}
        {step === 3 && (
          <StepSeat
            team={team}
            seat={seat}
            onSelect={selectSeat}
          />
        )}
        {step === 4 && (
          <StepPilot
            defaultValues={pilot ?? undefined}
            onSubmit={handlePilotSubmit}
          />
        )}
        {step === 5 && (
          <StepConfirm
            season={season}
            team={team}
            seatInfo={seatInfo}
            pilot={pilot}
            error={submitError}
          />
        )}
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={step === 1}
          onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4 | 5)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </Button>
        {step < 4 && (
          <Button
            type="button"
            disabled={
              (step === 1 && !seasonId) ||
              (step === 2 && !teamId) ||
              (step === 3 && !seat)
            }
            onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4 | 5)}
          >
            Continuar
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {step === 4 && (
          <Button type="submit" form={PILOT_FORM_ID}>
            Continuar
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {step === 5 && (
          <Button
            type="button"
            disabled={createMutation.isPending}
            onClick={handleCreate}
          >
            {createMutation.isPending
              ? "Registrando..."
              : "Confirmar entrada na F1"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="space-y-2">
      <CardTitle>Novo piloto no grid</CardTitle>
      <ol className="flex flex-wrap gap-1.5" aria-label="Passos">
        {STEPS.map((item) => {
          const active = item.id === step;
          const done = item.id < step;
          return (
            <li
              key={item.id}
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                active && "border-brand text-brand",
                done && "border-transparent bg-muted text-muted-foreground",
                !active && !done && "border-border text-muted-foreground",
              )}
            >
              {done ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <span>{item.id}</span>
              )}
              {item.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepSeason({
  setupQuery,
  seasons,
  seasonId,
  onSelect,
}: {
  setupQuery: {
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => void;
  };
  seasons: PlayerEntrySeason[] | null;
} & {
  seasonId: string | null;
  onSelect: (id: string) => void;
}) {
  const loaded = seasons !== null;

  if (setupQuery.isError && !loaded) {
    return (
      <ErrorState
        title="Dados indisponíveis"
        description="Não foi possível carregar as temporadas espelhadas da fonte F1."
        action={
          <Button
            variant="outline"
            onClick={() => void setupQuery.refetch()}
          >
            Tentar novamente
          </Button>
        }
      />
    );
  }

  if (setupQuery.isPending && !loaded) {
    return (
      <div className="flex items-center justify-center py-10">
        <span className="text-sm text-muted-foreground">Carregando temporadas...</span>
      </div>
    );
  }

  if (loaded && seasons.length === 0) {
    return (
      <EmptyState
        kicker="SEASON BINDINGS"
        title="Nenhuma temporada espelhada"
        description="Você ainda não tem temporadas vinculadas a uma temporada externa confirmada. Confirme um vínculo na aba F1 World Data para começar."
      />
    );
  }

  const options = (seasons ?? []).map((item) => ({
    value: item.id,
    label: `Temporada ${item.year} — ${statusLabel(item.status)}`,
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="season">Temporada da fonte</Label>
        <Select
          value={seasonId ?? ""}
          onValueChange={onSelect}
          options={options}
          placeholder="Selecione a temporada"
        >
          <SelectTrigger id="season">
            <SelectValue />
          </SelectTrigger>
          <SelectContent />
        </Select>
        <p className="text-sm text-muted-foreground">
          Seu personagem entra no grid espelhado desta temporada do mundo real.
        </p>
      </div>
    </div>
  );
}

function StepTeam({
  teams,
  isPending,
  isError,
  teamId,
  onSelect,
}: {
  teams: PlayerEntryTeam[] | null;
  isPending: boolean;
  isError: boolean;
  teamId: string | null;
  onSelect: (id: string) => void;
}) {
  if (isError) {
    return (
      <ErrorState
        title="Dados indisponíveis"
        description="Não foi possível carregar as equipes espelhadas desta temporada."
      />
    );
  }

  if (isPending || teams === null) {
    return (
      <div className="flex items-center justify-center py-10">
        <span className="text-sm text-muted-foreground">Carregando equipes...</span>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        kicker="TEAM BINDINGS"
        title="Nenhuma equipe espelhada"
        description="Você ainda não tem equipes vinculadas a equipes externas confirmadas nesta temporada."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Escolha a equipe do seu universo que vai receber o seu personagem.
      </p>
      {teams.map((team) => {
        const selected = team.id === teamId;
        const occupiedSeats = team.seats.filter((s) => s.universe).length;
        return (
          <button
            key={team.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(team.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border bg-background px-4 py-3 text-left transition-colors",
              selected
                ? "border-brand ring-1 ring-brand"
                : "border-input hover:border-brand/60",
            )}
          >
            <span
              aria-hidden
              className="h-4 w-4 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: team.color ?? undefined }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {team.name}
                {team.shortName ? ` · ${team.shortName}` : ""}
              </span>
              <span className="block text-xs text-muted-foreground">
                ID externo: {team.externalTeamId}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {2 - occupiedSeats}/{2} vaga{2 - occupiedSeats === 1 ? "" : "s"} livre
              {occupiedSeats > 0 ? ` · ${occupiedSeats} ocupada${occupiedSeats === 1 ? "" : "s"}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StepSeat({
  team,
  seat,
  onSelect,
}: {
  team: PlayerEntryTeam | null;
  seat: 1 | 2 | null;
  onSelect: (value: 1 | 2) => void;
}) {
  if (!team) {
    return (
      <EmptyState
        kicker="SEAT"
        title="Escolha uma equipe antes"
        description="Volte um passo e selecione a equipe na qual seu personagem vai correr."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Definindo vaga em <strong className="font-semibold text-foreground">{team.name}</strong>.
      </p>
      <div className="space-y-3">
        {team.seats.map((item) => {
          const selected = item.seat === seat;
          const occupied = item.universe !== null;
          return (
            <button
              key={item.seat}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(item.seat)}
              className={cn(
                "flex w-full items-start gap-3 rounded-md border bg-background px-4 py-3 text-left transition-colors",
                selected
                  ? "border-brand ring-1 ring-brand"
                  : "border-input hover:border-brand/60",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-black">
                {item.seat}
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-sm font-semibold">
                  {formatSeatLabel(item.seat)}
                </span>
                {item.source ? (
                  <span className="block text-sm text-muted-foreground">
                    Na fonte: <strong className="font-medium text-foreground">{item.source.name}</strong>
                    {item.source.number != null ? ` (#${item.source.number})` : ""}
                  </span>
                ) : (
                  <span className="block text-sm text-muted-foreground">
                    Na fonte: sem piloto registrado
                  </span>
                )}
                {item.universe ? (
                  <span className="block text-xs text-muted-foreground">
                    No seu universo: <strong className="font-medium text-foreground">{item.universe.characterName}</strong>{" "}
                    — será deslocado
                  </span>
                ) : (
                  <span className="block text-xs text-emerald-600">
                    Vaga livre no seu universo
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {team.reserve.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Reservas na fonte:{" "}
          {team.reserve
            .map((r) => `${r.name}${r.number != null ? ` (#${r.number})` : ""}`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

function StepPilot({
  defaultValues,
  onSubmit,
}: {
  defaultValues?: PilotFormValues;
  onSubmit: (values: PilotFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PilotFormValues>({
    resolver: zodResolver(pilotSchema),
    defaultValues: defaultValues ?? {
      name: "",
      nationality: "",
      gender: "",
      birthDate: "",
    },
  });

  return (
    <form
      id={PILOT_FORM_ID}
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      aria-label="Identidade do piloto"
    >
      <div className="space-y-2">
        <Label htmlFor="pilot-name">Nome</Label>
        <Input
          id="pilot-name"
          placeholder="Nome do seu personagem"
          {...register("name")}
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="pilot-nationality">Nacionalidade</Label>
        <Input
          id="pilot-nationality"
          placeholder="Ex.: Brasileira"
          {...register("nationality")}
        />
        {errors.nationality && (
          <p className="text-sm text-destructive">
            {errors.nationality.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="pilot-gender">Gênero</Label>
        <Input
          id="pilot-gender"
          placeholder="Opcional"
          {...register("gender")}
        />
        {errors.gender && (
          <p className="text-sm text-destructive">{errors.gender.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="pilot-birth">Data de nascimento</Label>
        <Input
          id="pilot-birth"
          type="date"
          {...register("birthDate")}
        />
        {errors.birthDate && (
          <p className="text-sm text-destructive">{errors.birthDate.message}</p>
        )}
      </div>
    </form>
  );
}

function StepConfirm({
  season,
  team,
  seatInfo,
  pilot,
  error,
}: {
  season: PlayerEntrySeason | null;
  team: PlayerEntryTeam | null;
  seatInfo: PlayerEntrySeat | null;
  pilot: PilotFormValues | null;
  error: string | null;
}) {
  if (!team || !seatInfo || !pilot) {
    return (
      <EmptyState
        kicker="REVIEW"
        title="Dados incompletos"
        description="Volte um passo e confirme todas as escolhas antes de continuar."
      />
    );
  }

  return (
    <div className="space-y-4">
      <dl className="space-y-3 rounded-md border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Temporada</dt>
          <dd className="font-medium">
            Temporada {season?.year ?? "—"}
            {season ? ` · ${statusLabel(season.status)}` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Equipe</dt>
          <dd className="font-medium">
            {team.name}
            {team.shortName ? ` (${team.shortName})` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Vaga</dt>
          <dd className="font-medium">
            {formatSeatLabel(seatInfo.seat)}
            {seatInfo.source
              ? ` — substitui ${seatInfo.source.name}`
              : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Piloto</dt>
          <dd className="font-medium">
            {pilot.name} · {pilot.nationality}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Nascimento</dt>
          <dd className="font-medium">
            {formatLocalDate(pilot.birthDate)}
          </dd>
        </div>
      </dl>

      {seatInfo.universe && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Este assento está ocupado no seu universo por{" "}
          <strong className="font-semibold">{seatInfo.universe.characterName}</strong>.
          Ao confirmar, esse piloto será deslocado para abrir espaço para{" "}
          {pilot.name}.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function StepResult({
  seasonYear,
  team,
  result,
  onRestart,
  onFinish,
}: {
  seasonYear: number | null;
  team: PlayerEntryTeam | null;
  result: PlayerEntryCreateResult;
  onRestart: () => void;
  onFinish: () => void;
}) {
  const displacedName = result.displaced?.entry.driverProfile.character.name ?? null;
  const seatLabel = formatSeatLabel(
    (result.entry.seat === 1 || result.entry.seat === 2 ? result.entry.seat : null) ??
      1,
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="text-base font-bold">
          {result.character.name} entrou no grid de {seasonYear ?? "—"}!
        </p>
        <p className="mt-1">
          Piloto de {team?.name ?? "—"}, vaga {seatLabel}.
          {result.entry.number != null ? ` Número ${result.entry.number}.` : ""}
        </p>
      </div>

      {displacedName && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong className="font-semibold">{displacedName}</strong> foi
          deslocado(a) para liberar a vaga.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={onFinish}>
          Ver meus pilotos
        </Button>
        <Button type="button" variant="outline" onClick={onRestart}>
          Registrar outro piloto
        </Button>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "PRE_SEASON":
      return "Pré-temporada";
    case "ACTIVE":
      return "Ativa";
    case "FINISHED":
      return "Concluída";
    default:
      return status;
  }
}

function formatLocalDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}