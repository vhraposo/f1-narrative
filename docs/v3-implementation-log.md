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

---

## V3.13 — Tech Debt / QA Hardening

### Subfase A — Baseline de testes
- Suíte API completa em banco recriado: **1853/1853 (100%)**, repetida no mesmo DB (resíduo): **1853/1853**. As 3 falhas históricas do baseline V3.00 (`1659/1662` do roadmap) **não existem mais** — foram resolvidas incidentalmente ao longo das fases da V3 (fixtures de reconciliação/universo e flaky de resíduo tratados nas Fases 3/4/7). Não houve alteração de código nem commit nesta subfase.
- Web completo: **418/418**.

### Subfase B — Typecheck / lint debt
- **API lint: 30 → 0** (todas correções mecânicas e seguras, sem mudança semântica):
  - imports não usados removidos (`OpenF1Transport` em `app.ts`, `prisma` em `events/news.ts`, `Role` em `jolpica.materialize.ts`, `ReconFixtureIds` em `reconciliation/universe-editor.source-matching.test.ts`);
  - variáveis não usadas removidas (`lauda` em `jolpica.materialization-flow.test.ts`, `cleanup` em source-matching, função `fixtureWithoutSeason` em `universe-init.bootstrap.test.ts`);
  - `crypto.randomUUID()` substituído por `randomUUID()` importado de `node:crypto` (availability, conversation, memory, schedule — 21 ocorrências);
  - `Buffer` importado de `node:buffer` em `driver-profile.test.ts`;
  - `any` do helper `assertSeat` (universe-editor.test) tipado estruturalmente.
- **Web tsc: 4 → 0** (fixtures de `drivers-page` com `headshotUrl`; helper `seat` tipado como `UniverseSeat` em `universe-divergence`).
- API typecheck 0; web lint 0 erros/0 warnings; web build exit 0; API/Web suítes completas verdes (1853/1853 e 418/418).

### Commit
- `chore(v3): reduce typecheck and lint debt`.

### Subfase C — Test isolation / flakiness
- **Causa raiz (reproduzida):** três testes legados usavam contagens globais sem escopo (`externalTeam/externalDriver.count()` sem ids, `bindings.toHaveLength(1)`, `externalBindingDriver.count()` global) e quebravam na segunda execução da suíte no mesmo banco — evidência: `1853/1853` em banco limpo, falhas `expected 6 to be 3`, `length 1 but got 3`, `expected 3 to be 1` após resíduo.
- **Correções (sem mascarar):** `jolpica-sync.integration.test.ts` escopa times/pilotos aos externalIds do próprio fixture; `reconciliation.integration.test.ts` valida presença do vínculo confirmado pelo id do fixture (via `characterLandoId`) e usa esse id no unlink; `universe-init.service.test.ts` (caso G) escopa bindings ao `universeId`/`externalDriverId` do fixture.
- **Validação:** arquivos afetados 55/55 no banco com resíduo; suíte API completa executada **duas vezes seguidas no mesmo DB**: **1853/1853** e **1853/1853**. Typecheck 0; lint 0.

### Commit
- `test(v3): harden test isolation`.

### Subfase D — Database residual audit (somente leitura)
| Banco | Tamanho | Tabelas públicas | Migrations | Usuários | Propósito | Ação |
|---|---|---|---|---|---|---|
| `f1-narrative` | 12 MB | 60 | 27 | 17 | DEV canônico (fonte da verdade) | Não modificar |
| `f1_narrative_test` | 15 MB | 60 | 27 | 479 (resíduo descartável) | TEST (pode recriar) | Recriável a qualquer momento |
| `f1nw_qa_v212` | 7,4 MB | **0** | inexistente | inexistente | Resíduo de QA do V2.12 | **Candidato a DROP** — obsoleto (nenhum objeto Prisma); requer autorização explícita antes de remover |
| `postgres` | 7,5 MB | — | — | — | Banco default do container | Não tocar |

- Nenhuma operação destrutiva executada na auditoria. **Remoção autorizada (2026-09-29):** `f1nw_qa_v212` foi removido via `DROP DATABASE "f1nw_qa_v212"` após confirmação de alvo exato, zero conexões ativas e listagem prévia; `f1-narrative` permanece acessível (17 usuários) e `f1_narrative_test` intacto/recriável.

### Subfase E — Relatório final de qualidade (V3.13)
- **Suíte API:** 1853/1853 em banco limpo e 1853/1853 na reexecução no mesmo DB (flakiness de resíduo eliminada na Subfase C).
- **Suíte Web:** 418/418.
- **Typecheck:** API 0; Web **0** (antes 4).
- **Lint:** API **0** (antes 30); Web 0 erros/0 warnings.
- **Build Web:** exit 0.
- **Migrations:** `migrate deploy` validado no TEST (27 migrations completas, 60 tabelas); nenhuma migration nova nesta execução. DEV íntegro (17 usuários, sem migração pendente).
- **Isolation checks:** suíte completa repetida no mesmo banco verde; contagens agora escopadas por fixture nas três verificações legadas.
- **Limitações restantes:** nenhuma falha conhecida; único item pendente é o DROP autorizado de `f1nw_qa_v212`; decisões de produto (relógio do Universe, persona, timeline histórica) permanecem fora do escopo.

### Commit
- `docs(v3): complete tech debt report`.

---

## V3.14 — Driver Persona / AI Character Profiles

### Contexto (STEPs 1–5)
- `docs(v3): design driver persona architecture` (63931c6); `feat(v3): add persona persistence foundation` (7e53936); `feat(v3): add persona domain rules` (f82e8da); `feat(v3): add persona service core` (3def4c4); `feat(v3): add manual persona mutations` (14e5560); `feat(v3): add persona evidence workflow` (2857afa). Decisões D-050..D-059; TEST/DEV preservados; nenhuma migration além da fundação.

### STEP 6 — Persona HTTP API
- **Implementação:** `persona.schema.ts` (Zod `.strict()`: params de character/trait/evidence; PATCH manual sem `sourceKind`/`confidence`/`evidenceId`/`origin` e com rejeição de keys duplicadas; evidence create sem campos de revisão; review `APPROVED|REJECTED` + confidence opcional) e `persona.routes.ts` (GET/PATCH/DELETE trait/POST evidence/PATCH review; `fastify.authenticate`; ownership e ADMIN delegados 100% ao `persona.service`; erros `PersonaServiceError` mapeados para 400/403/404/409 sem stack/SQL/Prisma; resposta `{ persona: PersonaView }`, `201` no create de evidence). Registro em `app.ts`. Nenhuma regra de domínio duplicada.
- **Testes:** `persona.routes.test.ts` **60/60** (auth, GET/leak-safe/catálogo, PATCH lazy/validações estritas/conversão EVIDENCE→MANUAL, DELETE, create evidence, review + reconcile, isolamento, contrato de erro, smoke characters); módulo persona completo **283/283** (6 arquivos); smoke `app.test` + `characters.test` 25/25. Typecheck 0; lint 0. TEST sem resíduos; DEV intocado; zero migrations.
- **Docs:** `v3.14-persona-architecture.md` §15 convertida de proposta para contrato implementado (rotas, payloads, erros, autorização, response shape). Nenhuma decisão nova (D-060+ não necessária).

### Commit
- `feat(v3): add persona api`.

### STEP 7 — Generation Context / Prompt Integration
- **Implementação:** `persona.prompt.ts` (renderer puro) + integração em `generation.assembly.ts`: a Persona do speaker é carregada com 1 query (`characterPersona.findUnique`, sem evidence) e renderizada no slot existente `CHARACTER_DNA` com preâmbulo de tendência (D-060); precedência Persona → dna legado → biography → omissão; caps 600/12/200/2000 com reasons `persona-summary-truncated`/`persona-traits-truncated`/`persona-block-truncated`; `SECTION_IDS`/numeração/`contextVersion`/SSE/projeção inalterados; nenhuma seção nova, nenhum pipeline novo.
- **Testes:** `generation-persona.test.ts` **33/33** (renderer/caps/confiança ausente, slot, precedência, multi-speaker, generationKey A–D, evidence ausente do prompt, memory/relationship/current-turn/RAG preservados, NullProvider, projeção). Módulos generation+persona **716/716**; ai-behavior **15/15**. Typecheck 0; lint 0.

