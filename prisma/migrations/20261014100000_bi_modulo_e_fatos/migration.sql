-- RN-082 / ADR-019: módulo BI de Vendas (chave só da tela) e os fatos diários
-- por loja × dia, preenchidos de carona no tráfego. Metas do mês por tipo.
ALTER TABLE "Company" ADD COLUMN "biEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "biFatosRunAt" TIMESTAMP(3);

CREATE TABLE "BiDia" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dia" TEXT NOT NULL,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "origens" TEXT NOT NULL DEFAULT '{}',
  "leadsRespondidos" INTEGER NOT NULL DEFAULT 0,
  "leadsComPedido" INTEGER NOT NULL DEFAULT 0,
  "leadsPagaram" INTEGER NOT NULL DEFAULT 0,
  "esperas" INTEGER NOT NULL DEFAULT 0,
  "respondidas" INTEGER NOT NULL DEFAULT 0,
  "noPrazo" INTEGER NOT NULL DEFAULT 0,
  "foraDoPrazo" INTEGER NOT NULL DEFAULT 0,
  "semResposta" INTEGER NOT NULL DEFAULT 0,
  "encerradasSemResposta" INTEGER NOT NULL DEFAULT 0,
  "medianaMin" DOUBLE PRECISION,
  "p90Min" DOUBLE PRECISION,
  "hist" TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0]',
  "pedidos" INTEGER NOT NULL DEFAULT 0,
  "pedidosPagos" INTEGER NOT NULL DEFAULT 0,
  "vendido" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BiDia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BiDia_companyId_dia_key" ON "BiDia"("companyId", "dia");
ALTER TABLE "BiDia" ADD CONSTRAINT "BiDia_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BiMeta" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "mes" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "valor" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BiMeta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BiMeta_companyId_mes_tipo_key" ON "BiMeta"("companyId", "mes", "tipo");
ALTER TABLE "BiMeta" ADD CONSTRAINT "BiMeta_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
