-- RN-106 · O pulso do WhatsApp: o sinal do webhook, o envio que espera o
-- eco, a cura automática e o alarme do webhook calado. Colunas novas e
-- vazias — nenhuma loja muda de estado por esta migração.
ALTER TABLE "CommSettings" ADD COLUMN IF NOT EXISTS "webhookUltimoSinalEm" TIMESTAMP(3);
ALTER TABLE "CommSettings" ADD COLUMN IF NOT EXISTS "envioSemEcoDesde" TIMESTAMP(3);
ALTER TABLE "CommSettings" ADD COLUMN IF NOT EXISTS "autoCuraEm" TIMESTAMP(3);
ALTER TABLE "CommSettings" ADD COLUMN IF NOT EXISTS "webhookCaladoAvisadoEm" TIMESTAMP(3);
ALTER TABLE "CommSettings" ADD COLUMN IF NOT EXISTS "ultimoReinicioEm" TIMESTAMP(3);

-- PONTO DE PARTIDA da rede de segurança (RN-106; a lição da RN-100): a loja
-- que JÁ estava caída (desconectada ou "aguardando QR" depois da queda) sem alarme no dia da entrega (o reinício e a
-- tela a marcavam sem alarme, porque a pessoa estava olhando) não recebe
-- uma enxurrada de alarmes na primeira rodada — fica carimbada como avisada.
UPDATE "CommSettings"
SET "evolutionAlertAt" = NOW()
WHERE "evolutionStatus" IN ('DESCONECTADO', 'AGUARDANDO_QR')
  AND "evolutionDownSince" IS NOT NULL
  AND ("evolutionAlertAt" IS NULL OR "evolutionAlertAt" < "evolutionDownSince");
