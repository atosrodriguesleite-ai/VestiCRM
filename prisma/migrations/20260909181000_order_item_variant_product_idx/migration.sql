-- ITENS DE PEDIDO POR VARIAÇÃO E POR PRODUTO (achado da revisão de
-- performance, 09/09/2026). As chaves estrangeiras OrderItem.variantId e
-- OrderItem.productId (onDelete: SetNull) não tinham índice: remover uma
-- variação da grade ou apagar um produto disparava a varredura de TODOS os
-- itens de pedido da plataforma (medido: 78 ms local por variação em 1 mi
-- de itens; com índice, 4,8 ms) — dentro da transação que segura as
-- variações da ficha. O giro do painel (RN-052) também lê por variação.
-- CONCURRENTLY, como as anteriores (o `migrate deploy` roda fora de transação).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_variantId_idx" ON "OrderItem"("variantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
