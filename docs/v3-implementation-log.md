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

---

## Fase 8 — Real-time / SSE Foundation

- **Data:** 2026-09-28.
- **Objetivo:** fundação de SSE seguro sobre o pipeline de geração existente, com deltas incrementais, contrato de eventos tipado, fallback tradicional, autenticação por conexão e isolamento por conversa — sem segundo motor de geração e sem migration.

### Arquitetura
- **Provider capability opcional:** `GenerationProvider.runStream?(input, { onDelta, signal })` com `ProviderOutput` idêntico ao `run()`; `ProviderAbortSignal` estrutural evita acoplamento ao DOM/Node. Providers sem streaming continuam válidos (`run` apenas).
- **Reuso do pipeline:** `assembleGenerationBundle` ganhou `stream?: { onDelta, signal }` e `runProvider` decide entre `runStream` (quando existir) e `run` + delta único (fallback server-side). `executeTurn` ganhou hooks `onStarted`/`onDelta`, `signal` e `failFast` no modo stream; o `/turn` tradicional segue sem hooks.
- **Ollama:** `OllamaProvider.runStream` faz `stream: true` com `Accept: text/event-stream`, lê o corpo incrementalmente, parseia `data:`/`[DONE]` e acumula o texto; abort externo/timeout usam a mesma infra de `AbortController`; erros mantêm as categorias existentes e não vazam prompts/URLs.

### Endpoint e contrato SSE
- `POST /api/conversations/:id/turn/stream` (cookie auth; mesmos schemas do `/turn`): 401/400/404 em JSON antes do streaming; depois, `reply.hijack()` + `text/event-stream` com heartbeat `: ping` a cada 15s.
- Eventos fixos e tipados (zod no cliente): `generation.started` (`requestId`, `conversationId`, `speakers`), `generation.delta` (`characterId`, `delta`), `generation.completed` (`userMessage`, `messages`, `failedSpeakers` — mesmo resultado do `/turn` 201), `generation.error` (`code`, `message` sanitizado: `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`, `TURN_USER_MISSING`, `RAG_FRAME_NOT_FOUND`, `TURN_FAILED`).
- Deltas contêm apenas texto incremental; nada de systemPrompt/contexto/RAG/stack. `generation.completed` só é emitido após a persistência normal de cada mensagem (mesmo pipeline do `/turn`).

### Desconexão, concorrência e cleanup
- `request.raw`/`reply.raw` `close` aborta a geração via `AbortSignal` (propagado até o provider); nada parcial é persistido e nenhum evento é escrito após a desconexão.
- Backpressure via `drain` com fila serializada de frames (sem buffer infinito); heartbeat encerrado no `finally`; `activeStreams` contém apenas o `requestId` e é limpo em todos os caminhos (testado).
- Sem broadcast: cada conexão carrega seu próprio writer/estado; gerações concorrentes em conversas diferentes ficam isoladas.

### Web
- `streamTurnMessage` (fetch + reader + parse SSE validado por zod) em `lib/conversations.ts`; `useStreamingTurn` no lugar do mutation tradicional no composer: placeholder de IA por speaker, deltas incrementais na cache (`setQueryData`), consolidação no `completed` (merge por id, sem duplicar), invalidação apenas de conversa/lista, abort no unmount e bloqueio de segundo envio enquanto pendente.
- **Fallback determinístico único:** se o SSE falhar antes de qualquer delta, o hook chama `POST /turn` uma única vez; se falhar depois de deltas, remove placeholders, mostra erro e refaz o fetch das mensagens. Sem loops.
- `/generate` e `/turn` permanecem inalterados para consumidores existentes.

### Testes e validação
- API: `conversation-turn-stream.test.ts` (8, servidor real + fetch streaming: auth/ownership, started/delta/completed, persistência, equivalência com `/turn`, fallback sem streaming, erro/timeout/malformed, desconexão+abort+cleanup, concorrência e isolamento, cookie inválido, ausência de vazamento de contexto/memória) + `ollama-provider-stream.test.ts` (5: ordem/`stream:true`, chunk inválido, vazio, HTTP, abort/timeout).
- Suíte API completa (banco recriado): **1795/1795**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **403/403** (6 novos de streaming + ajustes de mocks); `tsc` 4 (baseline); lint 0; `next build` exit 0.
- Sem migration (schema atual cobre).

