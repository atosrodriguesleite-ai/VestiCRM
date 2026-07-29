-- MOTOR DE RECOMPRA: aniversário da cliente + trava da rodada diária
--
-- 1) `Customer.birthDate` — o disparo de aniversário é o de maior conversão
--    do ano numa loja de moda, e o campo simplesmente não existia.
--
-- 2) `Company.automationsRunAt` — trava atômica que faz as automações rodarem
--    "de carona" no tráfego normal, no máximo uma vez por dia por loja.
--    Mesmo padrão do vigia de saúde (`SystemHealth.watchdogRunAt`), e pelo
--    mesmo motivo: o plano Hobby da Vercel só permite 2 crons e as duas vagas
--    já estão ocupadas — um terceiro cron bloqueia TODOS os deploys.

ALTER TABLE "Customer" ADD COLUMN "birthDate" TIMESTAMP(3);

ALTER TABLE "Company" ADD COLUMN "automationsRunAt" TIMESTAMP(3);

-- Varredura diária de aniversariantes (o ano do nascimento não entra na
-- busca — o casamento por mês/dia é feito no servidor).
CREATE INDEX "Customer_companyId_birthDate_idx"
  ON "Customer"("companyId", "birthDate");
