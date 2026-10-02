# Replanejamento do Dialogue Engine pós-V4
Base: 47a21a9 (branch v4-Living-F1-Universe). Data: 2026-10-02.
Este documento responde à especificação de replanejamento arquitetural. Nenhum código
de produção foi alterado. Benchmark de modelos/provider não foi executado nesta sessão
(sem acesso a providers no ambiente de teste); o protocolo de benchmark está definido
na seção 9 e deve ser rodado antes de habilitar o planner por padrão.

## 1. Estado atual
O Conversation Engine V4 + Fases 1/2/2.1/2.2 faz:
- Contexto derivado (`BehaviorContext`, `generation.assembly.ts`) montado por request.
- Seleção determinística de speaker (`conversation.response-engine.ts`): BASE_PRESENCE,
  DIRECT_MENTION, RECENTLY_SPOKE, RELATIONSHIP_SIGNAL, DEPTH_PENALTY, SOCIAL_BASELINE,
  REDUNDANT_RESPONSE, jitter SHA-256.
- Energy/intensity lexical e ResponseWindow por nível (`conversation.energy.ts`).
- Simulação com fase inicial + fase de reação e stop reasons (`conversation.simulation.ts`).
- Geração one-shot por speaker via `runAutonomousConversationTurn` (provider abstrato,
  fallback determinístico), persistida pelo Command Layer.
- Relationship/dimensions, Memory+retrieval, PersonaTrait, Goals, autonomia V4.7,
  world-simulation, observability V4.8, typing multi-speaker via `/simulate-turn/plan`.

## 2. Problema
O paradigma continua `selectSpeaker() → generateResponse()`. Cada speaker selecionado
produz **um bloco** com voz de coletiva de imprensa; a interação é: usuário pergunta,
N IAs respondem em sequência, cada uma ao usuário. Não existe: intenção de fala,
reply-to, fragmentos curtos, reação a reação, interrupção, conversa IA↔IA real,
continuidade de tópico, emoção corrente. Ajustar thresholds (2.1) produziu regressão
silenciosa (2.2), evidência de que a decisão está sendo tomada por uma fórmula frágil,
não por leitura da situação social.

## 3. Hipótese de causa
Faltam três coisas estruturais:
1. **Plano de diálogo** antes da geração: quem tem motivo, com que intenção, respondendo
   a quem, quantas mensagens, quando parar.
2. **Contrato de realização** por mensagem: intenção + voz + contexto autorizado, com
   política de brevidade e fragmentação.
3. **Reply-to** como relação de primeira classe (ainda que transitória em `contextJson`).

## 4. Alternativas consideradas
| Alternativa | Descrição | Naturalidade* | Controle | Custo/latência* | Determinismo | Testabilidade | Risco |
|---|---|---|---|---|---|---|---|
| A. Deterministic-only (atual) | score→threshold→speaker→LLM | Baixa | Alto | Baixo (1 call/speaker) | Alto | Alta | Médio: rigidez, regressões |
| B. LLM planner + validator | 1 call planeja, domain valida, realizer por speaker | Alta | Médio-alto | Médio (1+N calls) | Médio (seed + validador) | Média | Médio: planner inválido |
| C. Domain score + LLM suggestion | LLM sugere, domain re-pontua e seleciona | Média-alta | Alto | Médio | Alto | Alta | Baixo |
| D. Two-stage (director + realizer) | B com persistência de intenção por turno | Alta | Médio-alto | Médio | Médio | Média | Médio |
| E. Single LLM sequence | 1 call devolve toda a sequência | Média | Baixo | Baixo | Baixo | Baixa | Alto: lote artificial, sem reavaliação |
| F. Multi-agent (1 agente/personagem) | agentes independentes | Média | Muito baixo | Alto O(n²) | Baixo | Baixa | Muito alto: loops, spam, custo |
*Estimativa de design, não medida. Substituir por números do benchmark.

### Rejeições
- **E**: reproduz exatamente o sintoma atual ("lote de respostas"), não há reavaliação
  mensagem a mensagem nem interrupção; contexto cross-personagem pode vazar.
- **F**: 6 pilotos = 6 loops autônomos = custo, spam e coordenação impossível. O produto
  precisa de **um orquestrador de conversa**, não de agentes independentes.
- **A sozinha**: insuficiente — é a evidência empírica de 2.1/2.2.
- **B pura (LLM decide e domain só valida)**: o planner pode escolher bem, mas manter
  score/energy como *sugestão* para o domínio é mais barato e mais testável que dar
  autoridade total ao LLM.

## 5. Pesquisa externa
- **Structured Outputs**: OpenAI (Responses API, JSON Schema estrito) e Ollama
  (`format` com JSON Schema/Zod) suportam contrato estruturado. Isso permite um único
  `DialoguePlanSchema` portável entre provider local e hosted (fatos conforme docs
  citadas na especificação; verificar versão vigente no início do benchmark).
