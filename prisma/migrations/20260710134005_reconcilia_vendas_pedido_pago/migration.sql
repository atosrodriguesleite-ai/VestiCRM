-- Reconcilia a tabela Sale para refletir SOMENTE pedidos pagos (fonte única
-- da verdade). Corrige o faturamento que estava inflado por:
--   • vendas criadas ao ganhar oportunidade no funil (dinheiro contado 2x);
--   • vendas de pedidos que foram cancelados ou voltaram para não-pago.

-- 1) vincula vendas soltas ao pedido de origem pela descrição "Pedido #NNNN"
UPDATE "Sale" s SET "orderId" = o.id
FROM "Order" o
WHERE s."orderId" IS NULL
  AND s."companyId" = o."companyId"
  AND s.description = 'Pedido #' || lpad(o.number::text, 4, '0');

-- 2) remove tudo que não é um pedido atualmente pago
DELETE FROM "Sale"
WHERE "orderId" IS NULL
   OR "orderId" IN (
     SELECT id FROM "Order"
     WHERE status NOT IN ('PAGO','EM_PRODUCAO','SEPARACAO','ENVIADO','ENTREGUE')
   );
