-- Separação de pedido por leitor de código de barras (RN-060), 18/09/2026.
-- Escrita à mão (ADR-001); nada destrutivo.
ALTER TABLE "Order" ADD COLUMN "separadoEm" TIMESTAMP(3);

CREATE TABLE "Separacao" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "userId"      TEXT,
  "iniciadaEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "concluidaEm" TIMESTAMP(3),
  "itens"       TEXT NOT NULL DEFAULT '[]',
  "faltas"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Separacao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Separacao_companyId_orderId_idx" ON "Separacao"("companyId", "orderId");
CREATE INDEX "Separacao_companyId_concluidaEm_idx" ON "Separacao"("companyId", "concluidaEm");
-- UMA separação ativa por pedido: duas pessoas abrindo juntas esbarram aqui
CREATE UNIQUE INDEX "Separacao_ativa_key" ON "Separacao"("orderId") WHERE "concluidaEm" IS NULL;
ALTER TABLE "Separacao" ADD CONSTRAINT "Separacao_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Separacao" ADD CONSTRAINT "Separacao_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Separacao" ADD CONSTRAINT "Separacao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
