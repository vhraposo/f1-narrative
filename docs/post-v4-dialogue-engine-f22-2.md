# Dialogue Engine — F22.2 (Controlled LLM Realizer & Human Conversation A/B)

## F22.2 — COMPLETE — CONTROLLED LLM REALIZER (experimental; NÃO promovido)

## 1. Objetivo
Ligar o `LlmDialogueRealizer` existente atrás de flag, com provider existente, fallback, trace e
segurança de fronteiras, e responder empiricamente se o LLM melhora a realização sem destruir as
garantias F3–F21. A/B real executado com Ollama local (`llama3.2`).

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `795faf7` (F22.1); working tree limpo; origin sincronizado;
  sem push/merge/rebase/reset/amend. DEV read-only. Ollama local ativo (`/api/tags` 200;
  `llama3.2:latest`).

## 3. Arquitetura antes → depois
- Antes: `simulateConversationTurn` chamava `createDialogueRealizer(resolveDialogueRealizerKind())`
  **sem provider** → `DIALOGUE_REALIZER=llm` nunca usava LLM (caía no determinístico).
- Depois: mesmo pipeline (planner → contexto → realizer → `validateDialogueOutput` → domain gate →
  Command Layer → Message). Só a resolução do realizer mudou: `DIALOGUE_REALIZER=llm` +
  `OLLAMA_MODEL` configurado → `LlmDialogueRealizer` sobre o endpoint Ollama existente; ausente →
  determinístico. Opção injetável `dialogueRealizer` para testes.
- **Contrato estreitado**: o engine decide speaker/intent/replyTo/limites; o LLM devolve apenas
  wording (`{"messages":[...]}`) e o adapter recompõe `DialogueUtterance` com os campos do engine.
  `validateRealizerResult` continua validando schema/speaker/intent/replyTo/fragmentos.
- **Trace**: `DialogueRealizer.lastTrace?` + `realizerLanguageMetadata`; a simulação propaga
  provider/model/fallback para `runAutonomousConversationTurn` (`language`), que os grava em
  `contextJson.language`/metadata da decisão. No caminho determinístico nada muda
  (`provider="dialogue-realizer"`, contrato F11 preservado).
- **LLM fora de transação**: realiza antes do domain gate/Command Layer (F15 preservado).

## 4. Provider / modelo
- Reutiliza o endpoint OpenAI-compatible do projeto (`ollamaChatCompletionsUrl`,
  `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`) e a classe `OllamaProviderError`; nenhum
  SDK/provider novo. Request: `stream:false`, `response_format:{type:"json_object"}`, timeout via
  AbortController.
- Modelo do A/B: `llama3.2` (local, já instalado). Script permite `OLLAMA_MODEL`/timeout por env.

## 5. Prompt / output contract
- Prompt em seções (personagem, intenção, tom emocional, tópico, afinidade, voz, mensagens
  recentes, mensagem a responder, memórias disponíveis, limite). **Sem IDs internos, sem secrets,
  sem metadados de persistência**; fronteira explícita "use só o que está nas mensagens/tom/
  memórias; não invente fatos".
- Alta orientação comportamental (não recontar, não validar tudo, não terminar sempre com
  pergunta, sem emojis por padrão, sem tom de assistente) sem regra negativa infinita.
- Output: JSON `{"messages":["..."]}` (1–N fragmentos, ≤ `maxMessages`, ≤400 chars por fragmento);
  normalização aceita string ou `{text}`; inválido/vazio → erro tipado → fallback.

## 6. Fallback / trace
- Falhas (rede, timeout, HTTP, JSON inválido, conteúdo ausente, schema/speaker/intent/replyTo
  inválidos) → fallback determinístico com `RealizerTrace{valid:false, fallback:true,
  invalidReason}`; nunca silencioso. Sucesso → `valid:true, fallback:false`.
- Mapeamento honesto: determinístico → `llmUsed=false` (domínio); LLM sucesso → provider/model
  reais e `fallback:false`; fallback → `fallback:true`.

## 7. Testes (stub, sem rede)
- `conversation.dialogue-realizer-ollama.test.ts` (+13): factory sem modelo → null; sucesso
  mesclando campos do engine; `maxMessages`; JSON inválido; HTTP 500; conteúdo vazio; timeout;
  prompt sem IDs/metadados com contrato JSON; fallback do `LlmDialogueRealizer`; metadados de
  linguagem; erro é `OllamaProviderError`.