### Commit
- `feat(v3): integrate persona with generation` (862f8c4).

### STEP 8 — Persona UI
- **Implementação:** `lib/persona.ts` + `hooks/use-persona.ts` (React Query, invalidação por personagem) + `components/persona/persona-section.tsx`: summary editável/limpável, traits com labels do registry, badges Manual/Baseada em evidência, formulário de evidência, lista com status (Pendente/Aprovada/Rejeitada), papéis (Aplicada/Suporte/Conflito), “Manual prevalece”, confiança qualitativa (nunca decimal), revisão ADMIN (Aprovar/Rejeitar), estados loading/empty/erro/saving/validation. Seções integradas nas páginas de Character (sem evidências) e Driver (com evidências); Chat/seletores intactos; nenhuma regra de domínio no frontend.
- **Testes:** `persona-section.integration.test.tsx` **20/20** + 2 testes de página (Character/Driver) + mocks de sessão nos testes existentes. Suíte Web **440/440** (antes 418); typecheck Web 0; lint Web 0 (warnings pré-existentes de `<img>`/unused); `next build` exit 0.

### Commit
- `feat(v3): add persona ui` (520c7cc).

### STEP 9 — End-to-End / Hardening / QA / Documentation
- **E2E:** `persona.e2e.test.ts` **17/17**: fluxo A–T completo (persona manual → view → prompt → mudança de GenerationKey → evidence PROPOSED → approve ADMIN → reconcile EVIDENCE → prompt → override MANUAL → reject → DELETE sem ressurreição com evidence preservada), origins (ORIGINAL/REAL_DRIVER/AI_CHARACTER + catálogo global), DNA fallback (dna/bio/omissão/persona vence), multi-speaker/isolamento por Universe (mesmo piloto factual), prompt injection confinada ao bloco (seções estáveis, GLOBAL_RULES intacta) e performance (1 query de persona, 0 de evidence).
- **Regressão completa:** API **2186/2186** (123 arquivos) em **duas execuções seguidas no mesmo TEST DB** sem flakiness; Web **440/440**; typecheck API/Web 0; lint API/Web 0; build Web exit 0.
- **Banco:** TEST com 28 migrations, personas/traits/evidences **0 resíduos**, FKs/índices corretos; DEV intacto (27 migrations, 60 tabelas, 17 usuários, sem tabelas de Persona).
- **Docs:** architecture com status final; OQ-1..OQ-8 resolvidas com defaults; D-060 registrada; `docs/v3.14-final-report.md` criado (arquitetura, testes, segurança, limitações e checklist).
- **Limitações registradas:** revisão ADMIN global (D-057); `PERSONA_UPDATED` fora da V3.14 (D-058); `Character.dna` mantido como fallback (OQ-6); AI Behavior não lê Persona (OQ-4).

### Commit
- `feat(v3): complete driver persona`.

---

## V3.15 — Historical Timeline / Alternate History

### V3.15.1 — Timeline Read Model + UI
- **Objetivo:** superfície de leitura da timeline (sem correções ainda) + divergência Universe × External.
- **Arquivos:** `apps/api/src/modules/timeline/timeline.read.ts` (view model + filtros + cursor + detalhe com cadeia de supersession), `divergence.service.ts` (classificações MATCH/DIVERGENT/NO_EXTERNAL/UNIVERSE_ONLY/EXTERNAL_ONLY via bindings), `timeline.routes.ts` (GET `/api/timeline` com filtros/paginação, GET `/api/timeline/events/:eventId`, GET `/api/timeline/divergence`); web `lib/timeline.ts`, `hooks/use-timeline.ts`, `components/timeline/timeline-view.tsx`, `app/app/timeline/page.tsx`, nav (Narrativa → Linha do Tempo).
- **Migrations:** nenhuma.
- **Testes:** API `timeline.read.test.ts` 12/12 (leitura, filtros, ordenação, cursor, supersession, isolamento, divergência match/divergente/universe-only/external-only, rotas 401/400/404); timeline módulo 21/21. Web `timeline-view.integration.test.tsx` 8/8; suíte Web 448/448.
- **Typecheck:** API 0; Web 0. **Lint:** API 0; Web 0. **Build Web:** exit 0.
- **Problemas:** filtro `correctionsOnly` não pode incluir kind ainda inexistente no enum (ajustado para os 3 kinds atuais; V3.15.5 amplia); resíduo de execução falha de fixture limpo no TEST.
- **Decisões:** nenhuma nova (segue D-061..D-065).
- **Limitações:** UI mostra primeira página (50) com aviso de `hasMore`; scans limitados a 1000 eventos por universo com flag `beyondScanLimit`.
- **Commit:** `feat(v3): add timeline read model and ui`.
- **Próximo passo:** V3.15.2 — correction command foundation + number lock.

### V3.15.2 — Correction Command Foundation + Number Lock
- **Objetivo:** fundação tipada de comandos de correção (sem preview/UI) + lock no fluxo de números.
- **Arquivos:** `apps/api/src/modules/timeline/correction.service.ts` (tipos dos 5 kinds, validação semântica por kind, payload absoluto, supersession, checkpoint pré-correção, `submitCorrection`/`applyCorrectionWithinTransaction`), `timeline.service.ts` (`Tx` exportado), `driver-number.service.ts` (`lockUniverseTimeline` no setDriverNumber + export de `findPreviousSeasonChampion`).
- **Migrations:** nenhuma.
- **Testes:** `correction.foundation.test.ts` 10/10 (validação race/sprint/standing/número/calendário, supersession encadeada, snapshot pré-correção, replay efetivo, EVOLUTION_STALE, isolamento, lock concorrente de número); regressão drivers+timeline 88/88.
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** conflito de posição removido da validação — o domínio já permite posições repetidas (dead heat da simulação) e o cenário primário (P3→P1) ficaria bloqueado; coerência de classificação é do editor.
- **Decisões:** nenhuma nova (D-061..D-065).
- **Limitações:** número #1 continua validado pelo campeão derivado; códigos de domínio `EMPTY_CORRECTION`/`INVALID_POSITION`/`INVALID_ELIGIBILITY`/`INVALID_ROUND`/`INVALID_DATE`/`DERIVED_STANDING`/`NUMBER_*`/`CHAMPION_ONLY`/`EVOLUTION_STALE`/`SCHEDULE_ORDER_UNSAFE`.
- **Commit:** `feat(v3): add timeline correction foundation`.
- **Próximo passo:** V3.15.3 — preview engine (transação com rollback + token).

### V3.15.3 — Correction Preview Engine
- **Objetivo:** preview determinístico sem persistência (transação com rollback garantido) + token de estado.
- **Arquivos:** `apps/api/src/modules/timeline/correction.preview.ts` (diff RESULT/SPRINT/CALENDAR/NUMBER/STANDING/CHAMPION, detecção de narrativa stale por `payload.raceId`, impacto de número `#1` com `requiresAction`, `buildCorrectionPreviewToken` = sha256(universe, lastSequence, world, standings, comando canônico)), `correction.fixtures.ts` (fixture compartilhada com variante anexada a Universe existente).
- **Migrations:** nenhuma.
- **Testes:** `correction.preview.test.ts` 6/6 (diff completo, preview não escreve — timeline/snapshot/resultados/standings/Event/Memory/Persona/DriverAttribute inalterados, determinismo, token muda com estado, EVOLUTION_STALE propagado, isolamento leak-safe).
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** asserção de campeão com empate dependia da ordenação por uuid; fixture ajustada para flip determinístico (correção tira o líder da pontuação) e `requiresAction` verdadeiro.
- **Decisões:** nenhuma nova.
- **Limitações:** `EVOLUTION_STALE` bloqueia preview e apply (exibição como erro de domínio na UI).
- **Commit:** `feat(v3): add timeline correction preview`.
- **Próximo passo:** V3.15.4 — apply + recompute com revalidação de token.

