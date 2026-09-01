-- MÓDULO FINANCEIRO — Fase 3: contas fixas (RN-031) e transferências (RN-032).
-- Escrita à mão (ADR-001) e idempotente: rodar duas vezes não quebra.

-- CONTA FIXA: o molde que gera os lançamentos dos próximos meses
CREATE TABLE IF NOT EXISTS "FinRecorrencia" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "diaVencimento" INTEGER NOT NULL,
    "customerId" TEXT,
    "fornecedorId" TEXT,
    "categoriaId" TEXT,
    "centroCustoId" TEXT,
    "colecaoId" TEXT,
    "contaId" TEXT,
    "forma" TEXT NOT NULL DEFAULT 'PIX',
    "observacoes" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "geradoAte" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinRecorrencia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinRecorrencia_companyId_ativa_idx" ON "FinRecorrencia"("companyId", "ativa");

-- TRANSFERÊNCIA entre contas da própria loja (duas datas: saiu / caiu)
CREATE TABLE IF NOT EXISTS "FinTransferencia" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contaOrigemId" TEXT NOT NULL,
    "contaDestinoId" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "dataSaida" TIMESTAMP(3) NOT NULL,
    "dataEntrada" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT,
    "autorNome" TEXT NOT NULL,
    "canceladaEm" TIMESTAMP(3),
    "canceladaPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinTransferencia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinTransferencia_companyId_dataSaida_idx" ON "FinTransferencia"("companyId", "dataSaida");

-- vínculo do lançamento com a conta fixa que o gerou (1 por mês, sem duplicar)
ALTER TABLE "FinLancamento" ADD COLUMN IF NOT EXISTS "recorrenciaId" TEXT;
ALTER TABLE "FinLancamento" ADD COLUMN IF NOT EXISTS "recorrenciaMes" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "FinLancamento_recorrenciaId_recorrenciaMes_key"
    ON "FinLancamento"("recorrenciaId", "recorrenciaMes");

-- chaves estrangeiras (com guarda: já existir não é erro)
DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_fornecedorId_fkey"
        FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_categoriaId_fkey"
        FOREIGN KEY ("categoriaId") REFERENCES "FinCategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_centroCustoId_fkey"
        FOREIGN KEY ("centroCustoId") REFERENCES "FinCentroCusto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_colecaoId_fkey"
        FOREIGN KEY ("colecaoId") REFERENCES "FinColecao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_contaId_fkey"
        FOREIGN KEY ("contaId") REFERENCES "FinConta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_recorrenciaId_fkey"
        FOREIGN KEY ("recorrenciaId") REFERENCES "FinRecorrencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinTransferencia" ADD CONSTRAINT "FinTransferencia_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- as contas da transferência NÃO caem para NULL: dinheiro que andou sem dizer
-- de onde e para onde não fecha extrato nenhum. Conta se ARQUIVA.
DO $$ BEGIN
    ALTER TABLE "FinTransferencia" ADD CONSTRAINT "FinTransferencia_contaOrigemId_fkey"
        FOREIGN KEY ("contaOrigemId") REFERENCES "FinConta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinTransferencia" ADD CONSTRAINT "FinTransferencia_contaDestinoId_fkey"
        FOREIGN KEY ("contaDestinoId") REFERENCES "FinConta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
