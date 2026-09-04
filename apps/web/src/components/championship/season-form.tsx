"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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

const SEASON_STATUSES = ["PRE_SEASON", "ACTIVE", "FINISHED"] as const;

const seasonFormSchema = z.object({
  year: z.string(),
  name: z.string().trim().max(120, "Nome muito longo (máx. 120 caracteres)"),
  status: z.enum(SEASON_STATUSES),
});

type SeasonFormValues = z.infer<typeof seasonFormSchema>;

type SeasonValues = {
  year: number;
  name: string | null;
  status: string;
};

function toInput(values: SeasonFormValues): SeasonValues {
  const parsedYear = Number(values.year);
  return {
    year: Number.isFinite(parsedYear) ? parsedYear : 0,
    name: values.name === "" ? null : values.name,
    status: values.status,
  };
}

type SeasonFormProps = {
  initial?: { year: number; name: string | null; status: string };
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: SeasonValues) => void;
  onCancel: () => void;
};

export function SeasonForm({
  initial,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: SeasonFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SeasonFormValues>({
    resolver: zodResolver(seasonFormSchema),
    defaultValues: {
      year: String(initial?.year ?? new Date().getFullYear()),
      name: initial?.name ?? "",
      status: initial?.status as SeasonFormValues["status"] ?? "PRE_SEASON",
    },
  });

  useEffect(() => {
    reset({
      year: String(initial?.year ?? new Date().getFullYear()),
      name: initial?.name ?? "",
      status: initial?.status as SeasonFormValues["status"] ?? "PRE_SEASON",
    });
  }, [initial, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? "Editar temporada" : "Nova temporada"}</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}
        noValidate
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="year">Ano</Label>
            <Input
              id="year"
              type="number"
              placeholder="Ex.: 2026"
              {...register("year")}
            />
            {errors.year && (
              <p className="text-sm text-destructive">{errors.year.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="season-name">Nome (opcional)</Label>
            <Input
              id="season-name"
              placeholder="Ex.: Temporada 2026"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="season-status">Status</Label>
            <select
              id="season-status"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              {...register("status")}
            >
              {SEASON_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
