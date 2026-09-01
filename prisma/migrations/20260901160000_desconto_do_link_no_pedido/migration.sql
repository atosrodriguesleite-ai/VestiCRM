-- O DESCONTO DO LINK DE CAMPANHA VIRA DADO DO PEDIDO (RN-040).
-- Antes ele existia só como frase na nota: o valor não se explicava depois, e
-- o resgate "Colar pedido do WhatsApp" remontava o pedido a preço cheio.
-- Defaults neutros: pedido que já existe continua exatamente como está.
ALTER TABLE "Order" ADD COLUMN "campaignRef" TEXT;
ALTER TABLE "Order" ADD COLUMN "campaignDiscount" INTEGER NOT NULL DEFAULT 0;
