-- Migration aditiva: kind de timeline para evolução de atributos (V3 Fase 10).
-- Nenhuma operação destrutiva; não altera dados existentes.

ALTER TYPE "TimelineEventKind" ADD VALUE 'ATTRIBUTE_EVOLVED';
