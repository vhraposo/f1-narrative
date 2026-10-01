-- Migration aditiva: fundação de circuitos externos (V3 Fase 1).
-- Nenhuma operação destrutiva; não altera dados existentes.

-- 1) Enum de status de sincronização
CREATE TYPE "ExternalSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- 2) Circuito factual do espelho externo
CREATE TABLE "ExternalCircuit" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "locality" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lengthMeters" INTEGER,
    "turns" INTEGER,
    "direction" TEXT,
    "layoutKey" TEXT,
    "contentHash" TEXT NOT NULL,
    "sourceRecord" JSONB,
    "firstSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalCircuit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalCircuit_source_externalId_key" ON "ExternalCircuit"("source", "externalId");
CREATE INDEX "ExternalCircuit_source_name_idx" ON "ExternalCircuit"("source", "name");

-- 3) Circuito do universo do usuário
CREATE TABLE "Circuit" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "locality" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lengthMeters" INTEGER,
    "turns" INTEGER,
    "direction" TEXT,
    "layoutKey" TEXT,
    "layoutUrl" TEXT,
    "photoUrl" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'CANONICAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Circuit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Circuit_universeId_name_key" ON "Circuit"("universeId", "name");
CREATE INDEX "Circuit_universeId_idx" ON "Circuit"("universeId");

-- 4) Binding Universe <-> ExternalCircuit
CREATE TABLE "ExternalBindingCircuit" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "externalCircuitId" UUID NOT NULL,
    "circuitId" UUID NOT NULL,
    "confidence" "BindingConfidence" NOT NULL DEFAULT 'SUGGESTED',
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundBy" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalBindingCircuit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalBindingCircuit_circuitId_key" ON "ExternalBindingCircuit"("circuitId");
CREATE UNIQUE INDEX "ExternalBindingCircuit_universeId_externalCircuitId_key" ON "ExternalBindingCircuit"("universeId", "externalCircuitId");

-- 5) Registro de execução de sincronização
CREATE TABLE "ExternalSyncRun" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "seasonYear" INTEGER,
    "status" "ExternalSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "statistics" JSONB,
    "error" TEXT,
    "triggeredById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalSyncRun_source_scope_seasonYear_startedAt_idx" ON "ExternalSyncRun"("source", "scope", "seasonYear", "startedAt");

-- 6) Ampliar ExternalRace (dados fornecidos pela fonte, hoje descartados)
ALTER TABLE "ExternalRace" ADD COLUMN "officialName" TEXT;
ALTER TABLE "ExternalRace" ADD COLUMN "circuitExternalId" TEXT;
ALTER TABLE "ExternalRace" ADD COLUMN "locality" TEXT;
ALTER TABLE "ExternalRace" ADD COLUMN "country" TEXT;
ALTER TABLE "ExternalRace" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "ExternalRace" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "ExternalRace" ADD COLUMN "time" TEXT;
ALTER TABLE "ExternalRace" ADD COLUMN "url" TEXT;
ALTER TABLE "ExternalRace" ADD COLUMN "externalCircuitId" UUID;

-- 7) Race: relacionamento estruturado com Circuit (campos legados preservados)
ALTER TABLE "Race" ADD COLUMN "circuitId" UUID;

-- 8) FKs
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingCircuit" ADD CONSTRAINT "ExternalBindingCircuit_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingCircuit" ADD CONSTRAINT "ExternalBindingCircuit_externalCircuitId_fkey" FOREIGN KEY ("externalCircuitId") REFERENCES "ExternalCircuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingCircuit" ADD CONSTRAINT "ExternalBindingCircuit_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalRace" ADD CONSTRAINT "ExternalRace_externalCircuitId_fkey" FOREIGN KEY ("externalCircuitId") REFERENCES "ExternalCircuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Race" ADD CONSTRAINT "Race_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9) Índices
CREATE INDEX "ExternalRace_externalCircuitId_idx" ON "ExternalRace"("externalCircuitId");
CREATE INDEX "Race_circuitId_idx" ON "Race"("circuitId");
