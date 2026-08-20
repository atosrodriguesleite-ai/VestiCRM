-- TELA ENVIOS + SIMULADOR DE FRETE (RN-019, 19/08/2026)
--
-- A dor real da loja: a cliente pergunta o frete ANTES de pagar, mas a
-- embalagem só existe DEPOIS que a expedição embala. A saída é memória:
-- a etiqueta comprada passa a gravar os volumes que declarou e quantas
-- peças o pedido tinha — e o simulador mostra "teve um envio de 23 peças
-- nessa caixa", a vendedora escolhe e cota só com o CEP.
--
-- `freteSimuladorEnabled` nasce FALSE para todas as lojas: quem não ligar o
-- interruptor não vê nada de novo (mesma régua da RN-018).
--
-- Migração REEXECUTÁVEL (o banco tem drift; ver scripts/migrate-deploy.mjs).

ALTER TABLE "Shipping" ADD COLUMN IF NOT EXISTS "volumesJson" TEXT;
ALTER TABLE "Shipping" ADD COLUMN IF NOT EXISTS "pieces" INTEGER;
-- data da COMPRA da etiqueta ("gasto do mês" soma por ela, não pela postagem)
ALTER TABLE "Shipping" ADD COLUMN IF NOT EXISTS "meCompradoEm" TIMESTAMP(3);

-- BACKFILL: etiquetas já compradas (ME em produção desde 13/08) ficariam com
-- a data nula e SUMIRIAM do "gasto do mês" no mês do deploy. A postagem (ou,
-- sem ela, a data do pedido) é a melhor aproximação da compra. Idempotente:
-- só preenche o que está nulo.
UPDATE "Shipping" s
SET "meCompradoEm" = COALESCE(
  s."shippedAt",
  (SELECT o."createdAt" FROM "Order" o WHERE o."id" = s."orderId")
)
WHERE s."meOrderId" IS NOT NULL AND s."meCompradoEm" IS NULL;
ALTER TABLE "Company"  ADD COLUMN IF NOT EXISTS "freteSimuladorEnabled" BOOLEAN NOT NULL DEFAULT false;
