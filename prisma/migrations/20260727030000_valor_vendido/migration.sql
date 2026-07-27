-- VALOR VENDIDO: separa o que é venda do que é frete.
--
-- Até aqui o pedido só tinha `total` (= produtos - desconto + frete), e TODA
-- métrica de faturamento somava esse número. O frete entrava junto — dinheiro
-- da transportadora atravessando a loja — inflando o faturamento e podendo
-- cair na comissão da vendedora.
--
-- Agora existem duas colunas com papéis distintos:
--   netTotal = produtos - desconto + acréscimo  → faturamento e comissão
--   total    = netTotal + frete                 → o que a cliente paga

ALTER TABLE "Order" ADD COLUMN "surcharge" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "discountPct" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "surchargePct" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "netTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: nos pedidos que já existem não havia acréscimo, então o valor
-- vendido é o total menos o frete. `GREATEST(...,0)` protege contra qualquer
-- pedido antigo com frete maior que o total (dado inconsistente do passado).
UPDATE "Order" SET "netTotal" = GREATEST("total" - "shippingFee", 0);

-- Faturamento é somado por (empresa, data do pagamento) lendo netTotal.
CREATE INDEX "Order_companyId_paidAt_netTotal_idx" ON "Order"("companyId", "paidAt");

-- Base da comissão: "TOTAL" (que incluía frete) vira "VENDIDO" (peças −
-- desconto + acréscimo). A loja que tinha escolhido comissionar sobre o
-- total continua comissionando sobre o que vendeu — só o frete sai da conta.
UPDATE "Company" SET "commissionBase" = 'VENDIDO' WHERE "commissionBase" = 'TOTAL';