### Problemas encontrados
1. `writeRaw` respeitava o flag `closed` também para frames já enfileirados → `generation.completed`/`error` perdidos. Corrigido com fila serializada que só verifica `writableEnded`.
2. Falha do provider era absorvida por speaker (comportamento do `/turn`), impedindo `generation.error` no SSE → `failFast` explícito no modo stream re-lança o erro (abort continua silencioso).
3. Teste de concorrência mapeava deltas por ordem de chamada (flaky sob carga) → marcador derivado do próprio prompt.
4. `no-undef` de ESLint para `setInterval`/`TextDecoder`/tipos `AbortSignal` → `globalThis` e tipo estrutural (0 novos).

### Limitações
- SSE é por instância/processo (sem pub/sub); retomada de stream interrompido não existe (o cliente refaz o fetch e usa fallback).
- Sem persistência incremental: a mensagem final só existe ao terminar (deltas são efêmeros no cliente).
- Cookie cache do Better Auth pode manter sessão válida por até ~5 min após expiração no banco (sem impacto no fluxo testado com cookie inválido/ausente).
- Texto sem formatação incremental (sem markdown/cursor no bubble); heartbeat fixo de 15s sem configuração por env.

### Commit
- `feat(v3): add generation sse foundation`.

### Próximo passo
- Fase 9 (somente após validação desta fase).

---

## Fase 9 — AI Behavior / Decision Engine Foundation

- **Data:** 2026-09-28.
- **Objetivo:** camada de decisão comportamental para Characters AI com policy auditável, execução explícita por trigger e reuso total do domínio existente (geração, Event/News, Memory/Relationship) — sem scheduler, sem autonomia irrestrita e sem LLM decidindo operações de banco.

### Arquitetura (Context → Decision → Policy → Action → Execution → Audit)
- **Decision engine determinístico:** heurística server-side decide a intenção (`CREATE_EVENT` se há corrida corrente sem acontecimento do personagem; senão `SEND_MESSAGE` se há conversa com personagem do usuário; senão `NO_ACTION`). O LLM não decide nem executa: é usado apenas pelo pipeline de geração para compor o conteúdo de `SEND_MESSAGE`.
- **Decision model:** `AiDecision` registra `status` (NO_ACTION/DECIDED/EXECUTING/EXECUTED/REJECTED/FAILED), `actionType` (NO_ACTION/SEND_MESSAGE/CREATE_EVENT), alvo (`conversationId`), `reason`, `contextVersion` (`ai-behavior.v1`), `policyCode`, referências de resultado (`executedMessageId`/`executedEventId`) e `metadata` mínimo (trigger, season/race, participantIds). Sem prompts/contexto completo.
- **Policy:** só `controlledBy = AI` age; personagem precisa ser do usuário e do Universe (`404`/`403` semânticos); target revalidado sempre no banco (metadata não é confiável): conversa com o personagem AI, usuário presente como personagem USER, nenhum participante de outro Universe; evento exige corrida/participantes do mesmo Universe e reutiliza o helper de criação.
- **Auditabilidade:** cada avaliação cria uma linha; execução só ocorre via `POST /execute` por `decisionId`; `NO_ACTION` é resultado de primeira classe (não é erro) e não executa.

### Ações
- `SEND_MESSAGE`: `assembleGenerationBundle` + `persistGeneratedMessage` (mesmo pipeline do `/turn`), com instrução interna fixa passada como `userPrompt` (não persistida como mensagem), speaker = Character AI.
- `CREATE_EVENT`: `createEventWithDerivations` (helper extraído do POST /api/events e reutilizado pela rota) → Event `SOCIAL` + `syncNewsForEvent` + `applyEventEvolution`, com participantes criados antes das derivações → NewsItem, Memory e Relationship pelo fluxo existente. Dedup: nova avaliação não recria evento para a mesma corrida/personagem (fallback para `SEND_MESSAGE`).
- Nenhuma escrita direta em Timeline; nenhuma criação manual de News/NewsItem.

### Concorrência e cooldown
- Claim atômico `DECIDED → EXECUTING` dentro de transação com `pg_advisory_xact_lock(hashtext('ai-behavior:<characterId>'))`; segunda execução concorrente recebe `409 DECISION_NOT_EXECUTABLE` (ou `COOLDOWN` quando é outra decisão do mesmo personagem).
- Cooldown por `actionType` (SEND_MESSAGE 5 min; CREATE_EVENT 30 min) e limite de 5 ações/hora por personagem, derivados da própria auditoria (sem tabela nova). Rate-limit local à API (single-process documentado).

### API
- `POST /api/ai-behavior/evaluate` (`{ characterId, trigger? }`), `POST /api/ai-behavior/execute` (`{ decisionId }`), `GET /api/ai-behavior/decisions` (auditoria por personagem, limit 1–50). Autenticado; ownership/universe em todas; erros semânticos; falha de provider vira `FAILED` (sem estado parcial), violação de policy vira `REJECTED`.