### V3.15.4 — Apply + Recompute
- **Objetivo:** aplicar correções de forma atômica com revalidação de preview e invariantes.
- **Arquivos:** `correction.apply.ts` (lock `timeline:<universeId>`, recomputa token do estado atual, `PREVIEW_STALE` 409, `applyCorrectionWithinTransaction`, verificação de invariante da persistência), rotas `POST /api/timeline/corrections/preview` e `POST /api/timeline/corrections/apply` (Zod discriminated union `.strict()`, `DERIVED_FIELD` para `points` em race/sprint, token no body do apply).
- **Migrations:** nenhuma.
- **Testes:** `correction.apply.test.ts` 7/7 (apply + recompute, token obsoleto sem escrita, reaplicação 409, concorrência com exatamente um vencedor, rollback por validação, 401, rota preview/apply + DERIVED_FIELD + stale).
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** tipagem do comando de teste precisou de tipo concreto (união discriminada + spread).
- **Decisões:** nenhuma nova.
- **Limitações:** apply repetido com token novo gera nova correção redundante (auditável); UI ainda não expõe preview/apply (V3.15.6/8).
- **Commit:** `feat(v3): add timeline correction apply and recompute`.
- **Próximo passo:** V3.15.5 — correções de RaceResult e Sprint (enum + applyTimelineEvent).

### V3.15.5 — Race and Sprint Historical Corrections
- **Objetivo:** suporte de produção aos kinds `RACE_RESULT_CORRECTED` (position/status/grid; points derivados) e `RACE_SESSION_RESULT_CORRECTED` (position/status/elegibilidade; pontos derivados).
- **Migrations:** `20260930130000_add_session_result_correction_kind` (aditiva: `ALTER TYPE "TimelineEventKind" ADD VALUE`), aplicada apenas no TEST; enum também adicionado ao `schema.prisma` com generate seguro (`--no-engine` → normal). DEV permanece em 27 migrations.
- **Arquivos:** `timeline.service.ts` (payload de sessão + case no replay: update RaceSessionResult, merge de `metadata.eligibility`, recompute de standings), `correction.service.ts` (cast removido), `timeline.read.ts` (filtro de correções inclui o novo kind), `correction.race-sprint.test.ts`.
- **Testes:** `correction.race-sprint.test.ts` 5/5 (P→pontos derivados + standings + supersession; sprint posição→tabela 8..1; elegibilidade 40% → 0 pontos; leitura expõe kind/valores); módulo timeline 49/49.
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** enum precisava constar no schema Prisma além do SQL (client exigia); resíduo legado de fixtures falhas limpo no TEST.
- **Decisões:** nenhuma nova.
- **Limitações:** correção não cria pontos de fastest-lap/meio-ponto (inexistentes no motor); elegibilidade apenas no Sprint.
- **Commit:** `feat(v3): add race and sprint historical corrections`.

### V3.15.6 — Historical Champion and Number Impact
- **Objetivo:** consequência histórica de campeão derivada + impacto de `#1` sem cascata automática.
- **Arquivos:** `correction.fixtures.ts` (entry `#null` do próximo ano para o piloto), `correction.champion-impact.test.ts`.
- **Migrations:** nenhuma.
- **Testes:** `correction.champion-impact.test.ts` 5/5 (preview campeão antes/depois + `requiresAction`; apply muda campeão mas não reescreve `SeasonDriverEntry.number`; reatribuição explícita respeita a regra do campeão e unicidade; eventos `NUMBER_CORRECTED` apenas das ações explícitas; isolamento entre universos).
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** dois eventos `NUMBER_CORRECTED` legítimos na reatribuição (release + assignment) — expectativa ajustada.
- **Decisões:** nenhuma nova (D-064 aplicado).
- **Limitações:** reatribuição de `#1` exige liberar o número atual antes (unicidade por temporada), como no fluxo existente.
- **Commit:** `feat(v3): add historical champion and number impact`.

### V3.15.7 — Hardening dos Writers Legados
- **Objetivo:** eliminar bypasses de edição histórica por endpoints públicos sem quebrar lifecycle.
- **Classificação:** simuladores/weekend/finalize/world progression/progressão de número = lifecycle (preservados, com lock onde aplicável); CRUD público de resultados/standings/corridas = mutável (endurecido).
- **Arquivos/regras:** `championship.routes.ts` (PATCH/DELETE de resultado e de corrida `FINISHED` → `409 USE_TIMELINE_CORRECTION`; POST de resultado em corrida `FINISHED` bloqueado, permitido em corrida aberta; CREATE/PATCH/DELETE de standing com resultados na temporada → `409 DERIVED_STANDING`, importado sem resultados segue editável), `world.routes.ts` (`PATCH /api/world` em transação com `lockUniverseTimeline`), `championship-progression.routes.ts` (ownership leak-safe do Universe + lock no finalize normal, sem correction event).
- **Migrations:** nenhuma.
- **Testes:** `timeline.hardening.test.ts` 10/10 (401; bloqueio PATCH/DELETE/POST histórico; corrida aberta editável; standing derivado vs importado; world lifecycle; finalização normal sob lock; finalize de outro universo 404; correção + world concorrentes; ownership). Regressão afetada: championship 37/37; módulos world/drivers/race-weekend/timeline/simulation/narrative/roster/player-entry 221/221. Suíte legada de championship ajustada ao novo contrato (status QUALIFYING no CRUD; standings em temporadas sem resultados).
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** três testes legados assumiam edição direta de histórico (corrida FINISHED, standings com resultados) — atualizados ao contrato congelado, sem enfraquecer cobertura de ownership.
- **Decisões:** nenhuma nova (a classificação segue a arquitetura §31 item 7).
- **Limitações:** criação retroativa de resultado ausente em corrida finalizada não é suportada v1; `points` continua aceito no CRUD de corrida aberta (pré-finalização) como sempre.
- **Commit:** `feat(v3): harden timeline legacy writers`.

### V3.15.8 — Final QA / E2E / Documentation
- **Objetivo:** provar a V3.15 integrada, determinística e sem regressões.
- **E2E:** `timeline.e2e.test.ts` 8/8 — fluxo completo (preview sem escrita com diff/impacto → apply atômico → standings/campeão derivados → `#1` explícito → supersession com original imutável → stale 409 sem aplicação parcial → recompute determinístico 2× → narrativa/evolução preservadas com `EVOLUTION_STALE` sanitizado → divergência leitura pura → isolamento entre universos).
- **Regressão completa:** API **2249/2249** (131 arquivos) em **duas execuções consecutivas no mesmo TEST** sem flakiness; Web **448/448** (58 arquivos). Typecheck API/Web 0; lint API/Web 0; `next build` exit 0.
- **Banco:** TEST 29 migrations, 63 tabelas, 0 timeline/snapshots residuais, 0 resíduos de fixture; DEV intacto (27 migrations, 60 tabelas, 17 usuários, sem tabelas Persona/V3.15; 2 `NUMBER_CORRECTED` pré-existentes da era V3.04, sem alteração).
- **Docs:** `v3.15-timeline-architecture.md` com §0 de status (implementado/limitado/unsupported/future); `v3.15-open-questions.md` com as 8 OQs resolvidas; `docs/v3.15-final-report.md` criado.
- **Decisões:** nenhuma nova (D-061..D-065 + defaults das OQs).
- **Commit:** `feat(v3): complete historical timeline`.

