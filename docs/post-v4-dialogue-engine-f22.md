# Dialogue Engine — F22 (Human Conversation Quality Program)

## F22 — PARTIALLY COMPLETE — F22.1 (baseline + realizer tone-aware)

## 1. Objetivo
Elevar a qualidade comportamental/linguística do diálogo ("parece humano") preservando a
arquitetura F3–F21: Dialogue Engine como autoridade, Command Layer como writer, determinismo onde
a correção importa, geração apenas onde a linguagem se beneficia de variação.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `e1c0ce2` (F21 concluída); working tree limpo; origin
  sincronizado; sem push/merge/rebase/reset/amend. DEV read-only; Docker/Postgres ativos.

## 3. Arquitetura atual (código real)
- Pipeline: `simulateConversationTurn` → `getSimulationPlan` → `runAutonomousConversationTurn`
  (planner → contexto por speaker → realizer → `validateDialogueOutput` → domain gate
  `CONVERSATION_TURN_DUE` → `executeBehaviorDecision` → `executeMessageCommand` → Message).
- `contentOverride` carrega o texto do realizer + metadados (`language.provider`); o Command Layer
  permanece o writer único (F11).
- Limites de turno em `conversation.policy.ts`; F9 benchmark como barreira.

## 4. Realizer atual (auditoria)
- `conversation.dialogue-realizer.ts`: `DeterministicDialogueRealizer` com **12 intents**
  (`ANSWER/QUESTION/REACTION/JOKE/TEASE/SUPPORT/DISAGREE/FOLLOW_UP/TOPIC_CHANGE/INTERRUPTION/
  CALLBACK/SILENCE`), pools de frases por intent (`INTENT_REALIZATION_POLICY`), `maxChars`,
  `fragmentsAllowed`.
- Seleção determinística: `seededIndex(sha256(speaker+intent+replyTo+recent+maxMessages))` +
  `voiceBucket(informality)`; sem RNG.
- Adaptações existentes: afinidade baixa (≤0.3) → `neutralPhrases`; `REACTION` respondendo a
  pergunta → `questionPhrases`; emoji condicionado a `emojiTendency`/afinidade (SUPPORT→❤️,
  JOKE/TEASE/REACTION→😂); fragmentação por risada/verbosity.
- **Gaps encontrados**: `emotion`, `topic`, `topicContext`, `memoryContext`, `knowledgeContext`,
  `memorySummaries` chegam ao contexto mas eram **ignorados** pelo realizer determinístico;
  interlocutor só via `relationshipAffinity`; sem anti-repetição explícita.
- `LlmDialogueRealizer` já existe: provider abstrato, `validateRealizerResult` (schema/speaker/
  intent/replyTo/empty/JSON/fragmentos), trace (latência/provider/model/fallback) e fallback
  determinístico. **Não está ligado**: `simulateConversationTurn` chama
  `createDialogueRealizer(resolveDialogueRealizerKind())` sem provider; `DIALOGUE_REALIZER` aceita
  `deterministic` (default), `off`, `llm`.
- Validator: `validateDialogueOutput` (F3) barra genérico (`GENERIC_TEXT`), repetição, etc.;
  independente do método de geração; Command Layer idem.

## 5. Context assembly / persona / interlocutor / emoção / relação / tópico / memória / conhecimento
- Contexto do realizer montado por `buildDialogueRealizerContext` a partir de: identidade do
  speaker (`speakerName`), `replyToContent`, `recentMessages` (≤6), `topic`/`topicContext` (F5),
  `emotion` (`deriveDialogueEmotion`: NEUTRAL/PLAYFUL/TENSE/AFFECTIVE/SAD/EXCITED + intensidade +
  sinais), `relationshipAffinity`, `memorySummaries`/`memoryContext`, `knowledgeContext` (F5),
  `voice` (informality/warmth/humor/emojiTendency/verbosity derivados da afinidade).
- F5 já garante knowledge asymmetry e memória por speaker; F12 garante disponibilidade efetiva.
- Persona hoje = `voice` + pools + seed; sem eixos explícitos de assertividade/humor/formalidade
  etc. (roadmap).

## 6. Implementação F22.1 (menor melhoria de maior impacto)
- **Tone-aware deterministic realizer** (`conversation.dialogue-realizer.ts`): novo
  `isLowEnergyTone(context)` (SAD/TENSE); `pickPhrase` passa a preferir `neutralPhrases` nesses
  tons (quando existirem); `applyVoice` suprime emoji em SAD/TENSE. Corrige o "tone-deaf"
  (ex.: "kkkk"/😂 em contexto triste/tenso) usando estado que já existia no contexto.
