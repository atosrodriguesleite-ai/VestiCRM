-- Vínculo fino com a Nuvemshop: SKU por variação (chave universal),
-- id do produto NS na variação (modo produto-por-cor) e relatório de sync
ALTER TABLE "ProductVariant" ADD COLUMN "sku" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "nuvemshopProductId" TEXT;
ALTER TABLE "NuvemshopConnection" ADD COLUMN "lastSyncReport" TEXT NOT NULL DEFAULT '{}';
