# Dialogue Engine — F12 (Presence & Conversation Runtime State)

## 1. Objetivo
Tornar a presença/disponibilidade dos personagens um estado de runtime coerente com o
Conversation/Dialogue Engine, sem criar um segundo estado, uma segunda engine ou um segundo
writer. Regra da fase: analisar antes de implementar; só implementar a menor solução coerente.

## 2. Estado inicial
- Branch `v4-Living-F1-Universe`; HEAD `c190018` (F11 concluída); working tree limpo; DEV
  read-only; TEST para fixtures.
- F11 concluída: `ai-behavior` `SEND_MESSAGE` usa `simulateConversationTurn`; Command Layer é o
  writer único; benchmark F9 PASS.

## 3. Arquitetura encontrada (código real)
- **Fonte de verdade existente**: `CharacterAvailability` (1:1 com `Character`) — `status`
  (AVAILABLE/BUSY/TRAINING/TRAVELING/SLEEPING/RACE_WEEKEND/OFFLINE), `reason`, `since`, `until`.
  Intenção persistida, editada manualmente pelo dono via `GET/PATCH
  /api/characters/:characterId/availability` (404 para não-dono, sem bypass, sem admin).
- **Consumidores no runtime**:
  - Planner: `conversation.simulation.ts` (`loadPlanInput` → `participants[].available`),
    `conversation.autonomous.ts` (`planConversationTurn`), `conversation.turn-engine.ts`
    (`planTurnForConversation`).
  - Domain gate: `behavior.context.ts` carrega availability → `behavior.policy.ts`
    (`AVAILABILITY_OPEN`) e `behavior.scoring.ts` (`availabilityBonus`).
  - World simulation: `world-simulation.tick.ts` (`UNAVAILABLE_STATUSES`).
  - UI: `AvailabilityCard` no perfil do personagem (dono).
- **Gaps encontrados**:
  1. `until` era persistido, validado (`until < since` → 400) e exibido, mas **nenhum consumidor
     o avaliava**: um status temporário nunca expirava (estado de runtime obsoleto).
  2. A regra `available = !record || AVAILABLE || RACE_WEEKEND` estava **duplicada inline em
     4 lugares** (simulation, autonomous, turn-engine, world-sim com conjunto diferente).
  3. `PATCH` não iniciava nova janela ao trocar status: `since`/`until` antigos contaminavam o
     novo status (ex.: BUSY até 18:00 → OFFLINE sem `until` expirava às 18:00 por engano).
- **Fora do escopo por ausência de infraestrutura**: presença em tempo real (sessão/websocket/
  heartbeat) não existe no backend; seria nova arquitetura.

## 4. Decisão
**Opção A** — implementar o menor incremento coerente: *effective availability* derivada
deterministicamente da intenção persistida + janela `until`, contra o relógio do engine; um
único helper de domínio; todos os consumidores convergem; sem schema/migration; sem segunda
fonte de verdade; sem event bus/outbox.

O que a F12 **não** fez: presença online real, websocket, presença exibida para terceiros
(availability continua privada do dono), derivação de RACE_WEEKEND via WorldState/Eventos.

## 5. Modelo final
- **Intenção persistida**: `CharacterAvailability` (nada muda no schema).
- **Estado efetivo** (derivado, nunca armazenado):
  - sem registro → disponível (semântica preservada);
  - `until == null` → status persistido;
  - `referenceDate >= until` → `AVAILABLE` (reason/until limpos na view);
  - sem `referenceDate` → janela não avaliada (conservador/determinístico).
- **Data de referência** = relógio do engine: `worldDate` quando fornecido; senão o último
  `Message.createdAt` (conversas) ou `WorldState.currentDate` (turno autônomo); `schedule.startsAt`
  na simulação de mundo.
- **Regra de disponibilidade**: `AVAILABLE` e `RACE_WEEKEND` são abertos; os demais fechados.

## 6. Contratos
- `apps/api/src/modules/availability/availability.policy.ts` (novo):
  - `AvailabilityWindow`, `EffectiveAvailability`;
  - `resolveEffectiveAvailability(availability, referenceDate)`;
  - `resolveEffectiveAvailabilityStatus(...)`;
  - `isAvailabilityOpen(...)`.
- `PATCH /api/characters/:id/availability`: trocar `status` inicia nova janela
  (`since = agora`; `until = null` salvo se informado); atualizar só `reason`/`until` preserva os
  demais campos. `until < since` continua `400 VALIDATION_ERROR`.
- Consumers passam a chamar o helper (planner, domain gate, world sim); o boolean `available` do
  planner e a precondition `AVAILABILITY_OPEN` não mudam de forma.

## 7. Módulos alterados
- `availability/availability.policy.ts` (novo) + `availability.policy.test.ts` (novo).
- `availability/availability.routes.ts` (janela no PATCH) + `availability.test.ts`.
- `behavior/behavior.context.ts` (deriva no relógio do request) + `behavior.execution.test.ts`.
- `conversation/conversation.simulation.ts` (referência + helper; `until` selecionado).
- `conversation/conversation.autonomous.ts` (resolve worldDate **antes** do planner; helper).
- `conversation/conversation.turn-engine.ts` (`planTurnForConversation` com worldDate).
- `world-simulation/world-simulation.tick.ts` (`schedule.startsAt` como referência) + teste.
- `conversation/conversation.simulation-baseline.test.ts` (janela futura bloqueia / expirada libera).

