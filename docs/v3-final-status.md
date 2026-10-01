# V3 — Final Status (após V3.20)

> **V3 COMPLETE — READY FOR V4.** V4 não iniciada. HEAD de referência: `21cfe1e` + commit final desta fase.

## 1. Ambiente

| Item | Estado |
|---|---|
| DEV `f1-narrative` | **sincronizado**: 35 migrations / 73 tabelas; dados idênticos ao snapshot pré-migração (17 users, 17 universes, 55 characters, 2 seasons, 23 races, 286 results, 23 standings, 2 timeline events, 53 external drivers, 330 external results, 15 conversations); backup físico em `pg_dump` antes da migração |
| TEST `f1_narrative_test` | 35 migrations / 73 tabelas; pós-suíte: **0 users, 0 universes, 0 órfãos** (memories/experiences/evolutions/timeline/snapshots/knowledge) |
| Política | `docs/v3-development-environment.md` (quando migrations entram no DEV, como verificar, como migrar, drift, governança ADMIN, higiene) |
| Drift conhecido | índice único `Season(universeId, year)` ausente + nome truncado de índice `ExternalBindingDriverSeason` (pré-V3, não afeta features) |

## 2. Matriz de fases

| Fase | Status | Destaques de teste | Limitações |
|---|---|---|---|
| V3.14 Persona Foundation | ✅ DONE | módulo persona 302/302 (rules/service/routes/evidence/e2e), generation-persona | ADMIN review é governança de evidência (não editor de Universe); traits canônicos fixos |
| V3.15 Historical Timeline | ✅ DONE | timeline 94/94, correções/preview/apply/stale, campeões, divergência | kinds unsupported v1 (troca de piloto/equipe, void) |
| V3.16 Historical Timeline Editor | ✅ DONE | editor 6/6 + view 9/9, `PREVIEW_STALE` | sem editor para kinds informativos |
| V3.17 Pilot Knowledge | ✅ DONE | 101/101 em pilot-knowledge/context, providers com fixtures, refresh/status | refresh de persona é ingestão explícita; live sources opt-in |
| V3.18 Experience/Memory/Evolution | ✅ DONE | 45/45 pilot-experience + resolver/generation, correção→invalidação, evolução baseline+Σ | 5 regras/6 traits; relationship dimensions sem mutação automática |
| V3.19 Stabilization/Audit | ✅ DONE | 2434 API/477 Web; fixes C-1/H-1/H-2/H-3/E-1/F-2..F-6; higiene de 32→0 órfãos | F-7 (gate ADMIN recompute) adiado; L-1..L-4 backlog |
| V3.20 Completion/Readiness | ✅ DONE | DEV migrado (8 migrations aditivas, dados intactos); strict schemas + teardown global; QA final ×2 | ver §3 |

## 3. Classificação final de limitações (FASE 18)

| Item | Classificação | Justificativa |
|---|---|---|
| Mais regras de evolução de Persona | **V4** | V3.18 entregou as 5 regras planejadas; expansão é produto novo |
| POV histórico avançado (evitar contaminação futura com janelas temporais) | **V4** | filtro simples por tópico atende o declarado; simulação histórica é feature nova |
| Promoção de trait externo → CharacterPersona | **V3 OPTIONAL** | permitido via fluxo `PersonaEvidence` + review (manual); promoção automática é V4 |
| Cleanup sistêmico dos módulos legados (perf/attr/rel/auth/…) | **V3 REQUIRED (atendido)** | teardown global TEST-only + fix do maior ofensor (`relationship.test.ts`); correção arquivo-a-arquivo fica como higiene contínua |
| Gate ADMIN no `POST /timeline/recompute` | **V4 / WONT-FIX v3** | rota é owner-only e Universe-scoped; recompute global não existe (FASE 3 auditado) |
| ADMIN review de evidência sem escopo de universe | **KNOWN LIMITATION (documentada)** | governança de evidência auditada (`reviewedBy/At`), limitada à persona da própria proposta; sem mutação arbitrária (FASE 4) |
| Refresh ADMIN+ownership (admin não opera outro tenant) | **KNOWN LIMITATION (documentada)** | least privilege deliberado; refresh só toca External Knowledge (FASE 6) |
| Schemas strict em rotas legadas restantes (GETs/listagens) | **V3 OPTIONAL / FUTURE** | mutações mais sensíveis endurecidas na V3.20; GETs sem risco de mutação |
| Drift pré-existente `Season` unique index | **KNOWN LIMITATION** | igual em DEV/TEST; correção exige migration dedicada (não bloqueia features V3) |
| Flake `external-page.integration.test.tsx` | **KNOWN FLAKE (não mascarado)** | arquivo intocado desde `70eb2a6`; passa isolado (21/21) e em execuções limpas consecutivas |
| Second provider de persona / voice cloning / psicologia | **WONT-FIX / NOT-NEEDED** | proibido por política (privacidade/segurança psicológica) |

## 4. QA final (V3.20)

| Verificação | Resultado |
|---|---|
| API completa | **2434/2434** (155 arquivos) ×2 consecutivas, resíduo 0 após cada |
| Web completa | **477/477** (62 arquivos) ×2 consecutivas |
| Typecheck / Lint / Build | 0 em API e Web |
| DEV | migrado e íntegro (35/73; contagens idênticas; backup disponível) |
| TEST | limpo (0 resíduos em todas as tabelas de fixture) |
| External | intocado (0 knowledge sources/runs de piloto) |
| Segurança V3.19 | regressões verdes (C-1/H-1/H-2/H-3/F-5 herdadas nas suítes) |
| Evolução | revogação por invalidação e MANUAL>DERIVED cobertos; reconcile idempotente |

## 5. Declaração

Não há itens CRITICAL/HIGH abertos. Migrations sincronizadas. Ambiente operável. Limitações explícitas classificadas. **V3 COMPLETE — READY FOR V4.** V4 não iniciada.
