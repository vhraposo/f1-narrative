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
- **Atualização V3.19:** F1DB foi integrado como **provider estruturado de driver knowledge** na V3.17 (D-070; `f1db.provider.ts` — identidade/carreira/biografia com CC BY 4.0). Os campos de assets de circuito (`lengthMeters/turns/layout*`) continuam nulos; "não integrado" aplica-se apenas a esses assets.

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

## D-035 — SSE em rota dedicada com streaming opcional no provider
- **Decisão:** `POST /api/conversations/:id/turn/stream` reutiliza `executeTurn`; streaming é uma capability opcional (`runStream`) do `GenerationProvider`. Providers sem streaming usam `run()` + delta único no servidor; o cliente cai uma única vez para `POST /turn` quando o SSE falha antes de produzir conteúdo. `/turn` e `/generate` permanecem inalterados.
- **Consequência:** nenhum segundo motor de geração; Ollama real ganha streaming incremental, NullProvider e providers legados continuam funcionando.

## D-036 — Contrato SSE fixo com payload mínimo e persistência só no final
- **Decisão:** quatro eventos (`generation.started|delta|completed|error`), validados por zod no cliente; deltas carregam apenas texto incremental; `completed` replica o resultado do `/turn` (userMessage/messages/failedSpeakers) após a persistência normal; erros são mapeados para códigos semânticos e sanitizados. `failFast` no modo stream re-lança falha de provider para virar `generation.error`.
- **Consequência:** o cliente nunca precisa interpretar texto livre; systemPrompt/contexto/RAG/stack não trafegam; a mensagem final é a mesma do fluxo tradicional.

## D-037 — Desconexão aborta geração; cleanup por conexão
- **Decisão:** `close` da conexão aciona `AbortSignal` propagado até o provider (nada parcial é persistido); frames usam fila serializada com `drain` (backpressure) e heartbeat de 15s; cada conexão tem writer/estado próprios, com contador de ativos para observabilidade e limpeza em completed/error/abort. Auth por sessão (cookie) em toda conexão e ownership por participação da Conversation.
- **Consequência:** sem vazamento entre clientes nem listeners acumulados; streams abandonados não ficam pendurados; sem broadcast global.

## D-038 — Decisão comportamental determinística; LLM só compõe conteúdo
- **Decisão:** a camada Context → Decision → Policy → Action → Execution → Audit decide por heurística server-side (CREATE_EVENT se corrida corrente sem cobertura do personagem; senão SEND_MESSAGE se há conversa válida; senão NO_ACTION). O provider LLM não decide nem executa banco: é usado apenas para compor o texto de SEND_MESSAGE pelo pipeline existente.
- **Consequência:** decisões auditáveis e baratas (sem chamada LLM para decidir); NO_ACTION é resultado de primeira classe; gancho para decisão via LLM fica para fase futura sem mudar o contrato.

## D-039 — AiDecision Universe-scoped com claim atômico e cooldown na própria auditoria
- **Decisão:** nova tabela `AiDecision` (migration aditiva) guarda status/actionType/alvo/motivo/contextVersion/policyCode/referências de resultado e metadata mínimo — sem prompts. Execução faz claim `DECIDED → EXECUTING` em transação com advisory lock por personagem; cooldown por actionType e limite por hora derivam de linhas EXECUTING/EXECUTED; duplicidade concorrente → 409.
- **Consequência:** uma decisão executa no máximo uma vez; duas avaliações concorrentes não geram duas ações incompatíveis; nada de infraestrutura distribuída.

## D-040 — Execução reusa Event/News/Memory/Relationship e nunca confia em IDs do modelo
- **Decisão:** SEND_MESSAGE reusa `assembleGenerationBundle` + `persistGeneratedMessage` (instrução interna não persistida); CREATE_EVENT reusa o helper `createEventWithDerivations` (extraído do POST /api/events) com participantes criados antes das derivações, produzindo Event + NewsItem + Memory/Relationship pelo fluxo existente. Toda referência (conversa, corrida, participantes) é revalidada no banco no momento da execução; metadata não é fonte confiável.
- **Consequência:** nenhuma escrita paralela de News/Memory/Timeline; falha de provider vira FAILED sem estado parcial; violação de policy vira REJECTED com `policyCode` auditável.

## D-041 — Evolução season-scoped sobre os atributos existentes
- **Decisão:** evolução de pilotos/equipes opera sobre `DriverAttribute`/`TeamPerformance` (season-scoped via `Season.universeId`), com deltas determinísticos calculados de `RaceResult` de corridas FINISHED e clamp 0..100. Sem modelo novo de atributos nem histórico paralelo; External Mirror nunca é fonte de evolução e refresh externo não reescreve valores.
- **Consequência:** um Universe evolui sem interferir em outro; rows são materializadas no primeiro apply (defaults efetivos 50 antes disso); USER e AI seguem o mesmo caminho.

## D-042 — Idempotência por fingerprint com auditoria na Timeline
- **Decisão:** o change set carrega um fingerprint SHA-256 canônico dos resultados considerados; `apply` verifica o último `TimelineEvent` `ATTRIBUTE_EVOLVED` da temporada e recusa repetição (`409 ALREADY_APPLIED`). O evento é auditoria state-neutral (replay ignora), sem criar outro sistema temporal. `evaluate` sinaliza `alreadyApplied` quando o fingerprint atual já foi aplicado.
- **Consequência:** aplicar duas vezes não duplica deltas; nova corrida finalizada muda o fingerprint e permite nova evolução; a Timeline segue responsável pelo histórico.

## D-043 — Fórmulas limitadas e explícitas por avaliação
- **Decisão:** cada avaliação aplica deltas pequenos (teto ±3): piloto por vitórias/pódios/ganho de posições/taxa de conclusão/abandonos (speed, racecraft, consistency, aggression) e equipe por vitórias/pódios/abandonos/conclusão (carSpeed, reliability, operations). Nada de RNG nem LLM.
- **Consequência:** evolução previsível e testável; `aggression`/`operations` passam a ter dinâmica (ainda não consumidos pela simulação atual); rodar simulações depois consome os novos valores por decisão explícita do usuário.