### Web
- `AiBehaviorPanel` na página do Character (somente `controlledBy = AI`): última decisão (ação + status + motivo + policyCode + referência de resultado), botão "Avaliar comportamento" e "Executar decisão" quando `DECIDED`, estados loading/success/failure/no action e invalidação da auditoria após cada mutação. Sem redesign e sem UI de scheduler.

### Testes e validação
- API: `ai-behavior.test.ts` — **12/12** cobrindo os 25 cenários (evaluate/execute, USER proibido, outro usuário/Universe, NO_ACTION, SEND_MESSAGE com pipeline+persistência, cooldown/frequência, concorrência de avaliação/execução, provider indisponível/timeout/malformed sem estado parcial, CREATE_EVENT com Event/News/Memory/Relationship, dedup, metadata não confiável, isolamento de universos/conversas, revalidação de estado, segredo/stack ausentes).
- Suíte API completa (banco recriado): **1807/1807**; reexecução confirmou flake de resíduo pré-existente em `universe-init` (passa isolado e na segunda execução — mesmo comportamento registrado na Fase 4). Typecheck 0; lint 30 (baseline, 0 novos).
- Web: **409/409** (6 novos do painel); `tsc` 4 (baseline); lint 0; `next build` exit 0.

### Migration
- `20260928130000_add_ai_decision` — aditiva (enums `AiDecisionStatus`/`AiActionType`, tabela `AiDecision` com FKs cascade e índices); aplicada em `f1_narrative_test` e `f1-narrative` (DEV), sem operações destrutivas.

### Problemas encontrados
1. Cooldown acusava a própria decisão recém-marcada como `EXECUTING` (self-match) → ordem ajustada: dentro do lock, validar pendência → checar cooldown → só então claim.
2. Fixtures de teste usavam um Universe por usuário (unique `userId`), impedindo segunda fixture no mesmo usuário → cenários passaram a criar pares extras dentro do mesmo Universe.
3. Teste de malformed reutilizava o app/provider de timeout → segundo app dedicado em vez de novo Universe.

### Limitações
- Decisão é 100% heurística nesta fase (gancho para decisão via LLM fica para fase futura); triggers são manuais/explícitos (sem scheduler, sem cron); `Event` permanece global por design (payload carrega `universeId`/`raceId` para auditoria e feeds), com isolamento garantido por validação de participantes/conversa.
- Cooldown/limite são por processo + banco advisory (multi-instância continua suportado pelo advisory lock, mas a contagem é no banco — consistente).
- Sem retomada de decisões presas em `EXECUTING` após crash (auditoria explícita, sem scheduler).

### Commit
- `feat(v3): add ai behavior foundation`.

### Próximo passo
- Fase 10 (somente após validação desta fase).

---

## Fase 10 — Driver / Team Evolution

- **Data:** 2026-09-28.
- **Objetivo:** evolução contextual de atributos de pilotos e performance de equipes por temporada, derivada de resultados reais do Universe, determinística, auditável e idempotente — reutilizando `DriverAttribute`/`TeamPerformance` e sem novo sistema de atributos.

### Fonte de verdade e modelagem
- `DriverAttribute` (speed/consistency/racecraft/aggression) e `TeamPerformance` (carSpeed/reliability/operations) continuam **season-scoped** via `Season.universeId`; nada de coluna nova. Rows são materializadas no primeiro `apply` (antes disso valem os defaults efetivos 50, como na simulação).
- External Mirror permanece factual: nenhum `External*` participa da evolução e external refresh não toca atributos (testado). Um Universe pode ter valores próprios por temporada sem interferência de outro.

### Evolution engine (determinístico)
- `evaluateSeasonEvolution` (puro) calcula métricas por piloto/equipe a partir de `RaceResult` de corridas com `status = FINISHED`, na ordem determinística por `raceId:driverProfileId`.
- Deltas por avaliação, limitados a ±3 e com clamp final 0..100: piloto (speed: vitórias/pódios/ganho de posições; consistency: taxa de conclusão; racecraft: posições ganhas+pódios; aggression: abandonos) e equipe (carSpeed: vitórias/pódios; reliability: −abandonos; operations: taxa de conclusão). Sem RNG: mesma entrada → mesmo change set.
- `fingerprint` SHA-256 canônico de (raceId, driverProfileId, position, grid, status, points) dos resultados considerados.

