-- Sincronização da Nuvemshop em etapas com rastro: em que página/produto a
-- última rodada estava quando a função morreu (Entre Linhas, 15/09/2026).
-- Escrita à mão (ADR-001); nada destrutivo.
ALTER TABLE "NuvemshopConnection" ADD COLUMN "lastSyncEtapa" TEXT;
