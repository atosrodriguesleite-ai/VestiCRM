-- Quais eventos o servidor Evolution manda para o webhook de cada loja: o
-- carimbo que faz a loja já conectada ser reassinada sozinha quando o
-- sistema passa a escutar um evento novo (MESSAGES_EDITED, 17/09/2026).
-- Escrita à mão (ADR-001); nada destrutivo.
ALTER TABLE "CommSettings" ADD COLUMN "evolutionWebhookEventos" TEXT;
