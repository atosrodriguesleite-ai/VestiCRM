-- RN-069: previsão de recebimento combinada com a cliente na venda a prazo.
-- Nula = vale o padrão (30 dias da entrega).
ALTER TABLE "Order" ADD COLUMN "previsaoRecebimentoEm" TIMESTAMP(3);
