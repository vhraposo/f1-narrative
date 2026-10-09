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
  concluída (secret: sem caminho de vazamento; `.gitignore` endurecido para `.env.*`)**;
  **F22 — COMPLETE (qualidade conversacional, F22.1–F22.8). LLM — EXPERIMENTAL;
  DETERMINISTIC — DEFAULT (promotion gate: NÃO promovido; multi-turno com question overuse/
  incoerência no `llama3.2`)**. Fix pós-F22: prioridade de endereçamento explícito na seleção
  de speaker de grupo (abaixo).
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

## F22 — em andamento (detalhes em docs/post-v4-dialogue-engine-f22.md)
- F22.1 concluída (commit `f0f705f`): realizer determinístico passou a respeitar `emotion`
  SAD/TENSE (prefere `neutralPhrases`; suprime emoji) — antes o estado emocional chegava no
  contexto e era ignorado; baseline determinístico de qualidade em
  `conversation.dialogue-human-quality.test.ts` (question rate, variância de tamanho, diversidade
  entre seeds, diferenciação de persona, SAD/TENSE sem risada/emoji, anti-genérico, replay).
- Auditoria registrada: `LlmDialogueRealizer` existe (provider/schema/trace/fallback) mas **não
  está ligado** (simulation chama `createDialogueRealizer(kind)` sem provider); `topic`/`memory`/
  `knowledge` ainda não influenciam a realização; F5/F12 intactos.
- F22.2 concluída (commit `1157708`; doc `docs/post-v4-dialogue-engine-f22-2.md`): LLM realizer
  ligado atrás de `DIALOGUE_REALIZER=llm` via endpoint Ollama existente (`conversation.
  dialogue-realizer-ollama.ts`), contrato estreitado (engine decide speaker/intent/replyTo; LLM só
  wording), fallback+`RealizerTrace` propagado para `contextJson.language`, LLM fora de transação.
  A/B real (25 cenários, `llama3.2`): 0 fallbacks, ~1,07s, mais contexto/variedade, mas eco do
  interlocutor (8%), tom de assistente, nome alucinado, degeneração de emoji e JOKE fraco →
  **LLM NÃO promovido**; determinístico segue default. Lacuna: `validateDialogueOutput` não barra
  eco/emoji degenerado (registrado para F22.3/hardening).
- F22.3 concluída (commit `cecc6b3`; doc `docs/post-v4-dialogue-engine-f22-3.md`):
  `DialogueResponseStrategy` efêmera/determinística (question/echo/emoji/length/name/actionClaim)
  honrada pelos dois realizers; `interlocutorName` + prompt speaker-centric (fim do "kimim");
  guardrails determinísticos (`conversation.dialogue-naturalness.ts`: echo longo, estrutural,
  emoji degenerado, tom de assistente, action claim, pergunta proibida) com fallback determinístico
  na simulação. A/B real (30 cenários, `llama3.2`): leakage/emoji/nome zerados; guard rate 6,7%;
  duplicate 3,3% (acks curtos aceitáveis); question rate 23% (prompt citando pergunta piorava:
  43–73% → removida a orientação de pergunta do prompt); fallback realizer 6,7%. API full
  **216 files / 2996 tests — 100% verde**; benchmark F9 PASS antes/depois.
- F22.4 concluída (doc `docs/post-v4-dialogue-engine-f22-4.md`): curadoria determinística de
  memória (`curateDialogueMemories`: dedupe/normalização/remoção de eco do histórico/cap 3) +
  `measureDialogueContextBudget` + fronteira de conhecimento no prompt; A/B com curadoria
  aplicada (variância do `llama3.2` domina os agregados — ganho estrutural, sem claim de melhoria
  agregada).
- F22.5 concluída (commit `34218b7`; doc `docs/post-v4-dialogue-engine-f22-5.md`): projeção
  determinística de relação/estilo (`describeRelationshipAffinity`/`describeVoiceStyle`) usada no
  prompt; sem eixos inventados; determinístico já adaptava por voz/afinidade. API full 218/3003.
- F22.6 concluída (commit desta subfase; doc `docs/post-v4-dialogue-engine-f22-6.md`):
  anti-repetição determinística no `pickPhrase` (desvia de frase idêntica ao histórico recente) +
  `measureRecentRepetition` (duplicateRate/openingRate). Foco 44/44; API full 3007 (1 flake
  histórico); F9 PASS.
