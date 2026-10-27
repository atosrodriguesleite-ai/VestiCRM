-- RN-098: frete grátis é marca explícita da vendedora no pedido, não frete zero.
-- Nasce desligada em todo pedido: o que já existe segue "não informado".
ALTER TABLE "Order" ADD COLUMN "freteGratis" BOOLEAN NOT NULL DEFAULT false;
