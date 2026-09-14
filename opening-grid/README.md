# Opening Grid — Feed curado e versionado

## Por que existe `OPENING_GRID_SOURCE`

O espelho da Jolpica (via `/constructors` e `/drivers` da temporada) lista apenas
**participantes** de cada temporada — não distingue titulares de reservas nem
declara o grid de abertura. O Opening Grid é uma fonte separada, com claims
explícitos (`RACE_SEAT`/`RESERVE`), que o `OpeningGridResolver` combina com os
participantes da fonte primária por **`externalId`** (nunca por nome/TLA).

## Origem do feed

Este feed é curado manualmente a partir do documento oficial da FIA:

- **Documento:** "2026 FIA Formula One World Championship Entry List"
- **Data de referência:** 2025-12-19 (publicação; arquivado em 2026-01-01)
- **Estrutura:** `{ year, teams[] }`, validado por `openingGridEntryListSeasonSchema`
  (schema existente do módulo `opening-grid`), sem campos novos.

O arquivo `2026.json` é a primeira versão curada. Anos futuros seguem `2027.json`.
Correções factuais são registradas em novas versões; nunca se altera um ano
histórico silenciosamente.

## Identidades

Os `externalId` de pilotos e equipes usam os identificadores estáveis do espelho
Jolpica (ex.: `max_verstappen`, `rb`), conferidos contra o mirror local. O mapeamento
não assume que TLA ou nome equivalem ao `externalId` da Jolpica.

## Servindo o feed

O dev server expõe `GET /opening-grid/:year/opening-grid.json`, compatível com o
padrão de URL do `OpeningGridClient` (`{baseUrl}{year}/opening-grid.json`). O DEV
não está configurado para ingerir o feed (nenhuma `OPENING_GRID_BASE_URL` em `.env`):
a ingestão é validada apenas no banco de TEST.

## Limitações

- **`seat` sempre `null`:** a Entry List de abertura não ordena carros em assento
  1/2 de forma confiável; titulares sem assento declarado são tratados como
  `RACE_SEAT` pelo resolver.
- **Sem reservas no feed:** reservas de abertura são conhecidas por fontes
  secundárias (ex.: F1.com) e envolvem **afiliação multi-equipe** (ex.: Tsunoda em
  Red Bull e Racing Bulls). `validateOpeningGridPayload` rejeita reserva multi-equipe
  com `RESERVE_AFFILIATION_UNSUPPORTED`; essa capacidade é um STEP futuro
  (Reserve Affiliations), não um inventário aqui.

## Não implementado neste STEP

Parser de PDF, HTML scraper, Season Rollover, Reserve Affiliations, Roster
Management e simulação.