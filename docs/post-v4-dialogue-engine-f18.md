# Dialogue Engine — F18 (Schema↔Migrations Drift Alignment)

## F18 — COMPLETE — MIGRATION DRIFT FIX

## 1. Objetivo
Fechar o item de infraestrutura do HANDOFF: alinhar `prisma/migrations` com
`prisma/schema.prisma` (drift documentado: `Conversation_status_idx`, unique
`Season(universeId, year)`, rename de índice). Sem tocar no DEV; TEST para aplicar/validar.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `763c1ee` (F17 concluída); working tree limpo; 9 commits à
  frente de origin; sem push.
- TEST: `postgresql://postgres:postgres@localhost:5432/f1_narrative_test` (URL local do
  `vitest.config.ts`); `prisma migrate status` → 46 migrations, "Database schema is up to date!".

## 3. Drift real (gerado com `prisma migrate diff --from-url TEST --to-schema-datamodel`, somente
leitura)
```sql
DROP INDEX "Conversation_status_idx";
CREATE UNIQUE INDEX "Season_universeId_year_key" ON "Season"("universeId", "year");
ALTER INDEX "ExternalBindingDriverSeason_universeId_externalDriverSeasonId_k"
  RENAME TO "ExternalBindingDriverSeason_universeId_externalDriverSeason_key";
```
- O índice `Conversation_status_idx` existe no histórico/DB mas não é declarado no schema atual
  (schema não tem `@@index` em `Conversation.status`).
- A unique `Season(universeId, year)` está no schema (linha 477) e nunca foi criada por migration.
- O índice de `ExternalBindingDriverSeason` foi truncado pelo Postgres (63 chars, `_k`) e o
  schema espera `_key`.

## 4. Decisão
**Opção A — alinhar migrations ao schema** (schema é a fonte de verdade). Migration aditiva
(1 drop de índice não declarado, 1 unique, 1 rename cosmético), aplicada apenas no TEST.
Pré-checagem de dados: zero duplicatas `(universeId, year)` em TEST (query somente leitura) —
seguro criar a unique.

## 5. Implementação
- `prisma/migrations/20261008210000_align_schema_migrations/migration.sql` com os 3 statements
  exatos do diff (sem comentários, sem edição de schema).
- Aplicação: `prisma migrate deploy` no TEST → 47 migrations, "All migrations have been
  successfully applied".
- Verificação: `prisma migrate diff --from-url TEST --to-schema-datamodel` →
  `-- This is an empty migration.`; `prisma migrate status` → up to date.
- Adaptação de teste: ver §7 (a unique expôs dependência do drift).

## 6. Impacto da unique `Season(universeId, year)`
- A constraint já estava no schema desde sempre, mas o TEST não a aplicava; agora o banco
  garante a invariante de domínio "uma temporada por ano por universo" (o serviço já a assumia).
- O guard `MULTIPLE_SEASONS_SAME_YEAR` (`universe-init.service.ts:397-403`) torna-se
  inalcançável com a constraint; foi **mantido como defesa em profundidade** (sem mudança de
  código de produção).
- O teste `universe-init.bootstrap` que criava uma 2ª temporada do mesmo ano passava **apenas por
  causa do drift**; foi adaptado para a garantia do banco (P2002), preservando o objetivo
  ("múltiplas temporadas do mesmo ano são impedidas"), sem remover cobertura de comportamento
  real (o cenário anterior era impossível pelo schema).

## 7. Testes
- `universe-init.bootstrap`: **16/16** (teste adaptado para P2002 + count 1).
- API full: **212 files / 2961 tests — 100% verde** (execução final).
- Web: `tsc` verde; **70 files / 519 tests** (sem alteração web).
- Typecheck API verde; ESLint do arquivo alterado verde.

## 8. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. Banco
- DEV: intocado (nenhum comando de escrita; nenhuma migration aplicada em DEV).
- TEST: migration aplicada e verificada; `migrate diff` vazio.
- Schema/enum: sem alteração.

## 10. Flakes
- Nenhum flake na execução final (100% verde). Flakes históricos de F17 não reproduziram.

## 11. Limitações
- `prisma migrate dev` continua interativo (infra conhecida); a migration foi criada a partir do
  `migrate diff` (sem `migrate dev`).
- O guard `MULTIPLE_SEASONS_SAME_YEAR` fica como código inalcançável enquanto a constraint
  existir (custo desprezível; documentado).
- O drop de `Conversation_status_idx` segue o schema; se o índice for desejado por performance,
  deve ser declarado no schema (fora do escopo).

## 12. Achados honestos
- O drift não era só cosmético: ele mascarava a invariante de domínio e permitia um estado que o
  schema sempre proibiu — um teste dependia disso.
- A correção alinhou repositório e banco sem alterar código de produção; o único ajuste de teste
  foi tornar explícita a garantia do banco.
- `prisma generate`/EPERM não se manifestou nesta fase.

## 13. Decisões arquiteturais
- Schema como fonte de verdade; migrations alinhadas e verificadas por `migrate diff` vazio.
- Não editar schema para acomodar o drift; não aplicar nada em DEV.
- Manter o guard defensivo; adaptar o teste ao invariante forte.

## 14. Próximo passo
Backlog restante: presença em tempo real (com requisito de UX), performance/virtualização e guarda
semântica de secret. Drift schema↔migrations **encerrado** (F18).
