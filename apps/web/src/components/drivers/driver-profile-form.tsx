"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
import type { Team } from "@/lib/teams";

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
  teamId: z.string().trim(),
});

type DriverFormValues = z.infer<typeof driverFormSchema>;

function toInput(values: DriverFormValues): {
  number: number | null;
  teamId: string | null;
} {
  return {
    number: values.number === "" ? null : Number(values.number),
    teamId: values.teamId === "" ? null : values.teamId,
  };
}

type DriverProfileFormProps = {
  characterName: string;
  initialNumber?: number | null;
  initialTeamId?: string | null;
  teams: Team[];
  teamsLoading: boolean;
  teamsError: string | null;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: { number: number | null; teamId: string | null }) => void;
  onCancel: () => void;
};

export function DriverProfileForm({
  characterName,
  initialNumber,
  initialTeamId,
  teams,
  teamsLoading,
  teamsError,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: DriverProfileFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<DriverFormValues>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: {
      number: initialNumber != null ? String(initialNumber) : "",
      teamId: initialTeamId ?? "",
    },
  });

  useEffect(() => {
    reset({
      number: initialNumber != null ? String(initialNumber) : "",
      teamId: initialTeamId ?? "",
    });
  }, [initialNumber, initialTeamId, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil de piloto</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="teamId">Equipe</Label>
            {teamsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando equipes...
              </div>
            ) : teamsError ? (
              <p className="text-sm text-destructive" role="alert">
                {teamsError}
              </p>
            ) : (
              <>
                <Controller
                  control={control}
                  name="teamId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: "", label: "Sem equipe" },
                        ...teams.map((team) => ({
                          value: team.id,
                          label: team.name,
                        })),
                      ]}
                    >
                      <SelectTrigger id="teamId" onBlur={field.onBlur} />
                      <SelectContent />
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Escolha &ldquo;Sem equipe&rdquo; para desvincular este piloto.
                </p>
              </>
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
