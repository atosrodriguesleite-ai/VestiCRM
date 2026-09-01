-- CONDIÇÕES DO LINK DE CAMPANHA (RN-040).
-- O endereço do link (slug) nunca muda; estas colunas são o que a loja edita
-- depois de já ter divulgado o link. Tudo com default neutro: campanha que
-- já existe continua fazendo exatamente o que fazia (só rastrear).
ALTER TABLE "TrackCampaign" ADD COLUMN "discount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrackCampaign" ADD COLUMN "minOrderMode" TEXT;
ALTER TABLE "TrackCampaign" ADD COLUMN "minOrderPieces" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrackCampaign" ADD COLUMN "minOrderValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "TrackCampaign" ADD COLUMN "archivedAt" TIMESTAMP(3);
