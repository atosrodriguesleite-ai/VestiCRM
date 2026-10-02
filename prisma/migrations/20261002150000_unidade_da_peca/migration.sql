-- RN-068: como chamar a unidade no catálogo público ("peça", "conjunto", "kit").
-- Par singular/plural na loja, por categoria (JSON) e na peça (exceção).
-- Tudo nulo/vazio = "peça"/"peças", exatamente como era.
ALTER TABLE "Company" ADD COLUMN "unidadeSingular" TEXT;
ALTER TABLE "Company" ADD COLUMN "unidadePlural" TEXT;
ALTER TABLE "Company" ADD COLUMN "categoryUnits" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN "unidadeSingular" TEXT;
ALTER TABLE "Product" ADD COLUMN "unidadePlural" TEXT;
