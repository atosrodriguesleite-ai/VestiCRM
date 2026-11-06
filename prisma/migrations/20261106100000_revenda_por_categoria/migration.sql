-- Catálogo de revenda: o preço por CATEGORIA que a revendedora escolheu
-- (margem % ou preço fixo), lembrado na ficha dela (RN-109).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "resaleCategorias" JSONB;