## 8. Interação com o Dialogue Engine
- Planner continua decidindo quem/intenção/replyTo/continuidade/stop; apenas recebe `available`
  derivado corretamente (personagem ocupado é pulado; `NO_ELIGIBLE_SPEAKER` quando todos fechados).
- Domain gate `CONVERSATION_TURN_DUE`/`MESSAGE_RECEIVED` avalia `AVAILABILITY_OPEN` sobre o
  estado efetivo; `availabilityBonus` de scoring idem.
- F11 intacto: `SEND_MESSAGE` do AI Behavior continua via `simulateConversationTurn`; com janela
  ativa o domain gate rejeita (sem mensagem); com janela expirada o personagem volta a responder.
- World simulation deixa de bloquear agendas por status temporário já expirado no horário da
  atividade.

## 9. Testes
- Novos/adaptados:
  - `availability.policy.test.ts` (7): sem registro, sem janela, janela futura, expirada
    (deriva AVAILABLE e limpa reason/until), instante exato, sem referência, statuses abertos.
  - `availability.test.ts` (+2): troca de status descarta janela anterior; reason-only preserva
    status/until (os testes de ownership/404/validação/concorrência permanecem).
  - `behavior.execution.test.ts` (+1): OFFLINE com janela expirada → RESPOND EXECUTED (contexto
    derivado), complementando o caso OFFLINE sem janela → STALE_CONTEXT.
  - `conversation.simulation-baseline.test.ts` (+1): janela futura → `planned []`; janela
    expirada no `worldDate` → planner libera.
  - `world-simulation.tick.test.ts` (+1): OFFLINE com `until` anterior ao `startsAt` → agenda não
    é bloqueada (`skippedUnavailable 0`, evento criado).
- Resultados reais:
  - Escopo afetado (`availability+behavior+conversation+autonomy+ai-behavior+world-simulation`):
    **45 files / 594 tests** verdes.
  - API full: **212 files / 2958 tests** verdes (sem flakes nesta execução).
  - Web: tsc verde; **70 files / 519 tests**; `next lint` OK; `next build` OK.
  - F11 regression: `ai-behavior` 13/13 verde (incluído no escopo).
- `pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 10. Segurança
- AC L/ownership inalterados: availability continua privada do dono; outros usuários recebem 404
  (nunca 403); nenhum endpoint novo; nenhum dado de personagem de terceiros exposto.
- Derivação é interna ao engine (não vaza status para a conversa de terceiros).
- Command Layer continua writer único de `Message`; nenhuma mudança no pipeline de escrita.
- Target/universe isolation e audience/context intactos (F11 coberto pela suíte).

## 11. Banco
- Nenhuma migration/schema change.
- DEV intocado. TEST usado com fixtures controladas e cleanup em `afterAll`.

## 12. Flakes
- Nenhum flake novo observado na F12; o flake histórico `pilot-knowledge.provision #4` **não
  reproduziu** nesta execução full (API 100% verde).

## 13. Limitações
- Não existe presença em tempo real (conexão/sessão); a F12 cobre presença de domínio.
- A janela `until` é avaliada no relógio do universo (`worldDate`); assume-se universo próximo do
  tempo real (caso dos fixtures/produto atual). Universos muito distantes do tempo real podem
  expirar janelas imediatamente — comportamento determinístico e documentado.
- RACE_WEEKEND continua status manual (não derivado de WorldState/Eventos).
- Availability não é exibida para participantes de conversa por design (privacidade).

## 14. Achados honestos
- `until` era estado morto (persistido/validado/exibido, nunca avaliado) — gap real de runtime.
- A regra de disponibilidade estava duplicada em 4 pontos com conjuntos levemente diferentes.
- `PATCH` mantinha `since/until` antigos ao trocar status, gerando expiração incorreta futura.
- `runAutonomousConversationTurn` planejava com `new Date()` quando `worldDate` não era informado,
  embora já resolvesse `WorldState.currentDate` depois; a F12 antecipa a resolução (planner e
  domain gate no mesmo relógio) mantendo `new Date()` apenas como fallback quando não há
  WorldState.
- `world-simulation.tick` usava somente `OFFLINE/SLEEPING` brutos; agora avalia a janela no
  horário da atividade.

## 15. Decisões arquiteturais
- Presença = intenção persistida + derivação determinística; sem coluna nova, sem cache, sem
  segundo estado.
- Um único helper de domínio; nenhum consumidor reimplementa a regra.
- Relógio do engine é `worldDate` (determinismo/F9 replay), nunca `Date.now()` no domínio.
- Expiração → `AVAILABLE` (default de "sem registro"), preservando a semântica existente.
- Mudança de status = nova janela (o `until` pertence ao status, não ao registro).

## 16. O que deliberadamente não foi feito
- Streaming/websocket; presença online real; notificações; availability de terceiros na UI;
  derivação automática por Schedule/WorldState.

## 17. Próximo estado
Presença de domínio coerente e testada; nenhum P0/P1 aberto de escrita paralela ou estado
obsoleto. Backlog restante no HANDOFF (streaming como transporte, presença em tempo real se
houver requisito de UX, performance/virtualização, `CREATE_EVENT` do ai-behavior, secret guard,
drift schema↔migrations).
