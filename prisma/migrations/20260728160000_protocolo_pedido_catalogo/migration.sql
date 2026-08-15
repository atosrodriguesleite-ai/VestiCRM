-- PROTOCOLO DO PEDIDO DO CATÁLOGO
--
-- O aparelho da cliente sorteia um código ANTES de enviar o pedido. O
-- catálogo pode então insistir (tentar de novo, e até na próxima visita)
-- sem risco de criar o mesmo pedido duas vezes: o código é único por loja.
--
-- Era o que faltava para a falha silenciosa: quando a internet oscilava no
-- momento do envio, a mensagem chegava no WhatsApp da vendedora e o pedido
-- nunca era criado — ninguém ficava sabendo.
ALTER TABLE "Order" ADD COLUMN "clientRef" TEXT;

CREATE UNIQUE INDEX "Order_companyId_clientRef_key" ON "Order"("companyId", "clientRef");

-- AVISO DE PEDIDO NOVO: a notificação passa a poder apontar para um pedido
-- (até hoje só sabia abrir uma conversa). Pedido do catálogo não avisava
-- ninguém — a vendedora só descobria se abrisse a tela Pedidos por acaso.
ALTER TABLE "Notification" ADD COLUMN "orderId" TEXT;
