-- MÓDULO FINANCEIRO — Fase 5: cobrança pelo WhatsApp (RN-032).
-- Escrita à mão (ADR-001) e idempotente: rodar duas vezes não quebra.

-- quando a loja cobrou esta conta pela última vez: é o que impede cobrar a
-- mesma cliente duas vezes no mesmo dia (e o que a tela mostra como "cobrada hoje")
ALTER TABLE "FinLancamento" ADD COLUMN IF NOT EXISTS "cobradoEm" TIMESTAMP(3);
