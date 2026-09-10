"use client";

import { Link2, Loader2 } from "lucide-react";
import { useState } from "react";

import { SectionHeading } from "@/components/home/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  EXTERNAL_SOURCE_NAME,
  EXTERNAL_SOURCE_REF,
  formatExternalDateTime,
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
  fullName: string | null;
  nationality: string | null;
  number: number | null;
  teamName: string | null;
  role: string | null;
  lastSyncedAt: string | null;
};

function DriverDetailDialog({
  driver,
  open,
  onOpenChange,
}: {
  driver: SeasonDriver;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const candidates = useExternalCandidates("DRIVER", open ? driver.externalId : null);

  const identity = [
    { label: "Nome completo", value: driver.fullName ?? driver.name },
    { label: "Nacionalidade", value: driver.nationality ?? "—" },
    { label: "Número", value: formatDriverNumber(driver.number) },
    { label: "Equipe", value: driver.teamName ?? "Equipe não informada" },
    ...(driver.role
      ? [{ label: "Função", value: driverRoleLabel(driver.role) ?? driver.role }]
      : []),
    { label: "Identidade externa", value: driver.externalId },
    {
      label: "Fonte",
      value: `${driver.externalId} @ ${EXTERNAL_SOURCE_NAME} · ${EXTERNAL_SOURCE_REF}`,
    },
    { label: "Atualizado em", value: formatExternalDateTime(driver.lastSyncedAt) },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{driver.name}</DialogTitle>
          <DialogDescription>
            Dados do Mirror Externo · somente leitura.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-5 pb-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
              EXTERNAL DATA
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {EXTERNAL_SOURCE_NAME}
            </span>
          </div>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {identity.map((item) => (
              <div
                key={item.label}
                className="space-y-0.5 rounded-md border border-border p-3"
              >
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="truncate text-sm font-semibold text-foreground">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="space-y-1.5 rounded-md border border-border p-3">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" />
              Correspondência no universo
            </span>
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
                <div className="space-y-1 pt-1">
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
                {candidates.data.candidates.length > 0 && (
                  <ul className="space-y-1 pt-2">
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
                )}
              </>
            )}
          </div>
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
  const [detailExternalId, setDetailExternalId] = useState<string | null>(null);

  const seasonDrivers: SeasonDriver[] = driverSeasons.map((ds) => {
    const globalDriver = driversByExternalId[ds.externalDriver.externalId];
    return {
      externalId: ds.externalDriver.externalId,
      name: ds.externalDriver.name,
      fullName: globalDriver?.fullName ?? null,
      nationality: globalDriver?.nationality ?? null,
      number: ds.number ?? globalDriver?.number ?? null,
      teamName: ds.teamNameSnapshot ?? null,
      role: ds.role,
      lastSyncedAt: globalDriver?.lastSyncedAt ?? null,
    };
  });
  seasonDrivers.sort((a, b) => a.name.localeCompare(b.name));

  const detailDriver =
    seasonDrivers.find((d) => d.externalId === detailExternalId) ?? null;

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seasonDrivers.map((driver) => (
            <Card key={driver.externalId} className="h-full">
              <CardContent className="flex h-full flex-col gap-3 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <h3 className="truncate text-base font-bold tracking-tight text-foreground">
                      {driver.name}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {driver.nationality ?? "Nacionalidade não informada"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-black tabular-nums text-foreground">
                    {formatDriverNumber(driver.number)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {driver.teamName ?? "Equipe não informada"}
                  </span>
                  {driver.role ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {driverRoleLabel(driver.role)}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  ID: {driver.externalId}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-auto w-full"
                  aria-label={`Ver detalhes de ${driver.name}`}
                  onClick={() => setDetailExternalId(driver.externalId)}
                >
                  Ver detalhes
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {detailDriver && (
        <DriverDetailDialog
          driver={detailDriver}
          open={detailExternalId != null}
          onOpenChange={(next) =>
            setDetailExternalId(next ? detailDriver.externalId : null)
          }
        />
      )}
    </section>
  );
}