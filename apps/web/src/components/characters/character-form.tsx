"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
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
import type { Character, CreateCharacterInput } from "@/lib/characters";

const characterFormSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120, "Nome muito longo"),
  nationality: z
    .string()
    .trim()
    .min(1, "Informe a nacionalidade")
    .max(80, "Nacionalidade muito longa"),
  gender: z.string().trim().max(40, "Gênero muito longo").optional(),
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
  imageUrl: z
    .union([z.string().url("URL de imagem inválida"), z.literal("")])
    .optional(),
  biography: z
    .string()
    .max(2000, "Biografia muito longa (máx. 2000 caracteres)")
    .optional(),
});

type CharacterFormValues = z.infer<typeof characterFormSchema>;

function emptyValues(): CharacterFormValues {
  return {
    name: "",
    nationality: "",
    gender: "",
    birthDate: "",
    imageUrl: "",
    biography: "",
  };
}

function toInput(values: CharacterFormValues): CreateCharacterInput {
  return {
    name: values.name,
    nationality: values.nationality,
    gender: values.gender || null,
    birthDate: new Date(values.birthDate).toISOString(),
    imageUrl: values.imageUrl || null,
    biography: values.biography || null,
  };
}

type CharacterFormProps = {
  character?: Character;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: CreateCharacterInput) => void;
  submitLabel: string;
  cancelHref: string;
};

export function CharacterForm({
  character,
  isSubmitting,
  error,
  onSubmit,
  submitLabel,
  cancelHref,
}: CharacterFormProps) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CharacterFormValues>({
    resolver: zodResolver(characterFormSchema),
    defaultValues: character
      ? {
          name: character.name,
          nationality: character.nationality,
          gender: character.gender ?? "",
          birthDate: character.birthDate
            ? character.birthDate.slice(0, 10)
            : "",
          imageUrl: character.imageUrl ?? "",
          biography: character.biography ?? "",
        }
      : emptyValues(),
  });

  useEffect(() => {
    if (!character) return;
    reset({
      name: character.name,
      nationality: character.nationality,
      gender: character.gender ?? "",
      birthDate: character.birthDate.slice(0, 10),
      imageUrl: character.imageUrl ?? "",
      biography: character.biography ?? "",
    });
  }, [character, reset]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{character ? "Editar personagem" : "Novo personagem"}</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}
        noValidate
      >
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              placeholder="Nome do personagem"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nationality">Nacionalidade</Label>
            <Input
              id="nationality"
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
            <Label htmlFor="birthDate">Data de nascimento</Label>
            <Input
              id="birthDate"
              type="date"
              {...register("birthDate")}
            />
            {errors.birthDate && (
              <p className="text-sm text-destructive">
                {errors.birthDate.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="gender">Gênero</Label>
            <Input
              id="gender"
              placeholder="Opcional"
              {...register("gender")}
            />
            {errors.gender && (
              <p className="text-sm text-destructive">{errors.gender.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="imageUrl">URL da imagem</Label>
            <Input
              id="imageUrl"
              type="url"
              placeholder="https://... (opcional)"
              {...register("imageUrl")}
            />
            {errors.imageUrl && (
              <p className="text-sm text-destructive">
                {errors.imageUrl.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="biography">Biografia</Label>
            <textarea
              id="biography"
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="História do personagem (opcional)"
              {...register("biography")}
            />
            {errors.biography && (
              <p className="text-sm text-destructive">
                {errors.biography.message}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(cancelHref)}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
