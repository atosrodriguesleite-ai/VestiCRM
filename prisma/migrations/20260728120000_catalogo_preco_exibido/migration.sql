-- Preço que o catálogo público mostra e cobra: VAREJO (padrão, igual ao
-- comportamento de hoje) ou ATACADO. Escolha por loja, vale pra todos os
-- produtos de uma vez.
ALTER TABLE "Company" ADD COLUMN "catalogPriceMode" TEXT NOT NULL DEFAULT 'VAREJO';
