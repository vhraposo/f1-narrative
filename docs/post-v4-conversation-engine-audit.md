# Auditoria — Conversation Engine Evolution (pós-V4)
Base: commit 82beead (branch v4-Living-F1-Universe). Data da auditoria: 2026-10-02.
Escopo: comparar a especificação de 9 fases (A–I) com a implementação real.

## 1. O que já existe
- **Conversation/Message/participants**: `Conversation` (type, status ACTIVE/...), `ConversationParticipant` N:N,
  `Message` com `senderType`, `characterId`, `contextJson` (metadata) e índice por conversa/data
  (`prisma/schema.prisma:1099-1144`). Writer único = rotas de conversation (POST /messages).
- **Behavior/Command Layer**: `BehaviorContext`, `behavior-scoring.v1`, `AiDecision` (audit), Command Layer
  como único writer (`conversation.behavior.commands.ts`), stale/fingerprint/lock.
- **Participant Selection (Fase A)**: `conversation.response-engine.ts` com sinais BASE_PRESENCE,
  DIRECT_MENTION, RECENTLY_SPOKE, RELATIONSHIP_SIGNAL, DEPTH_PENALTY, SEEDED_VARIATION (SHA-256),
  SOCIAL_BASELINE e REDUNDANT_RESPONSE; `planResponseWindow`/energy em `conversation.energy.ts`;
  `simulateConversationTurn` com fase inicial + fase de reação e stop reasons ricos
  (NORMALIZADO na Fase 2.2: API 237/237).
- **Contexto estruturado**: BehaviorContext (V4.0) e `generation.assembly.ts` montam o contexto;
  regra pt-BR global (Fase 1).
- **Relacionamento (parcial Fase C)**: `Relationship` simétrico com `dimensions Json` + histórico
  `RelationshipChange`; `relationship.rules.ts`/`relationship.evolution.ts`.
- **Memória (parcial Fase D)**: `Memory` com `importance`, `source`, `context Json?`, `emotionalImpact Int?`,
  `participants` via `MemoryCharacter`, `experienceId`, `eventId`, `derivedKey`; retrieval determinístico
  `memory.retrieval.ts` + `memory.policy.ts`; PILOT EXPERIENCE integra eventos.
- **Personalidade (parcial Fase C)**: `PersonaTrait` com `context` ON_TRACK/OFF_TRACK e enrichment
  exclusivo de PUBLIC_PERSONALITY (V3.24.5).
- **Emoção (dados primitivos)**: `Memory.emotionalImpact Int?`; `events` com impacto; nenhum estado
  emocional corrente por personagem.
- **Iniciativa/Eventos (parcial Fases G)**: autonomia V4.7 (`autonomy.service.ts`, modos OFF/OBSERVER/
  GUIDED/FULL, budgets, fairness, dry-run) e `world-simulation.tick.ts` + `race-consequences.service.ts`
  (eventos → memória/goal/decisão).
- **Observabilidade (parcial)**: `getDecisionTrace`, `getSimulationTrace`, `getUniverseActivity`,
  `getUniverseMetrics`.
- **UI**: header com + Adicionar/Editar, lista, composer único, speaker colors determinísticos
  (FNV-1a → paleta de 15) aplicados só ao nome, typing multi-speaker vindo de `/simulate-turn/plan`.

## 2. Parcialmente implementado
- **Fase B — conversa reativa curta**: a fase de reação já existe, mas não há fragmentação
  (1 speaker → N mensagens curtas), nem contrato de tamanho por intenção, nem anti-monólogo.
- **Fase C — voz**: personalidade existe como traits; não existe contrato de voz
  (verbosity, directness, humor, emoji tendency, punctuation, affection, teasing, interruption).
- **Fase D — memória**: Memory + retrieval existem; não há classificação explícita
  short/episodic/long nem callbacks/inside jokes como conceito de primeira classe
  (podem ser derivados de `memoryType`/`importance`/`context`).
- **Fase G — iniciativa**: autonomia e reações a eventos existem; reagir dentro da conversa
  (novo evento → oportunidade de fala) ainda não é um trigger de conversa.
- **Fase I — knowledge asymmetry**: retrieval filtra por participante (via MemoryCharacter),
  o que já impede vazamento parcial; não há scopes explícitos (PUBLIC/GROUP/PARTICIPANTS/PRIVATE/
  CHARACTER_ONLY) nem garantia de isolamento por Conversation (Memory não tem conversationId).

## 3. Ausente
- **Fase E — estado emocional corrente** (happiness/anger/stress/excitement/affection/sadness/
  embarrassment; delta, decay, caps, fingerprint).
