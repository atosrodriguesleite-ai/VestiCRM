-- Fase 6 do módulo Financeiro: conciliação bancária por OFX (RN-035).
-- Migração escrita à mão e IDEMPOTENTE (ADR-001): o banco tem drift e a
-- mesma migração pode ser aplicada mais de uma vez em ambiente de teste.

CREATE TABLE IF NOT EXISTS "FinOfxImportacao" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "contaId"    TEXT NOT NULL,
  "arquivo"    TEXT NOT NULL,
  "banco"      TEXT,
  "periodoDe"  TIMESTAMP(3),
  "periodoAte" TIMESTAMP(3),
  "linhas"     INTEGER NOT NULL DEFAULT 0,
  "novas"      INTEGER NOT NULL DEFAULT 0,
  "autorNome"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinOfxImportacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinOfxLinha" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "contaId"      TEXT NOT NULL,
  "importacaoId" TEXT NOT NULL,
  "fitid"        TEXT NOT NULL,
  "data"         TIMESTAMP(3) NOT NULL,
  "valor"        DOUBLE PRECISION NOT NULL,
  "descricao"    TEXT NOT NULL,
  "ignoradaEm"   TIMESTAMP(3),
  "ignoradaPor"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinOfxLinha_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinOfxVinculo" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "linhaId"    TEXT NOT NULL,
  "baixaId"    TEXT NOT NULL,
  "automatico" BOOLEAN NOT NULL DEFAULT false,
  "autorNome"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinOfxVinculo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinOfxImportacao_companyId_createdAt_idx"
  ON "FinOfxImportacao"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "FinOfxLinha_companyId_contaId_data_idx"
  ON "FinOfxLinha"("companyId", "contaId", "data");
-- o FITID é o identificador que o próprio banco dá ao movimento: é este
-- único que faz reimportar o mesmo arquivo NÃO duplicar nada
CREATE UNIQUE INDEX IF NOT EXISTS "FinOfxLinha_companyId_contaId_fitid_key"
  ON "FinOfxLinha"("companyId", "contaId", "fitid");
CREATE INDEX IF NOT EXISTS "FinOfxVinculo_linhaId_idx" ON "FinOfxVinculo"("linhaId");
-- a mesma baixa não se concilia duas vezes (o mesmo dinheiro apareceria
-- conferido em dois lugares)
CREATE UNIQUE INDEX IF NOT EXISTS "FinOfxVinculo_baixaId_key" ON "FinOfxVinculo"("baixaId");
CREATE UNIQUE INDEX IF NOT EXISTS "FinOfxVinculo_companyId_baixaId_key"
  ON "FinOfxVinculo"("companyId", "baixaId");

DO $$ BEGIN
  ALTER TABLE "FinOfxImportacao" ADD CONSTRAINT "FinOfxImportacao_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxImportacao" ADD CONSTRAINT "FinOfxImportacao_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "FinConta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxLinha" ADD CONSTRAINT "FinOfxLinha_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxLinha" ADD CONSTRAINT "FinOfxLinha_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "FinConta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxLinha" ADD CONSTRAINT "FinOfxLinha_importacaoId_fkey"
    FOREIGN KEY ("importacaoId") REFERENCES "FinOfxImportacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxVinculo" ADD CONSTRAINT "FinOfxVinculo_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxVinculo" ADD CONSTRAINT "FinOfxVinculo_linhaId_fkey"
    FOREIGN KEY ("linhaId") REFERENCES "FinOfxLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinOfxVinculo" ADD CONSTRAINT "FinOfxVinculo_baixaId_fkey"
    FOREIGN KEY ("baixaId") REFERENCES "FinBaixa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
