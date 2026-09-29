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
- Regras FIA (2026 F1 Regulations, Section A, Issue 03, 25/06/2026 — publicada em 05/08/2026; A2.4 idêntico à Issue 02 — ver "Verificação regulatória" abaixo) traduzidas para gameplay com autoridade no backend.
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

---

## Verificação regulatória — FIA 2026 Section A (Issue 02 → Issue 03)

- **Data:** 28/09/2026.
- **Referência vigente:** FIA 2026 F1 Regulations — Section A [General Provisions] — Issue 03 (documento de 25/06/2026, aprovação WMSC 23/06/2026, publicado no site da FIA em 05/08/2026). Fontes: listagem oficial em fia.com/regulation/category/110 e PDF oficial (api.fia.com).
- **Art. A2.4 (Competition Numbers):** texto idêntico ao da Issue 02, frase a frase — A2.4.1 (número permanente first-come, uso em toda Competição da temporada, troca só antes da entry list e com efeito na temporada seguinte), A2.4.2 (`#1` para o campeão reinante; número anterior reservado se perder o título), A2.4.3 (forfeiture por escrito ou 2 Campeonatos consecutivos sem participar), A2.4.4 (demais pilotos usam números emitidos pela FIA à equipe), A2.4.5 (1–99, exceto 17).
- **Mudanças da Issue 03 (WMSC 23/06/2026):** sem impacto em numeração (heat hazard por Sprint/Corrida, boost mode em baixa aderência, ajustes de 2027/2028).
- **Conclusão:** D-008, D-018 e D-019 permanecem semanticamente compatíveis; nenhuma alteração de código ou comportamento necessária. Referência atualizada para Issue 03 em D-019 e registrada em D-022.
- **Limitação:** acesso direto ao PDF retornou 504 na checagem; texto conferido no conteúdo indexado do PDF oficial da FIA (api.fia.com) e na listagem oficial. Destaques de texto alterado (rosa) não são observáveis por indexação; a comparação foi feita frase a frase.

---

## Fase 5 — User Profile + Media Storage Foundation

- **Data:** 2026-09-28.
- **Objetivo:** perfil de usuário (favoritos + avatar) com abstração de storage isolada do domínio, upload seguro de imagem, implementação local e contrato S3-compatible, isolamento por usuário/Universe e UI funcional.

### Relação com o Better Auth (fonte única de nome/imagem/email)
- `User.name` (nome público/nick), `User.email` e `User.image` permanecem **exclusivamente no modelo do Better Auth**. Não há UI de edição de nome nesta fase (updateUser do BA já existe para isso).
- `UserProfile` foi criado apenas para **dados de domínio que não pertencem à autenticação**: `favoriteTeamId`/`favoriteDriverId` (+ `userId` único e timestamps). Nada de displayName/avatar duplicados.
- `User.image` guarda a URL controlada `BETTER_AUTH_URL/api/media/:id` (nunca a storageKey). A página de perfil lê a view sempre fresca de `GET /api/profile`; a sessão do BA pode continuar em cache de cookie por até 5 min (limitação documentada).

### Favoritos
- Referências por id ao `Team`/`DriverProfile` **do mesmo Universe** do usuário; validação no backend: `404 FAVORITE_NOT_FOUND` (inexistente) e `403 FAVORITE_NOT_IN_UNIVERSE` (outro Universe, inclusive entidades homônimas equivalentes).
- FKs com `onDelete: SetNull`; `UserProfile` inicializado de forma idempotente (upsert) em qualquer leitura/escrita do perfil.

### Storage
- `StorageProvider` (infra) com operações mínimas: `upload`, `delete`, `get`, `exists`; erros semânticos (`StorageError`) sem vazar key/segredo.
- `LocalStorageProvider`: raiz configurável (`STORAGE_LOCAL_ROOT`), keys geradas pelo servidor (`user-avatars/<userId>/<uuid>.<ext>`), flag `wx` (não sobrescreve), validação de key + contenção no root (anti path traversal), filename do cliente só como metadata sanitizada.
- `S3CompatibleStorageProvider`: SigV4 mínimo implementado sobre `fetch` (sem SDK novo), path-style default, tolerância a 404 em delete/get/exists; preserva capacidade futura de URL assinada/objeto privado (acesso atual é rota interna autenticada).
- `MediaAsset`: `ownerUserId`, `kind` (`USER_AVATAR`), `provider`, `storageKey` (único), `originalFilename`, `mimeType`, `byteSize`; tipos futuros (`CHARACTER_IMAGE`/`DRIVER_HEADSHOT`) não implementados.
- Migração aditiva `20260928120000_add_user_profile_media_storage`: enum `MediaKind`, tabelas `UserProfile` e `MediaAsset` (+ índices/FKs). Aplicada em `f1_narrative_test` e `f1-narrative` (DEV), sem operações destrutivas.

