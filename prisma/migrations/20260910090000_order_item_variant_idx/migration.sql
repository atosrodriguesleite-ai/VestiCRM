-- ITENS DE PEDIDO POR VARIAÇÃO — refazendo o índice de 20260909181000.
--
-- Aquela migração trazia os DOIS índices no MESMO arquivo, e o Postgres
-- executa várias instruções mandadas juntas dentro de UMA transação
-- implícita — onde `CREATE INDEX CONCURRENTLY` é proibido (erro 25001).
-- Resultado: a migração falhava inteira e, marcada como falhada, PARAVA
-- todos os deploys seguintes (P3009). As migrações CONCURRENTLY anteriores
-- funcionaram por terem UMA instrução cada; a régua agora é essa, sempre.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_variantId_idx" ON "OrderItem"("variantId");
