"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

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
} from "@/components/ui/select";

const RACE_STATUSES = ["UPCOMING", "QUALIFYING", "RACE", "FINISHED"] as const;

const raceFormSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da corrida"),
  circuit: z.string().trim().max(120, "Circuito muito longo (máx. 120)"),
  country: z.string().trim().max(80, "País muito longo (máx. 80)"),
  date: z.string().optional(),
  round: z.string().optional(),
  status: z.enum(RACE_STATUSES),
});

type RaceFormValues = z.infer<typeof raceFormSchema>;

type RaceValues = {
  name: string;
  circuit: string | null;
  country: string | null;
  date: string | null;
  round: number | null;
  status: string;
};

function toInput(values: RaceFormValues): RaceValues {
  let date: string | null = null;
  if (values.date) {
    date = new Date(values.date).toISOString();
  }
  let round: number | null = null;
  if (values.round) {
    const parsed = Number(values.round);
    round = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return {
    name: values.name,
    circuit: values.circuit === "" ? null : values.circuit,
    country: values.country === "" ? null : values.country,
    date,
    round,
    status: values.status,
  };
}

type RaceFormProps = {
  initial?: {
    name: string;
    circuit: string | null;
    country: string | null;
    date: string | null;
    round: number | null;
    status: string;
  };
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: RaceValues) => void;
  onCancel: () => void;
};

export function RaceForm({
  initial,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: RaceFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<RaceFormValues>({
    resolver: zodResolver(raceFormSchema),
    defaultValues: {
      name: initial?.name ?? "",
      circuit: initial?.circuit ?? "",
      country: initial?.country ?? "",
      date: initial?.date ?? "",
      round: initial?.round != null ? String(initial.round) : undefined,
      status: initial?.status as RaceFormValues["status"] ?? "UPCOMING",
    },
  });

  useEffect(() => {
    reset({
      name: initial?.name ?? "",
      circuit: initial?.circuit ?? "",
      country: initial?.country ?? "",
      date: initial?.date ?? "",
      round: initial?.round != null ? String(initial.round) : undefined,
      status: initial?.status as RaceFormValues["status"] ?? "UPCOMING",
    });
  }, [initial, reset]);

  function dateToLocal(value: string | null) {
    if (!value) return "";
    return value.slice(0, 16);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? "Editar corrida" : "Nova corrida"}</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}
        noValidate
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="race-name">Nome da corrida</Label>
            <Input
              id="race-name"
              placeholder="Ex.: GP Brasil"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="circuit">Circuito (opcional)</Label>
              <Input
                id="circuit"
                placeholder="Ex.: Interlagos"
                {...register("circuit")}
              />
              {errors.circuit && (
                <p className="text-sm text-destructive">
                  {errors.circuit.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">País (opcional)</Label>
              <Input
                id="country"
                placeholder="Ex.: Brasil"
                {...register("country")}
              />
              {errors.country && (
                <p className="text-sm text-destructive">
                  {errors.country.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="race-round">Rodada (opcional)</Label>
              <Input
                id="race-round"
                type="number"
                placeholder="Ex.: 1"
                {...register("round")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="race-date">Data (opcional)</Label>
              <Input
                id="race-date"
                type="datetime-local"
                defaultValue={dateToLocal(initial?.date ?? null)}
                {...register("date")}
              />
              {errors.date && (
                <p className="text-sm text-destructive">{errors.date.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="race-status">Status</Label>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={RACE_STATUSES.map((s) => ({
                    value: s,
                    label: s,
                  }))}
                >
                  <SelectTrigger id="race-status" onBlur={field.onBlur} />
                  <SelectContent />
                </Select>
              )}
            />
            {errors.status && (
              <p className="text-sm text-destructive">{errors.status.message}</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
