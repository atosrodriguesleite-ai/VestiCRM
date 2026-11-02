-- RN-102: o prazo prometido pela transportadora (dias úteis, da cotação
-- aceita) e a previsão de entrega carimbada na postagem. "Atrasado" passa a
-- ser "passou da previsão"; sem prazo (etiqueta antiga) vale os 7 dias.
ALTER TABLE "Shipping" ADD COLUMN "prazoDias" INTEGER;
ALTER TABLE "Shipping" ADD COLUMN "previstoAte" TIMESTAMP(3);