### Extensão — Campeões (Narrativa → Linha do Tempo)
- **Objetivo:** subaba com histórico de campeões (fonte externa × Universe), edição controlada e restauração, reutilizando corrections/recompute/divergence.
- **Arquivos:** `apps/api/src/modules/timeline/champions.service.ts` (read model por temporada com estados `MATCH/DIVERGENT/UNIVERSE_ONLY/EXTERNAL_ONLY/NONE`, origem `DERIVED/STANDING/NONE`, `canEdit/canRestore`, pares atômicos de `STANDING_CORRECTED`, preview por rollback e apply com token sob lock), rotas `GET /api/timeline/champions`, `GET /api/timeline/champions/:seasonId`, `POST .../preview`, `POST .../apply`; web `lib/timeline.ts` + `hooks/use-timeline.ts` + `components/timeline/champions-panel.tsx` + abas `História | Campeões` na página da Linha do Tempo.
- **Migrations:** nenhuma.
- **Testes:** API `champions.test.ts` 11/11 (lista/estados/origem, filtros, detalhe com histórico, preview zero-write e determinístico, edit com 2 eventos, bloqueio `DERIVED_STANDING` 409, restore preservando histórico e voltando a MATCH, stale 409 sanitizado, External intacto, `UNIVERSE_ONLY`, `EXTERNAL_CHAMPION_MISSING`); Web `champions-panel.integration.test.tsx` 8/8 (loading/empty/lista/estados/disabled derivado/filtros/detalhe/modais com preview+apply/erro/retry). Suíte API **2260/2260 ×2** no mesmo TEST; Web **456/456 ×2**; typecheck 0/0; lint 0/0; build 0.
- **Problemas:** `post` ausente no import de `lib/timeline.ts`; cleanup pré-existente de `championship.test.ts` não removia users (corrigido, resíduo anterior limpo); flakes intermitentes pré-existentes em páginas externas/universe sob carga (não reproduzem isoladas nem em execuções limpas consecutivas; arquivos não tocados).
- **Decisões:** D-066 (campeão derivado; edição = par atômico `STANDING_CORRECTED`; restore como correção; `NONE` no read model).
- **Limitações:** troca de campeão exige piloto com perfil no Universe; temporadas `DERIVED` direcionam para correção de resultado; sem criação de pilotos novos pela aba.
- **Commit:** `feat(v3): add historical champions timeline`.

### V3.16.1 — Edit model no detalhe do evento
- **Objetivo:** expor editabilidade estruturada do evento (o que pode ser editado, valores atuais, data do mundo, supersedes sugerido, bloqueios) sem criar motor novo.
- **Arquivos:** `apps/api/src/modules/timeline/timeline.editor.ts` (`buildTimelineEventEditModel` → `editorKind RACE_RESULT|SPRINT|NUMBER|STANDING|RACE|null`, `canEdit`, `blockedReason`, `defaultWorldDate`, `suggestedSupersedesId`, `values/currentValues`, `narrativeStaleEventIds`; SPRINT lê `metadata.eligibility` → `neutralizedStart` 1/0/null + `distancePct`); `GET /api/timeline/events/:eventId` passa a retornar `edit` (aditivo).
- **Migrations:** nenhuma.
- **Testes:** `timeline.editor.test.ts` 9/9 (editabilidade por kind, `EVOLUTION_STALE`, `DERIVED_STANDING`, cadeia `76→77`, `RESULT_NOT_FOUND`, 401/404 leak-safe); módulo timeline 92/92.
- **Typecheck:** 0. **Lint:** 0.
- **Problemas:** nenhum.
- **Decisões:** nenhuma nova (contrato congelado da V3.15; `RACE_UPDATED` supersede o evento de calendário).
- **Limitações:** edit model não valida o comando (validação permanece no preview/apply da V3.15).
- **Commit:** `feat(v3.16): add timeline event edit model`.

### V3.16.2 — Editor visual da Linha do Tempo
- **Objetivo:** UI de correção histórica sobre o correction framework (preview obrigatório, confirmação em dois passos, `PREVIEW_STALE` sem reuso de token).
- **Arquivos:** `apps/web/src/lib/timeline.ts` (tipos+fetchers `previewCorrection`/`applyCorrection`), `hooks/use-timeline.ts` (`usePreviewCorrection`, `useApplyCorrection` com invalidação `timeline/seasons/races`), `components/timeline/timeline-event-panel.tsx` (abas Detalhes/Impacto/Histórico, formulários por kind com prefill, preview ANTES/DEPOIS + IMPACTOS com nomes de piloto resolvidos, confirmação, bloqueios explicados, cadeia de supersession com badge `Atual`), `timeline-view.tsx` integra o painel (substitui o detalhe antigo).
- **Migrations:** nenhuma.
- **Testes:** Web `timeline-editor.integration.test.tsx` 6/6 (abas/estado atual/formulário; preview+impactos+confirmação+apply com invalidação; `PREVIEW_STALE` exige novo preview e usa token novo; bloqueio `DERIVED_STANDING` com botão desabilitado; `NUMBER` vazio ⇒ `null`; SPRINT com `eligibility`). Suíte Web 462/462.
- **Typecheck:** 0. **Lint:** 0 (0 novos).
- **Problemas:** `aria-label` redundante no botão Editar escondia o nome acessível exato (removido); clique duplo de "Aplicar correção" no stale resolvido resetando a confirmação (`setConfirming(false)`) — token antigo nunca reutilizado.
- **Decisões:** nenhuma nova.
- **Limitações:** kinds informativos seguem `NO_VISUAL_EDITOR`; evolução aplicada exige intervenção antes (`EVOLUTION_STALE`); narrativa apenas avisada.
- **Commit:** `feat(v3.16): add timeline correction editor`.

### V3.16.3 — Final QA / Docs
- **Objetivo:** provar o editor integrado e documentar a V3.16.
- **Regressão completa:** API **2269/2269** (133 arquivos) em **duas execuções consecutivas no mesmo TEST**; Web **462/462** (60 arquivos) ×2. Typecheck API/Web 0; lint API/Web 0; `next build` exit 0.
- **Banco:** TEST 29 migrations, 63 tabelas; 0 `TimelineEvent`/0 `WorldSnapshot` residuais ao final; resíduo pré-existente de `User`/`Universe` de testes alheios quantificado (módulo `performance` sozinho: +17 users/+17 universes; `team-performance.test.ts` e `driver-attribute.test.ts` sem cleanup de users) e TEST limpo ao final (0/0), conforme prática de banco descartável. DEV intacto (27 migrations, 60 tabelas, 17 usuários, 2 `NUMBER_CORRECTED` pré-existentes). External Mirror intocado.
- **Docs:** `docs/v3.16-timeline-editor.md` criado (edit model, formulários por kind, preview/apply, `PREVIEW_STALE`, supersession, impacto, segurança, concorrência, limitações, QA).
- **Decisões:** nenhuma nova (V3.16 é camada de UI sobre D-061..D-066).
- **Limitações:** sem migration/tabela nova; sem novos kinds; sem PATCH/DELETE de evento.
- **Commit:** `feat(v3.16): complete timeline editor`.

### V3.17.0 — Design (Pilot Knowledge, Persona & Context)
- **Objetivo:** camada de conhecimento externo de piloto + public persona + biography + histórico + relacionamentos + Universe overrides + `PilotContextResolver` para a geração.
- **Docs:** `v3.17-pilot-knowledge-architecture.md`, `v3.17-source-policy.md`, `v3.17-open-questions.md` (13 OQs resolvidas), D-067..D-071 em `v3-decisions.md`.
- **Decisões:** D-067 (camada externa separada; Universe vence; sem escrita de Universe por refresh), D-068 (persona pública observável; conflito permanece CONFLICT; LLM só extrator), D-069 (resolver speaker-only determinístico + seção opcional `PILOT_CONTEXT`), D-070 (source ledger com licença por claim; sem crawler/persistência de conteúdo protegido; ≠ RAG), D-071 (marcos derivados de dados estruturados; Memory continua Universe-only).
- **Commit:** `docs(v3.17): design pilot knowledge architecture`.

### V3.17.1 — Foundation (migration + profile + ledger)
- **Objetivo:** persistência/read model da camada externa.
- **Arquivos:** migration `20260930160000_add_pilot_knowledge_foundation` (8 tabelas + 12 enums, aplicada somente no TEST), `pilot-knowledge.policy.ts`, `pilot-knowledge.sources.ts` (ledger com licença/attribution, dedupe por provider+url, rejeição de metadata com conteúdo bruto), `pilot-knowledge.profile.ts` (upsert estruturado, composer determinístico de biografia display/context ≤1200/≤600, refresh status FRESH/STALE/UNKNOWN), `pilot-knowledge.access.ts` (ownership + guarda P2021→503).
- **Testes:** 21/21 (ledger, ownership, biografia sem invenção/cópia, precedência `Character.biography`).
- **Commit:** `feat(v3.17): add pilot knowledge foundation`.

