# V3 — Architectural Decisions

Decisões tomadas durante a implementação autônoma da V3. Cada entrada registra contexto, decisão e consequência.

## D-001 — Provider externo incremental (não big-bang)
- **Contexto:** a Jolpica é a única fonte integrada; trocar para um provider universal de uma vez exigiria reescrever todos os escopos de sync.
- **Decisão:** criar `ExternalDataProvider` cobrindo as capacidades novas (`getCircuits`, `getSeasonSchedule`) e manter os demais escopos no `JolpicaClient`. `createExternalDataProvider("jolpica", client)` é o ponto de extensão para F1DB.
- **Consequência:** nenhuma parte nova do código chama Jolpica diretamente; troca de fonte é localizada.

## D-002 — `ExternalCircuit` (mirror global) × `Circuit` (Universe)
- **Decisão:** seguir o padrão existente do projeto: mirror factual global + entidade própria por Universe + binding `[universeId, externalCircuitId]` (via `ensureCircuitForUniverse`).
- **Consequência:** um usuário nunca enxerga ou altera o circuito do outro; o espelho permanece factual.

## D-003 — Campos legados preservados
- **Decisão:** `Race.circuit/country` (strings) permanecem; `Race.circuitId` é opcional e ligado por `onDelete: SetNull`. `ExternalRace` recebeu colunas novas sem remover as antigas.
- **Consequência:** compatibilidade total com dados e rotas atuais; backfill é oportunista.

## D-004 — Idempotência e lock
- **Decisão:** upsert por `[source, externalId]`/`[source, seasonYear, round]` com `contentHash` (padrão do projeto). Controle de concorrência em memória por `[source, scope, seasonYear]` com coalescing: chamadas simultâneas do mesmo escopo compartilham a mesma execução; persistência e fetch no mesmo run.
- **Consequência:** sync repetido não duplica; duas requisições concorrentes não geram dois fetches/persistências.

## D-005 — Auditoria de sincronização
- **Decisão:** toda execução cria `ExternalSyncRun` (RUNNING→SUCCESS/FAILED) com `statistics`, `finishedAt`, `lastSyncedAt` e `error` sanitizado (máx. 300 chars, sem stack). `triggeredById` quando houver usuário.
- **Consequência:** a UI da Fase 6 poderá exibir progresso/resultado sem novo modelo.

## D-006 — Normalização defensiva, sem inventar dados
- **Decisão:** país passa por aliases (`UK→United Kingdom`, `USA→United States`, etc.); coordenadas são validadas por faixa e descartadas se inválidas; circuitos sem `circuitId` ou `circuitName` são pulados; corridas sem `round` são puladas. Não bloquear o lote por um registro inconsistente.
- **Consequência:** dados suspeitos não entram no espelho; lacunas ficam `null` em vez de valores fabricados.

## D-007 — F1DB reservado para assets (não integrado ainda)
- **Contexto:** F1DB é CC BY 4.0 e fornece layouts SVG, comprimento e voltas; Jolpica não fornece nada disso.
- **Decisão:** os campos (`lengthMeters`, `turns`, `direction`, `layoutKey`, `layoutUrl`) existem no modelo, mas permanecem nulos até integração aprovada. Não fazer scraping de Formula1.com.
- **Consequência:** nenhuma dependência nova nem dados inventados; a integração é aditiva quando decidida.

## D-008 — Regra de número de piloto (FIA × gameplay)
- **Contexto:** a regra oficial vigente (2026): números 2–99; `#1` reservado ao campeão; `#17` aposentado (Bianchi); `#0` inelegível; número liberado após 2 temporadas sem uso.
- **Decisão (a implementar na Fase 4):** o backend é autoridade; `#1` só para o campeão anterior; `#17` sempre indisponível; unicidade por temporada via constraint. Qualquer regra de gameplay mais restritiva será documentada aqui.
- **Consequência:** a UI apenas sugere; conflitos de corrida retornam 409 claro.

## D-009 — `TimelineEvent` é infraestrutura temporal, não substitui `Event`
- **Decisão:** `TimelineEvent` registra mudanças de estado do Universe (avanço de tempo e correções de fatos esportivos); o `Event` narrativo continua sendo o registro da história. Não há conversão, espelhamento ou dependência entre os dois.
- **Consequência:** narrativa (memória/RAG/notícias/conversa) permanece intocada; replay temporal não depende do sistema narrativo.