### Fluxo Context → Evaluation → Change Set → Validation → Apply → Audit
- `POST /api/evolution/seasons/:seasonId/evaluate` (dry-run): retorna `changeSet` (before/after, racesConsidered, fingerprint, `changed`, `alreadyApplied`); nunca escreve.
- `POST /api/evolution/seasons/:seasonId/apply`: valida ownership do Universe/temporada, recalcula o change set, abre transação com `lockUniverseTimeline`, verifica idempotência pelo fingerprint já registrado (→ `409 ALREADY_APPLIED`), faz upsert dos atributos/performance e grava `TimelineEvent` `ATTRIBUTE_EVOLVED` (auditoria; replay state-neutral, como `RACE_SCHEDULED`). Sem mudanças → `409 NO_CHANGES`.
- `GET /api/evolution/seasons/:seasonId`: última execução (mundo/aplicado em, fingerprint, corridas consideradas, contagens).
- Erros semânticos: `SEASON_NOT_FOUND` 404, `SEASON_NOT_IN_UNIVERSE` 403, `ALREADY_APPLIED`/`NO_CHANGES` 409; 401 sem sessão.

### Integração e isolamento
- Resultados de corrida/campeonato: apenas corridas finalizadas contam; corridas em andamento não alteram fingerprint nem propõem mudanças. USER e AI evoluem igualmente (atributo pertence ao DriverProfile).
- Timeline permanece estado/replay (kind novo documentado como auditoria); nada de histórico paralelo. Simulações existentes passam a consumir os valores evoluídos quando o usuário rodar qualifying/race novamente (comportamento explícito, sem automação).

### Testes e validação
- API: `evolution.test.ts` — **10/10** (dry-run determinístico sem escrita, apply materializando rows + timeline + status, idempotência por fingerprint, nova corrida finalizada gera novo fingerprint/aplicação, NO_CHANGES, corridas não finalizadas ignoradas, isolamento entre universos, ownership/401, clamp 0..100, external refresh/recompute sem reescrever atributos).
- Relacionadas (timeline/simulation/performance/championship/events): 137/137.
- Suíte API completa (banco recriado): **1817/1817**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **409/409**; `tsc` 4 (baseline); lint 0; `next build` exit 0 (sem mudanças de Web nesta fase).

### Migration
- `20260928140000_add_attribute_evolution_kind` — aditiva (`ALTER TYPE TimelineEventKind ADD VALUE 'ATTRIBUTE_EVOLVED'`), aplicada em `f1_narrative_test` e `f1-narrative` (DEV).

### Problemas encontrados
1. Helper interno `clamp` era chamado com bounds extras (deltas) → separado em `clamp` (0..100) e `bound` (faixa de delta).
2. Testes assumiam ordem do array de drivers; deltas agora localizados por `driverProfileId` (ordenação por id é estável, mas o vencedor não é o índice 0).
3. `evaluate` após `apply` propunha deltas novamente (deltas relativos) → respondido com `alreadyApplied` (fingerprint do último evento), mantendo `apply` bloqueado por 409.
4. Cleanup de teste esbarrava em FKs `Restrict` de `SeasonDriverEntry` → uso do `deleteUniverseDataForUsers` padrão.

### Limitações
- Sem rolagem automática entre temporadas (carry-over fica para fase futura); evolução é sempre explícita via API (sem scheduler).
- `aggression` e `operations` evoluem mas ainda não são consumidos pela simulação atual (campos permanecem preparados); `racecraft` só afeta a corrida (não o qualifying).
- Sem UI dedicada nesta fase (operável por API; painéis podem ser adicionados depois).
- Rodar simulações com atributos evoluídos pode alterar resultados anteriores se re-simulados (a simulação continua explícita e determinística por entrada).

### Commit
- `feat(v3): add driver/team evolution`.

### Próximo passo
- Fase 11 (somente após validação desta fase).

---

## Race Weekend — Parte 1: determinação de Sprint Weekend

- **Data:** 2026-09-28.
- **Escopo aprovado (decisão do usuário):** resolver **somente** a determinação de Sprint Weekend (flag manual do Universe + informação externa quando existir). Sprint scoring, Practice, Qualifying, Race e o state machine do fim de semana ficam para a validação/etapa seguinte da Fase Race Weekend.

