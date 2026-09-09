-- LIVRO DE MOVIMENTOS POR PEDIDO (achado da revisão de dados, 09/09/2026).
--
-- `baixasLiquidasDoPedido` (devolver/excluir pedido) e o "reservado" do
-- Inventário (RN-050) leem InventoryMovement por orderId — e a tabela só
-- tinha índice por (companyId, createdAt) e por variantId: cada cancelamento
-- varria o livro inteiro (medido: 180 mil linhas lidas para achar 3).
--
-- CONCURRENTLY: constrói o índice sem travar a escrita (venda do catálogo
-- continua reservando durante o deploy). Como na migração 20260903120000,
-- o `prisma migrate deploy` não roda a migração dentro de transação.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "InventoryMovement_orderId_idx"
  ON "InventoryMovement"("orderId");
