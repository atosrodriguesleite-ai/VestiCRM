-- PEDIDOS POR CLIENTE (achado da revisão da RN-063, 21/09/2026). O selo da
-- Central agrupa os pedidos dos clientes da lista (até 2.000 ids de uma vez)
-- e Order não tinha índice nenhum com customerId: o Postgres caía no
-- (companyId, status) e varria todo pedido da loja a cada abertura da
-- Central. A ficha da cliente e a transferência de pedido também filtram por
-- cliente. UMA instrução por arquivo: CONCURRENTLY não roda em transação.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_companyId_customerId_idx" ON "Order"("companyId", "customerId");
