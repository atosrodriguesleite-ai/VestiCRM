-- RN-050 · o rastro da cor separada é lido pela porta PÚBLICA do catálogo
-- quando uma linha não acha a cor no produto (pedido antigo do aparelho).
-- Índice parcial: só as variações separadas entram (quase nenhuma).
-- CONCURRENTLY = UMA instrução por arquivo (regra operacional 2).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductVariant_separadaDeId_idx" ON "ProductVariant" ("separadaDeId") WHERE "separadaDeId" IS NOT NULL;
