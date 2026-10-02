# Dialogue Engine — F0 + F1 (determinístico, sem LLM)

Base: 3f6b4d4 (branch v4-Living-F1-Universe). F2 (planner LLM), F3 (realizer),
F4+ (validator de saída, contexto rico, benchmark) NÃO foram implementados.

## F0 — Evaluation harness
- Dataset/harness: `apps/api/src/modules/conversation/conversation.dialogue-evals.test.ts`
  (14 testes, puro, sem DB e sem provider).
- Cenários cobertos (propriedades comportamentais, não texto exato): S01 greeting,
  S02 direct mention, S03 group question, S04 emotional, S05 joke, S06 callback,
  S07 topic shift, S08 private knowledge, além de invariantes (USER fora, indisponível,
  replyTo desconhecido, budget, fallback, STOP, determinismo, contratos Zod).
- Execução: `npx vitest run src/modules/conversation` (padrão do projeto).
- Resultado do baseline desta fundação: suíte de conversa 251/251 (14 arquivos),
  incluindo os 14 evals novos; conversa API anterior 237/237 permanece verde.
- Limitação honesta: o harness é unit-level (candidate set sintético). Fixtures com
  DB/relacionamentos/memórias reais e comparação CURRENT vs PLANNER ficam para F2
  (benchmark), como previsto no replan.

## F1 — Contratos e fundação do diálogo
- `apps/api/src/modules/conversation/conversation.dialogue.ts`:
  - `DialoguePlanSchema` (conversationIntent, topic, emotionalTone, turns,
    continuation, stopReason) e `DialogueTurnSchema` (speaker, replyTo, intent,
    maxMessages 1..3, priority).
  - `DialogueUtteranceSchema` e `MessageDialogueMetadataSchema`
    (responseType, replyToMessageId, fragmentIndex, topicTag) — runtime Zod, sem Prisma enum.
  - `DialogueCandidateSet` + `buildDialogueCandidateSet` (eligibility, opportunity,
    score, reasons, allowedIntents, recentActivity).
  - `DialoguePlanner` (interface) + `DeterministicDialoguePlanner` (kind "deterministic";
    não gera texto; deriva intent/replyTo/maxMessages/continuation/stop;
    STOP possível mesmo com candidatos).
  - `validateDialoguePlan` (participants/AI/eligible/available/replyTo/budget/ceiling/
    duplicados/maxMessages) e `buildFallbackPlan` (fallback seguro, PLANNER_DECLINED).
- Integração: `conversation.simulation.ts` agora produz `dialogue` (plano validado ou
  fallback) e `candidates` dentro de `SimulationPlan`, e `planned` é derivado dos turnos
  do plano. Gatilho do plano = última mensagem do usuário quando é do mesmo instante
  (ou mais nova) que a última IA, eliminando empate de timestamp.
- `energy`/`score`/`window` continuam existindo como sinais, prioridade e fallback —
  deixaram de ser a representação completa da seleção.
- Sem migration; sem LLM; sem novo provider. `Message.contextJson` permanece o lugar
  previsto para replyTo/intent/fragment — o contrato existe, mas a persistência
  end-to-end será ligada em F3, quando o Realizer produzir utterances.

## Observability
`/simulate-turn/plan` e `/simulate-turn` agora devolvem `dialogue` (plano com intents,
replyTo, continuation, stopReason) e `candidates`, permitindo inspecionar a decisão.
Trace completo (planner→validator→mensagens→continuation) evolui em F4.

## Testes / QA
- `npx tsc --noEmit`: limpo.
- `npx eslint src/modules/conversation --max-warnings=0`: limpo.
- Conversa API: 251/251. Build não re-executado nesta rodada (sem mudança de Web/deps).
- QA DEV: nenhuma escrita em DEV. QA TEST: os testes usam TEST DB descartável.
- Manual no navegador: pendente para F2/F3 (o comportamento textual não muda nesta fase,
  por design).

## Caminho para F2
1. Estender o harness com fixtures DB (`conversation-evals/`) e comparar
   CURRENT vs DETERMINISTIC PLANNER com as propriedades já definidas.
2. `DialoguePlanner` LLM atrás de `DIALOGUE_PLANNER=off|deterministic|llm` (default
   determinístico), com structured output e validator reutilizado.
3. Modelos/providers configuráveis; nenhum hardcode; custo medido antes de habilitar.

## Limitações declaradas
- Naturalidade textual não é resolvida aqui (F3).
- replyTo ainda não é persistido em `Message.contextJson` (contrato pronto).
- Tópico é derivado lexicalmente via `topicTag` provisório ("race"/null); Topic Manager
  completo é F5.