### V3.17.2 — Providers F1DB + Wikidata
- **Arquivos:** `providers/provider.types.ts` (contrato `ExternalDriverKnowledgeProvider`), `f1db.provider.ts` (release JSON local via `F1DB_DATA_DIR`, licença CC BY 4.0 + attribution/version), `wikidata.provider.ts` (SPARQL OTIMIZADO por QID/nome, parser de relações com validade, CC0; `fetchImpl` injetável; live opt-in), `pilot-knowledge.identity.ts` (match por provider id/QID/nome+nacionalidade+número+DOB, `AMBIGUOUS_IDENTITY` para colisões, `ensureExternalDriverForProvider` idempotente).
- **Testes:** 22/22 (fixtures sanitizadas, sem rede; Max/Lando/Sainz×Sainz Jr./histórico/inexistente; erros sanitizados).
- **Commit:** `feat(v3.17): add f1db and wikidata providers`.

### V3.17.3 — Evidências e persona pública externa
- **Arquivos:** migration `20260930161500_add_persona_evidence_source_kind`; `pilot-knowledge.extractor.ts` (interface + provider-backed com prompt de extração/grounding + `emptyPilotPersonaExtractor`), `pilot-knowledge.persona.ts` (ingestão de claims com evidência auditável, resolução por autoridade/temporalidade, `INFERRED` exige 2 evidências, conflito de mesma autoridade = `CONFLICT`, caps, view sem confidence/excerpt/url, refresh preserva `CharacterPersona`).
- **Testes:** 15/15 (self-description, primary×secondary, conflito, inferred, caps, sem leakage, override manual preservado).
- **Commit:** `feat(v3.17): add public persona extraction`.

### V3.17.4 — Relacionamentos (externo × Universe override)
- **Arquivos:** migration `20260930162000_add_character_relationship_target` (enum `CHARACTER`); `pilot-knowledge.relationships.ts` (ingestão idempotente com validade, resolução atual por autoridade→recência→confidence, conflito só no mesmo período/autoridade, override Universe CRUD com ownership, classificação `MATCH/DIVERGENT/UNKNOWN/CONFLICT`, rivalidade nunca inferida).
- **Testes:** 10/10 (parceiro atual, troca com histórico, conflito, rumor novo × oficial antigo, override A→B→C, familiares/teammates, ownership, idempotência).
- **Commit:** `feat(v3.17): add pilot relationships`.

### V3.17.5 — Histórico (marcos determinísticos)
- **Arquivos:** `pilot-knowledge.events.ts` (debut/first point/podium/pole/win/championship/team change derivados do espelho; eventos curados com source; `dedupeKey` idempotente; relevância por ano/corrida/título; vínculo season/race do Universe por binding; categoria/labels).
- **Testes:** 6/6 (derivação + idempotência, sem duplicar `RaceResult`, curados, relevância, vínculo, vazio; cleanup de FKs Restrict corrigido no teste).
- **Commit:** `feat(v3.17): add pilot historical context`.

### V3.17.6 — PilotContextResolver
- **Arquivos:** `pilot-context.policy.ts` (caps), `pilot-context.resolver.ts` (`resolvePilotContext` com queries agrupadas, precedence Universe→External, memories por relevância, estado atual do Universe, refresh status, fingerprint SHA-256 determinístico, early-exit sem `DriverProfile`, `loadSpeakerPilotContext` com degradação P2021→null), `pilot-context.prompt.ts` (bloco sem confidence/URLs/ids; caps 2000; rótulo de origem; estado omitido quando irrelevante).
- **Testes:** 13/13 (11 casos do spec + prompt sem leakage + degradação).
- **Commit:** `feat(v3.17): add pilot context resolver`.

### V3.17.7 — Integração com geração
- **Arquivos:** `generation.assembly.ts` — seção opcional `PILOT_CONTEXT` após `CHARACTER_DNA` (speaker-only), `loadSpeakerPilotContext` no bundle, reasons em `omitted`, contrato aceita a seção como opcional; `generation-pilot-context.test.ts` com fixtures de banco e spy provider.
- **Testes:** geração completa 441/441 (regressão) + 8 novos (Alice×Bob, terceiros fora, evidence/confidence/URL/ids fora, sem conhecimento = 12 seções, key muda com perfil/persona/memória, override vence marcado, `CURRENT_TURN` preservado, key determinística).
- **Commit:** `feat(v3.17): integrate pilot context with generation`.

### V3.17.8 — UI do piloto + Persona sem 500
- **Objetivo:** abas Visão geral/Persona/Histórico/Relacionamentos e correção do "Internal Server Error" da Persona no DEV (migration pendente) sem tocar DEV.
- **Arquivos:** `persona.service.ts` (`isPersonaSchemaUnavailable`, `withPersonaAvailability`, carga P2021→`PersonaServiceError UNAVAILABLE 503`), `persona.routes.ts` (mapeamento 503 sanitizado); web `lib/pilot-knowledge.ts`, `hooks/use-pilot-knowledge.ts`, `components/pilot-knowledge/pilot-knowledge-panels.tsx` (overview/persona/history/relationships + fontes/licenças + classificação + CRUD de override), abas em `drivers/[id]/page.tsx`.
- **Testes:** web 469/469 (61 arquivos), incluindo 7 novos dos painéis e regressão da página do piloto; API persona 302/302 (2 novos de availability).
- **Commit:** `feat(v3.17): add pilot knowledge ui and persona availability guard`.

### V3.17.9 — Refresh/rotas/isolamento
- **Arquivos:** `pilot-knowledge.refresh.ts` (reutiliza `ExternalSyncRun`/lock; scopes `DRIVER_PROFILE/DRIVER_RELATIONSHIPS/DRIVER_EVENTS`; resolve identidade/ambiguidade; nunca escreve Universe), `pilot-knowledge.read.ts` (view agregada), `pilot-knowledge.routes.ts` (GET agregado owner-only leak-safe; refresh ADMIN+owner com providers injetados/503; status ADMIN; CRUD override), `app.ts` (DI opcional de providers), `pilot-knowledge.isolation.test.ts`.
- **Testes:** módulo pilot-knowledge 84/84 + isolamento A/B com refresh externo.
- **Deviação documentada:** refresh registra `DRIVER_PROFILE/DRIVER_RELATIONSHIPS/DRIVER_EVENTS`; `DRIVER_PERSONA` não tem run próprio porque traits entram por ingestão de evidência explícita (curated/extractor), nunca por refresh automático (D-068).
- **Commit:** `feat(v3.17): add pilot knowledge refresh and routes`.

### V3.17.10 — Final QA / Docs
- **Regressão completa:** API **2376/2376** (147 arquivos) em **duas execuções consecutivas limpas no mesmo TEST**; Web **469/469** (61 arquivos) ×2 consecutivas limpas. Typecheck API/Web 0; lint API/Web 0; build API/Web 0 (4 execuções API limpas no total após o fix de cleanup).
- **Banco:** TEST 32 migrations, 71 tabelas; 0 `TimelineEvent`/`WorldSnapshot`; 0 conhecimento externo/relacionamentos de universe/sources/runs de piloto; 0 users de fixture; 0 orphans de corrida. DEV intacto (27 migrations, 60 tabelas, 17 usuários, 2 `NUMBER_CORRECTED` pré-existentes); nenhuma migration aplicada ao DEV. External Mirror intocado.
- **Problemas:** (1) resíduo real de `ExternalKnowledgeSource` (~420) por FKs `SetNull` sem cleanup nos testes — corrigido com `test-utils/pilot-knowledge-cleanup.ts` e validado (0 após execução); (2) 1ª execução completa da API teve 4 falhas em 1 arquivo, não reproduzidas em 4 execuções limpas subsequentes (resíduo de cleanups abortados de sessões de debug, limpo); (3) flake pré-existente `external-page.integration.test.tsx` (arquivo não tocado, conhecido desde a V3.14) falhou 1× sob carga, passou isolado e em execuções limpas.
- **Docs:** `v3.17-pilot-knowledge-architecture.md` (§14 status + §15 QA), `v3.17-source-policy.md`, `v3.17-open-questions.md` (13 OQs), D-067..D-071, nota de compatibilidade V3.14.
- **Decisões:** D-067..D-071.
- **Limitações:** refresh de persona é ingestão explícita (sem run automático); UI de override cobre alvo `PUBLIC_PERSON`; live sources opt-in (suíte usa fixtures); sem evolução automática de personalidade (preparada, não implementada).
- **Commit:** `feat(v3.17): complete pilot knowledge`.

