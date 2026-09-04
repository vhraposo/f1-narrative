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

const teamFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da equipe")
    .max(80, "Nome muito longo (máx. 80 caracteres)"),
  shortName: z.string().trim().max(20, "Sigla muito longa (máx. 20)"),
  color: z.string().trim().max(20, "Cor muito longa (máx. 20)"),
});

type TeamFormValues = z.infer<typeof teamFormSchema>;

type TeamValues = {
  name: string;
  shortName: string | null;
  color: string | null;
};

function toInput(values: TeamFormValues): TeamValues {
  return {
    name: values.name,
    shortName: values.shortName === "" ? null : values.shortName,
    color: values.color === "" ? null : values.color,
  };
}

type TeamFormProps = {
  initial?: { name: string; shortName: string | null; color: string | null };
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: TeamValues) => void;
  onCancel: () => void;
};

export function TeamForm({
  initial,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: TeamFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: initial?.name ?? "",
      shortName: initial?.shortName ?? "",
      color: initial?.color ?? "",
    },
  });

  useEffect(() => {
    reset({
      name: initial?.name ?? "",
      shortName: initial?.shortName ?? "",
      color: initial?.color ?? "",
    });
  }, [initial, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? "Editar equipe" : "Nova equipe"}</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}
        noValidate
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da equipe</Label>
            <Input
              id="name"
              placeholder="Ex.: Ferrari"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortName">Sigla (opcional)</Label>
            <Input
              id="shortName"
              placeholder="Ex.: FER"
              {...register("shortName")}
            />
            {errors.shortName && (
              <p className="text-sm text-destructive">
                {errors.shortName.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Cor (opcional)</Label>
            <Input
              id="color"
              placeholder="Ex.: red"
              {...register("color")}
            />
            {errors.color && (
              <p className="text-sm text-destructive">{errors.color.message}</p>
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
