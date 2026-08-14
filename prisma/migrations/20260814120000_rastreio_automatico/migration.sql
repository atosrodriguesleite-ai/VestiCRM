-- PEDIDO QUE ANDA SOZINHO (14/08/2026)
--
-- 1) Parcelas do cartão: a cliente pagou em 6x → o pedido mostra "Cartão 6x"
--    (antes a forma virava só "Cartão" e a parcela ficava só no recibo).
-- 2) Rastreio de carona: quando cada envio foi consultado pela última vez
--    (trackedAt) e a trava da rodada global (SystemHealth.trackingRunAt) —
--    o Vercel Hobby só permite 2 crons diários, então a varredura pega
--    carona no tráfego, igual ao vigia de saúde.
-- 3) publicCode: código do LINK PÚBLICO de rastreio que a vendedora manda
--    para a cliente (a cliente clica e vê o andamento — sem expor o id do
--    pedido nem exigir login).
--
-- Migração REEXECUTÁVEL (o banco tem drift; ver scripts/migrate-deploy.mjs).

ALTER TABLE "Payment"  ADD COLUMN IF NOT EXISTS "installments" INTEGER;
ALTER TABLE "Shipping" ADD COLUMN IF NOT EXISTS "trackedAt"    TIMESTAMP(3);
ALTER TABLE "Shipping" ADD COLUMN IF NOT EXISTS "publicCode"   TEXT;
ALTER TABLE "SystemHealth" ADD COLUMN IF NOT EXISTS "trackingRunAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Shipping_publicCode_key" ON "Shipping"("publicCode");
-- fila da varredura: os envios ainda em trânsito, do mais esquecido para o
-- mais recente (é a consulta que a rodada de carona faz a cada vez)
CREATE INDEX IF NOT EXISTS "Shipping_meStatus_trackedAt_idx" ON "Shipping"("meStatus", "trackedAt");
