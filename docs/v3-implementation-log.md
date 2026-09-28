# V3 — Implementation Log

## Fase 1 — Fundação de dados externos (circuitos)

- **Data:** 2026-09-25
- **Objetivo:** criar a fundação estruturada de circuitos/calendário externos, com provider abstrato, sync idempotente, lock/coalescing, registro de execuções e normalização defensiva — sem tocar nos dados narrativos do usuário.

### Arquivos principais
- `prisma/schema.prisma`: novos `ExternalCircuit`, `Circuit`, `ExternalBindingCircuit`, `ExternalSyncRun` (+ enum `ExternalSyncStatus`); `ExternalRace` ampliado (officialName, circuitExternalId, locality, country, latitude, longitude, time, url, externalCircuitId); `Race.circuitId` (opcional, legado preservado).
- `prisma/migrations/20260925180000_add_external_circuit_foundation/migration.sql`: aditiva (sem DROP).
- `apps/api/src/modules/external-sync/`: `external-data-provider.ts` (abstração + implementação Jolpica), `external-sync-run.ts` (lock/coalescing + registro `ExternalSyncRun`), `jolpica.client.ts` (`getCircuits` paginado + url/lat/long), `jolpica.normalizer.ts` (`normalizeCircuits`, `normalizeCircuitsFromRaces`, país normalizado, coordenadas validadas), `jolpica.persist.ts` (`persistCircuits`, corridas com circuito vinculado), `jolpica.service.ts` (escopo `CIRCUITS`, runs envolvendo fetch+persistência), `jolpica.routes.ts` (auditoria `triggeredById`).
- `apps/api/src/modules/circuits/circuit.service.ts`: `ensureCircuitForUniverse` (materialização por Universe + binding, idempotente).
- Testes: `jolpica.circuit-normalizer.test.ts`, `external-circuit-sync.test.ts`, `circuits/circuit.service.test.ts`; ajustes em `jolpica.normalizer.test.ts` e `jolpica-sync.integration.test.ts` (campos novos e contagem de circuitos).

### Migrations executadas
- `20260925180000_add_external_circuit_foundation` — aplicada em `f1-narrative` (dev, aditiva) e `f1_narrative_test` (testes).

### Testes executados
- Focados: 7 arquivos / 59 testes — 100%.
- Suíte completa API: 98 arquivos / 1696 testes — 100%.
- `typecheck` API: 0 erros. Lint API: 30 erros (baseline inalterado; 0 novos).

### Problemas encontrados
1. `prisma generate` falhou com `EPERM` (a instância do Kiro segurava a DLL do query engine). Intervenção mínima: parada apenas da API, migração aditiva no dev DB, `generate` e **um único** restart; health validado (200). Sem interrupção da web.
2. O registro `ExternalSyncRun` inicialmente envolvia apenas a persistência — falhas de fetch não eram auditadas. Corrigido: o run agora envolve **fetch + persistência** (e o lock cobre a chamada externa).

### Decisões tomadas
Ver `docs/v3-decisions.md` (D-001 a D-006).

### Limitações
- F1DB não integrado nesta fase; campos `lengthMeters/turns/direction/layoutKey` existem e ficam nulos até fonte aprovada (nada inventado).
- O provider cobre `getCircuits` e `getSeasonSchedule`; os demais escopos continuam no `JolpicaClient` (abstração incremental, sem big-bang).
- `CIRCUITS` ignora o ano no run (`seasonYear = null`).
- `Race.circuitId` permanece opcional; backfill de corridas legadas fica para a Fase 3 (calendário).
- O banco `f1_narrative_test` foi mantido durante a execução das fases (recriado é descartável) e será removido ao final da V3.

### Commit
- `feat(v3): add structured external circuit model` (hash registrado no relatório da execução).

### Próximo passo
- Fase 2 — Timeline foundation (`TimelineEvent` + `WorldSnapshot` + recompute determinístico reutilizando o engine de progressão).

