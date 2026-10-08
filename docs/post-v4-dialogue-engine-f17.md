# Dialogue Engine — F17 (Availability Open-Rule Consolidation)

## F17 — COMPLETE — SMALL CONSOLIDATION FIX

## 1. Objetivo
Fechar o cleanup registrado na F16: eliminar a duplicação do literal da regra de abertura de
disponibilidade (`AVAILABLE`/`RACE_WEEKEND`; sem registro = aberto), reusando a política canônica
`availability.policy` em `behavior.policy`/`behavior.scoring`. Sem mudança de comportamento.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `332395c` (F16 concluída); working tree limpo; 7 commits à
  frente de origin; sem push. DEV read-only; TEST para fixtures.

## 3. Arquitetura encontrada
- Regra canônica desde a F12 em `availability.policy.ts` (`isAvailabilityOpen`), usada por
  simulation/autonomous/turn-engine/world-sim.
- Duplicação residual do literal em:
  - `behavior.policy.ts` — `isAvailabilityOpen(context)` local (precondition `AVAILABILITY_OPEN`);
  - `behavior.scoring.ts` — `availabilityBonus` com o mesmo teste inline.
- Ambos operam sobre a view de contexto **já derivada** (F12); a duplicação era cosmética, sem
  divergência funcional (auditada na F16).

## 4. Decisão
**Opção A — pequena consolidação** (não é derivação nem correção de bug): extrair a regra pura
para `isOpenAvailabilityStatus(status)` e reusar nos três pontos, mantendo a semântica:
- `null`/`undefined` → aberto (política: sem registro = disponível);
- `AVAILABLE`/`RACE_WEEKEND` → aberto;
- demais → fechado.
Scoring mantém a regra própria de "sem registro = sem bônus" (checa presença antes).

## 5. Implementação
- `availability.policy.ts`: novo `isOpenAvailabilityStatus(status: string | null | undefined):
  boolean`; `isAvailabilityOpen` agora delega a ele (regra em um único lugar).
- `behavior.policy.ts`: remove a função local e usa `isOpenAvailabilityStatus(
  context.availability?.status)` na precondition `AVAILABILITY_OPEN`.
- `behavior.scoring.ts`: `availabilityBonus` usa `isOpenAvailabilityStatus` após checar
  `context.availability`.
- Nenhum schema/enum/migration; nenhum writer; nenhuma API.

## 6. Comportamento preservado
- `RACE_WEEKEND` continua aberto e com bônus; `OFFLINE`/`BUSY`/etc. continuam fechados e sem
  bônus; sem registro continua aberto na policy e sem bônus no scoring.
- Fingerprints de contexto/score não mudam (mesmos valores), então decisões e F9 permanecem
  idênticos.

## 7. Testes
- `availability.policy.test.ts` (+1): `isOpenAvailabilityStatus` (null/undefined/AVAILABLE/
  RACE_WEEKEND abertos; BUSY/TRAINING/TRAVELING/SLEEPING/OFFLINE fechados).
- `behavior.policy.test.ts` (+1): RACE_WEEKEND mantém `AVAILABILITY_OPEN` + bônus; OFFLINE falha
  a precondition e zera o bônus.
- Foco `availability + behavior`: **7 files / 68 tests** verdes.
- API full (3 execuções): apenas flakes históricos (ver §9); nenhuma falha atribuível à F17.
- Web: `tsc` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK (sem alteração web).

## 8. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. Flakes observados (por execução full)
- Run 1: `conversation.autonomous #13` + `pilot-knowledge.provision #4` — ambos passam isolados.
- Run 2: `race-weekend` (8) + `sprint-weekend` (1) — todos passam isolados (locks/TEST DB sob
  pressão).
- Run 3: `conversation.autonomous #13` + `pilot-knowledge.provision #4` — passam isolados.
- Isolado dos 4 arquivos: **45/45** verdes. Nenhum flake novo atribuído à F17 (mudança é de
  funções puras, sem DB).

## 10. Banco
Nenhuma migration/schema change; DEV intocado; TEST não necessário além da suíte.

## 11. Segurança
Nenhuma mudança de superfície: ACL/ownership/universo/audience e Command Layer intactos.

## 12. Limitações
- A suíte full não fechou 100% verde em nenhuma das 3 execuções por flakes históricos de TEST DB;
  a validação forte da F17 é o escopo afetado (68/68) + benchmark + web.
- Regra de abertura segue restrita a dois status; novos status exigirão atualizar apenas
  `isOpenAvailabilityStatus`.

## 13. Achados honestos
- A duplicação era real, mas sem impacto funcional — F17 é manutenção preventiva, não correção.
- A consolidação não altera scores/fingerprints; nenhuma decisão ou teste de comportamento mudou
  de resultado.
- O item de backlog da F16 foi o único acionável sem novos requisitos de produto/infra.

## 14. Decisões arquiteturais
- Regra de abertura em um único ponto (`isOpenAvailabilityStatus`); consumidores não repetem o
  literal.
- Não criar abstração nova além do helper puro; sem tocar no modelo de dados.

## 15. Próximo passo
Backlog restante: presença em tempo real (com requisito de UX), performance/virtualização,
secret guard e drift schema↔migrations. Streaming permanece não implementado (F13); F14–F16
auditados; F17 fecha o cleanup cosmético.
