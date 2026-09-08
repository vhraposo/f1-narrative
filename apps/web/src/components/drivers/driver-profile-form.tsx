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

const driverFormSchema = z.object({
  number: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (/^\d+$/.test(value) && Number(value) >= 2 && Number(value) <= 99),
      { message: "Número deve ser um inteiro entre 2 e 99" },
    ),
});

type DriverFormValues = z.infer<typeof driverFormSchema>;

type DriverProfileFormProps = {
  characterName: string;
  initialNumber?: number | null;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: { number: number | null }) => void;
  onCancel: () => void;
};

export function DriverProfileForm({
  characterName,
  initialNumber,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: DriverProfileFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DriverFormValues>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: {
      number: initialNumber != null ? String(initialNumber) : "",
    },
  });

  useEffect(() => {
    reset({
      number: initialNumber != null ? String(initialNumber) : "",
    });
  }, [initialNumber, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil de piloto</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) =>
          onSubmit({
            number: values.number === "" ? null : Number(values.number),
          }),
        )}
        noValidate
      >
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tornar <span className="font-medium text-foreground">{characterName}</span> um
            piloto.
          </p>

          <div className="space-y-2">
            <Label htmlFor="number">Número do piloto</Label>
            <Input
              id="number"
              type="number"
              inputMode="numeric"
              min={2}
              max={99}
              placeholder="Ex.: 44 (opcional)"
              {...register("number")}
            />
            {errors.number && (
              <p className="text-sm text-destructive">{errors.number.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              O número base é editado aqui. A vinculação a equipes é administrada
              pelas operações de roster da temporada.
            </p>
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