# Dialogue Engine — F13 (Streaming Transport)

## F13 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED

## 1. Objetivo
Avaliar se streaming pode ser uma camada de transporte do Dialogue Engine existente — sem nova
engine, sem segundo writer, sem religar LLM — e implementá-lo somente se houver benefício real
para a UX com complexidade proporcional. Esta fase não produziu código de produção.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `94ff8f1` (F12 concluída); working tree limpo; 2 commits
  à frente de `origin/v4-Living-F1-Universe` (não houve push).
- F11 (unificação do AI Behavior) e F12 (presença/availability efetiva) concluídas; DEV
  read-only; TEST com fixtures/cleanup.

## 3. Fluxo atual mapeado (código real)
### UI de Conversas
`MessageComposer` → `useCreateMessage` (`POST /api/conversations/:id/messages`) +
`planSimulationTurn` (`POST /simulate-turn/plan`, indicador de digitação) + `useSimulateTurn`
(`POST /simulate-turn`) → `simulateConversationTurn` → planner → contexto por speaker →
realizer determinístico → validator → domain gate → Command Layer → `Message`. Ao final o
React Query invalida a thread. **Nenhuma página/componente usa streaming** (grep em
`apps/web/src/app` e `apps/web/src/components` não encontra `useStreamingTurn`,
`useGenerateMessage`, `useAutonomousTurn`; `streaming-turn.integration.test.tsx` afirma
explicitamente que o composer não usa `/turn` nem `/turn/stream`).

### Dialogue Engine
`conversation.simulation.ts`: `simulateConversationTurn` percorre todos os turns/reações,
realiza (`realizer.realize`), valida (`validateDialogueOutput`), persiste via
`runAutonomousConversationTurn` (domain gate `CONVERSATION_TURN_DUE` → Command Layer) e **só
retorna depois de concluir todos os steps**. Não existe callback/event sink nem entrega
incremental.
Realizer default é **determinístico** (`resolveDialogueRealizerKind(undefined) ===
"deterministic"`, `conversation.dialogue-realizer.ts:307`), síncrono, produz a utterance
completa em memória; LLM permanece atrás de flag e não foi religado (F13 não avalia LLM).

### Rotas legadas (mapeadas, não alteradas)
- `POST /api/conversations/:id/turn` (`conversation-turn.routes.ts`) → `executeTurn`.
- `POST /api/conversations/:id/turn/stream` (`conversation-turn-stream.routes.ts`) → SSE de
  verdade (hijack, heartbeat de 15s, backpressure via `drain`, `AbortController` no
  disconnect), mas gera via **provider LLM** (`generation.delta`) e persiste via
  `persistGeneratedMessage` (`conversation-turn.ts:361`) — segunda engine/segundo writer.
- `POST /api/conversations/:id/generate` (`generation-generate.routes.ts`) → mesmo pipeline
  legado.
- Registradas em `app.ts:186-205` com `provider: generationProvider ?? nullProvider`; sem
  provider real, o caminho falha controladamente. **Dormente para a UI**; contratos cobertos
  por testes legados próprios.

## 4. Decisão: não implementar streaming (análise dos critérios §4)
1. **Benefício real de UX: nenhum.** A resposta determinística é produzida integralmente em
   memória quase instantaneamente; "streaming" do texto exigiria picar uma string pronta e,
   para parecer progressivo, sleeps artificiais (proibidos). Não há latência real a esconder:
   o composer já mostra indicador de digitação via `/simulate-turn/plan`.
2. **Frontend atual sem arquitetura paralela:** adotar SSE exigiria endpoint novo + estado de
   streaming no cliente + cancelamento/reconnect, sem ganho observável — complexidade sem
   benefício.
3. **Realizer como única origem:** viável, mas o texto já está completo antes de qualquer
   entrega.
4. **Validator como autoridade antes da persistência:** streamar texto não validado seria
   proibido; streamar depois da validação = replay do que a mutation já devolve.
5. **Command Layer writer único:** permaneceria (transporte não escreve), porém sem ganho que
   justifique superfície nova.
6. **ACL/universe/audience/target:** seriam reimplementados no endpoint de transporte
   (duplicação de superfície de segurança) sem contrapartida.
7. **Cancelamento:** sem ganho, adicionaria um ciclo de vida novo (disconnect/conclusão).
8. **Semântica de Message:** intacta hoje; nenhuma necessidade de mudança.
9. **F9:** PASS, mas o benchmark não é motivo para adicionar complexidade.
10. **Complexidade proporcional:** SSE + event sink injetado em `simulateConversationTurn`
    (função coberta pelo F9) + testes de transporte/segurança/concorrência + cliente —
    desproporcional para um ganho inexistente hoje.

Único ganho plausível identificado: entregar mensagens de **cadeias multi-step** conforme são
persistidas (efeito de conversa "ao vivo"), moderado e não requisitado. Registrado como
possibilidade futura, não implementado.

### Transportes avaliados
- **SSE**: melhor encaixe (já existe infraestrutura no legado: `startSse`, heartbeat,
  backpressure, abort) e compatível com Next.js/Fastify; escolhido *se* houvesse implementação.
