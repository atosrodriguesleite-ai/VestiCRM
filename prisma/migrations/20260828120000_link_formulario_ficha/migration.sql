-- LINK DO FORMULÁRIO DA FICHA (RN-025, 2ª entrega): o funcionário preenche a
-- própria ficha pelo celular, sem login. Código sorteado, 7 dias, uso único;
-- a resposta fica AGUARDANDO CONFERÊNCIA do admin antes de entrar na ficha.
-- Escrita à mão (ADR-001) e idempotente: rodar duas vezes não quebra.

CREATE TABLE IF NOT EXISTS "FichaFormLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "aceiteLGPDEm" TIMESTAMP(3),
    "resposta" JSONB,
    "conferidoEm" TIMESTAMP(3),
    "docsEnviados" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FichaFormLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FichaFormLink_code_key" ON "FichaFormLink"("code");
CREATE INDEX IF NOT EXISTS "FichaFormLink_funcionarioId_idx" ON "FichaFormLink"("funcionarioId");

DO $$ BEGIN
    ALTER TABLE "FichaFormLink" ADD CONSTRAINT "FichaFormLink_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FichaFormLink" ADD CONSTRAINT "FichaFormLink_funcionarioId_fkey"
        FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
