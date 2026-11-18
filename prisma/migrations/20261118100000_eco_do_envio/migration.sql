-- RN-106 · O TESTE DO ECO SÓ ARMA ONDE FOI PROVADO (18/11/2026).
--
-- O teste esperava o eco do envio como `messages.upsert`, que o servidor
-- Evolution não manda para o que sai pela API (só `send.message`). Resultado:
-- alarme falso de "WhatsApp parou de entregar" e reinício à toa de conexão
-- boa. A coluna nova guarda a última vez em que o servidor da loja mandou o
-- aviso de um envio — sem ela o teste não carimba, não reinicia e não alarma.
ALTER TABLE "CommSettings" ADD COLUMN "ecoDoEnvioVistoEm" TIMESTAMP(3);

-- Os carimbos que já existem são do teste errado: nenhum deles prova nada.
-- Limpa o envio "sem eco" e o aviso do episódio — ponto de partida limpo.
UPDATE "CommSettings"
SET "envioSemEcoDesde" = NULL,
    "webhookCaladoAvisadoEm" = NULL
WHERE "envioSemEcoDesde" IS NOT NULL OR "webhookCaladoAvisadoEm" IS NOT NULL;
