"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  useCreateStanding,
  useDeleteStanding,
  useStandings,
} from "@/hooks/use-championship";
import type {
  ChampionshipStanding,
  Season,
} from "@/lib/championship";
import {
  formatDriverNumber,
  type Driver,
} from "@/lib/driver-profiles";

const standingFormSchema = z.object({
  driverProfileId: z.string().uuid("Selecione um piloto"),
  points: z.string().optional(),
});

type StandingFormValues = z.infer<typeof standingFormSchema>;

type StandingsPanelProps = {
  season: Season;
  drivers: Driver[];
};

export function StandingsPanel({ season, drivers }: StandingsPanelProps) {
  const { data: standings, isLoading, isError } = useStandings(season.id);
  const createMutation = useCreateStanding(season.id);
  const deleteMutation = useDeleteStanding(season.id);

  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<StandingFormValues>({
    resolver: zodResolver(standingFormSchema),
    defaultValues: { driverProfileId: "", points: "0" },
  });

  const standingByDriver = new Map(
    (standings ?? []).map((s) => [s.driverProfileId, s]),
  );

  const driverById = new Map(drivers.map((d) => [d.id, d]));

  const sortedStandings = [...(standings ?? [])].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
  );

  const driverOptions = [
    { value: "", label: "Selecione um piloto" },
    ...drivers.map((d) => ({
      value: d.id,
      label: `${d.character.name}${
        standingByDriver.has(d.id) ? " (já na tabela)" : ""
      }`,
    })),
  ];

  function toPoints(value: string | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function handleAdd(values: StandingFormValues) {
    setFormError(null);
    createMutation.mutate(
      {
        driverProfileId: values.driverProfileId,
        points: toPoints(values.points),
      },
      {
        onSuccess: () => {
          setFormError(null);
          reset({ driverProfileId: "", points: "0" });
        },
        onError: (err) => {
          setFormError(
            err instanceof Error ? err.message : "Falha ao adicionar classificação",
          );
        },
      },
    );
  }

  function handleRemove(standing: ChampionshipStanding) {
    setRemovingId(standing.id);
    deleteMutation.mutate(standing.id, {
      onSettled: () => setRemovingId(null),
    });
  }

  return (
    <section aria-label="Classificação dos pilotos" className="space-y-4">
      <SectionHeading
        kicker="Standings"
        title="Classificação"
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {isError && (
            <p className="text-sm text-destructive">
              Não foi possível carregar a classificação.
            </p>
          )}

          {!isLoading && !isError && standings && standings.length === 0 && (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhuma classificação registrada ainda.
            </p>
          )}

          {!isLoading && !isError && standings && standings.length > 0 && (
            <div className="overflow-hidden rounded-md border">
              <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span className="w-10 shrink-0 text-center">Pos</span>
                <span className="h-4 w-1 shrink-0" aria-hidden="true" />
                <span className="flex-1">Piloto</span>
                <span className="text-right">Pontos</span>
                <span className="w-9 shrink-0" aria-hidden="true" />
              </div>
              <ol className="divide-y divide-border">
                {sortedStandings.map((standing) => {
                  const driver = driverById.get(standing.driverProfileId);
                  const team = driver?.team ?? null;
                  const teamColor = team?.color ?? null;
                  const stats =
                    standing.wins || standing.podiums
                      ? `${standing.wins}V · ${standing.podiums}P`
                      : null;
                  const meta = [
                    driver?.number != null
                      ? formatDriverNumber(driver.number)
                      : null,
                    team?.name ?? null,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <li
                      key={standing.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="w-10 shrink-0 text-center text-sm font-black tabular-nums text-muted-foreground">
                        {standing.position == null
                          ? "—"
                          : String(standing.position).padStart(2, "0")}
                      </span>
                      <span
                        aria-hidden="true"
                        className="h-4 w-1 shrink-0 rounded-full bg-foreground/10"
                        style={teamColor ? { backgroundColor: teamColor } : undefined}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {standing.driverProfile.character.name}
                        </span>
                        {meta && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {meta}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-black tabular-nums text-foreground">
                          {standing.points}{" "}
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            PTS
                          </span>
                        </span>
                        {stats && (
                          <span className="block text-[11px] font-semibold tabular-nums tracking-wide text-muted-foreground">
                            {stats}
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={removingId === standing.id}
                        onClick={() => handleRemove(standing)}
                      >
                        {removingId === standing.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <form
            onSubmit={handleSubmit(handleAdd)}
            noValidate
            className="space-y-3 rounded-md border p-3"
          >
            <div className="space-y-2">
              <Label htmlFor="standing-driver">Piloto</Label>
              <Controller
                control={control}
                name="driverProfileId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={driverOptions}
                  >
                    <SelectTrigger id="standing-driver" onBlur={field.onBlur} />
                    <SelectContent />
                  </Select>
                )}
              />
              {errors.driverProfileId && (
                <p className="text-sm text-destructive">
                  {errors.driverProfileId.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="standing-points">Pontos</Label>
              <Input
                id="standing-points"
                type="number"
                step="0.1"
                placeholder="Ex.: 25"
                {...register("points")}
              />
              {errors.points && (
                <p className="text-sm text-destructive">{errors.points.message}</p>
              )}
            </div>
            {formError && (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending}
              >
                Adicionar à classificação
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