### V3.18.0 — Design (Pilot Experience, Memory & Evolution)
- **Docs:** `v3.18-pilot-experience-memory-architecture.md`, `v3.18-evolution-rules.md`, `v3.18-open-questions.md` (16 OQs resolvidas), D-072..D-076.
- **Decisões:** D-072 (Experience = projeção determinística; Memory estendida), D-073 (memory projection com gatilhos; derivada imutável), D-074 (correção invalida experiences/memories na transação), D-075 (evolução baseline+efeitos append-only com fingerprint único), D-076 (resolver lê memories ACTIVE com relevância determinística; generationKey herda).
- **Commit:** `docs(v3.18): design pilot experience and memory architecture`.

### V3.18.1 — Experience/Memory foundation
- **Migrations:** `20260930170000_add_pilot_experience_memory_evolution` (tabelas `PilotExperience`/`PersonaTraitEvolution`, enums de tipo/source/status/derivation, colunas novas em `Memory`/`CharacterPersona`, enum `PERSONA_UPDATED`) — somente TEST.
- **Arquivos:** `pilot-experience.derive.ts` (derivação determinística de vitória/marcos/campeonato/team change/relação/narrativa/curadoria + filtro de futuro), `pilot-experience.memory-rules.ts` (gatilhos de Memory, derivedKey estável, render sem LLM).
- **Testes:** 10/10 puros (derivação, salience, determinismo, projeção, DNF sem memória).
- **Commit:** `feat(v3.18): add pilot experience and memory foundation`.

### V3.18.2 — Reconciliação e invalidação por correção
- **Arquivos:** `pilot-experience.reconcile.ts` (`reconcilePilotExperiences` idempotente com upsert/reaktivação/invalidação, projeção de memories com supercessão por revision, preservação de MANUAL, report) + `invalidatePilotExperienceForCorrection`; hook em `correction.apply.ts` (race→raceId+seasonId; standing→seasonId; number/calendar sem efeito), sem deletar histórico.
- **Testes:** 6/6 de banco (idempotência, manual preservada, P1→P5 invalida vitória, correção que tira título gera SPORTING_DEFEAT + memory substituta, primeira vitória muda → invalidação/replacement, isolamento A/B). Timeline 92/92 verde.
- **Commit:** `feat(v3.18): add experience reconciliation and correction invalidation`.

### V3.18.3 — Integração com contexto/geração
- **Arquivos:** `pilot-experience.relevance.ts` (score determinístico tópico→salience→recência→career-defining), resolver (memories ACTIVE do universe do speaker + legado null, fingerprint com revision/tipo), `context.assembly` (filtro ACTIVE), prompt com `[TIPO]`.
- **Testes:** 4 novos de resolver + 4 puros de relevância + geração 480/480 (memória invalidada fora do prompt).
- **Commit:** `feat(v3.18): integrate memories with pilot context`.

### V3.18.4 — Persona evolution foundation
- **Arquivos:** `persona-evolution.rules.ts` (5 regras nomeadas, valores canônicos, fingerprint por regra+experiência, baseline+Σ deltas com clamp, MANUAL vence), `persona-evolution.service.ts` (preview/apply com `expectedRevision`+`expectedPendingFingerprint`, 409 `EVOLUTION_STALE`, `evolutionRevision`, `TimelineEvent PERSONA_UPDATED`), resolver expõe `evolution.notes`/revision no fingerprint e no bloco.
- **Testes:** 7 puros + 5 de serviço (double-count impossível, no-op na reaplicação, stale, precedência manual, dois títulos, prompt/key mudam).
- **Commit:** `feat(v3.18): add persona evolution foundation`.

### V3.18.5 — Relationship experiences
- **Testes:** 4/4 (relação → experience/memory factual sem emoção inferida; encerrada preserva início; remoção invalida sem deletar; `Relationship.dimensions` intocado).
- **Commit:** `feat(v3.18): add relationship experiences`.

### V3.18.6 — API
- **Rotas:** `GET/POST /api/pilot-context/:characterId/memories`, `PATCH .../memories/:id` (derivada → 409), `GET .../experiences`, `POST .../reconcile`, `POST .../evolution/preview|apply` — owner-only leak-safe; `app.ts` registra o módulo.
- **Testes:** 5/5 de rotas (auth/ownership/filtros/CRUD/reconcile idempotente/evolution preview→apply→stale 409→no-op).
- **Commit:** `feat(v3.18): add pilot context memory api`.

### V3.18.7 — UI
- **Arquivos:** `lib/pilot-experience.ts`, `hooks/use-pilot-experience.ts`, `components/pilot-knowledge/pilot-experience-panels.tsx` (aba **Memórias** com filtros, criação manual, arquivamento, badge derivada/manual, reconciliação; card **Evolução da persona** com preview before/after, razões/expertise e apply explícito), aba Memórias no piloto.
- **Testes:** 7 novos de painéis; Web 476/476 (61/62 arquivos) com o flake conhecido de external-page registrado.
- **Commit:** `feat(v3.18): add pilot memory and evolution ui`.

### V3.18.8 — Final QA / Docs
- **Regressão completa:** API **2422/2422** (155 arquivos) em duas execuções consecutivas limpas no mesmo TEST; Web **476/476** (62 arquivos) ×2 consecutivas limpas. Typecheck/Lint/Build 0 em API e Web.
- **Banco:** TEST 33 migrations, 73 tabelas; 0 `PilotExperience`/`PersonaTraitEvolution`/`Memory` de fixture/`TimelineEvent`/`WorldSnapshot`/users de fixture; 0 knowledge sources/runs de piloto. Resíduo pré-existente de 97 `Memory` órfãs (universeId null, sem participantes) limpo no QA. DEV intacto (27/60/17 + 2 `NUMBER_CORRECTED` legados).
- **Flakes:** 1 falha isolada em execução completa da Web durante o desenvolvimento (arquivo não retido; não reproduzida em 3 execuções limpas consecutivas) + flake pré-existente `external-page.integration.test.tsx` (arquivo não tocado desde V3.14).
- **Docs:** `v3.18-pilot-experience-memory-architecture.md` (§10 status + §11 QA), `v3.18-evolution-rules.md`, `v3.18-open-questions.md` (16 OQs), `v3.18-final-report.md`, D-072..D-076.
- **Commit:** `feat(v3.18): complete pilot experience and evolution`.

### V3.19 — Stabilization, Audit & Product Corrections
- **Auditoria (2 independentes + inspeções):** findings com evidência — C-1 (rota legada de correção escrevia fora do Universe), H-1 (Event sem dono em PATCH/DELETE), H-2 (Memory aceitava Character de terceiros/vazava `userId`), H-3 (Prisma cru em relacionamentos), E-1 (efeito de evolução não revogava com experiência invalidada), F-2..F-7 e 10 itens de documentação.
- **Fixes:** rota legada selada (409 `USE_TIMELINE_CORRECTION`); `Event.createdById` + mutação dono/participante/ADMIN (D-077); participantes de Memory alcançáveis e resposta sem `userId`; view models + 404 leak-safe; `PersonaTraitEvolution.status` + revogação/baseline+Σ; reconcile em transação com `lockUniverseTimeline` e `revision` na invalidação; P2025→404/P2002→409; códigos `DERIVED_MEMORY_IMMUTABLE`/`REFRESH_FAILED`; cross-universe 404 em events/news; `PERSONA_UPDATED` no read model; docs reconciliados. Higiene: 32→0 `Memory` órfãs.
- **QA:** API 2431/2431 ×2; Web 477/477 ×2 (1 flake conhecido); typecheck/lint/build 0; TEST recriado limpo (35/73).
- **Docs:** `v3.19-audit-report.md`, `v3.19-final-report.md`, D-077, anotações de supersession em D-007/D-045/D-058/D-065/D-075.
- **Commit:** `feat(v3.19): complete v3 stabilization` (ver relatório).

