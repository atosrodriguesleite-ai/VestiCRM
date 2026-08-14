-- CONEXÃO INFINITEPAY (checkout por link, 11/08/2026).
--
-- A loja conecta com a InfiniteTag (handle); o dinheiro cai direto na conta
-- dela. `webhookToken` autentica o aviso de pagamento; `apiToken` (opcional,
-- criptografado) atende contas que exigem autenticação para gerar link.
--
-- REEXECUTÁVEL (IF NOT EXISTS / EXCEPTION): roda contra produção com lojas
-- operando — se o deploy cair no meio, a nova tentativa não pode quebrar.
CREATE TABLE IF NOT EXISTS "InfinitePayConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "apiToken" TEXT,
    "webhookToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfinitePayConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InfinitePayConnection_companyId_key"
    ON "InfinitePayConnection"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "InfinitePayConnection_webhookToken_key"
    ON "InfinitePayConnection"("webhookToken");

DO $$ BEGIN
  ALTER TABLE "InfinitePayConnection"
    ADD CONSTRAINT "InfinitePayConnection_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