- **Modelos**: `gpt-oss:20b` e `gpt-oss:120b` (Ollama local, structured outputs) são
  candidatos para planner/realizer; modelos hosted ficam como tier para casos difíceis.
  Nenhum modelo é hardcoded; ambos os papéis recebem config (`DIALOGUE_PLANNER_MODEL`,
  `DIALOGUE_REALIZER_MODEL`) e fallback.
- **LangGraph**: oferece stateful workflow/persistence, mas o projeto já tem PostgreSQL,
  SimulationTick, Command Layer, idempotência/fingerprint, autonomia e observability.
  Adicionar LangGraph duplicaria orquestração e persistência sem resolver um problema
  que já não esteja resolvido. **Rejeitado** nesta fase (reavaliar somente se surgir
  workflow resumível de longa duração).
- **XState**: já avaliado na V4; estado de domínio fica no Postgres. **Rejeitado**.
- **DSPy**: útil para otimização/evals de programas LLM, mas é Python e o backend é
  TypeScript/Node. Introduzi-lo em produção cria custo operacional sem ganho comprovado.
  Fica como opção de laboratório offline, não adotada agora. **Rejeitado para produção**.

## 6. Decisão arquitetural
**Híbrido "Domain-orchestrated Planner + Realizer" (C+D), com o caminho
determinístico como guardrail e fallback.**

```
Conversation State (derivado)
        ↓
Context Assembly priorizado (cap por seção)
        ↓
Candidate Set + Opportunity (domain, determinístico)
        ↓
Dialogue Planner (LLM opcional, structured output)
        ↓  (proposta dentro dos candidatos)
Deterministic Validator (schema + ownership + budgets + stop)
        ↓
Dialogue Plan (intents, replyTo, maxMessages, continuation)
        ↓
Per-Speaker Context (voz + relação + memória autorizada + emoção + tópico)
        ↓
Response Realizer (1..N utterances curtas, pt-BR)
        ↓
Output Validator (anti-monólogo, anti-genérico, reply-to, brevidade)
        ↓
Command Layer → Message (+ contextJson: intent, replyTo, fragmentIndex, topicTag)
        ↓
Continuation Check (domain, barato) → Planner de novo ou Natural Stop
```

Princípios:
1. **Planner propõe, domínio decide.** O LLM só referencia IDs do candidate set;
   ID desconhecido/participante fora da conversa → reject e fallback.
2. **Realizer não decide nada**: recebe intenção, reply target, voz e contexto
   autorizado; só formula linguagem.
3. **Answer curto é default**; tamanho deriva da intenção (REACTION pode ser "KKKK",
   ANSWER uma linha, EXPLANATION excepcional).
4. **Fragmentação** permitida com validação (máx. de utterances, tamanho, duplicatas,
   budget — fragmentos contam no budget de mensagens da conversa).
5. **Reply-to em `Message.contextJson`** (`replyToMessageId`, `intent`, `fragmentIndex`,
   `topicTag`). Sem migration; grafo de diálogo derivado em read-time. Migrar só se
   consultas de grafo se tornarem um requisito de performance.
6. **Energy/score viram filtro e prioridade**, não a decisão final.
7. **Determinismo**: seed SHA-256 no fallback e nos desempates; planner é cacheável por
   idempotency key do turno.
8. **Custo**: 1 planner call por turno envelopes; 1 realizer call por speaker selecionado
   (≤ 3-4); nada de `calls = participantes × mensagens`.

## 7. Contratos (rascunho)
`DialoguePlanSchema` (Zod, runtime — sem Prisma enum):
```
{
  conversationIntent: "CONTINUE" | "CLOSE" | "SHIFT_TOPIC" | "REACT",
  topic: string | null,
  emotionalTone: "NEUTRAL" | "PLAYFUL" | "TENSE" | "AFFECTIVE" | "SAD" | "EXCITED",
  turns: [{
    speakerCharacterId: string,      // deve ∈ candidateSet
    replyToMessageId: string | null, // deve ∈ mensagens fornecidas
    intent: "ANSWER"|"QUESTION"|"REACTION"|"JOKE"|"TEASE"|"SUPPORT"|"DISAGREE"
          |"FOLLOW_UP"|"TOPIC_CHANGE"|"INTERRUPTION"|"CALLBACK"|"SILENCE",
    maxMessages: 1|2|3,
    priority: number                 // informativo; domínio re-pontua
  }],
  continuation: "RE_EVALUATE" | "STOP",
  stopReason: "NATURAL_END"|"NO_OPPORTUNITY"|"TOPIC_CLOSED"|"BUDGET"|"INACTIVE"|"PLANNER_DECLINED"
}
```
`DialogueUtteranceSchema`:
```
{ speakerCharacterId: string, replyToMessageId: string | null, intent: Intent,
  messages: [{ text: string, fragmentIndex: number }] }
```
Validação determinística:
- ids ∈ candidate set e ∈ Conversation; replyTo ∈ mensagens do contexto;
- `turns ≤ window.maxInitialResponders + window.maxReactions`;
- fragmentos ≤ budget restante; tamanho por intenção;
- USER nunca speaker; indisponível nunca speaker; Universe isolation;
- falha → descarta o plano e usa o caminho determinístico (nunca corrompe a conversa).