### Fontes FIA consultadas e registradas
- **Section A [General Provisions] — Issue 03 (25/06/2026, WMSC 23/06/2026, publicada em 05/08/2026):** Art. A2.2.2 — pontos de Sprint P1..P8 = 8,7,6,5,4,3,2,1, atribuídos a Drivers' e Constructors' Championship; sem pontos se o líder não completar 2 voltas consecutivas sem Safety Car/VSC; com 2 voltas mas menos de 50% da Scheduled Sprint Distance não há pontos; com ≥50% aplica-se a tabela; dead heat pela regra oficial. *(decisão de produto registrada em D-045; implementação fica para a parte de scoring)*
- **Section B [Sporting] — vigente: Issue 08 (publicada em 05/08/2026), artigos de referência:** B2.1 Free Practice Session(s); B2.2 Sprint Qualifying Session (SQ1/Q2/Q3, 12/10/8 min conforme Issues 06+); B2.3 Sprint Session (B2.3.1 "At a each Alternative Format Competition, a sprint session will take place on the second day of track running"; B2.3.2 distância; B2.3.4 grid via Sprint Qualifying; B2.3.5 classificação); B2.4 Race Qualifying; B2.5 Race. Formato alternativo substitui duas prácticas; Sprint ~100 km sem pit stop obrigatório.
- **Limitação de verificação:** PDFs oficiais retornaram 504 no acesso direto; texto conferido via conteúdo indexado dos PDFs oficiais da FIA (api.fia.com/fia.com) e listagem oficial de regulamentos (Section B Iss 08 na lista de 05.08.26).

### Modelagem escolhida (D-044)
- `ExternalRace.hasSprint Boolean?` — sugestão estruturada da fonte: `true` quando o payload traz `Sprint`/`SprintQualifying` preenchido; `false` quando a fonte enumera o cronograma de sessões (FirstPractice/SecondPractice/ThirdPractice/Qualifying) sem Sprint; `null` quando não há informação (nunca heurística por nome/país/round).
- `Race.sprintOverride Boolean?` — autoridade do Universe (manual, editável pelo usuário).
- `Race.sprintExternal Boolean?` — última sugestão externa materializada.
- **Valor efetivo:** `hasSprint = sprintOverride ?? sprintExternal ?? false`, exposto em `GET/POST/PATCH /api/races` e no `NextRaceEntry`; refresh/materialização atualiza apenas `sprintExternal` (override nunca é tocado).

### Arquivos
- `prisma/schema.prisma` + migration `20260928150000_add_sprint_weekend_detection` (aditiva: 3 colunas Boolean?).
- `external-sync/jolpica.client.ts` (campos crus de sessão), `jolpica.normalizer.ts` (`detectHasSprint` + `NormalizedRace.hasSprint`, sem heurística de nome), `jolpica.persist.ts` (persiste `hasSprint`; entra no `contentHash`).
- `universe-init/universe-init.service.ts` (plan/materialize/applyExternalRaceUpdate + payload de auditoria do RACE_SCHEDULED/UPDATED).
- `championship/championship.routes.ts` + `championship.schema.ts` (campos e `hasSprint` efetivo; PATCH aceita `sprintOverride`).
- `calendar/next-race.service.ts` (`hasSprint` efetivo no Next Race).
- Web: `lib/championship.ts`, `lib/next-race.ts`, `race-form.tsx` (seletor Automático/Com Sprint/Sem Sprint), `race-card.tsx` (chip "Sprint").

### Testes e validação
- Novo `calendar/sprint-weekend.test.ts`: **8/8** cobrindo os 10 cenários exigidos (external true/false/null sem heurística; override true sobre false; override false sobre true e volta para automático; refresh atualiza sugestão sem remover override; dois universos com decisões diferentes no mesmo weekend externo; espelho intacto; sync idempotente com `hasSprint` estável; materializações concorrentes preservando override e sem duplicar corrida) + unit de detecção/hash.
- Suíte API completa em banco recriado: **1825/1825**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **409/409** (uma falha intermitente em `external-page.integration.test.tsx` sob carga, módulo não tocado: passa isolado e a reexecução completa ficou verde — registrado como flake, não baseline); `tsc` 4 (baseline); lint 0; `next build` exit 0.

### Limitações / pendências explícitas
- **Sprint scoring ainda não implementado** (decisão registrada em D-045: tabela oficial 8–1 nos dois campeonatos, com as condições de distância); a parte de scoring/classificação exige o modelo próprio de resultado de sessão (`RaceSessionResult`) e integração com `recomputeSeasonStandings` — próximo passo.
- Practice/Qualifying/Sprint/Race lifecycle, state machine e `WorldState.currentSession` com `SPRINT` não fazem parte desta parte (ficam para a sequência da Fase Race Weekend).
- `ExternalRace.hasSprint` depende da fonte: Jolpica omite sessões quando não fornece o detalhe → `null` (indeterminado), nunca `false` inventado.

