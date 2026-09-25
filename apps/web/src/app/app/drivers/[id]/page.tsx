"use client";

import { Loader2, Pencil } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DriverProfileForm } from "@/components/drivers/driver-profile-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useDriver, useUpdateDriver } from "@/hooks/use-driver-profiles";
import { formatBirthDate } from "@/lib/characters";
import { formatDriverNumber } from "@/lib/driver-profiles";

export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: driver, isLoading, isError, error } = useDriver(id);
  const updateMutation = useUpdateDriver(id);

  const [showForm, setShowForm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const displayHeadshotUrl = driver?.displayHeadshotUrl ?? driver?.headshotUrl ?? null;

  useEffect(() => {
    setImageFailed(false);
  }, [displayHeadshotUrl]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !driver) {
    return (
      <ErrorState
        heading="h1"
        title="Piloto não encontrado"
        description={
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o piloto."
        }
        action={
          <Button variant="outline" onClick={() => router.push("/app/drivers")}>
            Voltar para pilotos
          </Button>
        }
      />
    );
  }

  function handleSave(input: {
    number: number | null;
    customHeadshotUrl?: string | null;
  }) {
    setSubmitError(null);
    updateMutation.mutate(input, {
      onSuccess: () => setShowForm(false),
      onError: (err) =>
        setSubmitError(err instanceof Error ? err.message : "Falha ao salvar"),
    });
  }

  const rows = [
    { label: "Número", value: formatDriverNumber(driver.number) },
    { label: "Equipe", value: driver.team?.name ?? "—" },
    { label: "Nacionalidade", value: driver.character.nationality },
    {
      label: "Nascimento",
      value: driver.character.birthDate
        ? formatBirthDate(driver.character.birthDate)
        : "—",
    },
    { label: "Papel", value: driver.role ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="UNIVERSO / PILOTO"
        title={driver.character.name}
        description="Ficha esportiva do piloto no seu universo."
        action={
          <Button variant="outline" onClick={() => setShowForm((v) => !v)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
        }
      />

      {showForm && (
        <DriverProfileForm
          characterName={driver.character.name}
          intro="Editar o número base e a imagem do piloto."
          initialNumber={driver.number}
          showImage
          initialHeadshotUrl={driver.customHeadshotUrl ?? null}
          isSubmitting={updateMutation.isPending}
          error={submitError}
          onSubmit={handleSave}
          onCancel={() => {
            setShowForm(false);
            setSubmitError(null);
          }}
        />
      )}

      <Card>
        <CardContent className="flex flex-col items-center gap-5 pt-6 sm:flex-row">
          {displayHeadshotUrl && !imageFailed ? (
            <img
              src={displayHeadshotUrl}
              alt={driver.character.name}
              className="h-32 w-32 shrink-0 rounded-xl border border-border object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl bg-muted">
              <span
                aria-hidden="true"
                className="text-4xl font-black uppercase text-muted-foreground/40"
              >
                {driver.character.name.trim().charAt(0) || "?"}
              </span>
            </div>
          )}
          <div className="min-w-0 text-center sm:text-left">
            <h2 className="truncate text-2xl font-black tracking-tight text-foreground">
              {driver.character.name}
            </h2>
            <p className="mt-1 text-3xl font-black tabular-nums text-foreground">
              {formatDriverNumber(driver.number)}
            </p>
            {driver.team && (
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                {driver.team.name}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados do piloto</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="min-w-0 truncate text-right text-sm font-semibold text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {driver.character.biography && (
            <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
              {driver.character.biography}
            </p>
          )}
        </CardContent>
      </Card>

      {driver.attributes && (
        <Card>
          <CardHeader>
            <CardTitle>Atributos</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ["Velocidade", driver.attributes.speed],
                  ["Consistência", driver.attributes.consistency],
                  ["Corrida", driver.attributes.racecraft],
                  ["Agressividade", driver.attributes.aggression],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-1 text-2xl font-black tabular-nums text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
