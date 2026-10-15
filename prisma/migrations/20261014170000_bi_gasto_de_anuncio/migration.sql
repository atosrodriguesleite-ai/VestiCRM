-- RN-085 / ADR-019: o gasto de anúncio por campanha × mês (a aba Anúncios do BI).
CREATE TABLE "BiGastoDeAnuncio" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "campanhaId" TEXT NOT NULL,
  "mes" TEXT NOT NULL,
  "valor" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BiGastoDeAnuncio_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BiGastoDeAnuncio_companyId_campanhaId_mes_key" ON "BiGastoDeAnuncio"("companyId", "campanhaId", "mes");
CREATE INDEX "BiGastoDeAnuncio_companyId_mes_idx" ON "BiGastoDeAnuncio"("companyId", "mes");
ALTER TABLE "BiGastoDeAnuncio" ADD CONSTRAINT "BiGastoDeAnuncio_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiGastoDeAnuncio" ADD CONSTRAINT "BiGastoDeAnuncio_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
