-- RN-028: o arquivo da cliente não se perde.
--
-- A mensagem passa a ser gravada ANTES do download do arquivo. O que ainda
-- não chegou fica marcado como pendente e é repescado depois (de carona no
-- tráfego, sem cron novo — ADR-002).
ALTER TABLE "Message" ADD COLUMN "mediaPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN "mediaTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "mediaError" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaNextTryAt" TIMESTAMP(3);

-- A fila da repesca: "o que falta baixar e já pode tentar de novo".
CREATE INDEX "Message_mediaPending_mediaNextTryAt_idx"
  ON "Message"("mediaPending", "mediaNextTryAt");

-- Trava atômica da repesca (uma rodada por intervalo, como o vigia).
ALTER TABLE "SystemHealth" ADD COLUMN "midiaRunAt" TIMESTAMP(3);