## 8. Respostas às 28 perguntas (síntese)
1–2. Response-engine e energy **permanecem**: viram filtro/prioridade e fallback.
3. Score determinístico não decide sozinho: prioriza candidatos; planner escolhe dentro.
4–7. LLM no planejamento é **opcional e estruturado**; separar Planner de Realizer.
8. Planner retorna speakers, intents, replyTo, maxMessages, continuation, stop.
9–12. LLM só referencia IDs fornecidos; output validado; fato fora do contexto não persiste.
13–14. Determinismo via seed/cache no fallback + validador; naturalidade vem da intenção
e da voz, não de aleatoriedade.
15–17. Anti-monólogo no output validator; brevidade por intenção; fragmentação validada.
18–20. Interrupção/reply-to/reação suportados pelo plano + `replyToMessageId` em contextJson.
21–22. Loops/stop: continuation domínio-driven com orçamento e stop reasons ricos.
23–27. Memory/Relationship/Emotion/Topic/Knowledge entram por contexto estruturado
autorizado (retrieval primeiro), nunca por dump no prompt.
28. Custo/latência: 1 planner + N realizers por envelope; model tiering e cache de
contexto estável; medição obrigatória antes de habilitar por padrão.

## 9. Benchmark (protocolo; não executado nesta sessão)
Dataset `conversation-evals/` com 15 cenários (bom dia, menção direta, nervosismo,
corrida, "fiz merda", risada, provocação, callback de memória, mudança de tópico,
segredo privado, 6+ participantes, usuário ausente, race consequence, discussão,
desculpas). Para cada arquitetura (A/B/C/D) e modelo/planner candidato:
propriedades comportamentais obrigatórias + rubrica 15 dimensões (0..5): relevance,
naturalness, brevity, voice, relationship, continuity, memory, topic, reaction,
selection, stop, non-redundancy, informality, pt-BR, isolation.
Métricas: validade estruturada, latência p50/p95, tokens, custo, nº de calls.
Nenhum resultado numérico é declarado aqui; sem execução não há avaliação de naturalidade.

## 10. Implementação proposta (fases)
- **F0 — Harness de evals + telemetria** (executável sem LLM; mede o baseline atual).
- **F1 — Contratos + validator + replyTo em contextJson** com **planner determinístico**
  (regras), mantendo comportamento atual; testes de propriedade.
- **F2 — Planner LLM atrás de flag** (`DIALOGUE_PLANNER=off|deterministic|llm`), structured
  output via provider abstraction; cache por idempotency key.
- **F3 — Realizer por speaker** com voz/intenção/brevidade/fragmentação; fallback curto.
- **F4 — Output validator + observability** (`getDialogueTrace`: estado→candidates→plano→
  validação→mensagens→continuation→stop).
- **F5 — Contexto rico**: emoção derivada (sem schema), tópico derivado, memória escopada
  à conversa; knowledge asymmetry por participante.
- **F6 — Benchmark + defaults** (model tiering, flags), QA manual no navegador.

## 11. Providers, models, libraries
- Providers: manter abstração atual; adicionar `DialoguePlannerProvider`/
  `DialogueRealizerProvider` ou parametrizar o `GenerationProvider` por `purpose`.
- Models: configuráveis, sem hardcode; candidatos locais gpt-oss:20b/120b; hosted como tier.
- Libraries: LangGraph/XState/DSPy rejeitados (seção 5) com justificativa.
- Structured outputs: JSON Schema/Zod compartilhado entre OpenAI Responses API e Ollama.

## 12. Impacto de migration, performance, custo, riscos
- **Migration**: nenhuma necessária (contextJson cobre intent/replyTo/fragmento/tópico).
- **Performance**: adiciona 1 planner call por envelope; realizers já existem. Medir.
- **Custo**: teto por turno (planner + ≤4 realizers); cache de persona/contexto.
- **Riscos**: planner inválido (fallback), fragmentos estourando budget, vazamento de
  conhecimento (validação por participante), regressão de seleção (manter os 237 testes
  de conversa verdes a cada fase).

## 13. Rollout
Default: `DIALOGUE_PLANNER=deterministic` (comportamento atual estável, 47a21a9).
Habilitar `llm` por flag/ambiente após F2+F3 com evals verdes; nenhum path LLM pode
persistir sem passar pelo Command Layer e pelos validadores.
