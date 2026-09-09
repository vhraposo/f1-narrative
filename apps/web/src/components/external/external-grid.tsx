import { SectionHeading } from "@/components/home/section-heading";
import { Card, CardContent } from "@/components/ui/card";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import { formatDriverNumber } from "@/lib/driver-profiles";
import {
  driverRoleLabel,
  type ExternalDriverSeason,
  type ExternalTeam,
} from "@/lib/external-world";
import { cn } from "@/lib/utils";

type ExternalGridProps = {
  year: number;
  driverSeasons: ExternalDriverSeason[];
  teamsByExternalId: Record<string, ExternalTeam>;
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

type GridGroup = {
  teamExternalId: string | null;
  teamName: string;
  color: string | null;
  drivers: ExternalDriverSeason[];
};

export function ExternalGrid({
  year,
  driverSeasons,
  teamsByExternalId,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalGridProps) {
  const groups: GridGroup[] = [];
  const groupIndex = new Map<string, number>();

  for (const ds of driverSeasons) {
    const key = ds.teamExternalId ?? "__no-team__";
    let index = groupIndex.get(key);
    if (index == null) {
      const team = ds.teamExternalId
        ? teamsByExternalId[ds.teamExternalId]
        : undefined;
      index = groups.push({
        teamExternalId: ds.teamExternalId,
        teamName:
          ds.teamNameSnapshot ??
          team?.name ??
          (ds.teamExternalId ? "Equipe desconhecida" : "Equipe não informada"),
        color: team?.color ?? null,
        drivers: [],
      }) - 1;
      groupIndex.set(key, index);
    }
    groups[index].drivers.push(ds);
  }

  groups.sort((a, b) => a.teamName.localeCompare(b.teamName));
  for (const group of groups) {
    group.drivers.sort(
      (a, b) => (a.number ?? Number.POSITIVE_INFINITY) - (b.number ?? Number.POSITIVE_INFINITY),
    );
  }

  return (
    <section aria-label="Grid externo" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Grid"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar o grid da fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && groups.length === 0 && (
        <ExternalSectionEmpty
          title={`Não há dados de grid na fonte para ${year}.`}
          description="O grid é formado a partir dos pilotos da temporada (ExternalDriverSeason) informados na fonte."
        />
      )}
      {!isLoading && !isError && groups.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.teamExternalId ?? "no-team"}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-5 w-1 shrink-0 rounded-full bg-foreground/10",
                    )}
                    style={
                      group.color ? { backgroundColor: group.color } : undefined
                    }
                  />
                  <h3 className="truncate text-base font-bold tracking-tight text-foreground">
                    {group.teamName}
                  </h3>
                </div>
                <ul className="overflow-hidden rounded-md border border-border divide-y divide-border">
                  {group.drivers.map((ds) => (
                    <li
                      key={ds.id}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="w-9 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">
                        {ds.number != null ? formatDriverNumber(ds.number) : "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {ds.externalDriver.name}
                      </span>
                      {ds.role ? (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {driverRoleLabel(ds.role)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}