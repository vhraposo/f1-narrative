# Dialogue Engine — F5

## Estado
- Branch `v4-Living-F1-Universe`; HEAD inicial da execução F5.4: `91d319e`.
- Commits F5: F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 (este commit).
- Nenhum commit anterior reescrito; sem amend.

## F5.1 — Emotion Context
`conversation.dialogue-emotion.ts`: `DialogueEmotionContextSchema` (tone na taxonomia do plano —
NEUTRAL/PLAYFUL/TENSE/AFFECTIVE/SAD/EXCITED, intensity 0..1, sourceSignals ≤4) e
`deriveDialogueEmotion({ energy, affinity, recentMessages })` — determinístico, `null` sem sinais,
per-speaker via afinidade. Integrado ao `DialogueRealizerContext.emotion`.

## F5.2 — Topic Context
`conversation.dialogue-topic.ts`: `DialogueTopicContextSchema` (topicTag limitado, confidence,
previousTopic, changed, sourceSignals ≤4) e `deriveDialogueTopic({ messages, previousTopic })` —
lexical determinístico, `null` sem sinais. Integrado como `topicContext`.

## F5.3 — Conversation-Scoped Memory
`conversation.dialogue-memory.ts`: `DialogueMemoryContextSchema` (itens ≤3: memoryId/summary/
relevance/scope) e `buildDialogueMemoryContext` (cap 3 alinhado ao `memorySummaries` existente,
summary ≤120 chars, scope CHARACTER/SHARED). Reutiliza `retrieveRelevantMemories`, que já filtra
por `participants.some.characterId` e Universe. Integrado como `memoryContext` + `memorySummaries`.

## F5.4 — Knowledge Asymmetry + buildDialogueContext
`conversation.dialogue-context.ts`:
- `DialogueKnowledgeContextSchema`: `knownFacts` ≤3, `publicFacts` ≤3, `source: "MEMORY_SCOPE"`.
- `buildDialogueKnowledgeContext({ universeId, memories })`: fatos derivados apenas das memórias já
  autorizadas ao personagem pelo retrieval; exclui LOW, vazias e `universeId` divergente (defesa em
  profundidade). `publicFacts` permanece vazio por ausência de fonte confiável de fatos globais por
  personagem — limitação registrada, sem regra inventada.
- `DialogueRelationshipContextSchema` (`affinity`, `closeness` CLOSE/NEUTRAL/DISTANT) derivado de
  sinais já existentes.
- `DialogueContextSchema` + `buildDialogueContext`: composição por speaker de emotion + topic +
  memory + knowledge + relationship, bounded e determinística.
- Integração: `simulation.ts` monta `buildDialogueContext` por speaker (uma retrieval por
  speaker/turno, `referenceDate` determinístico) e entrega `knowledgeContext` (e as demais seções)
  ao `DialogueRealizerContext`.

## Isolamento / privacidade
- Memória privada: retrieval filtra por participante do personagem (testado em TEST DB na F5.3).
- Universe: retrieval filtra universe/global; knowledge builder rejeita `universeId` divergente
  (F5-E08).
- Conversation: contexto é montado por speaker a partir das mensagens da conversa corrente.
- User/Character: sem canal novo; nenhuma decisão delegada ao LLM.
- Nenhum secret/credential entra no contexto; allowlist do provider mantém as chaves fixas
  (teste de allowlist atualizado para emotion/topicContext/memoryContext/knowledgeContext).

## Budgets
- emotion: 1 tom + ≤4 sinais; topic: 1 tag + ≤4 sinais; memory: ≤3 itens (≤120 chars cada);
  knowledge: ≤3 fatos (≤120 chars cada); relationship: 2 campos; recentMessages: ≤3.
- Contexto não cresce com o histórico da conversa.

## Testes
- F5.1 +8, F5.2 +8, F5.3 +7 unit +2 TEST DB, F5.4 +9 (F5-E01..E08 + bounded/replay/schema).
- Conversation suite: **360/360** (24 arquivos). `tsc` limpo; eslint conversation 0 erros.
- TEST DB usado para isolamento (cleanup em afterAll); DEV somente leitura.

## Classificação
- IMPLEMENTADO: emotion, topic, memory escopada, knowledge asymmetry, buildDialogueContext por
  speaker, integração ao pipeline.
- MEDIDO: suite 360/360, tsc, lint, isolamento real em TEST DB (F5.3), evals F5-E01..E08 unit.
- NÃO MEDIDO: full API/build desta execução (orçamento); naturalidade subjetiva; latência de
  assembly; benchmark LLM (provider real ausente).
- PENDENTE: F6 (initiative/events/reactions), F7 (private groups/secrets), F8 (UI/microbehaviors),
  F9 (benchmark gate); `publicFacts` global; evals end-to-end adicionais.

## Limitações
- `publicFacts` vazio por design (sem fonte confiável por personagem).
- Eval F5-E04 verifica igualdade/vazio, não conteúdo público.
- Sem migration nova; `contextJson` existente segue suficiente.
