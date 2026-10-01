-- RN-050 · "Separar em produto próprio": a variação MOVIDA para outro
-- produto guarda de qual produto saiu. Pedido do catálogo que ainda está no
-- aparelho da cliente (RN-010), sacola e rascunho de pedido apontam para o
-- produto ANTIGO + cor; sem este rastro o pedido inteiro seria recusado.
ALTER TABLE "ProductVariant" ADD COLUMN "separadaDeId" TEXT;