## D-044 — Sprint Weekend: sugestão externa + override do Universe
- **Decisão:** `ExternalRace.hasSprint` guarda a informação estruturada da fonte (`true` com `Sprint`/`SprintQualifying`; `false` somente quando a fonte enumera o cronograma de sessões sem Sprint; `null` quando não há informação — nunca heurística por nome). O `Race` do Universe guarda `sprintOverride` (autoridade manual) e `sprintExternal` (sugestão), com valor efetivo `sprintOverride ?? sprintExternal ?? false`. Materialização/refresh atualizam apenas `sprintExternal` e jamais tocam o override.
- **Consequência:** dois universos podem decidir diferente para o mesmo weekend externo; sync repetido é idempotente; ausência de dado permanece indeterminada (`null`), sem inventar ausência.

## D-045 — Pontuação de Sprint: regulamento FIA vigente (implementado na V3.5/D-048)
- **Decisão (produto):** implementar Sprint conforme FIA 2026 — Section A Issue 03, Art. A2.2.2: P1..P8 = 8,7,6,5,4,3,2,1, atribuídos a Drivers' e Constructors' Championship; sem pontos se o líder não completar 2 voltas consecutivas sem SC/VSC; sem pontos com menos de 50% da Scheduled Sprint Distance; ≥50% aplica a tabela; dead heat pela regra oficial. Referências de lifecycle: Section B vigente (Iss 08, 05/08/2026) B2.1–B2.5 (FP, Sprint Qualifying, Sprint Session, Qualifying, Race).
- **Consequência:** Sprint terá resultado próprio (`RaceSessionResult`, semanticamente distinto de Practice/Qualifying/Sprint Qualifying/Race) e a soma ao campeonato usará um mecanismo oficial de Sprint separado do Race — a implementação faz parte da sequência da Fase Race Weekend e não foi incluída na determinação de Sprint Weekend.

## D-046 — `RaceSessionResult` próprio; Race continua em `RaceResult`
- **Decisão:** Practice, Sprint Qualifying, Sprint e Qualifying gravam em `RaceSessionResult` (unique por `[raceId, driverProfileId, session]`); a Race permanece exclusivamente em `RaceResult`. Qualifying também grava o grid em `RaceResult.grid` (semântica existente). `RaceStatus`/`RaceSession` ganham `PRACTICE/SPRINT_QUALIFYING/SPRINT`; a Timeline ganha `SESSION_COMPLETED` (state-neutral no replay).
- **Consequência:** categorias de resultado nunca se sobrescrevem; nenhum histórico paralelo; replay/recompute não depende de sessões.

## D-047 — State machine por configuração do weekend com lock por corrida
- **Decisão:** a sequência é derivada de `effectiveSprint` (padrão 3 sessões; com Sprint, 5). O runner exige o predecessor, bloqueia Sprint não configurado, duplicatas e weekend finalizado; `rerun:true` só para Practice corrente. Execução em transação com advisory lock `race-weekend:<raceId>` + lock da timeline e revalidação de status; WorldState (`currentRaceId/currentSeasonId/currentSession`) atualizado a cada sessão e limpo no FINISHED via apply.
- **Consequência:** exatamente uma execução efetiva sob concorrência; rollback total em falha; progressão sempre explícita (sem scheduler/IA).

## D-048 — Sprint scoring oficial no recompute único, com elegibilidade explícita
- **Decisão:** `sprintPointsForPosition` (8..1, sem fastest lap) é separado de `pointsForPosition`; `recomputeSeasonStandings` segue como única autoridade, reagrega Race + Sprint (dead heat compartilha a soma das posições empatadas) e os Constructors derivam da soma por equipe. A elegibilidade oficial é representada explicitamente (`neutralizedStart`, `distancePct >= 50`) no metadata do Sprint; o simulador v1 assume distância completa e sem neutralização, documentado como premissa, sem inventar SC/VSC.
- **Consequência:** Sprint nunca usa a tabela da Race; pontos de Sprint aparecem imediatamente no campeonato; quando a simulação passar a modelar voltas/SC/VSC, os inputs de elegibilidade já existem no contrato.

## D-049 — Progressão de WorldState explícita, determinística e sem relógio
- **Decisão:** `progressWorldState` (serviço + `POST /api/world/progress`) avança o WorldState com transições derivadas do lifecycle existente: `RACE_SELECTED` (sem `currentRaceId` e com temporada → primeira corrida não finalizada, sessão inicial), `SESSION_ADVANCED` (status → próxima sessão da sequência), `WEEKEND_FINALIZED` (RACE com classificação via `finalizeRaceInTx`; FINISHED legado limpa sessão). Sem transição → NO_CHANGE sem escrita; `currentDate` não é alterado (sem política de relógio confiável); concorrência pelo lock da timeline; auditoria via `WORLD_ADVANCED` reutilizado; Evolution/AI nunca disparam.
- **Consequência:** progressão é ação de domínio explícita (nada de cron/frontend), replay continua determinístico e o próximo Race permanece determinável pelo Next Race sem auto-avanço de ponteiro (política de produto reservada).

## D-050 — Persona como modelo próprio 1:1 com Character; slot `CHARACTER_DNA` reutilizado
- **Decisão (design V3.14):** a Persona é um modelo relacional próprio (`CharacterPersona` 1:1 com `Character`, `PersonaTrait`, `PersonaEvidence`), sem `universeId` redundante (o escopo vem do Character). O `Character.dna` legado permanece intocado e deprecado, usado apenas como fallback de leitura; o prompt reutiliza o slot existente `CHARACTER_DNA` para renderizar a Persona do speaker (sem nova seção, sem renumeração, `contextVersion` estável). Alternativas rejeitadas: colunas fixas, JSON como único storage, persona no `DriverProfile` e persona global compartilhada.
- **Consequência:** zero quebra de contrato de geração; `dna` pode ser removido numa limpeza futura após observação; confiança/evidência ganham representação de primeira classe sem duplicar `DriverAttribute`, `Memory` ou `Relationship`.