- Foco: 3 files / 53 tests verdes. API full: **214 files / 2981 tests — 100% verde**.
  `tsc`/ESLint verdes. Web não alterada.

## 8. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. A/B real (25 cenários, mesmo contexto, Ollama `llama3.2`)
Comando: `npm run human-quality:ab` (artefatos em `%TEMP%/opencode/f22-2-ab/`: JSON + Markdown
para revisão humana). 1 amostra por cenário; sem LLM-as-judge.

| Métrica | deterministic | llm |
|---|---|---|
| avg chars / words | 15 / 3 | 49 / 9 |
| question rate | 8% | 16% |
| generic rate | 0% | 0% |
| emoji rate | 28% | 8% |
| duplicate of reply | 0% | **8%** |
| fallback rate | 0% | 0% |
| avg latency | ~0 ms | ~1068 ms |
| unique ratio | 88% | 100% |

Exemplos representativos (A = deterministic, B = LLM):
- emotion-sad: A "certo" / B "Puxa, o que foi? Perdi meu voo 🤦" (**ecoou o interlocutor**).
- emotion-tense: A "Vai dar certo." / B "E aí, o que está causando esse tensão? Estou aqui para
  ajudar, hein! 🤗" (**tom de assistente**).
- memory-relevant: A "ué 😂" / B "Vamos marcar um café, eu estou livre na quinta-feira."
  (**melhor uso de contexto**).
- intent-disagree: A "Discordo, mas tudo bem." / B "não acho que seja melhor largar isso, tem
  alguma explicação que eu não esteja entendendo" (**mais específico**).
- length-long: B "oi kimim, o que aconteceu no fim de semana?" (**alucinou nome**).
- memory-emotional: B degenerou em despejo de emojis e fragmento JSON-like `']}😊...`.
- intent-joke: B não entregou piada; intent-answer: B inventou ação ("vou verificar na previsão").

## 10. Dimensões de qualidade (leitura honesta)
- Ganhos: context relevance, memory appropriateness (casos simples), variação (unique 100%),
  emotional fit em SAD.
- Regressões/riscos: persona fidelity e interlocutor adaptation fracos (nome alucinado, genérico),
  dialogue-act fit fraco (JOKE), assistant/therapist tone, echo do interlocutor (8%), degeneração
  de emoji, invenção de ações, latência ~1s, respostas ~3× mais longas.
- **Lacuna de validação encontrada**: `validateDialogueOutput` não bloqueia eco do `replyTo` nem
  despejo de emojis/JSON-like; hoje isso não afeta o determinístico, mas é barreira necessária
  antes de promover LLM (registrado para F22.3/hardening).

## 11. Segurança / privacidade / performance
- LLM sem autoridade de domínio; sem IDs/secrets no prompt; sem log de prompt; sem persistência de
  prompt/output/score (artefatos fora do banco). 1 chamada LLM por turno, sem judge/repair no
  caminho. Determinístico permanece default.

## 12. Banco
Nenhuma migration/schema; DEV intocado; nada de avaliação persistido.

## 13. Flakes
Nenhum nesta subfase.

## 14. Decisão (Resultado B/C)
**Não promover o LLM.** A integração está completa e segura atrás da flag, mas a evidência real
mostra falhas sérias (eco, tom de assistente, alucinação, degeneração) contra ganhos parciais.
`DIALOGUE_REALIZER=deterministic` continua default e íntegro; `llm` fica como modo experimental
documentado.

## 15. Próximo passo (roadmap ajustado)
1. **F22.3** — dialogue acts/response strategy (ataque aos "AI tells" no planejamento, não só no
   prompt; inclui hardening do validator para eco/emoji/JSON-like quando LLM estiver ativo).
2. F22.4 — context/memory optimization (memory/topic/knowledge no realizer; curadoria).
3. F22.5 — persona/relationship adaptation (eixos de persona; interlocutor; combate à alucinação
   de nome).
4. F22.6 — naturalness/diversity; F22.7 proactivity; F22.8 avaliação humana expandida
   (multi-sample, golden/negative examples).
Reavaliar promoção do LLM após F22.3–F22.5 com A/B repetido.
