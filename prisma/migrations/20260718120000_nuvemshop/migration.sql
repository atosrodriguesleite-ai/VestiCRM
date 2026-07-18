-- Integração Nuvemshop: conexão por loja, vínculos de produto/variação,
-- origem da venda no pedido e deduplicação de carrinho abandonado
CREATE TABLE "NuvemshopConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "storeUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONECTADO',
    "lastProductSync" TIMESTAMP(3),
    "lastCheckoutSync" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NuvemshopConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NuvemshopConnection_companyId_key" ON "NuvemshopConnection"("companyId");
CREATE UNIQUE INDEX "NuvemshopConnection_storeId_key" ON "NuvemshopConnection"("storeId");
ALTER TABLE "NuvemshopConnection" ADD CONSTRAINT "NuvemshopConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "nuvemshopId" TEXT;
CREATE UNIQUE INDEX "Product_companyId_nuvemshopId_key" ON "Product"("companyId", "nuvemshopId");

ALTER TABLE "ProductVariant" ADD COLUMN "nuvemshopId" TEXT;

ALTER TABLE "Order" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'CATALOGO';
ALTER TABLE "Order" ADD COLUMN "nuvemshopId" TEXT;
CREATE UNIQUE INDEX "Order_companyId_nuvemshopId_key" ON "Order"("companyId", "nuvemshopId");

ALTER TABLE "Opportunity" ADD COLUMN "nuvemshopCheckoutId" TEXT;
CREATE UNIQUE INDEX "Opportunity_companyId_nuvemshopCheckoutId_key" ON "Opportunity"("companyId", "nuvemshopCheckoutId");
