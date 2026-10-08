# Dialogue Engine — F22.3 (Dialogue Acts, Response Strategy & Conversational Guardrails)

## F22.3 — COMPLETE — RESPONSE STRATEGY + VALIDATOR HARDENING

## 1. Auditoria / estado inicial
- Git: HEAD `65825d5` (F22.2); tree limpo; origin sincronizado; sem push/merge/rebase/reset/amend.
- Fluxo: planner (`conversation.dialogue.ts`) decide intent/speaker/replyTo; `simulateConversationTurn`
  monta contexto por speaker (F5), chama realizer, `validateDialogueOutput`, domain gate, Command
  Layer. `validateDialogueOutput` já cobria JSON no início, META, genérico, monólogo, duplicata
  imediata e pergunta obrigatória de QUESTION.
- Lacunas confirmadas pelo A/B F22.2: eco do replyTo, artefato estrutural no meio do texto
  (`']}…`), emoji degenerado, tom de assistente, action claim, nome alucinado, question overuse.

## 2. Intents atuais (12) — semântica e política
| Intent | Objetivo | questionMode | echoMode | lengthMode | Observações |
|---|---|---|---|---|---|
| ANSWER | responder a mensagem | OPTIONAL | FORBIDDEN | SHORT/NORMAL | não inventar ação externa |
| QUESTION | perguntar | REQUIRED | LIMITED | SHORT/NORMAL | pergunta é o objetivo |
| REACTION | reagir | OPTIONAL | FORBIDDEN | SHORT | não ecoar; reação curta |
| JOKE | contribuição humorística | FORBIDDEN | FORBIDDEN | NORMAL | sem explicação; sem pergunta |
| TEASE | provocar | OPTIONAL | FORBIDDEN | SHORT/NORMAL | tom conforme relação |
| SUPPORT | apoiar | OPTIONAL | FORBIDDEN | EXPANSIVE* | sem tom terapêutico |
| DISAGREE | discordar | OPTIONAL | FORBIDDEN | EXPANSIVE* | discordância explícita |
| FOLLOW_UP | continuar | REQUIRED | LIMITED | SHORT/NORMAL | |
| TOPIC_CHANGE | mudar de assunto | FORBIDDEN | FORBIDDEN | NORMAL | |
| INTERRUPTION | interromper | FORBIDDEN | LIMITED | SHORT | |
| CALLBACK | retomar algo | FORBIDDEN | FORBIDDEN | EXPANSIVE* | |
| SILENCE | não falar | FORBIDDEN | FORBIDDEN | — | sem texto |
`*` quando `voice.verbosity ≥ 0.6`. Estratégia determinística por intent + tom + voz + tamanho do reply.

## 3. Response strategy (efêmera, determinística)
- `conversation.dialogue-strategy.ts`: `deriveDialogueResponseStrategy({ intent, emotionTone, voice,
  replyToContent })` → `{ questionMode, echoMode, emojiMode, lengthMode, nameMode: KNOWN_ONLY,
  actionClaimMode: FORBIDDEN }`. Mesma entrada ⇒ mesma estratégia; **não persistida** (sem
  schema/migration/metadata obrigatório).
- Entra no contrato do realizer (`strategy`) e é honrada pelo determinístico (questionMode
  FORBIDDEN filtra perguntas do pool; emojiMode OFF suprime emoji; lengthMode SHORT prefere frase
  curta) — os dois realizers recebem o mesmo contrato (sem `LLMResponseStrategy`).

## 4. Speaker perspective / name grounding
- Contexto ganhou `interlocutorName` (nome canônico de quem falou) e o prompt separa
  `PERSONAGEM` / `INTERLOCUTOR`, com regra explícita "use apenas os nomes fornecidos; nunca invente
  nomes". Efeito real no A/B: "kimim" (F22.2) desapareceu; vocativos corretos ("Oi Kimi").
- Não foi criada projeção egocêntrica completa (F22.4/F22.5): o realizer recebe recentes + reply
  target já existentes; nenhum estado novo.

## 5. Guardrails determinísticos (nova camada)
`conversation.dialogue-naturalness.ts` — `validateConversationNaturalness({ text, replyToContent,
emotionTone, emojiAllowed, questionMode })` → violações:
- `ECHO_OF_INTERLOCUTOR`: maior sequência de tokens compartilhada ≥ max(4, 60% dos tokens do
  reply) e reply com ≥6 tokens — aceita respostas curtas ("vou", "sim, amanhã").
