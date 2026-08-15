-- CAPA POR COR (pedido da Entre Linhas, 03/08/2026): cada foto do produto
-- pode ser etiquetada com a cor que ela mostra. O card de cada cor no
-- catálogo passa a usar a foto daquela cor; sem etiqueta, cai na capa geral.
ALTER TABLE "ProductImage" ADD COLUMN "color" TEXT;
