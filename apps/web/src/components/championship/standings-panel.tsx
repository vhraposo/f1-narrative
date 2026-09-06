"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { Driver } from "@/lib/driver-profiles";

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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Classificação — {season.name ?? `Temporada ${season.year}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {!isLoading && !isError && standings && standings.length > 0 && (
          <ol className="divide-y rounded-md border">
            {standings.map((standing) => (
              <li
                key={standing.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-semibold">
                    {standing.position ?? "—"}
                  </span>
                  <span className="text-sm">
                    {standing.driverProfile.character.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {standing.wins}V {standing.podiums}P
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {standing.points} pts
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removingId === standing.id}
                    onClick={() => handleRemove(standing)}
                  >
                    {removingId === standing.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
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
  );
}
