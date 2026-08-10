-- A TAREFA QUE A VIDA JÁ RESOLVEU (pedido do dono, 07/08/2026).
--
-- Duas colunas para a agenda parar de mentir:
--
-- 1) Task.autoDoneReason — POR QUE a tarefa se fechou sozinha ("o pagamento
--    entrou", "você já falou com a cliente"). Sem gravar o motivo, a tarefa
--    simplesmente sumia da lista e a lojista desconfiava do sistema em vez
--    de confiar nele.
--
-- REEXECUTÁVEL DE PROPÓSITO (IF NOT EXISTS / WHERE IS NULL): esta migração
-- roda contra o banco DE PRODUÇÃO, com lojas operando. Se ela falhar no meio
-- (tempo, lock), o Postgres desfaz tudo e o deploy tenta de novo — cada
-- comando precisa aguentar rodar duas vezes sem quebrar.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "autoDoneReason" TEXT;

-- 2) Order.updatedAt — QUANDO o pedido mudou pela última vez. É o que permite
--    saber que a entrega/cancelamento aconteceu DEPOIS de a tarefa nascer
--    (prova velha não pode fechar tarefa nova). `paidAt` já cobria o dinheiro;
--    entrega e cancelamento não tinham data nenhuma.
--
--    O DEFAULT entra ANTES do preenchimento: pedido criado durante a
--    migração já nasce carimbado — sem isso, uma linha nova com NULL fazia o
--    SET NOT NULL falhar e derrubava o deploy inteiro.
--
--    O preenchimento dos pedidos ANTIGOS usa a data do dinheiro (ou a de
--    criação) de propósito: se todos nascessem com CURRENT_TIMESTAMP, todo
--    pedido entregue no passado pareceria "mexido agora" e fecharia tarefas
--    que continuam válidas.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
UPDATE "Order" SET "updatedAt" = COALESCE("paidAt", "createdAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET NOT NULL;
