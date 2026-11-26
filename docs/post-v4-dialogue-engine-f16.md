# Dialogue Engine — F16 (RACE_WEEKEND Derivation & World-State Authority Audit)

## F16 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED

## 1. Objetivo
Auditar a derivação e a autoridade de `RACE_WEEKEND`: verificar se já pode ser derivado do estado
existente, se está duplicado, se há autoridade incorreta ou inferência inconsistente — e se cabe
uma correção pequena. Sem criar entidade/enum/tabela/migration/evento/abstração nova.

## 2. Estado Git
- Branch `v4-Living-F1-Universe`; HEAD `ab6147a` (F15 concluída); working tree limpo; 6 commits à
  frente de origin; sem push. DEV read-only; TEST para fixtures.

## 3. O que RACE_WEEKEND significa (semântica real)
Há **dois conceitos distintos** que não devem ser confundidos:

1. **`RACE_WEEKEND` (disponibilidade)** — valor do enum `AvailabilityStatus`
   (`prisma/schema.prisma:136-144`), parte de `CharacterAvailability` (1:1, privada do dono):
   intenção declarada de que o personagem está em fim de semana de corrida e **permanece
   acessível** para interações. Escrita exclusivamente pelo dono via
   `PATCH /api/characters/:id/availability` (`availability.routes.ts`); nenhum código de produção
   a define automaticamente (grep de `characterAvailability.create/update/upsert` só encontra a
   rota e testes).
2. **Fim de semana de corrida (fase do mundo)** — `Race.status`
   (`UPCOMING → PRACTICE/SPRINT_QUALIFYING/SPRINT/QUALIFYING/RACE → FINISHED`,
   `schema.prisma:42-59`) + `WorldState.currentRaceId/currentSession`
   (`schema.prisma:1565-1581`), avançada por `race-weekend`/`world-progression`.

Fonte de verdade:
- fase do weekend → `Race.status` + `WorldState` (derivada; ver §5);
- disponibilidade → `CharacterAvailability` (intenção do dono) + janela `until` (derivação
  determinística da F12 em `availability.policy.ts`).

## 4. Onde RACE_WEEKEND aparece (inventário)
| Local | Papel | Deriva algo? |
|---|---|---|
| `prisma/schema.prisma` enum `AvailabilityStatus` + migration init | valor persistido | não |
| `availability.schema.ts` (zod) | validação do PATCH (dono) | não |
| `availability.policy.ts:55` (`isAvailabilityOpen`) | regra canônica: `AVAILABLE`/`RACE_WEEKEND` abertos (F12) | interpreta o status efetivo |
| `behavior.policy.ts:55` / `behavior.scoring.ts:213` | consumidores da view já derivada do contexto (domain gate + bonus) | não (leem `context.availability`) |
| `world-simulation.policy.ts` (`UNAVAILABLE_STATUSES = OFFLINE/SLEEPING`) | agenda de mundo considera RACE_WEEKEND implicitamente disponível | não |
| `apps/web/src/lib/availability.ts` | label "Fim de semana de corrida" no card do dono | não |
| `race-weekend` module + `lib/weekend.ts` + `HomeRaceWeekend`/`RaceWeekendDialog` | fase/sessões do weekend (outro domínio) | **sim, mas de `Race`/`RaceSessionResult`/`WorldState`** |

Não há duplicação da *derivação*: o enum é único; a regra de abertura foi centralizada na F12
(`availability.policy.isAvailabilityOpen`) e é consumida pelo planner/domain gate/world-sim; os
literais restantes em `behavior.policy`/`behavior.scoring` operam sobre a view efetiva já
derivada e são consistentes (duplicação cosmética da regra, sem divergência).

## 5. Autoridade da fase de weekend (confirmada no código)
- `race-weekend.service.runWeekendSession` (`race-weekend.service.ts:510-627`): valida ordem das
  sessões (`weekendSequenceFor`), exige predecessor, bloqueia FINISHED, transação com
  `pg_advisory_xact_lock('race-weekend:<raceId>')` + `lockUniverseTimeline`, grava
  `RaceSessionResult`/`RaceResult`, atualiza `Race.status`, chama `setWorldSession`
  (`:262-284`) e audita timeline (`SESSION_COMPLETED`); RACE chama `finalizeRaceInTx`.
- `championship-progression.finalizeRaceInTx` (`:16-35`): `Race.status = FINISHED`, status da
  Season, `WorldState.currentSession = null`.
- `world-progression.service.progressWorldState` (`:57-301`): transições `RACE_SELECTED`,
  `SESSION_ADVANCED`, `WEEKEND_FINALIZED`, `STALE_POINTER_CLEARED`; limpa `currentSession` em
  FINISHED (`:190-213`) e ponteiros órfãos.