## Fase 2 — Timeline foundation

- **Data:** 2026-09-25
- **Objetivo:** fundação temporal do Universe — log append-only (`TimelineEvent`), checkpoints (`WorldSnapshot`), recomputação determinística, avanço temporal controlado e correções retroativas com preservação de histórico, reutilizando o engine de progressão existente e com isolamento total por Universe.

### Arquitetura final implementada
- **`TimelineEvent` (append-only):** `universeId`, `sequence` (única por universe), `worldDate`, `kind` (`WORLD_ADVANCED`, `RACE_RESULT_CORRECTED`, `STANDING_CORRECTED`, `NUMBER_CORRECTED`), `payload` JSON com dados suficientes para replay, `causedBy`, `supersedesId` (mesmo tipo), `createdAt`. Sem API de mutação/edição.
- **`WorldSnapshot` (checkpoint):** `universeId`, `sequence`, `worldDate`, `state` JSON (`world` + `standings` da temporada corrente). Único por `[universeId, sequence]`.
- **Ordenação determinística:** replay por `(worldDate, sequence)`; correções retroativas usam `worldDate` passado e entram no ponto histórico correto do replay.
- **Recompute:** seleciona o snapshot mais recente (ou um snapshot explícito) → restaura estado → aplica os eventos posteriores em ordem, **ignorando eventos superseded** → grava `WorldState` e `ChampionshipStanding` na mesma transação.
- **Reuso do engine:** a lógica de standings foi extraída para `championship-progression.service.recomputeSeasonStandings` e é usada **pela rota `apply` existente e pela timeline** (um único sistema de progressão).
- **Concorrência:** `pg_advisory_xact_lock(hashtext('timeline:<universeId>'))` dentro de transações interativas; `sequence` protegida por unique `[universeId, sequence]`.
- **Snapshot policy:** baseline em `sequence 0` no primeiro avanço; checkpoints automáticos a cada 20 eventos; criação explícita disponível via serviço.

### API
- `POST /api/timeline/advance`, `POST /api/timeline/corrections`, `POST /api/timeline/recompute`, `GET /api/timeline`, `GET /api/timeline/snapshots` (todas autenticadas e escopadas ao Universe do usuário).

### Migration
- `20260925190000_add_timeline_foundation` — aditiva (enum + 2 tabelas + índices/FKs); aplicada em `f1_narrative_test` e `f1-narrative` (DEV).

### Testes
- Focados: `timeline.service.test.ts` — **1 arquivo / 9 testes — 100%**, cobrindo: criação de evento, append-only, ordenação, snapshot inicial, snapshot explícito, recompute completo, recompute a partir de snapshot, mesmo histórico → mesmo estado, avanço, correção retroativa, supersession, falha transacional sem estado parcial, isolamento entre universos, concorrência e idempotência de replay.
- Suíte completa API (banco recriado): **99 arquivos / 1705 testes — 100%**.
- `typecheck` API: 0. Lint API: 30 (baseline, 0 novos).

### Problemas encontrados
1. `prisma generate` bloqueado por `EPERM` (Kiro segurando o engine). **Alternativa segura sem interromper o Kiro:** `prisma generate --no-engine` seguido de `prisma generate` normal (o engine existente é reutilizado). Nenhum processo do Kiro foi tocado.
2. `$queryRaw` para `pg_advisory_xact_lock` falhava (coluna `void` não desserializável) → trocado por `$executeRaw`.
3. Standings iniciais dependem do engine de progressão (não são derivados no primeiro avanço) → teste passou a preparar o estado inicial com `recomputeSeasonStandings`.
4. Execuções repetidas da suíte no mesmo banco de teste geram resíduo (falhas flaky) → suíte completa rodada em banco recriado (prática já conhecida do projeto).

### Decisões
Ver `docs/v3-decisions.md` (D-009 a D-013).