## D-051 — Traits estruturados com confiança por trait; evidência com workflow e fora do prompt
- **Decisão (design V3.14):** traits são linhas (`PersonaTrait`) com chave canônica de um registry em código, valor ≤200 chars e `confidence` 0..1 **por trait** (MANUAL default 1.0; EVIDENCE derivada das evidências APPROVED, maior confiança). Evidências são relacionais (`PersonaEvidence`) com workflow `PROPOSED → APPROVED | REJECTED`, campos estruturados (tipo, título, URL, data, trecho, confiança) e **nunca entram no prompt**; sem scraping e sem ingestão automática. Não existe confiança global da persona (derivável).
- **Consequência:** curadoria auditável de pilotos reais sem risco de prompt bloat/legal; o modelo só vê tendências textuais, nunca números de confiança nem trechos de fonte.

## D-052 — Provisionamento lazy, sem persona inventada; ownership por userId ou Universe
- **Decisão (design V3.14):** nenhuma persona é criada automaticamente (nem para pilotos materializados, nem no seed/`syncAiCatalog`). Criação é lazy no primeiro PATCH (`origin = ORIGINAL | REAL_DRIVER | AI_CHARACTER` definido na criação, REAL_DRIVER detectado por `ExternalBindingDriver`); `GET` sintetiza persona vazia sem escrever. Edição autorizada por `character.userId` (originais) ou `character.universeId` (materializados — que têm `userId null`); catálogo AI global é read-only até `switch-control` re-alojar o Character.
- **Consequência:** dois universos divergem naturalmente no mesmo piloto real; nenhum dado é inventado; sem backfill (o `dna` de produção é sempre `{}`); isolamento segue exatamente as regras existentes de Character/Driver.

## D-053 — Evolução de persona apenas por ação explícita via `persona.service`, com auditoria na Timeline
- **Decisão (design V3.14):** mudanças de persona no futuro passam exclusivamente pelo `persona.service` (único writer) e são auditadas por `TimelineEvent` `PERSONA_UPDATED` (state-neutral, payload mínimo), sem `PersonaSnapshot`, sem versionamento paralelo e sem escrita automática por Evolution engine ou AI Behavior. A Timeline histórica (V3.15) não reescreve persona diretamente: correções passam pelo serviço como ação de domínio.
- **Consequência:** um único sistema temporal permanece (Timeline); persona é estado corrente do Character, não estado temporal reconstruído; V3.14 e V3.15 ficam desacopladas.

## D-054 — `PersonaEvidence` é proposta humana de trait (`traitKey` + `proposedValue` obrigatórios)
- **Decisão (V3.14.1):** a evidência carrega `traitKey` obrigatório e `proposedValue` obrigatório (≤200 chars); nenhum trait é derivado de `excerpt`, de LLM ou de transformação automática — a aprovação materializa o valor explicitamente proposto por humano.
- **Consequência:** a transição `EVIDENCE → TRAIT` é sempre rastreável e nunca inventa valor; `excerpt` permanece contexto humano da fonte, nunca fonte de valor.

## D-055 — Evidência autoritativa com ordenação determinística
- **Decisão (V3.14.1):** `PersonaTrait.evidenceId` (opcional) aponta a evidência autoritativa quando `sourceKind = EVIDENCE`, com `ON DELETE SET NULL`. Autoridade entre evidências `APPROVED` do mesmo `traitKey`: `confidence DESC → publishedAt DESC (NULLS LAST) → createdAt DESC → id ASC`; ordem de aprovação não é critério. Múltiplas evidências `APPROVED` coexistem (a não autoritativa permanece como suporte).
- **Consequência:** o valor aplicado e sua linhagem são determinísticos e independentes da ordem de aprovação/concorrência; a perda da evidência autoritativa não invalida o trait (SetNull) e permite reconciliação futura no service.

## D-056 — Precedência `MANUAL > EVIDENCE`
- **Decisão (V3.14.1):** editar manualmente um trait `EVIDENCE` converte a linha para `MANUAL` (value manual, `sourceKind = MANUAL`, `confidence = 1.0`, `evidenceId = null`). Aprovar evidência enquanto existir trait `MANUAL` no mesmo `traitKey` não altera o trait; a evidência permanece `APPROVED`, sem sobrescrita silenciosa.
- **Consequência:** autoria humana sempre vence; evidências permanecem como suporte/auditoria e nunca reescrevem valor manual.

## D-057 — Auditoria de revisão e aprovação ADMIN-only no v1
- **Decisão (V3.14.1):** `PersonaEvidence` registra `reviewedById?`/`reviewedAt?` na revisão; aprovação/rejeição é ADMIN-only no v1 (o dono propõe, o ADMIN decide).
- **Consequência:** curadoria auditável com o papel ADMIN existente; nenhum privilégio novo é introduzido.

## D-058 — Sem `PERSONA_UPDATED` neste corte
- **Decisão (V3.14.1):** nenhum evento novo de Timeline para Persona nesta fase; a Timeline permanece sem kind de Persona até a fase de evolução da Persona.
- **Consequência:** a fundação persistente (D-050..D-057) permanece pura, sem sistema temporal de Persona; a auditoria temporal fica para a evolução futura via `persona.service` (D-053).
- **Superseded parcialmente por D-075 (V3.18):** `PERSONA_UPDATED` foi implementado como auditoria state-neutral (apply de evolução), preservando o enquadramento de D-060.

## D-059 — Resolução de rules: ausência sem invenção, conflito classificado, mesmo status inválido
- **Decisão (V3.14.2):** a resolução de confidence não inventa valor na ausência de evidência `APPROVED` (retorna `NONE`); o plano de reconcile remove trait `EVIDENCE` sem autoridade e nunca altera trait `MANUAL`. Conflito entre evidências `APPROVED` do mesmo `traitKey` não é erro: a autoritativa vem do comparator de D-055 e as demais são classificadas como suporte (mesmo `proposedValue`) ou conflitantes (valor diferente), sempre preservadas. Transição de status para o mesmo estado é explicitamente inválida (`SAME_STATUS`, distinta de `INVALID_TRANSITION`).
- **Consequência:** service/API/UI apenas consomem decisões determinísticas já resolvidas; nenhuma média/peso/LLM e nenhuma exceção para conflito; regras testáveis em memória, sem banco.

