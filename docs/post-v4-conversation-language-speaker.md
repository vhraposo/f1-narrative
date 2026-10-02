# Post-V4 — Fase 1: Language (pt-BR) & Speaker Identity

## Auditoria

- `generation.assembly.ts` não possuía **nenhuma** instrução de idioma no system prompt
  (`GLOBAL_RULES_TEXT`), permitindo que o provider respondesse no idioma da persona/biografia/
  contexto (italiano/inglês). O fallback determinístico já era pt-BR
  (`behavior.language.ts`, `conversation.autonomous.ts`).
- `message-bubble.tsx` usava `text-brand` fixo para todos os nomes de AI — sem identidade visual
  por speaker.

## Decisões

- Idioma é contrato global de geração (não por persona): regra explícita em `GLOBAL_RULES_TEXT`
  ("escreva exclusivamente em português do Brasil (pt-BR); exceção: citações literais do contexto").
- Turno autônomo reforça o contrato no `userPrompt` ("Responda exclusivamente em português do
  Brasil (pt-BR)"), cobrindo providers que priorizam o prompt do usuário.
- Cor de speaker é derivada determinística de `characterId` (FNV-1a → paleta fixa de 15 tons
  legíveis em dark mode), nunca de índice de mensagem/ordem/random; sem characterId → `text-brand`.
  Cor aplicada somente ao nome (e ícone) do AI — não ao texto da mensagem; o usuário mantém o
  tratamento atual.

## Mudanças

- `apps/api/src/modules/generation/generation.assembly.ts` — regra de idioma no global rules.
- `apps/api/src/modules/conversation/conversation.autonomous.ts` — locale explícito no prompt do
  turno.
- `apps/web/src/lib/speaker-color.ts` (+ teste) — paleta e hash determinístico.
- `apps/web/src/components/conversations/message-bubble.tsx` — nome do speaker com a cor própria.
- `apps/api/src/modules/conversation/conversation.autonomous.test.ts` — teste 12: instrução pt-BR
  chega ao provider (captura de systemPrompt/userPrompt).

## Testes

- API: conversation+generation 661/661 (inclui o novo teste de idioma e o fallback pt-BR já coberto).
- Web: speaker-color 4/4 + conversations 39/39.
- Regressões: nenhuma (GLOBAL_RULES é texto instrucional; contratos estruturais preservados).

## Limitações / próximas fases

- Detector automático de idioma não foi adicionado (contrato explícito + testes determinísticos
  cobrem o fluxo; heurística frágil evitada).
- Cores por proximidade/colisão de hash usam módulo simples; distribuição é estável e suficiente
  para o grid atual (15 slots).
- Fases 2–8 (response selection engine, personality/social voice, memória, emoção/tópico,
  iniciativa, knowledge asymmetry, polish) permanecem pendentes nesta sessão — a ordem e a
  arquitetura estão registradas no diagnóstico consolidado.
