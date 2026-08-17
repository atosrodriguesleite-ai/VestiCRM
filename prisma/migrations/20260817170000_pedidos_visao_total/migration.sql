-- VENDEDORA COM VISÃO TOTAL DOS PEDIDOS (pedido da Toque Leve, 17/08/2026).
--
-- Irmã da chavinha do chat (chatVisaoTotal): a regra padrão da RN-007
-- continua — vendedora vê só os pedidos dela —, e este interruptor, ligado
-- por pessoa na tela Equipe, abre a área de Pedidos inteira para uma
-- vendedora específica. Comissão continua pelo sellerId; transferir a venda
-- da colega continua proibido; a exportação segue o escopo normal.
--
-- IF NOT EXISTS: reexecutável (deploy que cai no meio não quebra na volta).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pedidosVisaoTotal" BOOLEAN NOT NULL DEFAULT false;
