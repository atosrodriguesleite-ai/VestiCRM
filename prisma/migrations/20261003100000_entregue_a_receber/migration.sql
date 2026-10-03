-- RN-069: venda a prazo — "Entregue · a receber". A cliente levou a
-- mercadoria e paga depois: estoque sai, conta a receber nasce com vencimento,
-- comissão conta na entrega, faturamento só quando virar PAGO.
ALTER TYPE "OrderStatus" ADD VALUE 'ENTREGUE_A_RECEBER' AFTER 'AGUARDANDO_PAGAMENTO';
ALTER TABLE "Order" ADD COLUMN "entregueAReceberEm" TIMESTAMP(3);