## D-060 — Renderização de Persona no prompt: tendência delimitada, sem confidence/evidence
- **Decisão (V3.14.7/9):** a Persona do speaker é renderizada no slot existente `CHARACTER_DNA` (sem nova seção), com preâmbulo fixo que a declara como tendência interpretativa (não fato, memória ou instrução); somente `summary` (cap 600) e traits ordenados pelas rules (cap 12, valor 200, bloco 2000) entram no prompt — nunca confidence numérica, URL, excerpt, status, `evidenceId`, `sourceType` ou `reviewedBy`. Apenas a Persona do speaker é carregada (1 query; nenhuma evidence) e o conteúdo permanece confinado ao bloco (prompt injection não cria seção nem altera regras do sistema).
- **Consequência:** OQ-1 e OQ-4 materializadas no renderer; qualquer evolução futura (ex.: `PERSONA_UPDATED`) deve preservar o enquadramento e a ausência de confidence/evidence no prompt.

## D-061 — Correção histórica é evento corretivo append-only com supersession e valores absolutos
- **Decisão (design V3.15):** uma única timeline canônica por Universe; correção é um novo `TimelineEvent` com `supersedesId` apontando o evento-alvo (mesmo universe/kind), mantendo o original imutável; não existe void nem branch. Campos corrigidos são **valores absolutos** (set-values), o que torna o replay idempotente e substituível por correção encadeada. O estado efetivo é sempre o replay sobre os derivados correntes.
- **Consequência:** nada de segundo sistema temporal/full event sourcing; auditoria completa (original + cadeia); corrigir de novo é o mecanismo de rollback semântico. Aplica-se somente ao Universe — o External Mirror permanece intocado.