### Commit
- `feat(v3): add sprint weekend detection` (parte 1 da Fase Race Weekend).

---

## Race Weekend / Sessions — Parte 2: sessões, lifecycle e Sprint scoring

- **Data:** 2026-09-28.
- **Objetivo:** concluir a Fase Race Weekend — modelo próprio de resultado de sessão, Practice/Sprint Qualifying/Sprint/Qualifying/Race, state machine, WorldState, scoring oficial de Sprint e UI mínima — reutilizando os simuladores existentes.

### Modelo de resultado de sessão (D-046)
- Novo `RaceSessionResult` (migration aditiva `20260928160000_add_race_session_results`): `raceId`, `driverProfileId`, `teamId?`, `session` (RaceSession), `position`, `laps?`, `status`, `timeMs?`, `points`, `metadata`, `provenance/sourceHash`; unique `[raceId, driverProfileId, session]`.
- `RaceResult` continua exclusivo da Race (grid e classificação). Practice, Sprint Qualifying, Sprint e Qualifying persistem em `RaceSessionResult`; a Qualifying também mantém o grid em `RaceResult.grid` (semântica existente preservada).
- Enums ampliados: `RaceStatus`/`RaceSession` ganham `PRACTICE`, `SPRINT_QUALIFYING` e `SPRINT`; `TimelineEventKind` ganha `SESSION_COMPLETED` (auditoria state-neutral no replay).

### Lifecycle e state machine (D-047)
- Sequência por configuração do weekend: padrão `PRACTICE → QUALIFYING → RACE`; com Sprint `PRACTICE → SPRINT_QUALIFYING → SPRINT → QUALIFYING → RACE`. `effectiveSprint` vem da determinação da parte 1 (override > externo > false).
- `GET /api/races/:raceId/weekend` expõe configuração, sessão atual/próxima e cada sessão como `COMPLETED/AVAILABLE/LOCKED` com resultados.
- `POST /api/races/:raceId/weekend/sessions/:session/run` valida a ordem (predecessor obrigatório), bloqueia Sprint em weekend sem Sprint (`409 SPRINT_NOT_CONFIGURED`), duplicatas e weekend finalizado (`409 SESSION_NOT_AVAILABLE`); `rerun:true` é permitido apenas para Practice enquanto ela é a sessão corrente (substitui o resultado, sem duplicar auditoria).
- Concorrência: transação com `pg_advisory_xact_lock(hashtext('race-weekend:<raceId>'))` + lock da timeline, revalidando o status dentro do lock; duas chamadas simultâneas → uma executa, a outra recebe 409. Falhas fazem rollback (nada parcial).
- WorldState: cada sessão concluída atualiza `currentRaceId`/`currentSeasonId` e `currentSession`; o apply do campeonato marca a corrida `FINISHED` e limpa `currentSession` do Universe.
- Timeline: um `SESSION_COMPLETED` por sessão (payload raceId/session/resultCount + elegibilidade do Sprint), ignorado no replay; recompute determinístico não altera resultados.

### Simulações reutilizadas
- Practice e Sprint Qualifying reutilizam o motor de qualifying com seeds dedicados (`:practice`, `:sprint-qualifying`); Qualifying reutiliza o seed oficial e persiste grid; Race reutiliza o motor de corrida (seed oficial).
- Sprint usa o motor de corrida com grid vindo do Sprint Qualifying e seed `:sprint`.
- Refatoração mínima: `computeQualifyingRun`/`computeRaceRun` exportados (com `seedSuffix`/`grid` opcionais) e usados pelo runner dentro da mesma transação; endpoints tradicionais mantêm o comportamento.

### Sprint scoring (D-048)
- `sprintPointsForPosition` (8..1, sem fastest lap) separado de `pointsForPosition` (25..1); elegibilidade explícita (`neutralizedStart`, `distancePct >= 50`) com dead heat compartilhando a soma das posições empatadas.
- `recomputeSeasonStandings` continua a única autoridade: lê `RaceResult` + `RaceSessionResult(SPRINT)`, regrava os pontos de Sprint e agrega Drivers' (soma) — Constructors derivam da soma por equipe via `teamId`. Simulador v1 assume distância completa e sem neutralização (registrado no metadata; seam para SC/VSC/voltas futuras).

### UI
- `HomeRaceWeekend` agora consome `/api/races/:id/weekend`: badge "Sprint", faixa de sessões com estados (Concluída/Disponível/Bloqueada), botão "Executar {sessão}" com loading e erro, resumo do último resultado com pontos, e `Sprint` nos labels de sessão. Invalidação de weekend/next-race/world após execução; sem alterações arquiteturais de UI.

