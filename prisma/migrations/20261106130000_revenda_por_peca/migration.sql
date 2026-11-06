-- Catálogo de revenda: o preço unitário por PEÇA (produto × cor) que a
-- revendedora escolheu, lembrado na ficha dela (RN-109).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "resalePecas" JSONB;