## D-010 — Ordenação determinística e correções retroativas
- **Decisão:** replay ordena por `(worldDate, sequence)`. Correção retroativa é um novo evento com `worldDate` no passado (≤ data atual do mundo) e `supersedesId` opcional (somente mesmo `kind`); durante o replay o evento superseded é ignorado, mas permanece no histórico.
- **Consequência:** editar o passado não sobrescreve nada; o estado derivado é reconstruído deterministicamente. Sem branches/universos alternativos na V3.

## D-011 — Snapshot: baseline + checkpoint por volume
- **Decisão:** snapshot baseline em `sequence 0` no primeiro avanço; checkpoints automáticos a cada 20 eventos; snapshots explícitos via serviço. Estado do snapshot = `WorldState` + `ChampionshipStanding` da temporada corrente.
- **Consequência:** replay não recalcula todo o histórico em toda requisição e o custo é limitado; estratégia simples, sem otimização prematura.

## D-012 — Concorrência por advisory lock do Universe
- **Decisão:** toda mutação temporal toma `pg_advisory_xact_lock(hashtext('timeline:<universeId>'))` dentro da transação; `sequence` é única por universe. Recompute, avanço e correções usam a mesma trava.
- **Consequência:** avanços/correções concorrentes são serializados; falhas fazem rollback total (sem estado parcial).

## D-013 — Um único sistema de progressão
- **Decisão:** a agregação de standings foi extraída para `championship-progression.service.recomputeSeasonStandings` e é usada tanto pela rota `POST /api/races/:raceId/championship/apply` quanto pela timeline (eventos `RACE_RESULT_CORRECTED`).
- **Consequência:** não existe segundo cálculo de campeonato; correções e apply produzem o mesmo resultado para os mesmos fatos.

## D-014 — Eventos de calendário são auditoria estado-neutra
- **Decisão:** `RACE_SCHEDULED` e `RACE_UPDATED` registram mudanças do calendário na timeline, mas o replay/recompute os ignora (não alteram `WorldState` nem standings). A timeline continua determinística e idempotente.
- **Consequência:** calendário tem trilha de auditoria sem criar acoplamento com o estado derivado; `Race` permanece fato materializado.

## D-015 — Override do Universe preservado por snapshot externo
- **Decisão:** cada binding de corrida guarda `contentHash` + `externalSnapshot` (último valor externo). O sync só atualiza um campo do `Race` se ele ainda for igual ao snapshot; campos editados pelo usuário são preservados. Sem sistema completo de edição de calendário nesta fase.
- **Consequência:** sync externo não sobrescreve silenciosamente decisões do usuário; backfill legado (snapshot nulo) atualiza uma vez e passa a guardar.

## D-016 — Next Race é estado do Universe
- **Decisão:** `GET /api/next-race` deriva previous/current/next de `WorldState` + `Race`/`Circuit` do Universe (ordem determinística `round, date, id`; classificação por `currentRaceId` e status). Nenhuma consulta à Jolpica em tempo de leitura; `totalRounds` é dinâmico.
- **Consequência:** a UI nunca escolhe a próxima corrida pela resposta externa; sem dados inventados (campos ausentes = `null`).

## D-017 — Materialização serializada por Universe
- **Decisão:** `universeInitService.execute` toma o advisory lock do Universe **antes** de montar o plano, reutilizando o lock da timeline. Corridas com dados incompletos são materializadas com campos nulos.
- **Consequência:** execuções concorrentes não duplicam corridas/bindings/eventos; um registro inconsistente não derruba o lote (D-006).

## D-018 — Número é escopo de temporada
- **Decisão:** a autoridade do número é `SeasonDriverEntry.number` (opção B); `DriverProfile.number` permanece como cache de compatibilidade, sincronizado apenas quando a entry pertence à temporada corrente do `WorldState`.
- **Consequência:** trocar de temporada não herda número automaticamente; leituras legadas continuam funcionando; board/atribuição sempre por temporada.