- **fetch streaming / ReadableStream**: cliente mais simples, mesmo custo de servidor/estado.
- **WebSocket**: descartado (conexão persistente, auth e operação extras, sem requisito).

**Não religar `/turn/stream`:** é a engine legada com provider e `persistGeneratedMessage`;
usá-lo seria violar a regra central da fase.

## 5. Fluxo desejado (documentado para o futuro)
```text
Request → simulateConversationTurn (mesma engine)
  planner → speaker context → realizer → validator → domain gate → Command Layer → Message
  → evento de transporte SOMENTE após cada passo persistido (step.messageId)
  → cliente
```
Regras do design futuro seguro (se houver realizer assíncrono/LLM ou requisito de UX):
- O transporte não decide, não valida e não escreve; sem `prisma.message.create` e sem
  `persistGeneratedMessage` no endpoint.
- Nada é emitido antes de `validateDialogueOutput` + Command Layer; o evento carrega a
  mensagem já persistida (autoridade = engine).
- ACL/ownership/universo/audience/target idênticos ao `/simulate-turn` (mesmo serviço,
  `accessibleConversation`); fingerprint/cooldown/stop conditions existentes, sem
  reimplementação.
- Cancelamento: desconexão encerra apenas a entrega; mensagens já commitadas permanecem (não há
  rollback hoje e não será criado estado parcial); abort entre steps pode ser avaliado depois,
  com signal, sem regra de domínio nova.
- Reconnect/retry: cliente refaz a leitura (query/thread) em vez de reexecutar; as proteções de
  idempotência/concorrência do engine permanecem as únicas.

## 6. Arquivos alterados
Nenhum arquivo de código. Somente esta análise e o `HANDOFF`.

## 7. Testes
Nenhum teste novo (sem implementação). Regressão executada: `pnpm benchmark:f9` →
`F9 BENCHMARK GATE: PASS` (12/12; contadores 0; thresholds intactos). O último checkpoint verde
de código permanece o da F12 (API 212 files/2958 tests; web 70 files/519 tests + tsc/lint/build),
válido porque não houve mudança de código.

## 8. Segurança
Nenhuma superfície nova. O caminho ativo (UI → `simulate-turn`) mantém ACL, ownership
(404 para não-dono), isolamento de universo, audience/context por speaker, target e Command
Layer como writer único. Nenhum endpoint adicional foi criado; a F11/F12 continuam intactas.

## 9. Concorrência e idempotência
Nenhuma mudança: cooldown, opportunity fingerprint, deduplicação e stop conditions do engine
permanecem as únicas regras. Ao não criar transporte, também não foi criada uma segunda
implementação dessas proteções.

## 10. Cancelamento
Nada implementado; comportamento documentado no design futuro (§5): desconexão não cria estado
parcial nem rollback; persistência já commitada pelo Command Layer permanece; decisão sobre
abort entre steps fica para quando (e se) houver transporte.

## 11. Banco
Nenhuma migration; nenhuma escrita em DEV; TEST não foi necessário nesta fase (sem fixtures
novas).

## 12. Flakes
Nenhum novo. Benchmark executado limpo. Flakes históricos já documentados no HANDOFF
(`pilot-knowledge.provision #4`; `world-progression`/`biography.lifecycle`/
`conversation.autonomous #13` sob pressão) permanecem não relacionados a esta fase.

## 13. Limitações
- Não existe entrega progressiva hoje (decisão consciente).
- `/turn`, `/turn/stream` e `/generate` continuam existindo como caminho legado dormente,
  coberto por testes próprios; não devem ser religados. Remoção fica para fase futura se
  desejada.
- O realizer LLM atrás de flag não foi ligado nem avaliado para streaming.

## 14. Achados honestos
- O SSE legado é tecnicamente completo (heartbeat/backpressure/abort), mas pertence à engine
  antiga e nunca foi consumido pela UI.
- O Dialogue Engine determinístico é rápido demais para se beneficiar de streaming de texto;
  o ganho só existiria com geração assíncrona (LLM) ou com entrega de cadeias multi-step — e
  ambos são requisitos futuros, não atuais.
- Implementar agora criaria superfície nova de transporte/segurança/testes sem benefício,
  contrariando o critério de proporcionalidade.

## 15. Decisões arquiteturais
- Streaming permanece **não implementado** até existir benefício real (realizer assíncrono ou
  requisito de UX por cadeias ao vivo).
- O transporte futuro, se existir, será SSE consumindo o **mesmo** `simulateConversationTurn`,
  emitindo somente após validação + Command Layer; nunca uma segunda engine/segundo writer.
- `/turn/stream` legado não será a base; permanece dormente.

## 16. Próximo passo
Seguir o backlog do HANDOFF (não-streaming): presença em tempo real só com requisito de UX,
virtualização/performance, `CREATE_EVENT` do ai-behavior via pipeline oficial, derivação de
`RACE_WEEKEND` via WorldState/Schedule, guarda semântica de secret e drift
schema↔migrations. Se streaming voltar à pauta, reabrir como fase própria com o design da §5 e
critério de benefício comprovado.
