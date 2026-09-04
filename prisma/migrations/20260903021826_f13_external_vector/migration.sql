-- Fase 13 STEP 7 — vector storage para ExternalChunk.
-- Garante que a extensão vector exista (reproduzível em banco limpo; a
-- extensão também é criada pela migration f13_external_storage_pgvector).
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "ExternalChunk" ADD COLUMN     "embeddedContentHash" TEXT,
ADD COLUMN     "embedding" vector(1024);

-- Sem índice vetorial (HNSW/IVFFlat) deliberadamente nesta fase: exact search
-- é suficiente para o volume inicial. (STEP posterior decide quando indexar.)

