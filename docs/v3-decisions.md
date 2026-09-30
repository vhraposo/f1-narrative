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

## D-045 — Pontuação de Sprint: regulamento FIA vigente (implementação pendente)
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
