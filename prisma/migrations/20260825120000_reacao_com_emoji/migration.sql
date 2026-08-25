-- REAGIR À MENSAGEM COM EMOJI (pedido do dono, 25/08/2026).
--
-- A coluna `reaction` já existia desde o início e nunca foi usada: passa a
-- guardar o emoji com que a CLIENTE reagiu. A nova `reactionStore` guarda o
-- emoji com que a LOJA reagiu — uma reação de cada lado, como no aplicativo.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "reactionStore" TEXT;