## D-019 — Regras FIA traduzidas para gameplay
- **Decisão:** referência 2026 F1 Regulations (Section A, Issue 03, 25/06/2026, publicada em 05/08/2026, WMSC 23/06/2026; A2.4 idêntico à Issue 02 — verificado em 28/09/2026, Art. A2.4). Gameplay: range 1–99, `#17` reservado, `#1` apenas para o campeão da temporada anterior do mesmo Universe, unicidade por temporada.
- **Consequência:** divergências FIA/gameplay são intencionais e documentadas; erros semânticos (`NUMBER_RESERVED`, `CHAMPION_ONLY`, `NUMBER_ALREADY_USED`) expõem o motivo.

## D-020 — Concorrência por constraint + P2002
- **Decisão:** unicidade garantida por índice único `[seasonId, number]`, com `P2002` convertido em `NUMBER_ALREADY_USED` (409); sem lock de aplicação para atribuição.
- **Consequência:** corrida de requisições concorrentes resulta em um vencedor e um 409 previsível.

## D-021 — Auditoria de número via timeline
- **Decisão:** reutilizar `NUMBER_CORRECTED` no `TimelineEvent` (worldDate = data corrente do world, causado por usuário), aplicado de forma idempotente no replay.
- **Consequência:** mudanças ficam auditáveis e reproduzíveis sem schema novo de eventos.

## D-022 — Referência regulatória vigente: Section A Issue 03
- **Decisão:** a referência normativa de números de piloto passa a ser a FIA 2026 F1 Regulations — Section A [General Provisions] — Issue 03 (documento de 25/06/2026, WMSC 23/06/2026, publicado no site da FIA em 05/08/2026). Verificação de 28/09/2026: Art. A2.4 idêntico à Issue 02 (A2.4.1 first-come/pedido de troca; A2.4.2 `#1` do campeão + reserva do número anterior; A2.4.3 forfeiture; A2.4.4 demais pilotos; A2.4.5 1–99 exceto 17).
- **Consequência:** D-008, D-018 e D-019 permanecem válidas sem ajustes de comportamento; novas Issues devem repetir esta verificação antes de qualquer alteração de código.

## D-023 — Nome/imagem/email permanecem no Better Auth
- **Decisão:** `User.name`, `User.email` e `User.image` são a única fonte de verdade; `UserProfile` guarda apenas dados de domínio (favoritos). `User.image` armazena a URL controlada `BETTER_AUTH_URL/api/media/:id`, nunca a storageKey.
- **Consequência:** nenhum campo duplicado entre BA e domínio; UI de nome usa a sessão (edição via `updateUser` do BA fica para quando necessária); a página de perfil sempre lê a view do banco.

## D-024 — Favoritos escopados ao Universe do usuário
- **Decisão:** `favoriteTeamId`/`favoriteDriverId` referenciam entidades do Universe do próprio usuário; o backend valida pertencimento (404 inexistente, 403 `FAVORITE_NOT_IN_UNIVERSE`), com FKs `onDelete: SetNull` e `UserProfile.userId` único.
- **Consequência:** um usuário não referencia nem lê entidades de outro Universe, mesmo homônimas; a UI não é fonte de validação.

## D-025 — MediaAsset é o recurso; acesso owner-only por rota interna
- **Decisão:** `MediaAsset` guarda provider/storageKey/mime/byteSize/originalFilename/kind e o dono; a imagem é servida por `GET /api/media/:id` autenticado e restrito ao dono (404 para terceiros). A URL pública é derivada de `BETTER_AUTH_URL`; a storageKey nunca sai do servidor.
- **Consequência:** trocar local→S3 não muda o domínio nem a URL; URL assinada/objeto privado permanece possível no futuro sem expor o provider.

## D-026 — Upload binário cru validado por conteúdo
- **Decisão:** sem multipart (nenhuma dependência nova): `POST /api/profile/avatar` aceita apenas `image/jpeg|png|webp` com limite `STORAGE_MAX_UPLOAD_BYTES`; o MIME é confirmado por magic bytes (sniffing próprio) e deve coincidir com o declarado. SVG/HTML/PDF/executáveis são rejeitados; o filename do cliente é apenas metadata sanitizada.
- **Consequência:** nenhum arquivo arbitrário entra no storage; extensão da key é derivada do MIME detectado; erros semânticos (415/400/413) sem vazar key ou conteúdo.