### Limitações
- Sem UI de timeline; sem automação completa do calendário/WorldState (Fase 3+).
- Snapshot automático a cada 20 eventos (sem gatilho de fim de temporada ainda).
- Correções suportam três kinds; branching/universos alternativos não implementados (por decisão).
- `NUMBER_CORRECTED` atualiza `SeasonDriverEntry` e, na ausência desta, o `DriverProfile`.

### Commit
- `feat(v3): add timeline foundation`.

### Próximo passo
- Fase 3 — Calendário automático + eventos de corrida + Next Race (somente após validação desta fase).

## Fase 3 — Calendário automático + eventos de corrida + Next Race

- **Data:** 2026-09-25
- **Objetivo:** materializar o calendário externo no Universe com associação estruturada Race ↔ Circuit, registrar mudanças de calendário na Timeline (append-only), criar o endpoint de Next Race baseado no estado do Universe e a UI mínima que o consome.

### Arquitetura
- **Materialização (reuso, sem segundo sistema):** `universeInitService.planRaces` passou a carregar os campos estruturados do `ExternalRace` (data, horário, circuito, país, hash) e a classificar `change` (`CREATED`/`UPDATED`/`UNCHANGED`) comparando o `contentHash` com o do binding. `materialize` cria/atualiza `Race` com `circuitId` resolvido por `ensureCircuitForUniverse` e mantém campos legados (`circuit`, `country`).
- **Timeline integrada:** corridas novas geram `RACE_SCHEDULED`; mudanças externas geram `RACE_UPDATED` (payload auditável: raceId, externalRaceId, round, nome, data, circuito). Eventos são **estado-neutros** no replay (não alteram `WorldState`/standings), preservando determinismo do recompute.
- **Override preservado:** `ExternalBindingRace` ganhou `contentHash` + `externalSnapshot`; o sync só sobrescreve um campo do `Race` se ele ainda for igual ao último valor externo (edições do usuário são mantidas).
- **Concorrência:** materialização toma o advisory lock do Universe **antes** do plan (evita duplicação em execuções simultâneas); timeline segue com seu lock.
- **Next Race:** `GET /api/next-race` deriva previous/current/next do `WorldState` + `Race`/`Circuit` do Universe, com `totalRounds` dinâmico e circuit info (campos ausentes retornam `null`). Nunca consulta a Jolpica.
- **UI mínima:** `HomeRaceWeekend` passou a consumir `/api/next-race` (loading/erro/vazio), com `R{round}/{total}` e link interno "Ver evento"; sem novas dependências.

### Migration
- `20260925200000_add_calendar_foundation` — aditiva: `ALTER TYPE TimelineEventKind ADD VALUE 'RACE_SCHEDULED'/'RACE_UPDATED'`; `ExternalBindingRace.contentHash` + `externalSnapshot`. Aplicada em `f1_narrative_test` e `f1-narrative` (DEV).

### Testes
- Focados: `calendar-materialization.test.ts` (7) + `next-race.test.ts` (6) — **13/13**; timeline 9/9 (teste de concorrência ajustado para datas iguais, comportamento correto de não-regressão).
- Suíte API completa (banco recriado): **101 arquivos / 1718 testes — 100%**.
- Web: **50 arquivos / 375 testes — 100%** (novo teste do Next Race); web tsc apenas os 4 baseline; typecheck API 0; lint API 30 (baseline).

### Problemas encontrados
1. Fixtures colidiam em uniques (`ExternalSeason [source, year]`, `ExternalCircuit [source, externalId]`) → ano/ids únicos por universo nos testes.
2. Materializações concorrentes duplicavam corridas (plan lido antes do lock) → lock do Universe movido para o início do `execute`.
3. Teste de concorrência da Fase 2 era flaky por ordem de datas (regressão legítima do segundo avanço) → corrigido para datas iguais.
4. Suíte completa é sensível a resíduo em execuções repetidas → execução final em banco recriado (log anexado).

