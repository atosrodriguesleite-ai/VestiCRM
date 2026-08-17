-- TABELAS DE PREÇO POR LINK (17/08/2026)
--
-- Loja que vende ATACADO E VAREJO no mesmo catálogo: em vez de uma chavinha
-- só para a loja inteira (Company.catalogPriceMode), ela gera LINKS — cada um
-- com a sua tabela. Manda o de atacado para lojista e o de varejo para
-- cliente final.
--
-- RECURSO GATED, DESLIGADO POR PADRÃO: `priceTablesEnabled` nasce false para
-- TODAS as lojas. Quem não ligar não vê diferença nenhuma — mesmo link, mesmo
-- preço, mesma tela (pedido do dono, 17/08/2026).
--
-- `Order.priceMode` carimba no pedido a tabela que o precificou: o servidor
-- recalcula todo preço na hora de gravar (RN-009), então sem esse carimbo um
-- pedido de atacado seria recobrado no varejo.
--
-- Migração REEXECUTÁVEL (o banco tem drift; ver scripts/migrate-deploy.mjs).

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "priceTablesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order"   ADD COLUMN IF NOT EXISTS "priceMode" TEXT;

CREATE TABLE IF NOT EXISTS "CatalogLink" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "priceMode" TEXT NOT NULL DEFAULT 'ATACADO',
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogLink_code_key" ON "CatalogLink"("code");
CREATE INDEX IF NOT EXISTS "CatalogLink_companyId_idx" ON "CatalogLink"("companyId");

DO $$ BEGIN
  ALTER TABLE "CatalogLink"
    ADD CONSTRAINT "CatalogLink_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
