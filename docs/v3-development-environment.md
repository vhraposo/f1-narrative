# V3 — Development Environment Policy (DEV × TEST × migrations)

> Criado na V3.20 após a sincronização do DEV (27 → 35 migrations). Aplica-se a todo o monorepo.

## 1. Bancos

| Banco | Container | Uso | Política |
|---|---|---|---|
| `f1-narrative` (DEV) | `f1nw-postgres` | ambiente de desenvolvimento do usuário (Kiro/web/api em 3000/3001) | **persistente e protegido**; migrations oficiais podem ser aplicadas após auditoria; nunca reset/drop/seed destrutivo |
| `f1_narrative_test` (TEST) | `f1nw-postgres` | suítes Vitest (API/Web) | **descartável**; pode ser limpo/recriado a qualquer momento; QA termina limpo |

## 2. Quando migrations aprovadas entram no DEV

1. A migration nasce e é validada no TEST (`prisma migrate deploy` com `DATABASE_URL` do TEST).
2. A suíte completa passa 2× no mesmo TEST e o QA classifica o item como concluído.
3. Auditoria de segurança da migration no DEV: deve ser **aditiva/compatível** (CREATE TYPE/TABLE, ADD COLUMN com default, ADD VALUE, índices/FKs). DROP/DELETE/TRUNCATE/ALTER COLUMN/SET NOT NULL em tabela existente = **parada obrigatória** (revisão humana + plano).
4. Backup físico do DEV antes de aplicar (`pg_dump -Fc`) + snapshot de contagens (users/universes/characters/seasons/races/results/standings/timeline/snapshots/external).
5. Aplicação pelo mecanismo oficial: `$env:DATABASE_URL=<DEV>; npx prisma migrate deploy`.
6. Pós-checagem: `prisma migrate status` (up to date), contagens idênticas ao snapshot, `migrate diff` sem drift novo, smoke read-only das features afetadas.

## 3. Verificação de pending migrations

```
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/f1-narrative?schema=public'; npx prisma migrate status
```

`Database schema is up to date!` = sincronizado. Se aparecerem migrations pendentes que pertencem a uma feature já declarada DONE, isso é tratado como **bug de ambiente** (FASE 1 da V3.20), não como limitação aceitável.

## 4. Smoke read-only pós-migration (DEV)

- `prisma.characterPersona.findUnique` (caminho do antigo 503/P2021 da Persona).
- Contagens de tabelas novas (pilotExperience, personaTraitEvolution, externalDriverProfile, universeDriverRelationship).
- Leitura de personagem com `driverProfile` + `externalBinding`.
Nenhum script de smoke escreve no DEV.

## 5. Evitar schema drift

- Drift pré-existente conhecido (DEV e TEST, anterior à V3): índice único `Season(universeId, year)` ausente e nome truncado de índice em `ExternalBindingDriverSeason`. Não afeta features V3; correção só com migration dedicada aprovada.
- Regra: o schema Prisma é a fonte; qualquer diferença nova detectada por `prisma migrate diff` deve virar migration oficial (nunca `db push` em DEV).
- `prisma generate` após deploy (workflow seguro: `--no-engine` e depois normal).

## 6. Governança ADMIN (escopo)

- **Persona evidence review (ADMIN):** governança de evidência (aprovar/rejeitar) limitada à própria persona/proposta; audita `reviewedBy/reviewedAt`; não é editor genérico de Universe.
- **Pilot knowledge refresh (ADMIN + ownership):** o admin só atualiza External Knowledge do próprio universo; nunca escreve Universe override de terceiros; refresh jamais toca `CharacterPersona`/`Relationship`/`Memory`/Timeline.
- **Recompute da Timeline:** owner-only (`ensureUniverse`) e Universe-scoped; não existe recompute global nem bypass de ownership.
- ADMIN não possui superuser de mutação global.

## 7. TEST hygiene

- Suítes devem terminar com 0 users/universes/dados de fixture (helpers `test-utils/universe-cleanup.ts` e `test-utils/pilot-knowledge-cleanup.ts`).
- Módulos legados ainda podem deixar users/universes descartáveis (débito conhecido, corrigido por prioridade na V3.20); o TEST é recriável e o QA final o deixa limpo.
