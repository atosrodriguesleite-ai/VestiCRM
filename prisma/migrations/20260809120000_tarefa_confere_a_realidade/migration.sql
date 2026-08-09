-- A TAREFA QUE A VIDA JÁ RESOLVEU (pedido do dono, 07/08/2026).
--
-- Duas colunas para a agenda parar de mentir:
--
-- 1) Task.autoDoneReason — POR QUE a tarefa se fechou sozinha ("o pagamento
--    entrou", "você já falou com a cliente"). Sem gravar o motivo, a tarefa
--    simplesmente sumia da lista e a lojista desconfiava do sistema em vez
--    de confiar nele.
ALTER TABLE "Task" ADD COLUMN "autoDoneReason" TEXT;

-- 2) Order.updatedAt — QUANDO o pedido mudou pela última vez. É o que permite
--    saber que a entrega/cancelamento aconteceu DEPOIS de a tarefa nascer
--    (prova velha não pode fechar tarefa nova). `paidAt` já cobria o dinheiro;
--    entrega e cancelamento não tinham data nenhuma.
--
--    O preenchimento dos pedidos ANTIGOS usa a data do dinheiro (ou a de
--    criação) de propósito: se todos nascessem com CURRENT_TIMESTAMP, todo
--    pedido entregue no passado pareceria "mexido agora" e fecharia tarefas
--    que continuam válidas.
ALTER TABLE "Order" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Order" SET "updatedAt" = COALESCE("paidAt", "createdAt");
ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
