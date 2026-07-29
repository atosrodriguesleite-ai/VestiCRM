-- MÓDULO CONTRATADO PASSA A TER PREÇO E HISTÓRICO
--
-- As 5 chavinhas em Company (productionEnabled, marketingEnabled, ...) ligam
-- e desligam o módulo — e só. Não existia preço nem data: ativar era um
-- clique, cobrar era lembrar de somar na mensalidade de cabeça. Resultado:
-- o MRR era um número digitado, não calculado, e ninguém sabia responder
-- "desde quando essa loja tem Produção?".
--
-- Esta tabela guarda HISTÓRICO (nunca apaga linha): permite cobrar
-- proporcional no mês da ativação, preservar o preço de quem contratou antes
-- de um reajuste, e enxergar quanto de desconto foi dado — número que hoje
-- não existe em lugar nenhum do sistema.
--
-- Nada muda para as lojas atuais: a tabela nasce vazia e as chavinhas
-- continuam mandando em quem vê o quê.

CREATE TABLE "CompanyModule" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "modulo"        TEXT NOT NULL,
  "priceMonth"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "listPrice"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "activatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMP(3),
  "notes"         TEXT,
  CONSTRAINT "CompanyModule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyModule_companyId_modulo_activatedAt_key"
  ON "CompanyModule"("companyId", "modulo", "activatedAt");

CREATE INDEX "CompanyModule_companyId_deactivatedAt_idx"
  ON "CompanyModule"("companyId", "deactivatedAt");

ALTER TABLE "CompanyModule"
  ADD CONSTRAINT "CompanyModule_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
