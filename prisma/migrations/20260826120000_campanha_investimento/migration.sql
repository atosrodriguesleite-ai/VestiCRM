-- Quanto a loja investiu na campanha (R$, digitado por ela) — vira o
-- "retorno por R$ 1 investido" no ranking do Marketing.
ALTER TABLE "MarketingCampaign" ADD COLUMN "investment" DOUBLE PRECISION NOT NULL DEFAULT 0;
