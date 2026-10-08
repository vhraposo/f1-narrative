# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `3e0ad46` — `feat(availability): derive effective presence windows in runtime consumers`
  (F12); docs/HANDOFF deste ciclo neste commit.
- Working tree: limpo (após commit deste HANDOFF)
- **F9 concluída (Benchmark Gate)**; **F10 concluída (análise)**; **F11 concluída (unificação do
  AI Behavior)**; **F12 concluída (presença/availability efetiva no runtime)**; **F13 concluída
  como análise (streaming: sem implementação por falta de benefício real)**; **F14 concluída
  (CREATE_EVENT: writer único já existia; correção pequena de atomicidade)**; **F15 concluída
  como análise (SEND_MESSAGE: separação transacional intencional; sem correção necessária)**;
  **F16 concluída como análise (RACE_WEEKEND: intenção do dono; fase de weekend já derivada em
  outro domínio; sem correção necessária)**;   **F17 concluída (consolidação da regra de abertura
  de availability; sem mudança de comportamento)**;   **F18 concluída (drift schema↔migrations
  alinhado; unique `Season(universeId, year)` aplicada no TEST)**;   **F19 concluída como análise
  (presença em tempo real: single-player, sem consumidor; não implementar)**;   **F20 concluída
  (performance da lista de mensagens: memoização; paginação/virtualização deferidas)**; **F21
  concluída (secret: sem caminho de vazamento; `.gitignore` endurecido para `.env.*`)**.
- Caminho real da UI validado: Conversations usa `createMessage` + `simulate-turn/plan` +
  `simulate-turn`; o `SEND_MESSAGE` do AI Behavior usa `simulateConversationTurn` com seed; o
  segundo writer (`assembleGenerationBundle`/`persistGeneratedMessage`) foi removido do AI
  Behavior.
- Presença (F12): `CharacterAvailability` é a intenção persistida (status + janela `until`); o
  estado efetivo é derivado pelo helper `availability.policy.ts` no relógio do engine (worldDate/
  última mensagem/`WorldState.currentDate`/`schedule.startsAt`). Sem segundo estado/migration.
- Próximo passo: escolher item do backlog abaixo (nenhum P0/P1 aberto de escrita paralela,
  estado obsoleto ou transporte pendente).

## F10 — conclusão (detalhes em docs/post-v4-dialogue-engine-f10.md)
- Análise sem alteração de código (Caso 1/3): a experiência de Conversas já usa o engine
  F3–F7 protegido pelo F9; streaming legado NÃO deve ser religado agora (exigiria refactor).
- Achado P1: `ai-behavior.service.executeSendMessage` (painel de personagem) usa um segundo
  writer (`assembleGenerationBundle` + `persistGeneratedMessage`), ignorando planner/realizer/
  validator/Command Layer; default `nullProvider` torna o caminho inerte (409), mas um provider
  configurado o ativa. Contexto é filtrado por audiência (F7.2), sem P0 de vazamento.
- P0: nenhum. P2: streaming não integrado (intencional); painel SEND_MESSAGE sem provider.
- Benchmark F9 reexecutado após a análise: `F9 BENCHMARK GATE: PASS` (12/12; contadores 0).

## F11 — conclusão (detalhes em docs/post-v4-dialogue-engine-f11.md)
- `ai-behavior.service.executeSendMessage` passou a chamar `simulateConversationTurn` com
  `OpportunityEnvelopeSeed` (`fingerprint: decision.id`, `targetCharacterId: null`,
  `maxDepth: 1`); `Message` nasce apenas no Command Layer, com texto determinístico do realizer.
- `provider` removido do módulo AI Behavior (`ai-behavior.service.ts`, `ai-behavior.routes.ts`,
  `app.ts`); sem LLM no caminho (`metadata.llmUsed === false`).
- Rejeições: ACL/target → `TARGET_NOT_FOUND`; engine/domain gate → `EXECUTION_REJECTED` (409);
  WorldState ausente → `PRECONDITION_FAILED` sanitizado (200 com decision REJECTED/FAILED).
