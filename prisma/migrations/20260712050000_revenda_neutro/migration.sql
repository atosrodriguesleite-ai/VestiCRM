-- Catálogo de revenda: arredondamento ,90 e nome da loja lembrados por lojista
ALTER TABLE "Customer" ADD COLUMN "resaleRound" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "resaleStoreName" TEXT;
