-- Fase 6 do módulo Financeiro: cartão de crédito (RN-037).
-- A conta do cartão não guarda dinheiro: ela junta as compras numa FATURA.
-- Migração à mão e idempotente (ADR-001).

ALTER TABLE "FinConta" ADD COLUMN IF NOT EXISTS "diaFechamento" INTEGER;
ALTER TABLE "FinConta" ADD COLUMN IF NOT EXISTS "diaVencimento" INTEGER;
ALTER TABLE "FinConta" ADD COLUMN IF NOT EXISTS "contaPagamentoId" TEXT;