- Testes do ai-behavior adaptados (13/13) sem remover cobertura; provam ausência de marcadores do
  writer legado (`contextJson.family`/`generationKey`) e presença de `language.provider =
  "dialogue-realizer"` + `behavior.reasonCode`.
- Fixtures do ai-behavior passaram a criar `WorldState { key: "default", currentDate }` (pré-
  condição do engine). O engine cria `AiDecision` oficial `CONVERSATION_TURN_DUE`; testes que
  contavam decisões EXECUTED filtraram `contextVersion: "ai-behavior.v1"`.
- Fora do escopo: `CREATE_EVENT` do ai-behavior (Event, não Message), rotas legadas `/turn`,
  `/turn/stream`, `/generate`, streaming.

## F12 — conclusão (detalhes em docs/post-v4-dialogue-engine-f12.md)
- Achado: `until` era persistido/validado/exibido, mas nenhum consumidor o avaliava; a regra de
  disponibilidade estava duplicada em 4 pontos; `PATCH` não iniciava nova janela ao trocar status.
- Implementado (Opção A): `availability.policy.ts` com estado efetivo derivado
  (`resolveEffectiveAvailability`/`isAvailabilityOpen`), aplicado em `conversation.simulation`,
  `conversation.autonomous` (worldDate resolvido antes do planner), `conversation.turn-engine`,
  `behavior.context` (domain gate/scoring) e `world-simulation.tick` (`schedule.startsAt`).
- PATCH de availability: trocar status inicia nova janela (`since = agora`, `until = null` se
  omitido); reason-only preserva status/until. Sem migration; DEV intocado.
- Testes: +7 unitários do helper, +2 no PATCH, +1 no domain gate, +1 no planner, +1 no
  world-simulation; F11 (ai-behavior 13/13) e benchmark F9 PASS intactos.
- Fora do escopo: presença em tempo real (sessão/websocket), availability visível para terceiros,
  derivação de RACE_WEEKEND via WorldState/Eventos.

## F13 — conclusão (detalhes em docs/post-v4-dialogue-engine-f13.md)
- `F13 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED`: nenhum arquivo de código alterado.
- Motivo: o realizer determinístico produz a utterance completa em memória e
  `simulateConversationTurn` só retorna após validar/persistir todos os steps; streamar texto
  exigiria sleeps artificiais (proibidos) ou seria replay do que a mutation já devolve. Sem
  benefício real de UX; complexidade (SSE + event sink + testes + cliente) desproporcional.
- `/turn`, `/turn/stream` e `/generate` permanecem legado dormente (provider LLM +
  `persistGeneratedMessage`); NÃO religar. UI não usa streaming (grep app/components vazio;
  teste do composer afirma ausência de `/turn`/`/turn/stream`).
- Design futuro seguro documentado: SSE consumindo o MESMO `simulateConversationTurn`, eventos
  somente após validator + Command Layer; transporte sem autoridade de escrita; ACL/cooldown/
  fingerprint reutilizados; desconexão sem estado parcial/rollback.
- Benchmark F9 reexecutado: PASS (12/12); último checkpoint verde de código é o da F12.

## F14 — conclusão (detalhes em docs/post-v4-dialogue-engine-f14.md)
- Inventário: **writer único de Event** = `createEventWithDerivations`
  (`events/event-create.ts`: Event + EventCharacter + News + EventEvolution), usado pela rota HTTP,
  world-simulation, Command Layer oficial (`behavior.commands.ts`) e AI Behavior. Não há segundo
  writer; o problema do F11 não existe para Event.
- AI Behavior é um command path legado próprio (decisão `ai-behavior.v1`), mas usa o mesmo domain
  service; não foi unificado ao `behavior.commands.ts` porque isso mudaria a semântica do Event
  (título/conteúdo). `CREATE_EVENT` NÃO foi roteado para o Dialogue Engine.