- `calendar/next-race` + `HomeRaceWeekend`/`RaceWeekendDialog` consomem essa derivação para UI.
- `WorldState.currentDate` é o relógio do universo usado pelo engine (F5/F12); a fase de weekend
  não entra no Dialogue Engine (F3–F7 não injetam eventos/sessões no diálogo).

## 6. É correto derivar `RACE_WEEKEND` de `WorldState`/`Schedule`? (decisão)
**Não.** Auto-derivar exigiria uma de duas coisas, ambas incompatíveis com a arquitetura vigente:
1. **Segundo writer de `CharacterAvailability`** (world-sim/race-weekend setando `RACE_WEEKEND`
   para pilotos) — sobrescreveria a intenção do dono (ex.: `OFFLINE`/`SLEEPING`) e criaria novo
   acoplamento; violaria o modelo da F12 (registro = intenção; só a janela `until` é derivada).
2. **Derivação em tempo de leitura que sobrepõe a intenção** — mudaria regra de domínio
   (personagens ficariam "abertos" durante o weekend mesmo com `OFFLINE` explícito), alterando
   domain gate/planner sem requisito de produto.

Além disso, não há consumidor que precise disso: a fase de weekend já é derivada e usada onde
importa (UI/world progression/next-race), e a disponibilidade já modela "acessível no weekend"
como status do dono (aberto na regra canônica). `CharacterSchedule` é agenda manual materializada
em Events pelo world-sim — não é fonte de `RACE_WEEKEND` nem precisa ser.

## 7. Inconsistências encontradas
- Nenhuma divergência de regra entre os consumidores (todos tratam `RACE_WEEKEND` como aberto).
- Nenhuma inferência inconsistente de `Race.status`/`WorldState` (máquina de estados com lock,
  ordem validada e idempotência por timeline).
- Nenhum estado duplicado: fase do weekend e disponibilidade são domínios ortogonais.

## 8. Segurança
- `CharacterAvailability` continua privada do dono (404 para não-dono; sem admin); nenhum dado de
  terceiros exposto; nenhuma superfície nova.
- A fase de weekend já valida universo/ownership (`loadRace`, `RaceWeekendError` 403/404) e usa
  locks; nada alterado.

## 9. Implementação
Nenhuma. Sem arquivos de código alterados.

## 10. Testes
Nenhum teste novo (sem implementação). Cobertura existente relevante: `availability` (inclui
`RACE_WEEKEND` no PATCH e no policy test), `race-weekend` (lifecycle/sessões/locks/WorldState/
Next Race), `world-progression`, `behavior.policy` (disponibilidade no gate), F9/F12. Último
checkpoint de código permanece o da F14: API **212 files / 2959 tests** verdes; web 70/519 +
tsc/lint/build.

## 11. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12; thresholds intactos). Sem implementação,
não há "depois".

## 12. Banco
Nenhuma migration/schema change; DEV intocado; TEST não necessário nesta fase.

## 13. Flakes
Nenhum novo. Históricos documentados no HANDOFF permanecem; nenhum reproduzido.

## 14. Limitações
- Duplicação cosmética da regra de abertura (`behavior.policy`/`behavior.scoring` mantêm o
  literal `AVAILABLE`/`RACE_WEEKEND`); funcionalmente consistente. Reuso de
  `availability.policy.isAvailabilityOpen` nesses dois pontos é um cleanup opcional futuro (não
  é derivação nem corrige bug).
- `RACE_WEEKEND` continua manual por decisão: o dono pode não refletir o weekend real do universo
  (não há sincronização automática); é uma escolha de produto, não um gap de runtime.

## 15. Achados honestos
- O item de backlog "derivação automática de RACE_WEEKEND via WorldState/Schedule" partia de uma
  premissa incorreta: o mundo **já** deriva a fase de weekend; o que é manual é a *disponibilidade
  do personagem*, que por design pertence ao dono.
- Derivar automaticamente seria criar segundo writer/override de intenção — exatamente o tipo de
  dívida que F11–F15 vêm eliminando.
- A regra de abertura está centralizada desde a F12; o que resta é cosmético.

## 16. Decisões arquiteturais
- Manter separação: fase de weekend = `Race.status`/`WorldState`/`race-weekend`; disponibilidade =
  `CharacterAvailability` (intenção) + `until` (F12).
- Não derivar `RACE_WEEKEND` de `WorldState`/`Schedule`; não criar writer de availability.
- Não alterar schema/enum/migrations.
- Backlog: item de derivação automática **encerrado** (premissa incorreta); fica registrado apenas
  o cleanup cosmético opcional do open-rule.

## 17. Próximo passo
Backlog do HANDOFF: presença em tempo real (com requisito), performance/virtualização, secret
guard, drift schema↔migrations e (opcional) reuso cosmético do open-rule. Streaming permanece não
implementado (F13); CREATE_EVENT/SEND_MESSAGE auditados (F14/F15); RACE_WEEKEND auditado (F16).
