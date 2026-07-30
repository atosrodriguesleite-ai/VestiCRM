-- Descrição por categoria no catálogo público.
-- Antes o catálogo mostrava a descrição do PRIMEIRO produto da categoria: o
-- texto mudava sozinho quando a ordem mudava ou quando a Nuvemshop
-- sobrescrevia a descrição do produto. Agora é texto da CATEGORIA, escrito
-- pela lojista em Produtos → Categorias. JSON objeto nome→texto.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "categoryDescriptions" TEXT NOT NULL DEFAULT '{}';
