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
  useCreateResult,
  useDeleteResult,
  useResults,
} from "@/hooks/use-championship";
import type { Driver } from "@/lib/driver-profiles";
import type { Race, RaceResult } from "@/lib/championship";

const resultFormSchema = z.object({
  driverProfileId: z.string().uuid("Selecione um piloto"),
  position: z.string().optional(),
  points: z.string().optional(),
});

type ResultFormValues = z.infer<typeof resultFormSchema>;

type ResultPanelProps = {
  race: Race;
  drivers: Driver[];
  onClose: () => void;
};

export function ResultPanel({ race, drivers, onClose }: ResultPanelProps) {
  const { data: results, isLoading, isError } = useResults(race.id);
  const createMutation = useCreateResult(race.id);
  const deleteMutation = useDeleteResult(race.id);

  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ResultFormValues>({
    resolver: zodResolver(resultFormSchema),
    defaultValues: {
      driverProfileId: "",
      position: undefined,
      points: "0",
    },
  });

  const resultsByDriver = new Map(
    (results ?? []).map((r) => [r.driverProfileId, r]),
  );

  const driverById = new Map(drivers.map((d) => [d.id, d]));

  const driverOptions = [
    { value: "", label: "Selecione um piloto" },
    ...drivers.map((d) => ({
      value: d.id,
      label: `${d.character.name}${
        resultsByDriver.has(d.id) ? " (já adicionado)" : ""
      }`,
    })),
  ];

  function toNumber(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  }

  function handleAdd(values: ResultFormValues) {
    setFormError(null);
    const position = toNumber(values.position);
    const points = toNumber(values.points);
    createMutation.mutate(
      {
        driverProfileId: values.driverProfileId,
        position,
        points: points ?? 0,
      },
      {
        onSuccess: () => {
          setFormError(null);
          reset({ driverProfileId: "", position: undefined, points: "0" });
        },
        onError: (err) => {
          setFormError(
            err instanceof Error ? err.message : "Falha ao adicionar resultado",
          );
        },
      },
    );
  }

  function handleRemove(result: RaceResult) {
    setRemovingId(result.id);
    setDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[result.id];
      return next;
    });
    deleteMutation.mutate(result.id, {
      onSettled: () => setRemovingId(null),
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Falha ao excluir o resultado";
        setDeleteErrors((prev) => ({ ...prev, [result.id]: message }));
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resultados — {race.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            Não foi possível carregar os resultados.
          </p>
        )}

        {!isLoading && !isError && results && results.length === 0 && (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum resultado registrado ainda.
          </p>
        )}

        {!isLoading && !isError && results && results.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span className="w-10 shrink-0 text-center">Pos</span>
              <span className="h-4 w-1 shrink-0" aria-hidden="true" />
              <span className="flex-1">Piloto</span>
              <span className="text-right">Pontos</span>
              <span className="w-9 shrink-0" aria-hidden="true" />
            </div>
            <ol className="divide-y divide-border">
              {results.map((result) => {
                const driver = driverById.get(result.driverProfileId);
                const team = driver?.team ?? null;
                const teamColor = team?.color ?? null;
                const meta = [
                  driver?.number != null
                    ? `#${driver.number}`
                    : null,
                  team?.name ?? null,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <li
                    key={result.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <span className="w-10 shrink-0 text-center text-sm font-black tabular-nums text-muted-foreground">
                      {result.position == null
                        ? "—"
                        : String(result.position).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-4 w-1 shrink-0 rounded-full bg-foreground/10"
                      style={teamColor ? { backgroundColor: teamColor } : undefined}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {result.driverProfile.character.name}
                        </span>
                        {result.fastestLap && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            VL
                          </span>
                        )}
                      </span>
                      {meta && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {meta}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right text-sm font-black tabular-nums text-foreground">
                      {result.points}{" "}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        PTS
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={removingId === result.id}
                      onClick={() => handleRemove(result)}
                    >
                      {removingId === result.id ? (
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
            <Label htmlFor="result-driver">Piloto</Label>
            <Controller
              control={control}
              name="driverProfileId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={driverOptions}
                >
                  <SelectTrigger id="result-driver" onBlur={field.onBlur} />
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="result-position">Posição</Label>
              <Input
                id="result-position"
                type="number"
                placeholder="Ex.: 1"
                {...register("position")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="result-points">Pontos</Label>
              <Input
                id="result-points"
                type="number"
                step="0.1"
                placeholder="Ex.: 25"
                {...register("points")}
              />
            </div>
          </div>
          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Fechar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending}
            >
              Adicionar resultado
            </Button>
          </div>
        </form>

        {Object.values(deleteErrors).map((msg, i) => (
          <p key={i} className="text-sm text-destructive" role="alert">
            {msg}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
