-- Catálogo de campanha: vitrine à parte com produtos selecionados + desconto próprio
CREATE TABLE "PromoCatalog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "discount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoCatalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromoCatalog_companyId_slug_key" ON "PromoCatalog"("companyId", "slug");
CREATE INDEX "PromoCatalog_companyId_idx" ON "PromoCatalog"("companyId");
ALTER TABLE "PromoCatalog" ADD CONSTRAINT "PromoCatalog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PromoCatalogProduct" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "PromoCatalogProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromoCatalogProduct_promoId_productId_key" ON "PromoCatalogProduct"("promoId", "productId");
ALTER TABLE "PromoCatalogProduct" ADD CONSTRAINT "PromoCatalogProduct_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "PromoCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoCatalogProduct" ADD CONSTRAINT "PromoCatalogProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
