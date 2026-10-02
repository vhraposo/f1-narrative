# Post-V4 — Fase 2: Response Orchestration & Multi-Speaker Simulation

## Auditoria

- `planConversationTurn` selecionava 1 speaker (mention → próximo → ordem), com budgets de rodada.
- `runAutonomousConversationTurn` gerava/persistia 1 mensagem por chamada (Command Layer canônico).
- Não existia engine de oportunidade por participante, depth, reação encadeada nem stop natural
  (o único stop era o budget do plano).
- UI chamava `/autonomous-turn` (1 mensagem por envio).

## Arquitetura implementada (evolução, sem duplicar writers)

```
POST /messages (canônico)
→ POST /simulate-turn
   → selectResponseCandidates (puro, determinístico)
       candidatos: mention, recent-speaker penalty, relationship affinity,
       depth penalty, seeded variation (sha256), availability, already-responded
   → runAutonomousConversationTurn(forceSpeaker)   [por passo, sequencial]
       → BehaviorDecision(CONVERSATION_TURN_DUE) → Command → Message
   → reassemble contexto → reavalia → próximo passo (ou stop natural)
```

- `conversation.response-engine.ts` (puro): `selectResponseCandidates` com reasons auditáveis
  (DIRECT_MENTION, RECENTLY_SPOKE, RELATIONSHIP_SIGNAL, DEPTH_PENALTY, SEEDED_VARIATION,
  LOW_SCORE, UNAVAILABLE, ALREADY_RESPONDED) e `stopReason`.
- `conversation.simulation.ts`: `simulateConversationTurn` — 0..N passos sequenciais, reavaliando
  após **cada** mensagem; stop reasons naturais (`NO_RESPONSE_OPPORTUNITY`, `NATURAL_END`,
  `BUDGET_EXHAUSTED`, `NO_MESSAGES`, reason do passo). Budget de rodada reaproveitado
  (`maxAiTurnsPerRound`); depth máximo por env `CONVERSATION_SIM_MAX_DEPTH` (3).
- Determinismo: nenhuma aleatoriedade real — jitter por SHA-256 de
  `universeId:conversationId:characterId:lastMessageId:worldDate:depth` (mesma entrada → mesmo
  resultado). USER nunca é candidato; indisponível nunca responde.
- `conversation.autonomous.ts`: nova opção interna `forceSpeakerCharacterId` (usada apenas pela
  simulação) — o endpoint `/autonomous-turn` continua com o comportamento single-step para
  AI↔AI/autonomia.
- API: `POST /api/conversations/:id/simulate-turn` (owner) → `{ simulation: { executed, stopReason,
  depth, steps, selection } }`; seleção auditável para o trace.
- UI: composer passou a chamar `/simulate-turn` (0..N respostas, sequenciais; typing indicator
  cobre toda a geração); nenhum botão adicional; mensagem do usuário nunca é duplicada.

## Decisões

- Preservar `/autonomous-turn` intacto (V4.7 usa o passo único) e adicionar a simulação como camada
  acima — sem segundo writer de Message (todo passo usa o mesmo Command Layer).
- Escolher 1 speaker por passo e reavaliar (em vez de pré-selecionar N) para que o próximo speaker
  veja a mensagem real do anterior.
- Affinity derivada das `Relationship` existentes (affinity+trust normalizados); nenhuma persona
  duplicada.

## Testes

- API: `conversation.response-engine.test.ts` 7/7 (menção, USER excluído, indisponível, penalidade
  de último speaker, determinismo de seed, depth penalty, silêncio).
- API: `conversation.autonomous.test.ts` 13/13 (novo teste 13: mensagem do usuário com menção →
  `/simulate-turn` → 1..N passos sequenciais, todos AI, `DIRECT_MENTION` na seleção, stopReason,
  mensagens persistidas com characterId correto).
- Suíte conversation: 227/227. Web: 43/43 (composer/thread/integração migrados para `/simulate-turn`).

## Limitações / próximas fases

- Fases 3–8 pendentes nesta sessão: personality/social voice, memória conversacional profunda,
  emotional state + topic engine, initiative/reactions, knowledge asymmetry e polish final.
- Sem multi-mensagem por speaker neste passo (1 mensagem por passo; agrupamento visual já suporta
  consecutivas quando ocorrerem em passos seguidos).
- Avaliação qualitativa manual (seção 44 do briefing) não executada — não é possível declarar
  naturalidade A/B/C/D honestamente antes das camadas 3–5.
