-- ITENS DE PEDIDO POR PRODUTO — a segunda metade de 20260909181000, em
-- arquivo próprio pelo mesmo motivo da migração anterior: uma instrução por
-- migração quando é CONCURRENTLY.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