- **Fase F — Topic Manager** (tópico atual, subassuntos, tópicos recentes/retomáveis, mudanças).
- **Fase H — timing/microcomportamentos** (não simular lote; separar timestamp canônico de typing;
  reações ❤️😂😭😡👍 sem virar Message obrigatória).
- Fragmentação de mensagens e anti-generic-response como comportamento do engine.

## 4. Precisa ser corrigido
- `Message.contextJson` existe mas não é usado para: responseType, fragmentIndex, reaction,
  topicTag — usar antes de criar schema.
- Retrieval de memória não recebe a Conversation como filtro; garantir que memória de outra
  Conversation não entre no contexto (teste obrigatório A↔B).
- `/simulate-turn/plan` precisa continuar batendo com a execução (typing); se fragmentação
  entrar, o contrato de progresso precisa refletir N mensagens por speaker.

## 5. Precisa evoluir
- Participant Selector: incorporar emoção, tópico e memória como sinais (hoje: menção,
  relationship, depth, social, redundância, jitter).
- Response Generator: contrato de tamanho/intenção + fragmentação + proibição de exposition.
- Context Analyzer: derivar tópico/emoção por leitura determinística do histórico recente.

## 6. Entidades reutilizáveis
- `Conversation`, `ConversationParticipant`, `Message.contextJson` (metadata).
- `BehaviorContext`, `AiDecision.metadata`, Command Layer, triggers existentes.
- `Relationship`/`RelationshipChange`, `Memory`/`MemoryCharacter`/`PilotExperience`,
  `PersonaTrait`, `CharacterGoal`, `CharacterAvailability`/`CharacterSchedule`, `WorldState`,
  `Event`/`TimelineEvent`, autonomia V4.7, observability V4.8.
- `conversation.energy.ts` / `conversation.response-engine.ts` / `conversation.simulation.ts`.

## 7. Migrations realmente necessárias (avaliar por fase)
- **Nenhuma** para Fases A, B, F, H (derivável/`contextJson`/runtime).
- **Fase E**: persistir emoção só se for exigido decay/continuidade cross-conversation;
  alternativa derivável de Memory.emotionalImpact + RelationshipChange + eventos recentes
  (preferir derivado; sem migration na primeira iteração).
- **Fase I**: se `Memory.participants` + convenção de `context.scope` cobrirem o isolamento,
  não criar tabela; migration apenas se provar vazamento impossível de resolver por filtro.
- Qualquer migration futura deve ser aditiva e aplicada em DEV (read-only) + TEST, como V4.

## 8. Riscos
- Regressão de zero-resposta (2.1) se novos sinais empurrarem thresholds acima do teto alcançável.
- Fragmentação multiplicar Message por turno: estourar `CONVERSATION_MAX_AI_MESSAGES` e budgets;
  precisa contar fragmentos no budget.
- Emoção/tópico via LLM = não determinístico; devem ser derivados por engine, LLM só formula.
- Memória vazando entre conversas/universos; retrieval precisa filtro de participantes da conversa.
- Typing preso se execução falhar depois do plano; limpar em todos os caminhos.
- Não duplicar writers (Command Layer continua único writer de Message).
- Timing real: UI atual não agenda mensagens; documentar e não falsificar timestamps.

## 9. Ordem final de implementação
1. **Fase A** (quase completa): fechar lacunas de seleção com testes de não-FIFO e relevância.
2. **Fase B** (maior valor imediato): contrato de tamanho/intenção, fragmentação, anti-monólogo,
   anti-generic, A→B→A e reação a reação; typing por speaker+fragmento.
3. **Fase C**: contrato de voz derivado de `PersonaTrait`; relação modulando voz.
4. **Fase D**: escopo de conversa no retrieval + callbacks/inside jokes via Memory.
5. **Fase E**: estado emocional derivado (sem schema na 1ª iteração), aparecendo na forma da fala.
6. **Fase F**: Topic Manager determinístico derivado do histórico recente.
7. **Fase G**: trigger "evento → oportunidade de conversa" reutilizando autonomia V4.7 (sem loop novo).
8. **Fase H**: microcomportamentos + separação timestamp canônico vs visual.
9. **Fase I**: scopes explícitos + teste de isolamento A↔B.

Cada fase exige auditoria própria antes da implementação (seção 71), suíte completa API/Web,
typecheck/lint/build e QA manual no navegador — a Fase 2.2 mostrou que calibrar sem reproduzir
causa regressão silenciosa.