- Correção aplicada (Opção A): `executeCreateEvent` agora cria Event + marca `AiDecision`
  EXECUTED/`executedEventId` na MESMA transação (antes eram duas), eliminando Event sem decisão
  EXECUTED e duplicata em retry. Teste de concorrência de CREATE_EVENT + asserções de causalidade
  e de "zero Event" em rejeição.
- Commit `826e492`; API full 212/2959 verde; benchmark F9 PASS antes/depois; web verde (sem
  alteração web).

## F15 — conclusão (detalhes em docs/post-v4-dialogue-engine-f15.md)
- `F15 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED`: nenhum arquivo de código alterado.
- O par **Message ↔ decisão oficial** (`CONVERSATION_TURN_DUE`) já é atômico na tx única do
  Command Layer (`behavior.execution.ts`); o update da decisão legada `ai-behavior.v1` fica fora
  por fronteira de camada (não pode entrar sem segundo writer, transação longa ou acoplamento
  engine↔legacy).
- Cenários modelados: sem duplicação de Message, sem Message órfã, retry bloqueado
  (claim/cooldown) e stale recovery de 15min (`EXECUTION_STALE`). Gap residual = linha de
  auditoria legada pode terminar FAILED em crash window; aceito/documentado.
- Sem chave natural persistida ligando decisão legada ↔ execução oficial (seed fingerprint não é
  persistido); correlação exigiria mudança de contrato do engine — não justificada agora.
- Benchmark F9 reexecutado: PASS (12/12); último checkpoint de código é o da F14.

## F16 — conclusão (detalhes em docs/post-v4-dialogue-engine-f16.md)
- `F16 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED`: nenhum arquivo de código alterado.
- `RACE_WEEKEND` é um valor de **disponibilidade** (intenção do dono em `CharacterAvailability`;
  só a rota PATCH o escreve) e é tratado como aberto pela regra canônica da F12
  (`availability.policy.isAvailabilityOpen`). A **fase de weekend** é outro domínio, já derivada
  de `Race.status` + `WorldState.currentRaceId/currentSession` + `RaceSessionResult` pelo módulo
  `race-weekend`/`world-progression` (locks, ordem de sessões, FINISHED limpa `currentSession`).
- Não há duplicação de derivação nem inconsistência. Auto-derivar `RACE_WEEKEND` exigiria segundo
  writer de availability (sobrescrevendo intenção) ou override em leitura — descartado.
- Premissa do backlog ("derivação automática via WorldState/Schedule") era incorreta; item
  encerrado. Fica só cleanup cosmético opcional (reuso do open-rule em `behavior.policy`/
  `behavior.scoring`).
- Benchmark F9 reexecutado: PASS (12/12); último checkpoint de código é o da F14.

## F17 — conclusão (detalhes em docs/post-v4-dialogue-engine-f17.md)
- Consolidação registrada na F16: a regra de abertura (`AVAILABLE`/`RACE_WEEKEND`; sem registro =
  aberto) agora vive só em `availability.policy.isOpenAvailabilityStatus`; `behavior.policy`
  (precondition `AVAILABILITY_OPEN`) e `behavior.scoring.availabilityBonus` reusam o helper.
- Sem mudança de comportamento/scores/fingerprints; +2 testes (policy unit e behavior policy
  RACE_WEEKEND/OFFLINE). Commit `038b54c`.
