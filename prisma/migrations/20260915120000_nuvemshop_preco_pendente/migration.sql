-- RN-057: o preço de varejo da peça Nuvemshop também se muda AQUI, e vai
-- para lá. A fila é a mesma da RN-053 (estoque): uma linha por PRODUTO que
-- ainda não teve o preço confirmado na Nuvemshop. Escrita à mão (ADR-001);
-- nada destrutivo.
CREATE TABLE "NuvemshopPrecoPendente" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "proximaEm" TIMESTAMP(3),
  "ultimoErro" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NuvemshopPrecoPendente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NuvemshopPrecoPendente_productId_key"
  ON "NuvemshopPrecoPendente"("productId");
CREATE INDEX "NuvemshopPrecoPendente_companyId_proximaEm_idx"
  ON "NuvemshopPrecoPendente"("companyId", "proximaEm");
ALTER TABLE "NuvemshopPrecoPendente"
  ADD CONSTRAINT "NuvemshopPrecoPendente_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NuvemshopPrecoPendente"
  ADD CONSTRAINT "NuvemshopPrecoPendente_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