- F22.7 concluída (commit desta subfase; doc `docs/post-v4-dialogue-engine-f22-7.md`):
  `selfDisclosureMode` na estratégia (FORBIDDEN/OPTIONAL/ENCOURAGED) + orientação de
  compartilhamento no prompt; sem planner/scheduler novo; turno ativo apenas.
- F22.8 concluída (commit desta subfase; docs `post-v4-dialogue-engine-f22-8.md` e
  `evaluations/f22-human-review.md`): multi-turno real (4×5 turnos) via
  `npm run human-quality:multiturn`; determinístico 0 violações/0 perguntas/0 dup; LLM question
  overuse (até 80%) e incoerência → **promotion gate: LLM NÃO promovido**. F9 PASS; API full 3008
  (flake histórico `autonomous #13`, verde isolado 13/13); tsc/ESLint verdes; web não alterada.
- Programa F22 encerrado. Roadmap residual: apenas itens condicionados a requisito de produto
  (paginação/virtualização, presença em tempo real, `setErrorHandler`).
- Validação F22.1: foco 7/7 + realizer 32/32 + conversation 454/454; API full **213 files /
  2968 tests — 100% verde**; benchmark F9 PASS antes/depois; sem migration.

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
F21: F21.1 `609f31d`; docs `e1c0ce2`.
F22: F22.1 `f0f705f`; F22.2 `1157708`; F22.3 `cecc6b3`; F22.4 `71ba1f1`; F22.5 `34218b7`;
F22.6 `44061d1`; F22.7 `99143cb`; F22.8 (commit desta subfase).

## Fix pós-F22 — Speaker priority (conversa de grupo)
- Problema: cadeia artificial (cada piloto respondia o anterior), menção explícita ignorada
  ("Kimi" não batia por ser nome do meio) e avalanche de reações.
- Correção em `conversation.response-engine.ts`: matching de qualquer token do nome (nome
  completo/primeiro/último/meio), distinção `DIRECT_MENTION` (vocativo/pergunta direta/nome no
  fim) vs `SUBJECT_MENTION` (assunto), `REPLY_TARGET` (reply a mensagem de IA), seleção
  restrita aos alvos diretos quando existem, gating de reações por motivo contextual
  (`TOPIC_ENGAGEMENT`/`HIGH_AFFINITY`/menção) e cap social (1 sem sinal contextual).
- `conversation.simulation.ts`: `replyToMessageId` lido do `contextJson.dialogue` e propagado;
  intent de reação agora considera menção do escolhido.
- Testes: `conversation.speaker-selection.test.ts` (9); conversation 503/503; API full 3017
  verdes; F9 PASS. QA end-to-end (TEST): "mds o que Kimi?" → só Kimi e encerra; "Max, ..." → só
  Max; "bom dia" → 1 resposta. Database: unchanged; Migrations: none.

## F23 — Group chat response relevance (fix)
- Reprodução (endpoint real, TEST): "ola" → "ué"/"mds" (pool REACTION), "kimi voce é gay ?" → "Acho que
  sim, vamos ver." (ANSWER assertivo) — estratégia ativa: **determinística** (`.env` sem
  `DIALOGUE_REALIZER`). Cadeia (Caso C) não reproduz no código atual (turno encerra).
- Correção em `conversation.dialogue-realizer.ts`: pool `greetingPhrases` (REACTION/ANSWER/FOLLOW_UP)
  usado quando a mensagem é saudação (e sem baixa afinidade/tom SAD/TENSE); `questionPhrases` do
  ANSWER (evasivas: "Boa pergunta.", "Sei lá, depende.") usadas em perguntas — nunca afirmação
  genérica. `pickPhrase` reordenado (saudação → pergunta → neutro).
- Testes: human-quality +3 (saudação coerente, relação distante neutra, pergunta evasiva);
  repetição/realizer adaptados; conversation 39 files/506; API full **220 files / 3020 tests — 100%**;
  F9 PASS. QA pós-fix (TEST): "ola" → "e aí"; "kimi voce é gay ?" → "Sei lá, depende.";
  "mds o que Kimi?" → só Kimi ("Boa pergunta."), turno encerra. Database: unchanged; Migrations: none.

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
- F22.1 (API): foco `human-quality` 7/7 + `dialogue-realizer` 32/32 + folder conversation
  454/454; API full **213 files / 2968 tests — 100% verde**; benchmark F9 PASS antes/depois;
  tsc/ESLint verdes; web não alterada.