### V3.20 — V3 Completion, Environment Readiness & Final Hardening
- **DEV migration sync:** auditoria das 8 migrations pendentes (persona, sprint enum, pilot knowledge, evidence sourceKind, relationship target, experience/memory/evolution, event creator, evolution effect status) — todas aditivas (CREATE TYPE/TABLE, ADD COLUMN com default, ADD VALUE, índices/FKs), sem DROP/DELETE/TRUNCATE/ALTER COLUMN. Backup `pg_dump` + snapshot de contagens; aplicação via `prisma migrate deploy`; DEV passou de **27/60 para 35/73** com **todas as contagens idênticas**; `migrate status` up to date; smoke read-only confirmou o caminho do antigo 503 da Persona sem P2021.
- **Política de ambiente:** `docs/v3-development-environment.md` (DEV persistente × TEST descartável, quando migrations entram no DEV, verificação de pendências, smoke, drift, governança ADMIN, higiene).
- **FASE 3/4/6 (adiados da V3.19):** recompute auditado owner-only/Universe-scoped (sem operação global); review ADMIN documentado como governança de evidência auditada limitada à própria persona; refresh ADMIN+ownership mantido (least privilege, só External Knowledge). Sem código novo necessário; documentado.
- **Strict schemas (V3.19 F-5/L-3):** `create/updateEventSchema`, `addParticipantSchema`, `create/update/participant` de Memory e `create/updateRelationshipSchema` com `.strict()`; testes de campo desconhecido → 400 em events/memory/relationships.
- **Higiene de testes (V3.19 FASE 21):** `relationship.test.ts` com cleanup explícito (fim do maior ofensor, ~11 users/run); `vitest.global-setup.ts` (TEST-only) remove users/universes `@f1nw.test`/`@test.dev`, dados de universo e memórias órfãs ao fim da suíte; teste do provider Cohere ficou hermético (não depende de `COHERE_API_KEY` do `.env` de DEV). Suíte completa passa a terminar com **0 users / 0 universes / 0 órfãos**.
- **QA final:** API **2434/2434** (155 arquivos) ×2 consecutivas; Web **477/477** ×2; typecheck/lint/build 0 em API e Web; flake `external-page` revalidado (isolado 21/21, execuções completas limpas); DEV íntegro; External intocado; `docs/v3-final-status.md` criado com matriz e classificação de limitações.
- **Commit:** `feat(v3.20): complete v3 stabilization`.

### V3.20.1 — Product Fixpack
- **Biography/Pilot Knowledge:** provisionamento lazy idempotente do espelho interno (`pilot-knowledge.provision.ts` + rota GET): identidade, biografia determinística, equipes/títulos e marcos; `sync` no payload (providers/provisioned/lastStatus) e estados claros na UI.
- **Avatar:** causa raiz era o cookie cache de 5 min da sessão; `getSession` agora ignora o cache — avatar persiste na sessão imediatamente após o upload.
- **Timeline:** opção explícita `Todas/Todos` em todos os filtros (voltar a "sem filtro"); range de datas derivado do calendário da temporada (primeira/última corrida), sem hardcode.
- **Campeões:** range de produto 2000..2025 (2026 nunca aparece; temporada em andamento não vira campeã); campeão externo de `ExternalStanding` P1; botão Editar abre modal real (STANDING) ou explicação com navegação para a Linha do Tempo (DERIVED).
- **Sync externa:** toasts top-right sem biblioteca nova (`ToastProvider`), loading persistente + sucesso/erro com auto-dismiss 3,5s.
- **QA:** API **2438/2438** (156 arquivos) ×2; Web **482/482** (63 arquivos) ×2; typecheck/lint/build 0/0; TEST zero resíduos; DEV smoke real (provisionamento do Albon + champions 2025..2000 sem 2026; dados intactos).
- **Docs:** `v3.20.1-product-fixpack.md`.
- **Commit:** `docs(v3.20.1): record product corrections`.

### V3.21 — Calendar/Circuits Audit & Pilot Knowledge Completion
- **Auditoria primeiro:** explorações independentes de circuits/calendar/next-race/progression e de pilot knowledge; concluiu-se que circuitos/calendário/Next Race/progressão já estão implementados e testados (`circuits/circuit.service.ts`, `GET /api/next-race`, `POST /api/world/progress`, `championship-progression.*`, sprint weekend) — o gap real de produto era o Pilot Knowledge incompleto (nacionalidade crua, bio superficial, milestones não autocorrigíveis, bio não editável).
- **Nacionalidade pt-BR global:** `nationality.ptbr.ts` (API: demonimos, ISO-3, países, formas pt-BR, + `feminizeNationalityPtBr`) e `nationality-pt-br.ts` (Web: `localizeNationalityPtBr`); API localiza `identity.nationality` (mantém cru em `externalIdentity`) e Web localiza driver-card/página/painel. Nenhuma tradução ad-hoc em componente.
- **Biografia rica:** nascimento do `sourceRecord` da Jolpica, nacionalidade flexionada em prosa, "Tem registros na Fórmula 1 desde {ano}" (D-080 — sem afirmar estreia com espelho parcial), equipes, títulos, até 3 marcos, interesses.
- **Auto-upgrade self-healing:** perfis `CURATED`/sem bio são recompostos na reabertura (mesma source, sem duplicar ledger); bio de provider externo é preservada (D-079). `PATCH/DELETE /api/pilot-knowledge/drivers/:characterId/biography` owner-only (override Universe-scoped, cap 1200, leak-safe 404).
- **Milestones:** prune de eventos `DERIVED_RESULTS` obsoletos — quando o espelho ganha corrida mais antiga, `FIRST_WIN` é movido e o antigo é removido; curados intactos.
- **UI:** painel Overview com editar/restaurar biografia (textarea novo `ui/textarea.tsx`), badge de origem, "Não informado." para campos ausentes; invalidação de `drivers` mantém a ficha sincronizada.
- **QA:** API e Web ×2 + smoke DEV (Albon: `driverCode=ALB`, `dateOfBirth=1996-03-23`, bio/contexto pt-BR; sem sources duplicadas); typecheck/lint/build 0/0.
- **Docs:** `v3.21-calendar-circuit-progression.md` (inclui matriz do que existe × pendências de circuito/calendário), D-078..D-080.

