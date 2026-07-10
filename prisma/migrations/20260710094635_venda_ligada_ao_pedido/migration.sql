-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "orderId" TEXT;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: liga vendas existentes ao pedido de origem (pela descrição
-- "Pedido #0001" gerada no pagamento) e apaga vendas de pedidos que já
-- foram cancelados — cancelou, sai do faturamento.
UPDATE "Sale" s SET "orderId" = o.id
FROM "Order" o
WHERE s."companyId" = o."companyId"
  AND s."orderId" IS NULL
  AND s.description = 'Pedido #' || lpad(o.number::text, 4, '0');

DELETE FROM "Sale"
WHERE "orderId" IN (SELECT id FROM "Order" WHERE status = 'CANCELADO');