### Limitações
- F1DB não integrado: `lengthMeters/turns/layout/layoutUrl/photoUrl` permanecem `null` até fonte aprovada (nada inventado).
- Sem UI completa de calendário; sem simulação de race weekend/sprint; statuses seguem o enum existente (sem `CANCELLED`).
- `RACE_UPDATED` registra a mudança; replay não reaplica calendário (auditoria).

### Commit
- `feat(v3): add calendar and next race foundation`.

### Próximo passo
- Fase 4 — Números dos pilotos (somente após validação desta fase).

---

## Fase 4 — Driver Number Management

### Escopo
- Regras FIA (2026 F1 Regulations, Section A, Issue 02, 27/02/2026, Art. A2.4) traduzidas para gameplay com autoridade no backend.
- Número por temporada (`SeasonDriverEntry.number` = autoridade; `DriverProfile.number` = cache de compatibilidade sincronizado quando a entry é da temporada corrente do `WorldState`).
- Unicidade por temporada garantida por constraint `@@unique([seasonId, number])` + tratamento de `P2002` (concorrência).
- Board de disponibilidade 1–99 (`GET /api/seasons/:seasonId/driver-numbers`) e atribuição (`PUT /api/seasons/:seasonId/drivers/:driverProfileId/number`), com `#17` reservado e `#1` exclusivo do campeão anterior.
- Auditoria via timeline (`NUMBER_CORRECTED`, replay idempotente) e UI de seleção na página do piloto.

### Arquivos
- `apps/api/src/modules/drivers/driver-number.rules.ts` (schema zod + inspeção central).
- `apps/api/src/modules/drivers/driver-number.service.ts` (board, atribuição, campeão, cache, timeline).
- `apps/api/src/modules/drivers/driver-number.routes.ts` + registro em `app.ts`.
- `apps/api/src/modules/drivers/driver-number.test.ts` (service + rotas).
- `prisma/migrations/20260925210000_add_driver_number_unique` + `@@unique([seasonId, number])`.
- `apps/web/src/lib/driver-numbers.ts`, `apps/web/src/hooks/use-driver-numbers.ts`, `apps/web/src/components/drivers/season-number-picker.tsx` (+ teste) e integração na página do piloto.

### Regras de gameplay (D-008)
- Range 1–99; `#17` sempre indisponível (reservado); `#1` apenas para o campeão da temporada anterior (mesmo Universe); unicidade por temporada.
- Erros semânticos: `NUMBER_INVALID` (400), `NUMBER_RESERVED` (409), `NUMBER_ALREADY_USED` (409), `CHAMPION_ONLY` (409), `SEASON_NOT_FOUND`/`DRIVER_NOT_FOUND` (404).

### Testes e validação
- API: suíte completa **1732/1732** em banco recriado (log `v3f4-suite3.log`); lint 30 (baseline, 0 novos).
- Web: **378/378** (inclui 3 novos do picker); `tsc` 4 (baseline).
- Fixtures de reconciliação ajustadas (dois números 2 na mesma temporada) e teste de perfil atualizado (`#17` inválido no PATCH).

### Problemas encontrados
1. Fixtures de `reconciliation` violavam a nova unicidade (dois pilotos nº 2 na mesma temporada) → números distintos (3).
2. Duas falhas intermitentes em execução completa (reconciliation/universe-init) passam isoladas e desaparecem em re-execução → resíduo entre arquivos, não regressão.

### Limitações
- Nenhuma sincronização de números com o espelho externo (apenas leitura/compatibilidade); sem migração automática de números legados duplicados (diagnóstico prévio: 0 no DEV).
- UI do board é mínima (sem busca/filtros); remoção de número (null) suportada pela API, sem botão dedicado na UI.

### Commit
- `feat(v3): add driver number management`.

### Próximo passo
- Fase 5 (somente após validação desta fase).
