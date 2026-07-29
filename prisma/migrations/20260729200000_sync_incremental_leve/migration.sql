-- SYNC DA INBOX PARA DE CARREGAR O HISTÓRICO INTEIRO A CADA 3 SEGUNDOS
--
-- A tela do WhatsApp consulta o servidor a cada 3s e recebia, de cada conversa
-- alterada, TODAS as mensagens dela — sem limite nenhum. Uma cliente com 3.000
-- mensagens fazia as 3.000 trafegarem de novo só porque chegou um ✓✓. Numa
-- loja com movimento, isso é o gargalo nº 1 do sistema (e a queixa de "o
-- sistema está lento").
--
-- Filtrar por `createdAt` não resolvia: recibo de entrega/leitura, edição e
-- "apagar para todos" MUDAM a mensagem sem mexer na data de criação — o sync
-- perderia justamente as atualizações. Daí este campo.

ALTER TABLE "Message" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- histórico já gravado: a última mudança conhecida é a própria criação
UPDATE "Message" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Message" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- "o que mudou nesta conversa desde X" — a consulta que o sync faz o tempo todo
CREATE INDEX "Message_conversationId_updatedAt_idx"
  ON "Message"("conversationId", "updatedAt");
