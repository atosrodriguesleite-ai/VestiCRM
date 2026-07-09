-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "stockDeducted" BOOLEAN NOT NULL DEFAULT false;

-- No modelo antigo o estoque baixava na CRIAÇÃO do pedido. Marca os pedidos
-- não-cancelados existentes como já baixados, para o cancelamento futuro
-- devolver o estoque corretamente.
UPDATE "Order" SET "stockDeducted" = true WHERE "status" <> 'CANCELADO';
