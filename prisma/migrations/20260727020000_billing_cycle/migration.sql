-- Ciclo do contrato da loja (como a recorrência é cobrada).
-- O valor mensal segue sendo a régua do MRR; o ciclo diz se a loja paga
-- de mês em mês, de 6 em 6 meses ou uma vez por ano.
ALTER TABLE "CompanyBilling" ADD COLUMN "cycle" TEXT NOT NULL DEFAULT 'MENSAL';