## D-027 — Consistência upload→DB com compensação (sem transação longa)
- **Decisão:** a ordem é upload → criar `MediaAsset` (se falhar, apaga o objeto) → atualizar `User.image` (se falhar, apaga o asset) → remover o asset anterior best-effort. Delete limpa a referência primeiro e tolera ausência; `deleteMediaAsset` remove objeto e, em `finally`, a row.
- **Consequência:** o perfil nunca aponta para arquivo inexistente; o pior caso é objeto órfão no storage (documentado), nunca referência quebrada; I/O externo não segura transação de banco.

## D-028 — S3-compatible sem SDK (SigV4 mínimo) e local com key do servidor
- **Decisão:** `S3CompatibleStorageProvider` assina requisições com SigV4 implementado sobre `fetch` (path-style default), sem adicionar SDK; `LocalStorageProvider` gera keys `user-avatars/<userId>/<uuid>.<ext>` com flag `wx`, validação de key e contenção no root configurado.
- **Consequência:** o contrato S3 fica pronto para MinIO/S3 sem dependência nova; path traversal e sobrescrita de arquivo de outro usuário são impossíveis pela API.

## D-029 — Refresh composto é Mirror-only
- **Decisão:** `POST /api/external-sync/refresh` executa a ordem explícita `SEASON → TEAMS → DRIVERS → DRIVER_SEASONS → RACES → RESULTS → STANDINGS`, sem auto-materialização; o endpoint legado por escopo mantém o comportamento anterior (incluindo materialização) e não é usado pela UI.
- **Consequência:** o botão de refresh nunca altera Universe (Race/Driver/Team/Character/WorldState/Timeline); a materialização continua sendo um processo explícito e separado.

## D-030 — Observabilidade de sync é derivada de `ExternalSyncRun`
- **Decisão:** `GET /api/external-sync/status` lê `ExternalSyncRun` (lastRun/lastSuccess/recent) e os locks em memória (`active`); o refresh composto não cria linha própria de "REFRESH". Erros exibidos são sanitizados (URLs → `[fonte externa]`, sem stack) e `triggeredById` é registrado por escopo.
- **Consequência:** nenhum modelo/histórico novo; a UI mostra o que o backend registrou sem expor detalhes internos.

## D-031 — Refresh admin-only; status autenticado; coalescing por lock
- **Decisão:** executar refresh exige ADMIN (regra preservada; `401`/`403` garantidos no backend), enquanto ler o status é permitido a qualquer usuário autenticado. O refresh composto reutiliza o coalescing da Fase 1 com lock próprio `source:REFRESH:year`, mantendo escopos independentes paralelizáveis.
- **Consequência:** cliques/requisições concorrentes compartilham a execução sem fetches ou runs duplicados; nenhum lock global bloqueia escopos independentes.

## D-032 — Contexto de notícia derivado do Event (sem novas colunas)
- **Decisão:** Season/Race de uma notícia vêm de `Event.payload.seasonId`/`payload.raceId` (eventos de corrida sempre carregam ambos); não criar colunas nem inferir por timestamp. Eventos sem contexto determinável permanecem sem vínculo e fora dos feeds de temporada/corrida.
- **Consequência:** zero migration; a integridade depende de validação no backend na criação/edição do Event (`404`/`403`/`400 INVALID_EVENT_CONTEXT`), impedindo referência cruzada entre universos.

## D-033 — Feed de notícias escopado ao Universe com temporada corrente por padrão
- **Decisão:** `GET /api/news` resolve `seasonId`/`raceId` dentro do Universe do usuário (403/404 semânticos) e, sem filtro, usa `WorldState.currentSeasonId`; ordenação determinística `worldDate desc (nulls last) → createdAt desc → id desc`; paginação `limit`/`offset` com `hasMore`.
- **Consequência:** nenhum feed atravessa universos; a Home não precisa escolher temporada e o Championship filtra explicitamente; consultas determinísticas mesmo com empates de data.

## D-034 — Cobertura de corrida reutiliza a materialização existente
- **Decisão:** `processRaceNarrative` passa a chamar `syncNewsForEvent` na mesma transação da criação do Event (mesma dedup/advisory lock); mutações de Event seguem regenerando a notícia. Timeline e external refresh continuam sem criar Event/NewsItem.
- **Consequência:** cada acontecimento de corrida ganha cobertura 1:1 sem duplicação em reprocessamento; notícia nunca vira fonte de verdade nem item de timeline.