- `STRUCTURAL_LEAKAGE`: `{`/`}` no texto, `]`/`}` no início, `"messages":`, fence ```, rótulos
  `Assistant:/Speaker:/Resposta:`.
- `EMOJI_DEGENERATION`: >3 emojis, emoji-only, emoji em SAD/TENSE ou com emoji desabilitado.
- `ASSISTANT_TONE`: padrões conservadores observados ("estou aqui para ajudar", "como posso
  ajudar", "posso ajudar", "quer algo para te ajudar").
- `ACTION_CLAIM`: `(vou|vamos|devemos|devo|deixa eu) + verificar/checar/pesquisar/buscar/consultar/
  confirmar`; `verificar/checar/consultar + sistema/app/site/previsão/agenda/tv`; `estou/tô vendo o
  tempo/previsão/internet`.
- `QUESTION_NOT_ALLOWED`: `?` quando `questionMode = FORBIDDEN`.
- Integração: `simulateConversationTurn` valida output + naturalness; qualquer violação → fallback
  determinístico (mesma barreira do F22.2); LLM continua fora de transação (F15).

## 6. Prompt do LLM (reestruturado)
Ordem speaker-centric: PERSONAGEM → INTERLOCUTOR → INTENÇÃO → COMO RESPONDER (echo/length/emoji/
ação) → tom/tópico/afinidade/voz → recentes → reply → memórias → limite; sistema reforça nomes
conhecidos, proibição de ações externas e contrato JSON. **Lição medida**: incluir orientação sobre
pergunta no prompt **aumentou** a taxa de perguntas com `llama3.2` (16%→43%→73% conforme a
redação); a linha de pergunta foi removida do prompt e a política ficou no guard determinístico.

## 7. Testes
- Novos: `conversation.dialogue-strategy.test.ts` (8: modos, determinismo, realizer honrando) e
  `conversation.dialogue-naturalness.test.ts` (7: echo pass/fail, estrutural, emoji, assistente,
  action, question policy).
- Atualizados: allowlist do contexto do provider (+`strategy`, +`interlocutorName`); prompt test.
- Foco realizer/strategy/naturalness/ollama/human-quality: 67/67 (antes das últimas guardas) e
  28/28 no recorte final; API full **216 files / 2996 tests — 100% verde**; tsc/ESLint verdes.

## 8. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. A/B real (30 cenários, `llama3.2`, 1 amostra)
Progressão medida (LLM):
| Métrica | F22.2 (25 cen.) | F22.3 iter. final (30 cen.) |
|---|---|---|
| structural leakage | 1 caso | 0 |
| emoji degenerado | 1 caso | 0 |
| nome alucinado | "kimim" | 0 (nome correto) |
| duplicate of reply | 8% | 3,3% (acks curtos aceitáveis: "oi", "kkk") |
| question rate | 16% | 23% (sem guidance de pergunta; 43–73% quando o prompt citava pergunta) |
| generic rate | 0% | 0% |
| fallback (realizer) | 0% | 6,7% (2/30, variação do modelo) |
| guard rate (produção) | — | 6,7% (2/30 → fallback determinístico por QUESTION_NOT_ALLOWED) |
| avg chars / latência | 49 / 1068ms | 36 / 765ms |
Determinístico: guard rate 0, comportamento inalterado, ~0ms.
Remanescente honesto: action claim mutou ("estou vendo o tempo na internet" — agora coberto pela
guarda) e tom de assistente mutou ("posso ajudar com algo?" — agora coberto); respostas ainda
podem soar genéricas/estranhas (modelo 3B); pergunta continua acima do baseline.

## 10. Performance / banco / segurança
- Guard é função pura barata; 0 queries/retrieval/LLM extras; LLM 1 chamada/turno. Sem migration;
  nada persistido (estratégia efêmera). DEV intocado. F9/F11/F12/F14/F15 preservados; LLM sem
  autoridade de domínio.

## 11. Flakes
Nenhum flake novo; full 100% verde nesta execução.

## 12. Limitações / achados honestos
- `llama3.2` 3B é sensível ao prompt e fraco em coerência (saídas estranhas); A/B de 1 amostra por
  cenário não permite afirmar ganho de "humanidade" — só reduções observáveis de artefatos.
- Question overuse não foi reduzido; a estratégia só enforça FORBIDDEN.
- Multi-turn eval (§45) não implementado nesta subfase; persona drift fica para F22.5/F22.8.
- Guardas são conservadoras por design; novas mutações exigirão novos padrões/testes.

## 13. Decisões
- Camada mínima: 6 campos de estratégia justificados por falhas reais; nada de 40 acts.
- Política de pergunta no código (guard), não no prompt.
- Fallback determinístico como reparo (sem segundo LLM); strategy efêmera; determinismo preservado.
- LLM continua **não promovido**.

## 14. Próximo passo
F22.4 — context/memory optimization (curadoria; usar topic/memory/knowledge com parcimônia),
seguido de F22.5 persona/relationship e F22.8 avaliação multi-turn/multi-sample. Reavaliar LLM
depois.