### Testes e validação
- `race-weekend.test.ts` — **11/11** cobrindo os 33 cenários exigidos (lifecycle padrão e com Sprint, SQ sem tocar grid, scoring 8–1, elegibilidade zerada, dead heat, duplicata, rerun controlado, concorrência (Practice/Qualifying/Race), WorldState, Next Race, Timeline determinística, isolamento de universos/espelho, ausência de Evolution/AI automáticos, contrato/erros e regressão do lifecycle).
- Suíte API completa em banco recriado: **1836/1836**; typecheck 0; lint 30 (baseline, 0 novos).
- Web: **412/412** (novos testes de sessões/Sprint/erro); `tsc` 4 (baseline); lint 0; `next build` exit 0.
- Migration aplicada em `f1_narrative_test` e `f1-narrative` (DEV), aditiva.

### Problemas encontrados
1. Seed único do espelho externo nos fixtures colidia (`[source, seasonYear, round]`) → rounds dedicados por fixture.
2. Asserções assumiam que o vencedor da Race seria o mesmo do Sprint e que `RaceResult.points` já estaria preenchido antes do apply → passaram a calcular o esperado por posição/`pointsForPosition` e reconsultar após o apply.
3. `let resultCount = 0` gerava lint `no-useless-assignment` → declaração sem valor inicial.
4. Cleanup de teste esbarrava em FKs `Restrict` de `SeasonDriverEntry` → `deleteUniverseDataForUsers` padrão.

### Limitações
- Simulador v1 não modela voltas nem SC/VSC; a elegibilidade do Sprint é avaliada com distância completa e sem neutralização (mecanismo pronto para receber esses dados quando a simulação evoluir).
- `RaceSessionResult.laps/timeMs` existem, mas permanecem nulos na v1 (não inventados).
- Sem scheduler/WorldState automático: toda progressão é explícita; Evolution continua acionada manualmente; AI Behavior não avança o weekend.
- Sem UI dedicada de resultados por sessão no campeonato (o card do Home mostra o resumo; a API expõe os resultados completos).

### Commit
- `feat(v3): add race weekend sessions`.

### Próximo passo
- WorldState Progression Auto (fase futura; não iniciada nesta execução).

---

## V3.12 — WorldState Progression Auto (Subfase A)

- **Data:** 2026-09-28.
- **Objetivo:** transformar o lifecycle do Race Weekend em progressão de WorldState controlada pelo domínio, sem cron/scheduler e sem inventar política de relógio.

### Implementação (D-049)
- Novo serviço explícito `progressWorldState(userId)` em `apps/api/src/modules/world/world-progression.service.ts` e rota `POST /api/world/progress` (autenticada, Universe do usuário), retornando `{ world, changed, transition }`; sem transição válida → `NO_CHANGE` sem escrever nada.
- Transições determinísticas ancoradas na state machine existente (helpers do Race Weekend exportados e reutilizados): `RACE_SELECTED` (world sem `currentRaceId` + temporada → primeira corrida não finalizada abre a sessão inicial), `SESSION_ADVANCED` (status concluído → próxima sessão válida da sequência padrão/Sprint), `WEEKEND_FINALIZED` (status `RACE` com classificação → `finalizeRaceInTx`; status `FINISHED` legado → limpa `currentSession`).
- `finalizeRaceInTx` extraído para `championship-progression.service` e reutilizado pelo apply do campeonato (uma única autoridade de pontos/status/sessão).
- Tempo: `currentDate` nunca é alterado pela progressão — não há regra temporal confiável por sessão (decisão registrada); a data só muda por `PATCH /api/world`/timeline.
- Auditoria: cada transição grava `WORLD_ADVANCED` (payload com data/sessão/corrida), reutilizando o replay existente; concorrência pelo advisory lock da timeline (uma transição efetiva por vez).

### Testes e validação
- `world-progression.test.ts` — **14/14** (seleção de corrida, avanço padrão/Sprint, finalização com pontos e Next Race, NO_CHANGE em corrida FINISHED/sem temporada/sem classificação, idempotência/auditoria única, concorrência, lifecycle completo via Race Weekend, replay + snapshot, isolamento de universos, ausência de Evolution/AI automáticos, 401).
- Suíte API completa em banco recriado: **1846/1846**; typecheck 0; lint 30 (baseline, 0 novos). Sem migration.
- Web não afetado nesta subfase.

