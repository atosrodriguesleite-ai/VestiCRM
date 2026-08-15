-- TIPO DE PEÇA: o guarda-chuva das categorias no catálogo público.
-- "Blusas" agrupa Regata Alça, Baby Look e Ombro Único; "Shorts" agrupa os
-- shorts. JSON objeto categoria→tipo — o vínculo é da CATEGORIA, então peça
-- nova já nasce no guarda-chuva certo, sem marcar produto por produto.
-- A ordem dos tipos vem da ordem das categorias (categoryOrder).
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "categoryTypes" TEXT NOT NULL DEFAULT '{}';
