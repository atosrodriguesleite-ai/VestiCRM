-- Data do PAGAMENTO no pedido.
--
-- Por quê: até aqui o faturamento era somado pela data em que o orçamento foi
-- MONTADO. Como o pedido só entra na conta depois de virar PAGO, um mês já
-- fechado mudava de valor quando um orçamento antigo era pago. Agora cada
-- pedido guarda QUANDO virou pago, e é essa data que manda nas métricas.

ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Preenche os pedidos que JÁ estão pagos:
--   1) se existe um pagamento confirmado, usa a data dele (a verdade);
--   2) senão, usa a data em que o pedido foi criado.
-- (Primeiro mês de uso do sistema: os dois caminhos caem no mesmo mês.)
UPDATE "Order" o
SET "paidAt" = COALESCE(
  (
    SELECT MIN(p."paidAt")
    FROM "Payment" p
    WHERE p."orderId" = o.id AND p."paidAt" IS NOT NULL
  ),
  o."createdAt"
)
WHERE o."status" IN ('PAGO', 'EM_PRODUCAO', 'SEPARACAO', 'ENVIADO', 'ENTREGUE')
  AND o."paidAt" IS NULL;

CREATE INDEX "Order_companyId_paidAt_idx" ON "Order"("companyId", "paidAt");
