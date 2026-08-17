-- VENDEDORA COM VISÃO TOTAL DO CHAT (pedido da Toque Leve, 17/08/2026).
--
-- A regra padrão continua: vendedora vê os atendimentos DELA + a fila.
-- Este interruptor, ligado por pessoa na tela Equipe, abre TODAS as
-- conversas da Central de Atendimento para uma vendedora específica —
-- sem mexer em carteira, pedidos, comissão nem relatórios.
--
-- IF NOT EXISTS: reexecutável (deploy que cai no meio não quebra na volta).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "chatVisaoTotal" BOOLEAN NOT NULL DEFAULT false;