### Segurança e consistência
- Upload autenticado, binário cru (sem multipart), content-types permitidos JPEG/PNG/WEBP; validação por **magic bytes** no backend (Content-Type do cliente não é confiado); SVG/HTML/PDF/executáveis rejeitados; limite configurável (`STORAGE_MAX_UPLOAD_BYTES`, 413).
- Ownership: só o dono lê (`GET /api/media/:id` → 404 para terceiros), substitui e remove; nenhum `mediaAssetId` de outro usuário é manipulável.
- Estratégia upload→DB (sem transação aberta durante I/O de storage): upload → `MediaAsset` (compensa com delete se o create falhar) → `User.image` (compensa asset se o update falhar) → remoção best-effort do asset anterior; delete de referência primeiro e tolerância à ausência (idempotente).

### APIs
- `GET /api/profile`, `PATCH /api/profile` (somente favoritos; zod, rejeita `{}` e ids inválidos), `POST /api/profile/avatar` (raw binário), `DELETE /api/profile/avatar`, `GET /api/media/:id`.

### Web
- Página `/app/profile` (item "Perfil" no nav), com nome/email (sessão BA), avatar com fallback de inicial, preview local antes de salvar, substituição, remoção, selects de favoritos (equipe/piloto), estados de loading/erro/sucesso/sem favoritos e invalidação via React Query; avatar também exibido no sidebar/mobile usando o `User.image` da sessão.

### Testes e validação
- API focada: 24/24 (storage local, contrato S3 com servidor HTTP local, profile/media/isolamento/compensação).
- API completa (banco recriado): **1756/1756**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **385/385** (7 novos do perfil); `tsc` 4 (baseline); lint 0 erros; `next build` exit 0.
- Cobertura dos 30 cenários obrigatórios: rotas de perfil, inicialização, favoritos válidos/inexistentes/de outro Universe, upload válido/tipo inválido/tamanho/não autenticado, acesso cruzado a asset, substituição, remoção idempotente, falha de storage, compensação, key safety, path traversal, contrato S3, isolamento entre Users e entre Universes (entidades homônimas), zod, UI (página/upload/favoritos/invalidation), constraints da migration, integração auth e persistência após refetch.

### Problemas encontrados
1. `buildView` inicializava o `UserProfile` apenas em GET/PATCH → upload chamava `findUniqueOrThrow` sem perfil. Corrigido garantindo upsert idempotente em qualquer caminho de leitura.
2. Lint acusou `no-undef` para `Buffer`/`NodeJS` nos arquivos novos (config não declara globais Node) → imports explícitos de `node:buffer` e casts `{ code?: string }` (padrão do projeto).

### Limitações
- Sem edição de nome na UI (usa o Better Auth `updateUser` que já existe, não exposto nesta fase); sessão do BA pode exibir avatar antigo por até 5 min (cache de cookie) — a página de perfil sempre reflete o banco.
- Acesso a mídia é owner-only (sem página pública/compartilhamento); S3-compatible implementado por contrato (SigV4 mínimo) sem MinIO/S3 no ambiente local; sem varredura de órfãos de storage.
- Sem crop/redimensionamento de imagem; sem limite por dimensão (apenas bytes/formato).

### Commit
- `feat(v3): add user profile and media storage`.

### Próximo passo
- Fase 6 (somente após validação desta fase).

---

## Fase 6 — External Data Refresh + Sync Observability

- **Data:** 2026-09-28.
- **Objetivo:** refresh manual dos dados externos pela UI (backend-driven, admin), com observabilidade da última execução e proteção absoluta do Universe — sem segundo sistema de sync e sem migration.

### Fluxo
- UI `/app/external` → `POST /api/external-sync/refresh` (autenticado + admin) → `JolpicaSyncService.refreshSeason` → `ExternalDataProvider`/`JolpicaClient` → **External Mirror** (ExternalSeason/Team/Driver/DriverSeason/Race/Circuit/Result/Standing). O refresh **não** materializa nem altera Universe (sem `tryAutoMaterialize`).
- O endpoint legado `POST /api/external-sync/:source/:scope` permanece com o comportamento aprovado (inclusive auto-materialização), sem uso pelo botão.

