"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDrivers } from "@/hooks/use-driver-profiles";
import {
  useDeleteAvatar,
  useProfile,
  useUpdateProfile,
  useUploadAvatar,
} from "@/hooks/use-profile";
import { useTeams } from "@/hooks/use-teams";
import { useSession } from "@/providers/session-provider";

const NO_FAVORITE = "__none__";

export function ProfileSettings() {
  const { data, isLoading, isError, error } = useProfile();
  const { data: teams } = useTeams();
  const { data: drivers } = useDrivers();
  const updateMutation = useUpdateProfile();
  const uploadMutation = useUploadAvatar();
  const deleteMutation = useDeleteAvatar();
  const { refresh } = useSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [data?.image]);

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setNotice(null);
    setActionError(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  }

  function handleUpload() {
    if (!selectedFile) return;
    setNotice(null);
    setActionError(null);
    uploadMutation.mutate(selectedFile, {
      onSuccess: () => {
        setNotice("Foto atualizada.");
        setSelectedFile(null);
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        refresh();
      },
      onError: (err) =>
        setActionError(
          err instanceof Error ? err.message : "Falha ao enviar a foto",
        ),
    });
  }

  function handleRemoveAvatar() {
    setNotice(null);
    setActionError(null);
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setNotice("Foto removida.");
        refresh();
      },
      onError: (err) =>
        setActionError(
          err instanceof Error ? err.message : "Falha ao remover a foto",
        ),
    });
  }

  function handleFavoriteChange(
    field: "favoriteTeamId" | "favoriteDriverId",
    value: string,
  ) {
    setNotice(null);
    setActionError(null);
    const resolved = value === NO_FAVORITE ? null : value;
    const input =
      field === "favoriteTeamId"
        ? { favoriteTeamId: resolved }
        : { favoriteDriverId: resolved };
    updateMutation.mutate(input, {
      onSuccess: () => setNotice("Favoritos atualizados."),
      onError: (err) =>
        setActionError(
          err instanceof Error ? err.message : "Falha ao atualizar favoritos",
        ),
    });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Carregando perfil…
          </span>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Não foi possível carregar o perfil"
        description={error instanceof Error ? error.message : undefined}
      />
    );
  }

  const teamOptions = [
    { value: NO_FAVORITE, label: "Nenhuma equipe" },
    ...(teams ?? []).map((team) => ({ value: team.id, label: team.name })),
  ];
  const driverOptions = [
    { value: NO_FAVORITE, label: "Nenhum piloto" },
    ...(drivers ?? []).map((driver) => ({
      value: driver.id,
      label: `${driver.character.name}${driver.number != null ? ` #${driver.number}` : ""}`,
    })),
  ];

  const favoritesPending = updateMutation.isPending;
  const busy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      {notice ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
        >
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Foto de perfil</CardTitle>
          <CardDescription>
            JPEG, PNG ou WEBP, até o limite configurado pelo servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {data.image && !imageFailed ? (
              <img
                src={data.image}
                alt={`Foto de ${data.displayName}`}
                onError={() => setImageFailed(true)}
                className="h-16 w-16 rounded-full border border-border object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground"
              >
                {data.displayName.trim().charAt(0) || "?"}
              </span>
            )}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {data.displayName}
                </p>
                <p className="text-xs text-muted-foreground">{data.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) =>
                    handleFileChange(event.target.files?.[0] ?? null)
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Escolher imagem
                </Button>
                {selectedFile ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={handleUpload}
                  >
                    {uploadMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Salvar foto
                  </Button>
                ) : null}
                {data.image ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={handleRemoveAvatar}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Remover foto
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {preview ? (
            <img
              src={preview}
              alt="Pré-visualização da nova foto"
              className="h-20 w-20 rounded-full border border-dashed border-border object-cover"
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Favoritos</CardTitle>
          <CardDescription>
            Equipe e piloto do seu Universe que você acompanha.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">
              Equipe favorita
            </span>
            <Select
              value={data.favoriteTeam?.id ?? NO_FAVORITE}
              onValueChange={(value) =>
                handleFavoriteChange("favoriteTeamId", value)
              }
              options={teamOptions}
              placeholder="Nenhuma equipe"
            >
              <SelectTrigger
                aria-label="Equipe favorita"
                disabled={favoritesPending}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">
              Piloto favorito
            </span>
            <Select
              value={data.favoriteDriver?.id ?? NO_FAVORITE}
              onValueChange={(value) =>
                handleFavoriteChange("favoriteDriverId", value)
              }
              options={driverOptions}
              placeholder="Nenhum piloto"
            >
              <SelectTrigger
                aria-label="Piloto favorito"
                disabled={favoritesPending}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