- **Baseline de qualidade determinístico** (`conversation.dialogue-human-quality.test.ts`, 7
  testes): question rate em banda explícita (perguntas vêm de QUESTION/FOLLOW_UP; INTERRUPTION
  nunca pergunta; taxa 10–50%), variância de tamanho entre intents (spread ≥20) e respeito a
  `maxChars`, diversidade entre seeds (≥3/6), diferenciação de persona (≥2/3 speakers), SAD/TENSE
  sem risada/emoji, nenhum texto genérico em 11 intents × 6 tons, replay determinístico.
- Sem novos templates, sem LLM, sem schema, sem comentários novos no código.

## 7. Testes / QA
- Foco: `dialogue-human-quality` 7/7; `dialogue-realizer` 32/32; folder `conversation`
  454/454 (um rerun; 1 falha transiente não reproduzida, classe histórica).
- API full: **213 files / 2968 tests — 100% verde**.
- `tsc --noEmit` verde; ESLint do escopo verde.
- Web não alterada (último checkpoint F20: 70/519 + tsc/lint/build).

## 8. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. Performance
Mudança é função pura sobre contexto já existente: **nenhuma query, retrieval ou chamada LLM
adicional**; sem aumento de latência mensurável no caminho determinístico.

## 10. Banco
Nenhuma migration/schema change; nenhum estado novo persistido (dialogue acts/estratégia ficam
efêmeros por design); DEV intocado.

## 11. Segurança
Nenhuma mudança de superfície: ACL/ownership/universo/audience/target e Command Layer intactos.
O LLM (quando ligado no futuro) não ganha autoridade sobre domínio/IDs/persistência; validação
estrutural permanece no código.

## 12. Flakes
1 falha transiente no folder `conversation` sob pressão, não reproduzida no rerun (454/454); full
100% verde; históricos documentados permanecem. Nenhuma regressão atribuída à F22.1.

## 13. Limitações
- O realizer determinístico continua baseado em pools; ganho é de adequação tonal, não de
  variedade linguística plena.
- `topic`/`memory`/`knowledge` ainda não influenciam a realização (roadmap).
- Sem métricas LLM-as-judge/golden conversations ainda (roadmap F22.8).
- LLM realizer existe mas não está ligado (decisão consciente).

## 14. Achados honestos
- O maior gap de "humanidade" não era falta de frases: era **estado ignorado** (emoção) e
  ausência de medição. A F22.1 ataca os dois sem inflar templates.
- O LLM realizer já está pronto e validado; falta decisão de produto/infra para ligá-lo
  (provider Ollama) e um eval que compare baseline vs candidato.
- `emotion` existia no contexto desde F5 e não era usado — corrigido com ~6 linhas.

## 15. Decisões arquiteturais
- Determinismo onde correção importa; geração futura só atrás de flag, com fallback.
- Nada de estado persistido novo para atos/estratégia; efêmero.
- Avaliação de humanidade separada do F9 (que continua barreira de segurança/consistência).
- Não religar streaming/LLM globalmente sem eval A/B.

## 16. Roadmap F22 (subfases futuras)
- F22.2 — LLM realizer wiring (Ollama via provider existente) atrás de `DIALOGUE_REALIZER=llm`,
  com fallback determinístico e trace; testes com provider stub (sem rede).
- F22.3 — Dialogue acts/response strategy (derivar ato + evitar "responde+pergunta" mecânico).
- F22.4 — Context/memory optimization (usar topic/memory/knowledge no realizer com curadoria).
- F22.5 — Persona/relationship adaptation (eixos de persona; interlocutor).
- F22.6 — Naturalness/diversity (anti-repetição de aberturas/estruturas; length calibration).
- F22.7 — Proactive conversation (iniciativa guiada por objetivo/contexto).
- F22.8 — Human conversation evaluation (golden conversations, métricas por dimensão, A/B
  baseline vs candidato, inspeção humana; sem LLM-as-judge como verdade absoluta).

## 17. Próximo passo
F22.2 (wiring do LLM realizer com provider existente + eval A/B baseline vs candidato), mantendo
determinismo da suíte padrão e F9/F11/F12/F14/F15 intactos.
