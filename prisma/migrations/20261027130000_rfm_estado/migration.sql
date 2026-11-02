-- RN-100: a memória do grupo do RFM de cada cliente (para saber quando ela
-- CAI de grupo) e a trava da rodada diária das quedas, de carona (ADR-002).
ALTER TABLE "Company" ADD COLUMN "rfmQuedasRunAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "rfmQuedasOkEm" TIMESTAMP(3);

CREATE TABLE "RfmEstado" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "grupo" TEXT NOT NULL,
  "desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seguradaDesde" TIMESTAMP(3),
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RfmEstado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RfmEstado_customerId_key" ON "RfmEstado"("customerId");
CREATE INDEX "RfmEstado_companyId_idx" ON "RfmEstado"("companyId");
ALTER TABLE "RfmEstado" ADD CONSTRAINT "RfmEstado_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RfmEstado" ADD CONSTRAINT "RfmEstado_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