- F22.2 (API): foco realizer+adapter+baseline 53/53; API full **214 files / 2981 tests — 100%
  verde**; benchmark F9 PASS antes/depois; tsc/ESLint verdes; A/B real com Ollama
  (`npm run human-quality:ab`, 25 cenários) executado; web não alterada.
- F22.3 (API): foco strategy/naturalness/realizer/ollama 28/28; API full **216 files / 2996 tests —
  100% verde**; benchmark F9 PASS antes/depois; tsc/ESLint verdes; A/B real reexecutado (30
  cenários, guard rate 6,7%, leakage/emoji/nome zerados); web não alterada.
- F22.4 (API): foco curation+ollama 17/17; API full 3000 testes com 1 flake histórico
  (`pilot-knowledge #4`, verde isolado 13/13); benchmark F9 PASS; tsc/ESLint verdes; A/B com
  curadoria aplicada (variância do modelo documentada); web não alterada.
- F22.5 (API): foco persona+ollama 16/16; API full **218 files / 3003 tests — 100% verde**;
  benchmark F9 PASS; tsc/ESLint verdes; A/B reexecutado; web não alterada.
- F22.6 (API): foco repetition+realizer+human-quality 44/44; API full 3007 testes com 1 flake
  histórico; benchmark F9 PASS; tsc/ESLint verdes; A/B reexecutado; web não alterada.
- F22.7 (API): foco strategy/ollama/naturalness 29/29; API full 3008 testes com 1 flake histórico;
  benchmark F9 PASS; tsc/ESLint verdes; A/B reexecutado; web não alterada.
- F22.8 (API/scripts): multi-turn real (4 sequências × 5 turnos) executado; determinístico 0
  violações/0 perguntas/0 dup; LLM question overuse até 80% + incoerência; F9 PASS; API full 3008
  com flake histórico verde isolado (13/13); tsc/ESLint verdes; web não alterada.

## Flakes observados
- F17: 3 execuções full com flakes históricos (autonomous #13, pilot-knowledge #4; race-weekend/
  sprint-weekend sob pressão na 2ª) — todos passam isolados (45/45); não atribuídos à F17.
- F14: uma execução do foco (`ai-behavior+behavior+events`) falhou 1 teste sob pressão; rerun
  135/135 e API full 100% verde — não reproduzido, não atribuído à F14.
- F12: nenhum flake novo; `pilot-knowledge.provision.test.ts #4` não reproduziu no full.
- Histórico: `pilot-knowledge.provision #4` (falhou no full na F11, passa isolado; documentado
  desde F6); `world-progression`/`biography.lifecycle`/`conversation.autonomous #13` falharam uma
  vez sob pressão na F11 e passaram isoladas. Nenhum é atribuído a F11/F12.

## Programa F22 — ENCERRADO
F22.1–F22.8 concluídas. LLM — EXPERIMENTAL (`DIALOGUE_REALIZER=llm`); DETERMINISTIC — DEFAULT.
Relatórios em `docs/post-v4-dialogue-engine-f22*.md`; revisão em `docs/evaluations/`. Itens
residuais são condicionados a requisito de produto (paginação/virtualização, presença,
`setErrorHandler`).

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
- DEV estava 3 migrations atrás (`add_conversation_visibility`, `add_event_visibility`,
  `align_schema_migrations`) → HTTP 500 em `GET/POST /api/conversations` (coluna `visibility`
  ausente no banco). Corrigido com `npx prisma migrate deploy` (47 migrations, up to date) e
  validado end-to-end (GET 200 / POST 201). Aplicar migrations pendentes no DEV após pull:
  `npx prisma migrate deploy` (a partir da raiz).
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
`docs/post-v4-dialogue-engine-f22-8.md`. Valide Git (branch, HEAD, working tree). F3–F22
concluídas (F22 — COMPLETE; LLM EXPERIMENTAL, DETERMINISTIC DEFAULT); NÃO repita. Garanta Docker
Desktop/Postgres ativos; Ollama é opcional (`npm run human-quality:ab` e
`human-quality:multiturn`). Para verificar o engine, rode `pnpm benchmark:f9`. Para trabalho novo,
escolha um item condicional do backlog ou abra fase própria. Não use amend e não faça push."

