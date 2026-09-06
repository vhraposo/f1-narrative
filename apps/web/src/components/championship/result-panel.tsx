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

        {!isLoading && !isError && results && results.length > 0 && (
          <ul className="divide-y rounded-md border">
            {results.map((result) => (
              <li
                key={result.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-semibold">
                    {result.position ?? "—"}
                  </span>
                  <span className="text-sm">
                    {result.driverProfile.character.name}
                  </span>
                  {result.fastestLap && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      VL
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {result.points} pts
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removingId === result.id}
                    onClick={() => handleRemove(result)}
                  >
                    {removingId === result.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
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