- Validação: foco `availability+behavior` 68/68; benchmark F9 PASS antes/depois; web 519/519 +
  tsc/lint/build. Full API (3 execuções) só com flakes históricos (autonomous #13,
  pilot-knowledge #4, race-weekend/sprint-weekend sob pressão), todos verdes isolados.

## F18 — conclusão (detalhes em docs/post-v4-dialogue-engine-f18.md)
- Drift real (via `migrate diff`, somente leitura): drop `Conversation_status_idx` (não declarado
  no schema), create unique `Season_universeId_year_key`, rename do índice truncado de
  `ExternalBindingDriverSeason`. Migration `20261008210000_align_schema_migrations` (commit
  `a5b60d1`) aplicada no TEST via `migrate deploy` (47 migrations); `migrate diff` agora vazio e
  `migrate status` up to date.
- A unique expôs que o teste `universe-init.bootstrap` dependia do drift (criava 2ª Season mesmo
  ano). Guard `MULTIPLE_SEASONS_SAME_YEAR` ficou inalcançável (mantido como defesa); teste
  adaptado para a garantia do banco (P2002), sem remover cobertura real.
- DEV intocado; schema sem alteração; API full **212 files / 2961 tests — 100% verde**;
  benchmark F9 PASS antes/depois; web 519/519.

## F19 — conclusão (detalhes em docs/post-v4-dialogue-engine-f19.md)
- `F19 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED`: nenhum arquivo de código alterado.
- Produto é single-player (`Universe.userId @unique`, sem compartilhamento); personagens IA não têm
  semântica de "online"; a única presença com fonte de verdade é a de domínio (F12). Não há
  websocket/socket.io; só o heartbeat do SSE legado dormente (`/turn/stream`, F10/F13).
- Modelo futuro documentado: atividade derivada on-read (`Message/Event/PilotExperience`), exibida
  só para dados autorizados; transporte só com requisito (SSE como transporte, nunca engine);
  NÃO persistir presença de IA nem religar `/turn/stream`.
- Incidente de infra na fase: Docker Desktop parado → benchmark falhou com
  `PrismaClientInitializationError`; restaurado (Docker Desktop + `f1nw-postgres` healthy) e
  `F9 BENCHMARK GATE: PASS` (12/12). Sem mascarar.

## F20 — conclusão (detalhes em docs/post-v4-dialogue-engine-f20.md)
- Auditoria de performance da UI de conversas: API `GET /messages` sem paginação
  (`conversation.routes.ts:666-670`) e `MessageList` reconstruindo Map/scans por render com
  `MessageBubble` sem memo.
- Correção proporcional (commit `0f32267`): `MessageBubble` com `React.memo`; `MessageList` com
  `participantsById`/`messageById`/`rows` via `useMemo` antes dos early returns; `findAuthor`
  removido. Sem dependência nova, sem mudança de contrato/UX, sem comentários novos.
- Deferido: paginação do histórico e virtualização (exigem requisito de produto/volume real);
  CSS `content-visibility` descartado por afetar `scrollHeight`.
- Validação: foco conversations 12/54; web full **70/519** + tsc/lint/build; benchmark F9 PASS
  antes/depois (API intocada).

## F21 — conclusão (detalhes em docs/post-v4-dialogue-engine-f21.md)
- Auditoria de secrets: nenhum secret entra em contexto/prompt/persistência (env só em
  config/app/server/providers/auth); logger sem headers/body; erros de domínio sanitizados; repo
  só tem `.env.example` rastreado e `.env.keys` ausente. Nenhuma guarda semântica de runtime é
  necessária.
- Correção pequena (commit `609f31d`): `.gitignore` passa a ignorar `.env.*` com `!.env.example`
  (antes `.env.production`/`.env.test` ficavam fora do ignore).
- Verificação: `git check-ignore` confirma variantes ignoradas e exemplo preservado; benchmark F9
  PASS (mudança não-runtime). Sem código de produção alterado.

## Roadmap concluído (commits reais)
F3: F3.1–F3.5 (HEAD F3.5 `b0f7b8b`); docs `docs/post-v4-dialogue-engine-f3.md`.
F5: F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6: F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7: F7.0 `2207c0f`, F7.1 `286a165`, F7.2 `6e390be`, F7.3 `c0bbe39`, F7.4 `9be1ff4`,
F7.5 `185bdef`, F7.6 `59c1e25`.
F8: F8.1 `f58b41e`, F8.2 `8fff7bd`, F8.3 `5fc7470`, F8.4 `ebfca63`, F8.5 `83caa99`.
F9: gate `199b098`; doc `7c9b417`.
F10: análise `c9eee60`.
F11: F11.1 `d392196`; docs `c190018`.
F12: F12.1 `3e0ad46`; docs `94ff8f1`.
F13: análise `post-v4-dialogue-engine-f13.md`; docs `392bdff` (sem código).
F14: F14.1 `826e492`; docs `2a4b6eb`.
F15: análise `post-v4-dialogue-engine-f15.md`; docs `ab6147a` (sem código).
F16: análise `post-v4-dialogue-engine-f16.md`; docs `332395c` (sem código).
F17: F17.1 `038b54c`; docs `763c1ee`.
F18: F18.1 `a5b60d1`; docs `b992980`.
F19: análise `post-v4-dialogue-engine-f19.md`; docs `0ef21e6` (sem código).
F20: F20.1 `0f32267`; docs `fd1c8c4`.
F21: F21.1 `609f31d`; docs/HANDOFF neste commit.

## F9 — Benchmark Gate
- Arquivo: `apps/api/src/modules/conversation/conversation.dialogue-f9-benchmark.test.ts`
  (TEST DB, fixtures próprias, cleanup em `afterAll`, sem LLM/rede, serviços reais).
- Comando: `pnpm benchmark:f9` (raiz) ou `npm run benchmark:f9` (apps/api).
- Cenários B01–B10 + prova de regressão; thresholds hard-zero; budgets de `autonomyBudgets()`.
- Resultado real: `F9 BENCHMARK GATE: PASS` (12/12; contadores todos 0; exit 0).

## Validação real (F12)
- API: `npx tsc --noEmit` verde; ESLint do escopo verde; build `tsc -p` verde.
- Escopo afetado (`availability + behavior + conversation + autonomy + ai-behavior +
  world-simulation`): **45 files / 594 tests** verdes.
- Suíte completa API: **212 files / 2958 tests** — 100% verde (flake histórico não reproduziu).
- Benchmark: `pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` antes e depois (12/12; contadores 0).
- Web: `npx tsc --noEmit` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK
  (F12 não alterou web).
- Banco: TEST (`f1_narrative_test`) com fixtures/cleanup; DEV intocado; nenhuma migration.
- F11 regression: `ai-behavior` 13/13 (Command Layer/dialogue-realizer/llmUsed=false intactos).
- F13 (análise, sem código): `pnpm benchmark:f9` → PASS (12/12); suítes completas não
  reexecutadas porque nenhum arquivo de código foi alterado (checkpoint F12 permanece válido).
- F14 (código): foco `ai-behavior+behavior+events` 135/135; API full **212 files / 2959 tests**
  verdes; web 70/519 + tsc/lint/build; `pnpm benchmark:f9` PASS antes e depois.
- F15 (análise, sem código): `pnpm benchmark:f9` → PASS (12/12); suítes completas não
  reexecutadas porque nenhum arquivo de código foi alterado (checkpoint F14 permanece válido).
- F16 (análise, sem código): `pnpm benchmark:f9` → PASS (12/12); idem (checkpoint F14 válido).
- F17 (código): foco `availability+behavior` 68/68; `pnpm benchmark:f9` PASS antes/depois; web
  70/519 + tsc/lint/build. Full API: 3 execuções com apenas flakes históricos (autonomous #13,
  pilot-knowledge #4, race-weekend/sprint-weekend sob pressão), todos verdes isolados (45/45).
- F18 (db): `migrate diff` vazio após deploy; `migrate status` up to date (47 migrations);
  universe-init 16/16; API full **212 files / 2961 tests — 100% verde**; benchmark F9 PASS
  antes/depois; web `tsc`+519/519 (sem alteração web).
- F19 (análise, sem código): benchmark F9 PASS (12/12) após restaurar Docker/Postgres; suítes
  completas não reexecutadas (checkpoint F18 válido).
- F20 (web): foco conversations 12 files/54 tests; web full **70 files / 519 tests** + tsc/lint/
  build; benchmark F9 PASS antes/depois (API intocada).
- F21 (repo hygiene): `git check-ignore` ok; benchmark F9 PASS; sem código de produção alterado.

## Flakes observados
- F17: 3 execuções full com flakes históricos (autonomous #13, pilot-knowledge #4; race-weekend/
  sprint-weekend sob pressão na 2ª) — todos passam isolados (45/45); não atribuídos à F17.
- F14: uma execução do foco (`ai-behavior+behavior+events`) falhou 1 teste sob pressão; rerun
  135/135 e API full 100% verde — não reproduzido, não atribuído à F14.
- F12: nenhum flake novo; `pilot-knowledge.provision.test.ts #4` não reproduziu no full.
- Histórico: `pilot-knowledge.provision #4` (falhou no full na F11, passa isolado; documentado
  desde F6); `world-progression`/`biography.lifecycle`/`conversation.autonomous #13` falharam uma
  vez sob pressão na F11 e passaram isoladas. Nenhum é atribuído a F11/F12.

## Backlog futuro (priorizado)
1. Streaming como transporte — **decidido na F13: não implementar** enquanto o realizer for
   determinístico/instantâneo e sem requisito de UX para cadeias ao vivo. Se reaberto: SSE
   sobre o MESMO `simulateConversationTurn` (design na F13); NÃO religar `/turn/stream` legado.
2. Presença em tempo real — **decidido na F19: não implementar** (single-player, sem consumidor;
   IA sem semântica de online). Se reaberto: atividade derivada on-read (sem schema), transporte
   só com requisito; NUNCA religar `/turn/stream`.
3. Paginação do histórico de mensagens e virtualização — **F20 fez a parte segura (memoização);
   o restante exige requisito de produto** (janela de histórico/cursor) e evals de latência.
   API `GET /messages` hoje devolve todo o histórico.
4. Auditoria exata decisão legada ↔ execução oficial (F15 concluiu que a separação é intencional;
   só reabrir se houver requisito de auditoria que justifique registrar correlação no metadata
   oficial — mudança de contrato do engine a avaliar).
5. `RACE_WEEKEND` auditado na F16 (sem derivação automática: intenção do dono; fase de weekend já
   derivada) e o literal duplicado da regra de abertura consolidado na F17.
6. Secret **encerrado na F21** (sem caminho de vazamento; `.gitignore` endurecido). Hardening
   opcional futuro: `setErrorHandler` global para 500 inesperado. Drift schema↔migrations
   **encerrado na F18**.
   (P1 da F10 — segundo writer — concluído na F11; presença de domínio na F12; streaming
   analisado/não implementado na F13; CREATE_EVENT investigado e atomicidade corrigida na F14 —
   unificação com o Command Layer oficial descartada por mudança semântica do Event.)

## Achados de infraestrutura (mantidos)
- Drift schema↔migrations resolvido na F18 (`20261008210000_align_schema_migrations`; `migrate
  diff` vazio; unique `Season(universeId, year)` aplicada no TEST). DEV intocado.
- `prisma migrate dev` interativo; migrations via `migrate deploy` em TEST (F18 gerou a migration
  a partir de `migrate diff --from-url`).
- Docker Desktop precisa estar rodando para o TEST (`f1nw-postgres`); se o daemon cair, testes
  falham com `PrismaClientInitializationError` (incidente da F19, restaurado com
  `docker compose -f docker/docker-compose.yml up -d`).
- `prisma generate` pode falhar com EPERM no engine DLL; verificar tipos gerados.
- Web usa `.eslintrc.json` via `next lint` (ESLint 9 direto não acha config).

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md` e os docs `docs/post-v4-dialogue-engine-f9.md` a
`docs/post-v4-dialogue-engine-f21.md`. Valide Git (branch, HEAD, working tree). F3–F9
concluídas, F10–F21 concluídas (F13/F15/F16/F19 como análise; F11/F12/F14/F17/F18/F20/F21 com
código/higiene); NÃO repita. Garanta Docker Desktop/Postgres ativos. Para verificar o engine,
rode `pnpm benchmark:f9`. Backlog acionável esgotado; itens restantes exigem requisito de produto
(paginação/virtualização) ou hardening opcional (setErrorHandler). Não use amend e não faça
push."

