-- RN-083 / ADR-019: os fatos diários do BI por vendedora (loja × dia × pessoa).
-- Linha derivada, refeita a cada rodada de carona; apagada com a loja ou a pessoa.
-- `BiDia.versao`: a linha gravada pela conta antiga (0) vale como "dia que falta"
-- para a rodada, que a refaz junto com as linhas por vendedora (22 dias por
-- rodada, de carona) — o histórico já gravado não ficaria sem pessoa.
ALTER TABLE "BiDia" ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "BiDiaVendedora" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dia" TEXT NOT NULL,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "leadsRespondidos" INTEGER NOT NULL DEFAULT 0,
  "leadsComPedido" INTEGER NOT NULL DEFAULT 0,
  "leadsPagaram" INTEGER NOT NULL DEFAULT 0,
  "respondidas" INTEGER NOT NULL DEFAULT 0,
  "noPrazo" INTEGER NOT NULL DEFAULT 0,
  "foraDoPrazo" INTEGER NOT NULL DEFAULT 0,
  "semResposta" INTEGER NOT NULL DEFAULT 0,
  "medianaMin" DOUBLE PRECISION,
  "p90Min" DOUBLE PRECISION,
  "hist" TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0]',
  "pedidos" INTEGER NOT NULL DEFAULT 0,
  "pedidosPagos" INTEGER NOT NULL DEFAULT 0,
  "vendido" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BiDiaVendedora_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BiDiaVendedora_companyId_dia_userId_key" ON "BiDiaVendedora"("companyId", "dia", "userId");
CREATE INDEX "BiDiaVendedora_companyId_userId_dia_idx" ON "BiDiaVendedora"("companyId", "userId", "dia");
ALTER TABLE "BiDiaVendedora" ADD CONSTRAINT "BiDiaVendedora_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiDiaVendedora" ADD CONSTRAINT "BiDiaVendedora_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
