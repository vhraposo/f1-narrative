# Dialogue Engine — F3

## 1. Estado final
- Branch: `v4-Living-F1-Universe`.
- HEAD inicial da F3: `e9c04ce` (F2). HEAD inicial desta execução (F3.5): `b0f7b8b`.
- Commits: F3.1 `4363fe8`, F3.2 `8f9ad82`, F3.3 `05bf5ee`, F3.4 `b0f7b8b`, F3.5 (este commit).
- Nenhum commit anterior reescrito; sem amend.

## 2. Objetivo da F3
Transformar o plano de diálogo em fala curta, com voz, relacionamento, fragmentação e provider
opcional, integrada ao fluxo real (Command Layer), com replyTo real e AI→AI.

## 3. F3.1 — Realizer Contract
`conversation.dialogue-realizer.ts`: `DialogueRealizerContextSchema` (allowlist, pt-BR),
`DialogueRealizerProvider`, `DialogueRealizer`, `validateRealizerResult` (schema, speaker,
intent, replyTo, vazio, JSON, fragmentIndex, maxMessages). Reutiliza `DialogueUtteranceSchema`.

## 4. F3.2 — Deterministic Realizer
`DeterministicDialogueRealizer`: short-by-intent (`INTENT_REALIZATION_POLICY`), voz por
informalidade/emoji/warmth, relationship-aware (neutro ≤0.3, emoji liberado ≥0.7), fragmentação
(risada / duas frases, respeitando `maxMessages`), SILENCE sem texto, anti-generic, seed SHA-256.

## 5. F3.3 — Realizer Provider
`resolveDialogueRealizerKind` (`DIALOGUE_REALIZER=off|deterministic|llm`, default deterministic),
`LlmDialogueRealizer` com `RealizerTrace` e fallback para o determinístico em qualquer falha;
`createDialogueRealizer`. Nenhum provider LLM real configurado no ambiente.

## 6. F3.4 — Runtime Integration
- `BehaviorDialogueMetadata` persistida em `Message.contextJson.dialogue` pelo Command Layer.
- `conversation.autonomous.ts` aceita `textOverride` + `dialogue` e não chama geração quando o
  realizer fornece o texto.
- `simulateConversationTurn` monta per-speaker context, realiza, valida, persiste sequencialmente
  com replyTo real encadeado (turno N+1 → Message N; fragmento seguinte → fragmento anterior),
  SILENCE não cria Message, continuation/budget/window/stop respeitados.

## 7. F3.5 — Evaluation
Harness TEST: `conversation.dialogue-f3-evals.test.ts` (7 testes). Fixtures reproduzíveis
(Universe, WorldState 2026-10-01T12:00Z, USER Alicya, 6 AIs, Relationships, mensagens fixas),
cleanup completo, DEV intocado.

### Métricas reais (execução em TEST)
| Cenário | turns | msgs | replyTo | válidos | AI→AI | USER→AI | avg chars | max | stop |
|---|---|---|---|---|---|---|---|---|---|
| S01 greeting | 2 | 2 | 2 | 2 | 1 | 1 | 6 | 7 | DEPTH_LIMIT |
| S02 mention | 2 | 2 | 2 | 2 | 1 | 1 | 32 | 33 | DEPTH_LIMIT |
| S03 group | 2 | 2 | 2 | 2 | 1 | 1 | 27 | 29 | DEPTH_LIMIT |
| S05 joke | 4 | 4 | 4 | 4 | 3 | 1 | 13 | 15 | DEPTH_LIMIT |
| S10 seis IAs "oi" | 2 | 2 | 2 | 2 | 1 | 1 | 8 | 11 | DEPTH_LIMIT |
| F3-AI01 primeiro | 2 | 2 | 2 | 2 | 1 | 1 | 5 | 7 | DEPTH_LIMIT |
| F3-AI02 cadeia | 1 | 3 | 3 | 3 | 2 | 1 | 5 | 7 | NO_OPPORTUNITY |
| S14 replay | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | SELECTED |

Totais: 17 mensagens AI; replyTo 17/17 válidos (100%); AI→AI 10; USER→AI 7; fallback 0;
mensagens vazias 0; fragments 0 (planos com `maxMessages=1` nestes cenários); S10 "oi" com 6 IAs
produziu 2 mensagens (não escala com participant count); comprimentos 5–33 caracteres.

### CURRENT vs F3
A comparação estrutural da F2A (CURRENT = DETERMINISTIC = 22 speakers, 0 casos com todos) foi
preservada; a F3 adiciona o que o CURRENT não tinha: replyTo real persistido (17/17), cadeia
AI→AI (10 replies), falas curtas (máx. 33 chars) e metadata de intent. Não foi executado um
CURRENT side-by-side novo nesta subfase — limitação registrada.

## 8. Arquitetura
```
Dialogue Planner → Validator → Per-Speaker Context → Dialogue Realizer
→ Realizer Validation → Command Layer → Message → Continuation / Stop
```
Planner decide; Realizer escreve; domínio valida; Command Layer persiste.

## 9. QA
- TEST: fixtures + evals + integração; cleanup em afterAll.
- DEV: somente leitura, nenhuma escrita.
- Frontend: não alterado. Migrations: nenhuma.

## 10. Testes
- conversation suite: 310/310 antes da F3.5; com os 7 evals novos, suíte ampliada (ver relatório).
- Full API, typecheck, lint e build: executados no fechamento da F3.5 (números no relatório final).

## 11. Métricas
Ver seção 7. Todas obtidas por consulta real ao TEST DB e aos resultados de execução; nenhum
número estimado.

## 12. Limitações (IMPLEMENTADO / MEDIDO / NÃO MEDIDO / PENDENTE)
- IMPLEMENTADO: contrato, realizer determinístico curto, voz, relationship, fragmentação,
  provider+fallback, integração, replyTo real, AI→AI, SILENCE, continuation.
- MEDIDO: replyTo válido 100% (17/17), AI→AI 10, comprimentos 5–33, fallback 0, vazias 0,
  S10 sem escalar, replay determinístico.
- NÃO MEDIDO: naturalidade subjetiva (sem benchmark humano); fragmentos em produção (0 nos
  cenários); SILENCE/STOP/RE_EVALUATE end-to-end nos evals (cobertos por unidade/integração);
  benchmark LLM (provider real ausente — LLM benchmark: not executed); latência/custo LLM.
- PENDENTE: F4 (output validator avançado, trace completo), F5 (emoção/tópico/memória/
  knowledge asymmetry).

## 13. Próximos passos
F4/F5 conforme plano. Nenhuma alteração de arquitetura nesta fase.