### Scopes e ordem (explícita e idempotente)
- `SEASON → TEAMS → DRIVERS → DRIVER_SEASONS → RACES → RESULTS → STANDINGS` (RESULTS por último por volume; CIRCUITS global continua fora do botão).
- Cada escopo é um `ExternalSyncRun` próprio; falha em um escopo interrompe a sequência e retorna os escopos já concluídos.

### ExternalSyncRun (sem modelo novo)
- RUNNING → SUCCESS/FAILED, `startedAt/finishedAt`, `statistics`, `lastSyncedAt` no sucesso, `error` sanitizado (300 chars) e `triggeredById` por escopo. O lock `REFRESH` é apenas em memória (não cria linha), então não há histórico duplicado.
- `GET /api/external-sync/status?source=jolpica&limit=N` (autenticado, qualquer role): `lastRun`, `lastSuccess`, `recent` e `active` (locks em memória), com erro de exibição sanitizado (URLs → `[fonte externa]`; sem stack).
- `GET` nunca chama a fonte externa; a UI lê o Mirror pelas rotas existentes.

### Autorização
- Refresh admin-only preservando a regra existente (`403 FORBIDDEN`; `401` sem sessão; checagem no backend, não só na UI). Status é leitura autenticada para todos. O usuário comum não vê o botão e recebe orientação; a API continua rejeitando.

### Concorrência e coalescing
- Reutilizados os locks da Fase 1: escopos independentes continuam paralelizáveis; o refresh composto tem lock próprio por `source:REFRESH:year`, então dois cliques/duas requisições concorrentes compartilham a mesma execução (sem fetches duplicados e sem runs duplicados). `active` expõe os locks em andamento.
- Testado com `Promise.all` de dois refreshes: mesma resposta, um único conjunto de fetches e um único run por escopo.

### Erros externos
- Mapeamento no refresh: 429 → `429 SOURCE_RATE_LIMITED` (retry limitado pela infra existente), timeout → `504 SOURCE_TIMEOUT`, 404 → `404 SOURCE_NOT_FOUND`, payload inválido → `502 SOURCE_MALFORMED`, 5xx/outros → `502 SOURCE_UNAVAILABLE`, falha interna → `502 SYNC_FAILED`.
- Erro externo nunca é sucesso: o run termina FAILED com `finishedAt` (nenhum RUNNING preso) e a resposta não inclui stack, corpo externo, URL completa nem credenciais.

### UI e cache
- `ExternalSyncPanel` no `/app/external` (sem redesign): mostra fonte, última execução, última bem-sucedida, status, estatísticas, duração e falha sanitizada; botão admin com loading (desabilita durante a execução, evita cliques duplicados) e estados initial/loading/success/failure/empty/unauthorized.
- Após o refresh (sucesso ou falha), invalida as queries `["external"]` (inclui status, temporadas, times, pilotos, corridas, resultados, standings e candidatos) — sem reload da aplicação e sem cache global novo.

### Proteção do Universe
- Teste explícito: Universe com Team/Character/DriverProfile/SeasonDriverEntry/WorldState/Race customizados + binding com `contentHash`/`externalSnapshot`; refresh com mudança externa; nada do Universe muda e nenhum `TimelineEvent` é criado. Segundo Universe permanece intocado (isolamento).

### Testes e validação
- Focados: `src/modules/external-sync` — **7 arquivos / 71 testes — 100%** (14 novos: refresh autorizado/negado, validação, idempotência, mudança externa, concorrência/coalescing, locks ativos, 500/429/timeout/malformed/404, status, proteção do Universe e cross-Universe).
- Suíte API completa (banco recriado): **1770/1770**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **390/390** (5 novos do painel de sync); `tsc` 4 (baseline); lint 0; `next build` exit 0.
- Nenhuma migration necessária (o schema existente cobre tudo).

### Problemas encontrados
1. `REFRESH` não cria linha em `ExternalSyncRun` (é só lock em memória) — asserção de teste ajustada para medir runs por escopo; documentado para não confundir com histórico.
2. Fixture de teste criava run com `finishedAt` anterior ao `startedAt` default → duração negativa; corrigido no fixture.
3. `deleteUniverseDataForUsers` exige `(prisma, userIds)` — cleanup ajustado.

