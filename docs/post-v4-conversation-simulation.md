# Pós-V4 — Simulação de conversa com Energy/Response Window (Fase 2.1)

## Problema corrigido
A Fase 2 tratava participação como uma fila: `simulateConversationTurn` selecionava 1 falante por vez
até `CONVERSATION_SIM_MAX_DEPTH`, então Kimi → Max → Leclerc respondiam em sequência mesmo quando
a mensagem só justificava uma reação. Não havia noção de energia da mensagem, janela de resposta,
reação ou redundância.

## Modelo
`conversation.energy.ts` (puro, determinístico):
- `evaluateConversationEnergy({ message, participantCount, recentAiMessages })` produz
  `{ energy, intensity, level, reasons }` com sinais lexicais: pergunta, mensagem longa/curta,
  alta intensidade (raiva/euforia/risada/caps), tópico F1, saudação, atividade recente.
- Níveis: `QUIET | NORMAL | ACTIVE | HIGHLY_ACTIVE`.
- `planResponseWindow(energy, { budgetRemaining })` deriva um `ResponseWindow`:
  `maxInitialResponders`, `maxReactions`, `maxChainDepth`, thresholds de score
  (`stopThresholds.initial/reaction`), `reactionAllowance` e `reasonCodes`.
  A janela é um **teto + threshold**, nunca uma contagem fixa; o orçamento de turno continua
  limitando tudo.

## Seleção
`selectResponseCandidates` ganhou `recentAiContents`: respostas com sobreposição de tokens ≥ 0.6
e sem menção direta levam `-30` e `REDUNDANT_RESPONSE`. O score base permanece seeded
(SHA-256 por universo:conversa:personagem:mensagem:data:profundidade), sem FIFO.

`simulateConversationTurn`:
1. Chama `getSimulationPlan` (energia + janela + seleção inicial ranqueada por score).
2. Gera os falantes iniciais **na ordem do score**, um a um, sempre relendo a conversa — cada
   resposta seguinte enxerga as anteriores.
3. Fase de reação: só entram personagens que ainda não falaram, com threshold maior
   (`stopThresholds.reaction`), respeitando `maxReactions`.
4. Stop reasons ricos: `NO_MESSAGES`, `NO_OPPORTUNITY`, `NATURAL_END`, `REDUNDANT_RESPONSE`,
   `DEPTH_LIMIT`, `BUDGET_LIMIT`, `CONVERSATION_INACTIVE`, além do reason do turno.

## API
- `POST /api/conversations/:id/simulate-turn/plan` — retorna `energy`, `window`, `planned[]`
  (characterId, name, score, opportunity, reasons) e `stopReason`, sem gerar mensagens.
- `POST /api/conversations/:id/simulate-turn` — executa o plano e devolve `plan`, `steps`,
  `selection` (traces da fase de reação) e `stopReason`.
- `POST /api/conversations/:id/autonomous-turn` — inalterado; `forceSpeakerCharacterId` continua
  interno para automação AI↔AI.

## UI
O composer chama primeiro o endpoint de plano e usa `plan.planned` como a **lista real de quem vai
digitar**; o indicador mostra:
- 1 falante: `X está digitando…`
- 2: `X e Y estão digitando…`
- 3+: `Várias pessoas estão digitando…`

O estado é transitório (não persistido) e é limpo em sucesso, falha, aborto e unmount;
`role="status"` + `aria-live="polite"`.

## Testes
- `conversation.energy.test.ts`: níveis, intensidade, thresholds, teto de orçamento.
- `conversation.autonomous.test.ts` (13/13): plano inicial, menção direta, stop reason.
- Suíte de conversa API: 232/232. Web conversas + speaker-color: 43/43.

## Pendências honestas
- Typing cobre os falantes do plano inicial; participantes que entram na fase de reação não
  aparecem no indicador (o plano é determinístico e pré-gerado).
- Fases 3–8 (personalidade/social voice, memória, emoção+tópico, iniciativa+reações,
  knowledge asymmetry, polish de UI) permanecem pendentes.

## Fase 2.2 — correção da regressão de zero resposta

Root cause: com `bom dia`, o score máximo possível era `BASE_PRESENCE 10 + jitter ≤14 = 24`,
e o threshold QUIET era exatamente 24 (NORMAL 21). Na prática só o jitter máximo passava, então
o plano saía vazio no caso comum e a fase de reação (threshold 30) nunca iniciava. A penalidade
de redundância também comparava a fala da IA com a mensagem do usuário e podia zerar todos os
candidatos.

Correções:
- `BASE_PRESENCE` 10 → 20; novo sinal `SOCIAL_BASELINE (+12)` para saudações, perguntas e
  chamados ao grupo ("gente", "vocês", "alguém", "?").
- Thresholds recalibrados: QUIET 31, NORMAL 28, ACTIVE 24, HIGHLY_ACTIVE 20; reação = inicial + 6.
- `REDUNDANT_RESPONSE (-24)` agora só penaliza o **autor** de mensagem recente de IA com overlap
  ≥ 0.6 com a última mensagem; não zera mais todos.
- `selectResponseCandidates` respeita `maxResponders = 0` (antes forçava no mínimo 1).
- Energia: base 0.15 → 0.3; saudação soma +0.1. "bom dia" agora é NORMAL com baseline social.

Evidência: `conversation.simulation-baseline.test.ts` reproduziu a regressão (simulate retornava
200/executed:false) e valida A–G: bom dia gera 1–2 candidatos, menção direta seleciona o citado,
pergunta ao grupo abre múltiplos, execução cria mensagens AI, personagem OFFLINE fica em silêncio.
Suíte de conversa: 237/237. Módulos relacionados (behavior/autonomy/observability/pilot-knowledge):
207/207.
