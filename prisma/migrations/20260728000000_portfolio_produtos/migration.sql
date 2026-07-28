-- PORTFÓLIO DE PRODUTOS E SERVIÇOS (Super Admin / empresa-plataforma).
--
-- Guarda o "manual" dos serviços que a plataforma vende junto com o CRM:
-- o que é, para quem serve, como vender, quanto custa entregar e o passo a
-- passo da entrega.
--
-- Nada aqui se mistura com o catálogo das lojas (`Product`): não há estoque,
-- foto nem pedido. Todas as tabelas penduram em PortfolioProduct com
-- ON DELETE CASCADE — apagar o produto leva junto blocos, linhas e materiais.
--
-- Materiais são LINKS, não arquivos: mídia continua fora do banco de propósito.

CREATE TABLE "PortfolioProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDesc" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISPONIVEL',
    "duration" TEXT,
    "baseValue" DOUBLE PRECISION,
    "ownerName" TEXT,
    "fullDesc" TEXT,
    "icpText" TEXT,
    "icpForWhom" TEXT,
    "icpHowValue" TEXT,
    "scope" TEXT,
    "deliveryFormat" TEXT,
    "teamInvolved" TEXT,
    "howToSell" TEXT,
    "howToDeliver" TEXT,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseValue" DOUBLE PRECISION,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioPosition" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioDreLine" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sign" TEXT NOT NULL DEFAULT 'NEUTRO',
    "percent" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioDreLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioStep" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stage" TEXT,
    "task" TEXT NOT NULL,
    "detail" TEXT,
    "executor" TEXT,
    "estimate" TEXT,
    "popUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioMaterial" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'VENDAS',
    "title" TEXT NOT NULL,
    "tag" TEXT,
    "url" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioSalesFrame" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "colA" TEXT,
    "colB" TEXT,
    "colC" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioSalesFrame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioSalesFrameRow" (
    "id" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "valueA" TEXT,
    "valueB" TEXT,
    "valueC" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PortfolioSalesFrameRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PortfolioProduct_companyId_name_idx" ON "PortfolioProduct"("companyId", "name");
CREATE INDEX "PortfolioVariant_productId_idx" ON "PortfolioVariant"("productId");
CREATE INDEX "PortfolioPosition_productId_idx" ON "PortfolioPosition"("productId");
CREATE INDEX "PortfolioDreLine_productId_idx" ON "PortfolioDreLine"("productId");
CREATE INDEX "PortfolioStep_productId_idx" ON "PortfolioStep"("productId");
CREATE INDEX "PortfolioMaterial_productId_idx" ON "PortfolioMaterial"("productId");
CREATE INDEX "PortfolioSalesFrame_productId_idx" ON "PortfolioSalesFrame"("productId");
CREATE INDEX "PortfolioSalesFrameRow_frameId_idx" ON "PortfolioSalesFrameRow"("frameId");

ALTER TABLE "PortfolioProduct" ADD CONSTRAINT "PortfolioProduct_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioVariant" ADD CONSTRAINT "PortfolioVariant_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "PortfolioProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioPosition" ADD CONSTRAINT "PortfolioPosition_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "PortfolioProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioDreLine" ADD CONSTRAINT "PortfolioDreLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "PortfolioProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioStep" ADD CONSTRAINT "PortfolioStep_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "PortfolioProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioMaterial" ADD CONSTRAINT "PortfolioMaterial_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "PortfolioProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioSalesFrame" ADD CONSTRAINT "PortfolioSalesFrame_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "PortfolioProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioSalesFrameRow" ADD CONSTRAINT "PortfolioSalesFrameRow_frameId_fkey"
  FOREIGN KEY ("frameId") REFERENCES "PortfolioSalesFrame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