### V3.22 — External Data Hub, Circuits, Historical Champions & Pilot Data Quality
- **Inventário (FASE 1):** mapeamento completo de external-sync/circuits/calendar/standings/providers/mídia/avatar/champions antes de mudar código; classificações IMPLEMENTED/PARTIAL/BROKEN/MISSING documentadas em `v3.22-external-data-hub.md` (inclui matriz de fontes FASE 56).
- **Campeões 2000-2025:** `champions.canonical.ts` com 26 temporadas factuais (FIA_CANONICAL_CHRONOLOGY/FACTUAL_REFERENCE); resolução standing → canônico com `sourceConflict`/`canonicalChampion` explícitos; baseline MATCH read-only para Universe sem temporada (sem fabricar seasons/resultados); 2026 nunca aparece; apply de campeões agora invalida `PilotExperience` da temporada (D-081).
- **Avatar (bug real, 2 causas-raiz):** CORP `same-origin` do helmet bloqueava `<img>` cross-origin — liberado somente em `/api/media/:id`; cookie cache de 5 min da sessão devolvia `User.image` antigo — `POST/DELETE /api/profile/avatar` limpam `f1nw.session_data` (testes: Set-Cookie + header CORP + sessão pós-upload) (D-082).
- **Milestones:** nova categoria `FIRST_FASTEST_LAP` + `ExternalResult.fastestLapTime` (migration aditiva `20260930223000`, aplicada em TEST e DEV com backup); Jolpica `FastestLap.Time` normalizado; primeira ocorrência + prune mantidos (D-084).
- **Catálogo de circuitos:** `GET /api/external/circuits` (lista global, busca, stats via groupBy único) e `/api/external/circuits/:id` (maiores vencedores, recentes, volta mais rápida em corrida, recorde oficial indisponível com razão, mídia por resolver abstêmio); aba Externo → Circuitos com lista/detalhe/busca e país pt-BR (`localizeCountryPtBr`) (D-083).
- **Atualidade × histórico:** teste garante que temporada corrente nova atualiza equipe/número/bio sem reescrever `ExternalDriverSeason` históricos.
- **Higiene:** cleanup de circuitos do teste de sync Jolpica (+ guard `races: none`); TEST 0 resíduos.
- **QA:** API 2459/2459 (159 arquivos) ×2; Web 495/495 (65 arquivos) em execuções limpas ×2 (flake pré-existente `external-page` reproduzido 1×, isolado 21/21, não mascarado); typecheck/lint/build 0/0; DEV 36 migrations e dados intactos.
- **Adiados com justificativa:** composer de biografia por LLM, F1DB/OpenF1/PitLane/Wikimedia como providers ativos do catálogo, layouts/fotos reais, recorde oficial de volta, backfill histórico em lote.
- **Docs:** `v3.22-external-data-hub.md`, D-081..D-084.

### V3.23 — Historical Champion Overrides, F1DB Integration & Biography Composer
- **Override histórico de campeão (sem Season):** migration aditiva `20260930234500_add_historical_champion_override` (enum SET/CLEARED + tabela + índices), comandos no correction framework, replay/projeção com nota em `WorldSnapshot`, rotas `POST /api/timeline/champions/historical/:year/preview|apply` (EDIT/RESTORE com token determinístico e supersession de SET por SET) e UI (“Campeão histórico do Universe” com select, prévia e restaurar). Aceitação: 2024 Verstappen → Alicya Kuchinski no Universe, espelho intacto, restore volta ao baseline (D-085).
- **F1DB real vendorizado:** subset CSV do release v2026.15.1 (CC BY 4.0) em `data/external/f1db/` + SVGs f1-circuits-svg (CC BY 4.0) em `data/external/f1-circuits-svg/`, ambos com `PROVENANCE.json`; provider local (parser CSV, alias Ergast→F1DB, fallback por nome), enriquecimento de circuito (extensão/curvas/tipo/direção/cidade/primeiro GP) e endpoint `layout.svg` sanitizado com atribuição (D-086).
- **Marcos históricos reais:** merge F1DB (primeira ocorrência no histórico completo) com o espelho, sourceId no ledger; perfil do piloto cai para F1DB (DOB/local/código/stats/títulos); teste Lando 2019/2020/2021/2024/2025 (D-087).
- **Biography composer:** pipeline claims-only, prompt canônico, LLM opcional (`GenerationProvider`), sanitização, source ledger BIOGRAPHY_PAGE, bio gerada preservada na reabertura; fallback determinístico com sentença de carreira (D-088).
- **Avatar:** contrato cross-origin (Origin + CORP cross-origin + CORS) e sessão sem cookie de cache verificados em teste.
- **QA:** API 2484/2484 (163 arquivos) ×2; Web 497/497 (65 arquivos) ×2; typecheck/lint/build 0/0; TEST 0 resíduos; DEV 37/37 migrations com backup e dados intactos.
- **Docs:** `v3.23-external-data-quality.md`, D-085..D-088.

### V3.24 — Biography Quality & External Enrichment
- **Auditoria primeiro:** trace completo da biografia + evidência real no DEV (5 bios `BIOGRAPHY_PAGE` corrompidas: "talentoexceptional", mix PT/EN, invenções) → causas-raiz C1–C6 (persistência sem validação, texto livre, prompt-only, sem verifier, sem fallback, sem versionamento); doc `v3.24-biography-quality.md` commitado antes do código (D-089..D-092).
- **Claims aprovados:** `biography.claims.ts` (ids estáveis, chaves tipadas, autoridade, fingerprint, planner cronológico); F1DB ampliado com constructors/entrants (equipes reais por período, test drivers excluídos; Max → Toro Rosso 2015 / Red Bull 2016–2026); identidade estrita com `AMBIGUOUS_IDENTITY` bloqueando LLM.
- **Composer v2 + validação:** Structured Output estrito com `claimIds`; `BiographyQualityValidator` genérico (concatenção, idioma misturado, substantivo/ano sem claim, etc.); `BiographySemanticVerifier` opcional; fallback determinístico com motivo observável; self-healing por `generatorVersion`/validação (reparou 23 perfis do DEV; 0 corrupções).
- **Smoke LLM real:** Ollama executado (13,7 s) — contrato não satisfeito pelo modelo local → fallback limpo validado; nenhuma credencial OpenAI presente.
- **Next Race:** layout F1DB real por chave (`/api/external/circuits/f1db/:key/layout.svg`), extensão/curvas/tipo/direção com `lengthSource`, web renderiza SVG com atribuição (D-091).
- **Media:** provider Wikimedia Commons opt-in com allowlist CC0/CC BY/CC BY-SA, metadata/cache/timeout e degradação; desabilitado por padrão e testado com mock (D-092). OpenF1 permanece complementar (headshots); enriquecimento de circuito OpenF1 documentado como pendência.
- **QA:** API 2505/2505 (165 arquivos) ×2; Web 497/497 (65 arquivos) ×2; typecheck/lint/build 0/0; TEST 0 resíduos; DEV preservado (37 migrations, 23 bios limpas, 0 "campeão 2026", backup `f1narrative_dev_pre_v324.dump`).
- **Docs:** `v3.24-biography-quality.md`, D-089..D-092.

### V3.24.1 — Rich Biography Evidence & Narrative Depth
- **Evidência curada com provenance:** `curated-evidence.json` (fatos estruturados com `sourceRef`, autoridade, anos; fontes reais: F1 oficial, Alpine, McLaren, Honda, Red Bull, sites oficiais, entrevista F1; sem prosa copiada) + `biography.evidence.ts` com versionamento e cache (D-093).
- **Categorias editoriais:** ORIGIN, KARTING, JUNIOR_CAREER, F1_ENTRY, TEAM_HISTORY, F1_ACHIEVEMENTS, PUBLIC_PERSONALITY, INTERESTS, PROJECTS, CURRENT_CONTEXT; dedupe curado sobre derivado (inclui TEAM_SEASON vs TEAM_HISTORY); fingerprints com `evidenceVersion`.
- **Coverage + planner:** rich mode ≥5 áreas relevantes; 8 blocos editoriais sem repetição de claims; sparse preservado (D-094).
- **Composer v3 + fallback rico:** contrato `paragraphs[].sentences[].{text,claimIds}`; prompt narrativo; fallback determinístico multi-parágrafo por categoria; quality validator com parágrafos/anos citados/`too-few-paragraphs` (D-095). UI renderiza parágrafos.
- **Resultado real (DEV):** Gasly e Norris saíram de 1 parágrafo estatístico para **8 parágrafos narrativos** com kart, base, F1, conquistas, personalidade atribuída, interesses e projetos; demais 21 perfis re-materializados; 0 corrupções; backup `f1narrative_dev_pre_v3241.dump`.
- **Cobertura do catálogo:** `v3.24.1-driver-coverage.md` (47 bindings) — só Gasly/Norris rich; lacunas reais documentadas, sem cobertura inventada.
- **QA:** pilot-knowledge 136/136 + suíte completa ×2 + Web ×2; lint/build 0; TEST limpo.
- **Docs:** `v3.24.1-rich-biography.md`, D-093..D-095.