### Limitações
- Coalescing/locks são por processo (como na Fase 1); múltiplas instâncias da API poderiam duplicar fetches.
- Status lista runs sem paginação além de `limit` e sem filtro por escopo; sem retenção/expurgo de runs antigos.
- Em falha, o endpoint devolve os escopos concluídos, mas a UI exibe apenas a mensagem (os detalhes ficam no status via run FAILED).
- O botão atualiza a temporada selecionada; CIRCUITS global e sync de números com o Mirror continuam fora do escopo desta fase.

### Commit
- `feat(v3): add external data refresh`.

### Próximo passo
- Fase 7 (somente após validação desta fase).

---

## Fase 7 — News × Temporada

- **Data:** 2026-09-28.
- **Objetivo:** contextualizar notícias por temporada/corrida do Universe, expor feed filtrado (Home/Championship) e conectar eventos de corrida à cobertura jornalística — preservando Event como origem, NewsItem como derivada e sem segundo sistema de eventos/notícias.

### Modelagem (sem migration)
- Nenhuma coluna nova: o contexto já vive em `Event.payload.seasonId`/`payload.raceId` (eventos gerados pela narrativa de corrida sempre incluem ambos). NewsItem continua 1:1 por Event (materialização transacional com advisory lock e `findFirst`+update/create existentes).
- `NewsItem` sem vínculo determinável permanece sem contexto e fora dos feeds de temporada/corrida (continua acessível em `GET /api/events/:id/news`).

### Event → NewsItem
- Eventos gerados por `processRaceNarrative` agora chamam `syncNewsForEvent` na mesma transação (antes só `applyEventEvolution`), reutilizando a deduplicação existente: reprocessar a corrida não duplica eventos nem notícias.

### API
- `GET /api/news?seasonId=&raceId=&limit=&offset=` (autenticado): sem filtro usa a temporada corrente do `WorldState`; `seasonId`/`raceId` validados no Universe do usuário (`404 SEASON_NOT_FOUND`/`RACE_NOT_FOUND`, `403 SEASON_NOT_IN_UNIVERSE`/`RACE_NOT_IN_UNIVERSE`); resposta `{ news, context, hasMore, nextOffset }` com `context.season`/`context.race` por item.
- Ordenação determinística: `worldDate desc (nulls last)`, `createdAt desc`, `id desc`; paginação por `limit` (1–50, default 20) + `offset`, sem quebrar consumidores (rota nova).
- Eventos (POST/PATCH) validam `payload.seasonId`/`payload.raceId` contra o Universe do usuário (`404`/`403`/`400 INVALID_EVENT_CONTEXT`), impedindo associação cruzada entre universos.

### Isolamento e princípios
- Feeds sempre resolvem Season/Race dentro do Universe; itens de outro Universe nunca aparecem (defesa extra no mapeamento de contexto).
- Timeline continua estado/replay (nenhum evento de timeline criado por notícia); external refresh não cria Event/NewsItem.
- Nenhuma automação social nova: apenas cobertura dos acontecimentos existentes.

### UI
- `SeasonNewsFeed` (componente reutilizável) no Home (temporada corrente) e no Championship (temporada selecionada): loading, erro com retry, vazio, lista com contexto (`R{round} · corrida` ou `Temporada {ano}`) e link para o Event existente.
- Invalidação: mutações de Event passaram a invalidar `["news"]` (além de events/news por evento).

### Testes e validação
- API focada: `src/modules/news` — **12/12**; relacionadas (events/narrative/context): 206/206.
- Suíte API completa (banco recriado): **1782/1782**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **397/397** (7 novos do feed); `tsc` 4 (baseline); lint 0; `next build` exit 0.
- Sem migration (schema atual cobre o requisito).

### Problemas encontrados
1. `payload.path.raceId in [...]` não é suportado pelo filtro JSON do Prisma → feed por temporada usa `payload.seasonId` (sempre presente nos eventos de corrida) e por corrida usa `raceId` único; sem consulta indisponível.
2. Teste do feed esperava notícia sem link com `eventId` preenchido → fixture ajustada para `eventId: null` (caso real de notícia sem contexto).

### Limitações
- Filtro por JSON path não usa índice; volume atual é pequeno (sem necessidade de índice GIN nesta fase).
- Feeds de temporada/corrida não incluem notícias legadas sem `payload.seasonId` (eventos antigos permanecem visíveis apenas no detalhe do Event).
- UI sem seletor de corrida e sem paginação ("mostrar mais"); API já suporta ambos.
- Um NewsItem por Event (sem 1:N de cobertura) — semântica existente preservada.

### Commit
- `feat(v3): add season-aware news`.

### Próximo passo
- Fase 8 (somente após validação desta fase).