## D-062 — Escopo suportado de correções v1: causa factual, nunca campo derivado
- **Decisão (design V3.15):** SUPPORTED = `RaceResult` (`position`/`status`/`grid`), Sprint via novo kind `RACE_SESSION_RESULT_CORRECTED` (`position`/`status`/elegibilidade), número (`setDriverNumber` com lock/regra do #1/`NUMBER_CORRECTED`) e calendário (`RACE_UPDATED`). DERIVED = `points`, `ChampionshipStanding`, campeão — nunca editáveis quando há resultados (exceção única: standing `IMPORTED` de temporada sem RaceResult). `DriverProfile.number` é cache; entries de temporada usam o fluxo de roster (não timeline); News/Memory/Relationship/DriverAttribute/TeamPerformance/Persona ficam fora.
- **Consequência:** a menor alteração factual (posição/status) produz todas as consequências; o payload rejeita campos derivados (`DERIVED_FIELD`/`DERIVED_STANDING`).

## D-063 — Preview por transação com rollback + token anti-obsolescência no apply
- **Decisão (design V3.15):** preview executa o mesmo motor do apply dentro de `prisma.$transaction` que sempre lança antes do commit (nada persistido: timeline, world, standings, numbers, News, Memory, Persona, Evolution), retornando diff ANTES/DEPOIS/IMPACTO + `previewToken = sha256(universeId, lastSequence, worldState canônico, hash(standings), payloadCanônico)`. O apply adquire `timeline:<universeId>`, revalida o token e rejeita preview obsoleto com 409 `PREVIEW_STALE`. Checkpoint pré-correção obrigatório antes do append.
- **Consequência:** preview e apply nunca divergem de lógica; apply é atômico (sem estado híbrido); preview antigo nunca é aplicado cegamente.

## D-064 — Sem cascata automática: correção recalcula standings; números/#1 são ação explícita
- **Decisão (design V3.15):** aplicar uma correção de resultado recalcula apenas standings (e, por derivação, o campeão hipotético). `SeasonDriverEntry.number`/`DriverProfile.number` **não** são reescritos automaticamente; o preview mostra o impacto no `#1` e a UI oferece ação explícita “Reatribuir #1” que chama `setDriverNumber` (regra do campeão derivado + lock + evento). Override manual prevalece.
- **Consequência:** história corrigida não reescreve silenciosamente números já atribuídos; o usuário decide a cascata; cache nunca vira fonte.

## D-065 — Correção nunca escreve News/Event/Memory/Relationship/Persona/Evolution
- **Decisão (design V3.15):** correções não apagam, editam ou regeneram narrativa (Event/News) nem Memory/Relationship; não tocam Persona (D-053/D-060) nem `DriverAttribute`/`TeamPerformance`. Staleness narrativa é sinalizada na UI; temporada corrigida com `ATTRIBUTE_EVOLVED` e fingerprint divergente bloqueia novo apply de evolução com 409 `EVOLUTION_STALE` até existir recompute/baseline (OQ-4).
- **Consequência:** nenhuma destruição arbitrária de narrativa ou dupla contagem de evolução; regeneração narrativa e baseline de atributos ficam para fases futuras com regra explícita.
- **Superseded parcialmente por D-074 (V3.18):** correções agora **invalidam** (sem deletar) experiences e memories derivadas na própria transação; narrativa/Event/News continua intocada.

## D-066 — Campeão do Universe: derivado de standings; edição é par atômico de `STANDING_CORRECTED`
- **Decisão (extensão Campeões):** o campeão do Universe continua derivado de `ChampionshipStanding.position === 1` (sem entidade nova). Temporadas com RaceResult permanecem `DERIVED` e a edição direta é bloqueada (409 `DERIVED_STANDING`; a causa esportiva é corrigida pela Timeline). Em temporadas sem resultados (importadas), editar o campeão é um **par atômico** de `STANDING_CORRECTED` — rebaixa o atual P1 para P2 e promove o novo para P1 — dentro de uma única transação, um único `previewToken` e um único apply; "Restaurar da fonte" é a mesma operação com alvo resolvido pelo binding do campeão externo (nunca DELETE; histórico preservado). O read model expõe estados `MATCH/DIVERGENT/UNIVERSE_ONLY/EXTERNAL_ONLY/NONE`; o External Mirror nunca é alterado.
- **Consequência:** nenhum override inconsistente entre standings e campeão, nenhuma tabela paralela de "custom champions", histórico append-only mesmo no restore e isolamento total entre Universes.

## D-067 — External Driver Knowledge é camada separada keyed por identidade externa; Universe sempre vence
- **Decisão (V3.17):** o conhecimento externo de piloto vive em tabelas próprias (`ExternalDriverProfile`, `ExternalDriverPersona`, `ExternalPersonaTrait/Evidence`, `ExternalDriverRelationship`, `ExternalDriverEvent`, `ExternalKnowledgeSource`) ancoradas em `ExternalDriver` (via binding Universe→Character existente) e **nunca** escreve Universe. Overrides Universe-scoped reutilizam o que já existe — `Character.biography` (biografia efetiva = override ?? externo) e `CharacterPersona` (persona efetiva = merge por traitKey com CharacterPersona vencendo) — e relacionamentos ganham `UniverseDriverRelationship` (alvo pode ser Character ou pessoa pública, sem criar Character). Refresh externo nunca altera `CharacterPersona`, `Relationship`, `Memory`, Timeline, WorldState ou estado esportivo (D-063/D-065 preservados).
- **Consequência:** `External Knowledge != Universe Truth` verificável por construção; isolamento A/B garantido; nenhuma migração do DEV.

## D-068 — Persona externa é perfil público observável; conflito permanece conflito
- **Decisão (V3.17):** traits externos registram `sourceKind` (`DIRECT_SELF_DESCRIPTION|OBSERVED_PUBLIC_BEHAVIOR|INFERRED`) e `status` (`SUPPORTED|UNCERTAIN|CONFLICT|UNKNOWN`); `INFERRED` exige ≥2 evidências independentes; nunca se inferem doença/estado mental/diagnóstico/fitness/motivos privados nem se transformam observações públicas em diagnóstico. LLM atua apenas como extrator/classificador com grounding obrigatório; evidence raw (excerpt/URL/confidence) nunca entra no prompt; resolução por autoridade (`PRIMARY_OFFICIAL > STRUCTURED_LICENSED > REPUTABLE_SECONDARY > OTHER_SECONDARY`) e temporalidade; conflito material do mesmo período não é escolhido silenciosamente. Promoção para `CharacterPersona` só via `PersonaEvidence` + review ADMIN (V3.14), nunca automática.
- **Consequência:** chat factual; ausência de dado permanece ausência; "Não tenho informação pública confiável sobre isso" suportado.

## D-069 — PilotContextResolver é a única fonte speaker-only de contexto do piloto na geração
- **Decisão (V3.17):** `resolvePilotContext(universeId, speakerCharacterId, topic)` agrega identidade, biografia, persona efetiva, relacionamentos, histórico, memórias e estado atual em queries agrupadas (sem N+1), com precedência Universe→External determinística, caps nomeados (biografia 600, traits 12, relacionamentos 8, eventos 8, memórias 6, bloco 2000) e omissões registradas. A geração consome apenas o speaker via nova seção opcional `PILOT_CONTEXT` (após `CHARACTER_DNA`); `generationKey` continua derivado do `systemPrompt` (mudança de perfil/persona/relacionamento/evento/memória/estado invalida automaticamente); NUNCA entram confidence, source metadata, evidence raw ou IDs internos. Falha/ausência de conhecimento → seção omitida, geração intacta (SSE/NullProvider/CURRENT_TURN/RAG preservados).
- **Consequência:** nada de "personalidade gigante em JSON/texto único"; contexto limitado e determinístico; terceiros nunca entram.

## D-070 — Source ledger com licença por claim; sem crawler e sem persistir conteúdo protegido
- **Decisão (V3.17):** toda informação derivada aponta para `ExternalKnowledgeSource` com provider, sourceKind, license, attributionRequirement/Text, url/título/publishedAt/retrievedAt/sourceVersion — permitindo auditoria de licença por claim. F1DB = CC BY 4.0 (attribution), Wikidata = CC0, Wikimedia = CC BY-SA 4.0, primary commercial = PROPRIETARY_REFERENCE_ONLY. Proibido crawler indiscriminado, persistência de páginas/artigos/transcrições ou cópia de grandes blocos; permitido apenas `fetch → extract → discard raw` explícito com persistência de claims/summaries originais + provenance. External Knowledge ≠ RAG (`ExternalSource/Document/Chunk` não são reutilizados).
- **Consequência:** licenciamento auditável para uso comercial futuro; nenhuma contaminação RAG.

## D-071 — Marcos históricos derivados de dados estruturados; Memory continua Universe-only
- **Decisão (V3.17):** `ExternalDriverEvent` é baseline histórica resumida (debut, first point/podium/pole/win, campeonatos, mudança de equipe, marcos) e é derivado deterministicamente do espelho esportivo quando possível (`derivation`), com `dedupeKey` único por piloto; nunca duplica `RaceResult`. LLM não "descobre" fato esportivo que o banco já contém. Memória permanece exclusiva do Universe (V3.14): nenhum histórico externo vira Memory e nenhuma frase "eu me lembro" é gerada sem Memory correspondente. Relevância selecionada deterministicamente por tópico (corrida/temporada/ano/piloto/time mencionado) com fallback para milestones recentes/importantes.
- **Consequência:** histórico na UI é milestone, não log de resultados; separação Memory × Historical Event preservada.

## D-072 — Experience é projeção determinística do Universe; Memory é estendida (não substituída)
- **Decisão (V3.18):** `PilotExperience` é uma projeção source-keyed e idempotente de fatos do Universe (`RACE_RESULT|STANDING|TIMELINE_CORRECTION|UNIVERSE_EVENT|RELATIONSHIP|CURATED`), com resumo estruturado (tipo + chaves + salience + resumo), nunca texto livre como única representação; `Memory` ganha colunas aditivas (`universeId`, `memoryType`, `derivation`, `status`, `revision`, `experienceId`, `timelineEventId`, `derivedKey`) reutilizando `importance` como salience. Nenhum segundo sistema temporal/narrativo; nada disso escreve External Knowledge.
- **Consequência:** mesma fonte ⇒ mesmas experiences/memories (reconciliação idempotente); correção invalida e a reconciliação cria replacement com revision; histórico nunca é deletado.

## D-073 — Memory projection com gatilhos explícitos; derivada é imutável
- **Decisão (V3.18):** só experiências com gatilho explícito geram Memory (título, primeira vitória no Universe, team change, relationship start/end, narrativa CRITICAL/HIGH, perda de título, conflito, marcos de carreira); resultado comum continua Historical Event. Derivation ∈ `MANUAL|DERIVED|RULE_DERIVED`; derivada não é editável (409 `DERIVED_MEMORY_IMMUTABLE`; override = nova manual ou correção da fonte) e arquivamento manual é `ARCHIVED`. Texto é renderização do structured, sem copiar fontes e sem afirmar emoção.
- **Consequência:** "não criar Memory para cada RaceResult" verificável; proveniência (experienceId/timelineEventId/derivation) preservada sempre.

## D-074 — Correção histórica invalida experiences/memories na própria transação
- **Decisão (V3.18):** `applyCorrection` (V3.15/V3.16) passa a invalidar, sob o mesmo lock e sem LLM: race corrections → experiences ACTIVE com `raceId` ou `seasonId` afetados; standing corrections → `seasonId`; number/calendar → sem efeito. Memories derivadas das experiences invalidadas → `INVALIDATED`. Nada é deletado; replacement determinístico surge na `reconcile` explícita. Regeneração narrativa continua fora (D-065).
- **Consequência:** chat deixa de tratar memória invalidada como fato atual (resolver filtra ACTIVE); auditoria completa da existência histórica daquelas memórias.

## D-075 — Persona evolution = baseline + efeitos append-only com fingerprint único
- **Decisão (V3.18):** evolução de Persona registra `PersonaTraitEvolution` append-only (regra, experiência-fonte, delta, reason, fingerprint `@unique` sha256(universe|character|rule|experience)); efetivo = `clamp(base + Σ deltas ativos, 0, 1)` — nunca mutação cumulativa do valor; MANUAL vence (efeito vira `skipped-manual`); `CharacterPersona.evolutionRevision` versiona; preview→apply exige `expectedRevision`+`expectedPendingFingerprint` (409 `EVOLUTION_STALE`); apply grava `TimelineEvent PERSONA_UPDATED` state-neutral com before/after. Regras v1 limitadas a 5 códigos e traits canônicos V3.14, sem saúde/psicologia.
- **Consequência:** reaplicar é no-op (double-count impossível), explainability por efeito, auditoria na Timeline sem replay de estado.
- **Atualização V3.19 (E-1):** efeitos cujas experiências-fonte forem invalidadas ganham `status SUPERSEDED` (migration `add_evolution_effect_status`) e deixam de somar; o preview expõe `revertedEffects` e o apply persiste a revogação (revision+1, `PERSONA_UPDATED` com `reverted`). Baseline+Σ volta a 0.6 quando o único efeito é revogado — sem mutação cumulativa.

## D-076 — Resolver seleciona memories ACTIVE de forma determinística; generationKey herda
- **Decisão (V3.18):** `PilotContextResolver` lê Memory com `status=ACTIVE` do universe do speaker, ranqueia por tópico→salience→recência→recorrência→career-defining→id (cap existente) e inclui `{id, revision, memoryType}` + `evolutionRevision` no fingerprint; `context.assembly` filtra memórias ACTIVE; `generationKey` continua derivado do `systemPrompt` (mudança relevante invalida automaticamente). Seleção é backend; LLM recebe só o subset final; AI Behavior permanece inalterado.
- **Consequência:** outras personagens/outros Universes nunca entram; prompt sem confidence/IDs/status; cache/fingerprint auditáveis.

## D-077 — Event: leitura global preservada, mutação restrita ao criador/participantes/ADMIN
- **Decisão (V3.19, auditoria):** `Event` continua global para leitura (feed/narrativa), mas PATCH/DELETE passam a exigir que o usuário seja o **criador** (`Event.createdById`, coluna aditiva), dono de ≥1 participante (character próprio ou do seu universe) ou ADMIN; caso contrário 404 leak-safe. O DELETE deixa de destruir memórias/notícias de outros tenants por id cru. A criação via `POST /api/events` grava `createdById`; eventos gerados por serviços internos (AI/narrativa) ficam com `createdById = null` e só podem ser mutados por dono de participante ou ADMIN.
- **Contexto:** o contrato anterior (qualquer usuário autenticado podia editar/excluir qualquer Event global) foi corrigido por segurança multi-tenant; a leitura global permanece como projetada (docs pré-V3). Nota histórica em `docs/v3.19-audit-report.md` (H-1).

## D-078 — Nacionalidade pt-BR é regra global com mapas espelhados API/Web (sem import cross-app)
- **Decisão (V3.21):** demonimos/ISO/países são resolvidos para pt-BR por `resolveNationalityPtBr` (API) e `localizeNationalityPtBr` (Web); a API localiza a view do piloto (mantendo o valor cru em `externalIdentity`) e o Web localiza driver-card/página/painel. Os mapas são espelhados por app (bundles separados, sem pacote compartilhado com build) e ambos têm testes canônicos das mesmas entradas; formas já em pt-BR e valores desconhecidos passam intactos. Nenhum componente traduz nacionalidade ad-hoc.
- **Consequência:** nenhuma nacionalidade crua de provider é exibida ao usuário; a flexão (`feminizeNationalityPtBr`) existe para prosa (`nacionalidade tailandesa`).

## D-079 — Biografia do espelho é auto-atualizável; bio de provider externo nunca é sobrescrita
- **Decisão (V3.21):** na reabertura do piloto, o provisionamento lazy recompõe e atualiza perfis cuja biografia pertence ao espelho (`biographySourceId` nulo ou provider `CURATED`), reusando a mesma source do ledger (sem duplicar). Se a biografia foi escrita por provider externo (F1DB/Wikidata), apenas os marcos são re-derivados e a bio é preservada. Edição do usuário vive em `Character.biography` (override Universe-scoped, rotas owner-only `PATCH/DELETE .../biography`), com precedência sobre a fonte e restauração que volta à bio do espelho/provider.
- **Consequência:** perfis antigos se corrigem sozinhos quando o código evolui; nenhuma perda de bio curada por provider; override e fonte sempre distinguíveis por `origin` (`UNIVERSE|EXTERNAL|NONE`).

## D-080 — Biografia usa "registros na F1 desde {ano}" enquanto o espelho for parcial
- **Decisão (V3.21):** a frase de carreira deriva da primeira temporada presente no espelho; com espelho parcial (DEV só tem 2026) dizer "estreou em 2026" seria afirmação histórica falsa. A redação canônica é "Tem registros na Fórmula 1 desde {ano}" e o contexto usa "registros na F1 desde {ano}"; os milestores mantêm o enquadramento "Primeira corrida registrada". Nenhum ano é inferido de fonte externa ao espelho.
- **Consequência:** biografia nunca afirma debut/título que os dados não sustentam; quando o espelho tiver histórico completo a mesma frase continua verdadeira.

## D-081 — Fallback canônico FIA para campeões 2000-2025 com conflito explícito e baseline read-only
- **Decisão (V3.22):** a tela de Campeões nunca depende exclusivamente de `ExternalStanding` histórico. A resolução usa standing P1 quando existe (identidade + vínculo para MATCH/RESTORE) e cai para `FIA_CANONICAL_CHAMPIONS_2000_2025` (fonte factual, sem prosa) quando não existe. Se ambos existem e divergem, o conflito é exposto (`sourceConflict` + `canonicalChampion`), nunca escolhido em silêncio. Para Universe sem temporada, a linha é uma projeção `baseline` (state MATCH, sem criar Season/Race/Result nem habilitar edição; `blockedReason = SEASON_NOT_IN_UNIVERSE`).
- **Consequência:** 26 campeões sempre visíveis e corretos; nenhum campeão fabricado; divergência e restore continuam exigindo temporada materializada + correção `STANDING_CORRECTED`.

## D-082 — Avatar: CORP liberado apenas na rota de mídia e cookie cache de sessão limpo em mutações
- **Decisão (V3.22):** o helmet global deixa de impor `Cross-Origin-Resource-Policy: same-origin` (a quebrava `<img>` cross-origin de `:3001` para a página em `:3000`, mesmo com 200) e apenas `/api/media/:id` responde `cross-origin` — rota autenticada e restrita ao dono. `POST/DELETE /api/profile/avatar` limpam `f1nw.session_data` (Max-Age=0) para o `get-session` do browser reler `User.image` sem esperar o cache de 5 min.
- **Consequência:** avatar persiste e renderiza após reload/sessão; nenhuma credencial ou arquivo privado é exposto (ownership 404 leak-safe mantido). Risco residual de deploy cross-site (SameSite=Lax) documentado.

## D-083 — Mídia de circuito por resolver abstêmio
- **Decisão (V3.22):** `resolveCircuitMedia` só devolve layout/foto quando existir referência com licença identificada em `sourceRecord` (ex.: `layoutUrl`/`photo*` de provider licenciado). Sem isso, a UI informa indisponibilidade. Proibido inventar URL, usar imagem sem licença, scraping de buscadores ou copiar fotografia comercial.
- **Consequência:** catálogo permanece correto e licenciável; F1DB (layouts) e Wikimedia Commons (fotos) plugam no resolver quando configurados, sem mudar contrato.

## D-084 — Volta mais rápida: milestone de primeira ocorrência e tempo da corrida (recorde oficial separado)
- **Decisão (V3.22):** `FIRST_FASTEST_LAP` é derivado do primeiro resultado com `fastestLap = true` (ordenado por temporada/round) e o tempo (`FastestLap.Time.time`) é persistido em `ExternalResult.fastestLapTime` (migration aditiva). O detalhe do circuito mostra "volta mais rápida em corrida (fonte)"; o recorde oficial homologado de circuito só é exibido quando uma fonte explícita o fornecer — hoje `officialLapRecord.available = false` com razão.
- **Consequência:** nada confunde volta rápida de sessão/corrida com recorde oficial; prune de marcos obsoletos continua valendo para a nova categoria.

## D-085 — Override histórico de campeão como TimelineEvent + projeção, sem materializar Season
- **Decisão (V3.23):** permitir que o jogador sobrescreva o campeão de 2000–2025 mesmo sem `Season` materializada via `HISTORICAL_CHAMPION_OVERRIDE_SET/CLEARED` (TimelineEvent) e projeção `HistoricalChampionOverride` (unique `universeId+year`). O evento carrega driverProfileId do Universe; supersession de SET por SET mantém a cadeia; RESTORE emite CLEARED. `WorldSnapshot` inclui os overrides; a fonte externa nunca é escrita; nenhuma corrida/resultado é fabricado. Edição por standings (`STANDING_CORRECTED`) continua para temporadas materializadas.
- **Consequência:** baseline (fonte = Universe) e divergência (Alicya vs Verstappen) convivem na mesma tela, com restore e auditoria na Linha do Tempo.

## D-086 — F1DB vendorizado como snapshot gerado, com layouts SVG sanitizados e atribuição
- **Decisão (V3.23):** o subset do release oficial F1DB `v2026.15.1` (CC BY 4.0) é versionado em `data/external/f1db/` com `PROVENANCE.json` (asset sha256, retrievedAt) e checksums; os SVGs do `f1-circuits-svg` (CC BY 4.0, ROY Jules) em `data/external/f1-circuits-svg/`. O provider local resolve por `F1DB_DATA_DIR`/caminho do repo; o endpoint de layout serve o SVG do layout vigente sanitizado (sem script/foreignObject/on*/javascript:) com headers de atribuição. Proibido buscar imagem em runtime sem licença identificada.
- **Consequência:** catálogo de circuitos funciona offline com dados e traçados reais, reprodutível e licenciado.

## D-087 — F1DB como autoridade histórica de marcos; espelho permanece para o presente
- **Decisão (V3.23):** quando o piloto resolve no F1DB (nome/abbreviation), os marcos de primeira ocorrência (`F1_DEBUT`, `FIRST_POINT/PODIUM/POLE/WIN/FASTEST_LAP`, títulos) usam o histórico completo do dataset; o espelho vence o merge como fallback e F1DB só substitui quando o ano é estritamente anterior. Perfil (DOB/local/código) e estatísticas de carreira também caem para o F1DB quando o `sourceRecord` não tem. Eventos F1DB carregam `sourceId` do ledger (F1DB/STRUCTURED_RELEASE/CC BY 4.0). O espelho (Jolpica) continua a fonte do tempo presente (resultados/standings/calendário).
- **Consequência:** “primeira vitória em 2026” deixa de aparecer para pilotos com histórico; nada é inventado e a provenance é auditável.

## D-088 — Composer de biografia claims-only com LLM opcional e preservação de bio gerada
- **Decisão (V3.23):** `BiographyComposer` recebe apenas claims estruturados (nunca texto de fonte), prompt canônico proíbe invenção/diagnóstico/cópia, saída é sanitizada (sem HTML/URLs, cap 2400) e persistida com source ledger `CURATED`/`BIOGRAPHY_PAGE` + metadata do gerador. LLM é opcional (usa `GenerationProvider` existente); sem LLM ou em falha, cai no compositor determinístico. Biografia gerada é tratada como “provider-owned”: preservada na reabertura (sem re-chamada de LLM).
- **Consequência:** biografia rica quando houver LLM, factual sempre; nenhum conteúdo LLM vira fato canônico sem ledger e fingerprint de claims.

## D-089 — Biografia só compõe claims aprovados; identidade ambígua bloqueia LLM
- **Decisão (V3.24):** o pipeline é SOURCE → FACT → NORMALIZED FACT → APPROVED CLAIM SET → PLANNER → COMPOSER → VALIDATION → PERSISTENCE. Cada claim tem id estável, chave tipada, autoridade (`STRUCTURED_CANONICAL`/`SECONDARY`) e provenance (provider/sourceVersion); `UNVERIFIED` nunca entra e `AMBIGUOUS_IDENTITY` (mais de um candidato F1DB para o mesmo piloto) desliga o LLM e usa somente o fallback determinístico. Títulos do espelho só viram claim quando o F1DB registra campeão final do ano (líder de temporada em andamento não é campeão).
- **Consequência:** o composer nunca recebe o “universo” de dados; recebe um conjunto fechado, deduplicado e cronológico; datas/equipes/anos só existem se derivados de claim.

## D-090 — Composer v2 com Structured Output estrito, validator determinístico e fallback obrigatório
- **Decisão (V3.24):** o LLM devolve JSON estrito (`language`, `sentences[{text, claimIds}]`, ids existentes, 2–12 frases) e passa por `BiographyQualityValidator` genérico (idioma, HTML/markdown/URL/placeholder, duplicação, palavras concatenadas, idioma misturado, substantivo próprio/ano sem claim, tokens longos desconhecidos) e por `BiographySemanticVerifier` opcional (`{approved, issues, unsupportedStatements, claimMismatches}`). Qualquer falha (provider, parse, quality, verifier reprovando) → fallback determinístico com motivo observável; nunca se persiste texto corrompido. Bio gerada é regenerada quando `generatorVersion` muda ou o texto armazenado falha no validator (self-healing); bio de provider externo é preservada.
- **Consequência:** o bug real do DEV (talentoexceptional/mix de idiomas/invenções) não pode mais ser persistido; o smoke com Ollama real resultou em fallback limpo, não em degradação.

## D-091 — Next Race resolve o layout no F1DB por identidade de circuito
- **Decisão (V3.24):** o Next Race enriquece o `Circuit` do Universe via F1DB (nome → id, alias Ergast→F1DB) expondo `layoutUrl` real (`/api/external/circuits/f1db/:circuitKey/layout.svg`), extensão/curvas/tipo/direção e `lengthSource` (UNIVERSE→F1DB). O nome do Grand Prix continua vindo da materialização/espelho — Circuit ≠ GrandPrix ≠ Race preservado.
- **Consequência:** banner do próximo GP mostra o traçado real licenciado com atribuição, sem hardcode nem placeholder.

## D-092 — Foto de circuito via Wikimedia Commons é opt-in com allowlist de licenças
- **Decisão (V3.24):** `circuit-photo.provider.ts` consulta a API do Commons com `fetch` injetável, aceita somente CC0/CC BY/CC BY-SA (rejeita NC/ND/all rights reserved), registra author/license/licenseUrl/attribution/retrievedAt, cacheia por circuito, tem timeout e degrada para null. Fica **desabilitado por padrão** (`WIKIMEDIA_COMMONS_ENABLED=false`) e é exercitado apenas com mock nos testes; nenhuma imagem é persistida sem metadata. Recorde oficial de volta permanece separado de volta mais rápida em corrida e só ganha o rótulo “oficial” com fonte que o sustente.
- **Consequência:** foto licenciada entra quando habilitada, sem scraping e sem placeholders mentirosos; a ausência continua sendo exibida honestamente.

## D-093 — Evidence biográfica curada como fatos estruturados com sourceRef, nunca texto pronto
- **Decisão (V3.24.1):** `data/external/biography/curated-evidence.json` guarda apenas claims (`category`, `key`, `value`, `display`, ano/período, `authority`, `sourceRef`) com URLs reais de fontes oficiais/secundárias. Nenhum parágrafo de biografia é armazenado; o composer/fallback continua responsável pela narrativa. O ledger permanece `ExternalKnowledgeSource` (registrado na persistência) e `evidenceVersion` (hash do arquivo + release F1DB) entra no fingerprint e no metadata.
- **Consequência:** riqueza editorial sem cópia de prosa e sem segundo mecanismo de provenance; atualizar a curadoria regenera biografias automaticamente.

## D-094 — Coverage validator e rich mode por áreas relevantes
- **Decisão (V3.24.1):** `evaluateBiographyCoverage` conta claims aprovados por categoria; rich mode exige ≥5 áreas relevantes (IDENTITY e CURRENT_CONTEXT não contam). O `planner` distribui os claims em até 8 blocos editoriais sem repetição; áreas sem evidência são omitidas. Sparse continua suportado e nunca é forçado a parecer rico.
- **Consequência:** a profundidade da biografia é decidida pela evidência, nunca por meta de parágrafos; o relatório de cobertura do catálogo expõe lacunas reais.

## D-095 — Composer v3 por parágrafos com fallback rico determinístico
- **Decisão (V3.24.1):** o contrato do LLM passa a `paragraphs[].sentences[].{text,claimIds}` (1–8 parágrafos), com prompt narrativo (contextualizar kart→F1, hobbies/projetos naturais, atribuição de personalidade). Quando o coverage é rich e o LLM falha/está ausente, o fallback determinístico também produz narrativa multi-parágrafo com templates por categoria (nomes preservados, capitalização correta, sem HTML/markdown/URLs). Quality validator ganha checagem de parágrafos, `too-few-paragraphs` para rich raso e anos citados nos displays como permitidos. Claims derivados duplicados por `key` (e `TEAM_SEASON` quando há `TEAM_HISTORY` curado) são substituídos pela versão curada.
- **Consequência:** o produto entrega biografia rica mesmo sem LLM (Ollama local não satisfaz o contrato estrito), e nenhuma garantia factual da V3.24 foi relaxada.






