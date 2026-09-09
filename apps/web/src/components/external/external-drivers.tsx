"use client";

import { Loader2, Link2 } from "lucide-react";
import { useState } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import { useExternalCandidates } from "@/hooks/use-external-world";
import { formatDriverNumber } from "@/lib/driver-profiles";
import {
  driverRoleLabel,
  EXTERNAL_SOURCE_REF,
  formatExternalDate,
  type ExternalDriver,
  type ExternalDriverSeason,
} from "@/lib/external-world";

type ExternalDriversProps = {
  driverSeasons: ExternalDriverSeason[];
  driversByExternalId: Record<string, ExternalDriver>;
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

type SeasonDriver = {
  externalId: string;
  name: string;
  nationality: string | null;
  number: number | null;
  teamName: string | null;
  role: string | null;
  lastSyncedAt: string | null;
};

function DriverBindingDialog({
  driver,
  open,
  onOpenChange,
}: {
  driver: SeasonDriver;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const candidates = useExternalCandidates("DRIVER", open ? driver.externalId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correspondência — {driver.name}</DialogTitle>
          <DialogDescription>
            Vínculo entre este piloto externo e o universo narrativo. Consulta
            somente leitura, sem confirmação.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 pb-5">
          {candidates.isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {candidates.isError && (
            <p className="text-sm text-destructive">
              Não foi possível consultar a correspondência na fonte.
            </p>
          )}
          {candidates.data && (
            <>
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Vínculo atual
                </span>
                {candidates.data.currentBinding ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {candidates.data.currentBinding.targetLabel ?? "Personagem"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {candidates.data.currentBinding.confidence === "CONFIRMED"
                        ? "Confirmado"
                        : "Sugerido"}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Este piloto externo ainda não tem vínculo no universo.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Identidade externa: {driver.externalId} · Fonte:{" "}
                {candidates.data.external.source} ({EXTERNAL_SOURCE_REF})
              </p>
              {candidates.data.candidates.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Candidatos no universo
                  </span>
                  <ul className="space-y-1">
                    {candidates.data.candidates.map((candidate) => (
                      <li
                        key={candidate.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {candidate.label}
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                          {Math.round(candidate.score * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExternalDrivers({
  driverSeasons,
  driversByExternalId,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalDriversProps) {
  const [verifyingExternalId, setVerifyingExternalId] = useState<string | null>(
    null,
  );

  const seasonDrivers: SeasonDriver[] = driverSeasons.map((ds) => {
    const globalDriver = driversByExternalId[ds.externalDriver.externalId];
    return {
      externalId: ds.externalDriver.externalId,
      name: ds.externalDriver.name,
      nationality: globalDriver?.nationality ?? null,
      number: ds.number ?? globalDriver?.number ?? null,
      teamName: ds.teamNameSnapshot ?? null,
      role: ds.role,
      lastSyncedAt: globalDriver?.lastSyncedAt ?? null,
    };
  });
  seasonDrivers.sort((a, b) => a.name.localeCompare(b.name));

  const verifyingDriver =
    seasonDrivers.find((d) => d.externalId === verifyingExternalId) ?? null;

  return (
    <section aria-label="Pilotos externos" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Pilotos"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar os pilotos da fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && seasonDrivers.length === 0 && (
        <ExternalSectionEmpty
          title="Não há pilotos da temporada informados na fonte."
          description="A lista de pilotos vem da Temporada Exterior de Pilotos (ExternalDriverSeason)."
        />
      )}
      {!isLoading && !isError && seasonDrivers.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="w-9 shrink-0 text-center">Nº</span>
            <span className="flex-1">Piloto</span>
            <span className="hidden w-40 shrink-0 sm:block">Nacionalidade</span>
            <span className="hidden w-28 shrink-0 md:block">Sincronização</span>
            <span className="w-8 shrink-0" aria-hidden="true" />
          </div>
          <ol className="divide-y divide-border">
            {seasonDrivers.map((driver) => (
              <li
                key={driver.externalId}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="w-9 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">
                  {driver.number != null ? formatDriverNumber(driver.number) : "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {driver.name}
                    </span>
                    {driver.role ? (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {driverRoleLabel(driver.role)}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {driver.teamName ?? "Equipe não informada"} · ID:{" "}
                    {driver.externalId}
                  </span>
                </span>
                <span className="hidden w-40 shrink-0 truncate text-sm text-muted-foreground sm:block">
                  {driver.nationality ?? "—"}
                </span>
                <span className="hidden w-28 shrink-0 text-xs text-muted-foreground md:block">
                  {formatExternalDate(driver.lastSyncedAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Verificar correspondência de ${driver.name}`}
                  onClick={() => setVerifyingExternalId(driver.externalId)}
                >
                  <Link2 className="h-4 w-4" />
                  <span className="ml-2 hidden sm:inline">Verificar</span>
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {verifyingDriver && (
        <DriverBindingDialog
          driver={verifyingDriver}
          open={verifyingExternalId != null}
          onOpenChange={(next) =>
            setVerifyingExternalId(next ? verifyingDriver.externalId : null)
          }
        />
      )}
    </section>
  );
}