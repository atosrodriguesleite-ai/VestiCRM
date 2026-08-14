-- Chave de acesso da NF-e (44 dígitos), vinda do Bling.
-- É o que o Melhor Envio precisa para emitir a etiqueta COM nota fiscal em
-- vez da declaração de conteúdo.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "nfeKey" TEXT;

-- E a chave que FOI usada em cada etiqueta: etiqueta comprada antes da nota
-- continua sendo declaração de conteúdo, mesmo que a nota saia depois.
ALTER TABLE "Shipping" ADD COLUMN IF NOT EXISTS "nfeKey" TEXT;
