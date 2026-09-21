-- SELO DA CLIENTE NA CENTRAL (RN-063, 21/09/2026). O sync da inbox (a cada
-- 3s, por aba aberta) pergunta "de quem mexeram no pedido desde a última
-- batida?" para trocar o selo Pedido/Cliente/Recompra sozinho, sem carimbo
-- em nenhum caminho de pedido. Sem este índice a pergunta varria todos os
-- pedidos da loja a cada batida. UMA instrução por arquivo: CONCURRENTLY não
-- roda dentro de transação (incidente da 20260909181000).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_companyId_updatedAt_idx" ON "Order"("companyId", "updatedAt");
