-- Margem de revenda por lojista (catálogo de revenda em PDF)
ALTER TABLE "Customer" ADD COLUMN "resaleMarkup" DOUBLE PRECISION NOT NULL DEFAULT 0;