### Limitações
- Sem política de relógio real (datas oficiais por sessão dependem de decisão de produto e de dados completos da fonte).
- Após `FINISHED`, o ponteiro `currentRaceId` permanece na corrida encerrada; a próxima corrida é determinável pelo Next Race (avanço automático de ponteiro não foi adotado por ser política de produto).

### Commit
- `feat(v3): add worldstate progression`.

---

## V3.12 Hardening — Recovery de ponteiros do WorldState (Subfase B)

- **Data:** 2026-09-28.
- **Auditoria:** transições duplicadas já são cobertas pelo lock + NO_CHANGE (D-049); RACE sem classificação já retorna NO_CHANGE; replay após progressão já é determinístico (testado na Subfase A). O gap real era ponteiro obsoleto: `currentRaceId`/`currentSeasonId` apontando para corrida inexistente, corrida de outro Universe ou temporada inexistente — antes a progressão apenas retornava NO_CHANGE e deixava o estado inválido persistido.
- **Implementação (baixo risco, direta):** nova transição `STALE_POINTER_CLEARED` que limpa os campos inválidos (`currentRaceId`/`currentSession` para corrida inexistente/estrangeira; `currentSeasonId`/`currentSession` para temporada inexistente) com auditoria `WORLD_ADVANCED` e retorno `changed:true`. Sessão fora da sequência do weekend (ex.: `SPRINT` em weekend padrão) já é normalizada para a sessão inicial.
- **Testes:** 4 novos cenários em `world-progression.test.ts` (corrida inexistente, corrida de outro Universe com isolamento preservado, temporada inexistente, normalização de sessão). Focados 29/29; suíte API completa em banco recriado **1850/1850**; typecheck 0; lint 30 (baseline).
- **Limitações:** corrida `FINISHED` permanece como `currentRaceId` (comportamento intencional; Next Race deriva a próxima); nenhuma recuperação de outros campos.

### Commit
- `fix(v3): harden worldstate progression`.

---

## Race Weekend — Session Results UI (Subfase C)

- **Data:** 2026-09-28.
- **Objetivo:** resolver a limitação "sem tela dedicada de resultados por sessão no campeonato", integrando ao Race Weekend existente sem backend novo.
- **Implementação:** `RaceWeekendDialog` (componente do campeonato) consome `GET /api/races/:raceId/weekend` via `useRaceWeekend` e mostra cada sessão (Practice/Sprint Qualifying/Sprint/Qualifying/Race) com estado (Concluída/Disponível/Bloqueada) e classificação (posição, piloto, equipe, pontos quando aplicável, status/time quando houver), respeitando weekend padrão/Sprint, loading, erro, vazio de classificação e finalizado. O `RaceCard` ganhou o botão "Fim de semana" (prop opcional) e a página do campeonato abre o diálogo — nenhum editor manual, nenhuma alteração de simuladores.
- **Testes:** `race-weekend-dialog.integration.test.tsx` (6) cobrindo weekend padrão, Sprint com 8/7, sessão concluída vazia, loading, erro e isolamento (apenas o endpoint do weekend é chamado); `race-card.test.tsx` ganhou o caso do novo botão. Web **418/418**; `tsc` 4 (baseline); lint 0; `next build` exit 0. API não alterada.

### Commit
- `feat(v3): add race session results ui`.

---

## AI Behavior — Recovery de EXECUTING preso (Subfase D)

- **Data:** 2026-09-28.
- **Objetivo:** resolver a limitação da Fase 9 ("sem retomada de EXECUTING preso após crash") com solução conservadora.
- **Implementação:** `recoverStaleExecutions(userId)` + `POST /api/ai-behavior/recover` (autenticado, Universe do usuário). Marca como `FAILED`/`policyCode=EXECUTION_STALE` apenas decisões `EXECUTING` com `updatedAt` anterior ao threshold `AI_EXECUTING_STALE_MS` (15 min); nada é reexecutado automaticamente, `EXECUTED`/`DECIDED`/`FAILED` e execuções recentes não são tocados. Idempotente e seguro sob concorrência (updateMany atômico); sem scheduler, sem fila.
- **Testes:** `ai-behavior-recovery.test.ts` (3) cobrindo recuperação apenas de stale, preservação dos demais estados, ausência de nova mensagem, execução pós-recovery bloqueada (`409`), concorrência idempotente (soma = nº de stale, segunda rodada = 0), isolamento entre universos e 401. Focados 15/15; suíte API completa em banco recriado **1853/1853**; typecheck 0; lint 30 (baseline). Web não afetado.

### Commit
- `fix(v3): recover stale ai decisions`.
