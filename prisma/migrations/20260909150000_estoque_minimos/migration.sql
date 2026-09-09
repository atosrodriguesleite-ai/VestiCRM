-- Módulo Estoque, Fase 2 (RN-051): mínimo por peça e por categoria, com
-- alerta sem spam. Escrita à mão (ADR-001). Tudo nulo/novo: nenhuma loja muda
-- de comportamento — sem mínimo próprio, vale o da loja (lowStockThreshold),
-- que já existia.
ALTER TABLE "Product" ADD COLUMN "minStock" INTEGER;
ALTER TABLE "ProductVariant" ADD COLUMN "lowStockAlertedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "estoqueAlertaRunAt" TIMESTAMP(3);

CREATE TABLE "EstoqueMinimoCategoria" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "minStock" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EstoqueMinimoCategoria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EstoqueMinimoCategoria_companyId_category_key"
  ON "EstoqueMinimoCategoria"("companyId", "category");
ALTER TABLE "EstoqueMinimoCategoria"
  ADD CONSTRAINT "EstoqueMinimoCategoria_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
