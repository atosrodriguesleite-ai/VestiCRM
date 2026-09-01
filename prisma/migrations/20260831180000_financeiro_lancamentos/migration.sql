-- MÓDULO FINANCEIRO (RN-030) — Fase 2: lançamentos, parcelas, baixas,
-- anexos e histórico. Conta a receber e a pagar são a mesma peça (`tipo`).
-- Escrita à mão (ADR-001) e idempotente: rodar duas vezes não quebra.

CREATE TABLE IF NOT EXISTS "FinLancamento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "documento" TEXT,
    "competencia" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "fornecedorId" TEXT,
    "categoriaId" TEXT,
    "centroCustoId" TEXT,
    "colecaoId" TEXT,
    "valor" DOUBLE PRECISION NOT NULL,
    "observacoes" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "origemId" TEXT,
    "canceladoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinLancamento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinLancamento_companyId_tipo_idx" ON "FinLancamento"("companyId", "tipo");
-- 1 pedido = 1 lançamento, nunca duplica (a porta única da Fase 4 se apoia
-- nisto; no Postgres NULLs são distintos, então lançamento MANUAL não colide)
CREATE UNIQUE INDEX IF NOT EXISTS "FinLancamento_companyId_origem_origemId_key"
    ON "FinLancamento"("companyId", "origem", "origemId");

CREATE TABLE IF NOT EXISTS "FinParcela" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "contaId" TEXT,
    "forma" TEXT NOT NULL DEFAULT 'PIX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinParcela_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinParcela_companyId_vencimento_idx" ON "FinParcela"("companyId", "vencimento");
CREATE INDEX IF NOT EXISTS "FinParcela_lancamentoId_idx" ON "FinParcela"("lancamentoId");

CREATE TABLE IF NOT EXISTS "FinBaixa" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parcelaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "desconto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "juros" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "autorNome" TEXT NOT NULL,
    "estornadaEm" TIMESTAMP(3),
    "estornoAutor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinBaixa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinBaixa_companyId_data_idx" ON "FinBaixa"("companyId", "data");
CREATE INDEX IF NOT EXISTS "FinBaixa_parcelaId_idx" ON "FinBaixa"("parcelaId");

CREATE TABLE IF NOT EXISTS "FinAnexo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "arquivo" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinAnexo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinAnexo_lancamentoId_idx" ON "FinAnexo"("lancamentoId");

CREATE TABLE IF NOT EXISTS "FinLancamentoEvento" (
    "id" TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinLancamentoEvento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinLancamentoEvento_lancamentoId_createdAt_idx"
    ON "FinLancamentoEvento"("lancamentoId", "createdAt");

-- chaves estrangeiras (com guarda: já existir não é erro)
DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_fornecedorId_fkey"
        FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_categoriaId_fkey"
        FOREIGN KEY ("categoriaId") REFERENCES "FinCategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_centroCustoId_fkey"
        FOREIGN KEY ("centroCustoId") REFERENCES "FinCentroCusto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamento" ADD CONSTRAINT "FinLancamento_colecaoId_fkey"
        FOREIGN KEY ("colecaoId") REFERENCES "FinColecao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinParcela" ADD CONSTRAINT "FinParcela_lancamentoId_fkey"
        FOREIGN KEY ("lancamentoId") REFERENCES "FinLancamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinParcela" ADD CONSTRAINT "FinParcela_contaId_fkey"
        FOREIGN KEY ("contaId") REFERENCES "FinConta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinBaixa" ADD CONSTRAINT "FinBaixa_parcelaId_fkey"
        FOREIGN KEY ("parcelaId") REFERENCES "FinParcela"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- a conta da baixa NÃO cai para NULL: baixa sem conta seria dinheiro que
-- andou sem dizer de onde (e o extrato não fecharia). Conta se ARQUIVA.
DO $$ BEGIN
    ALTER TABLE "FinBaixa" ADD CONSTRAINT "FinBaixa_contaId_fkey"
        FOREIGN KEY ("contaId") REFERENCES "FinConta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinAnexo" ADD CONSTRAINT "FinAnexo_lancamentoId_fkey"
        FOREIGN KEY ("lancamentoId") REFERENCES "FinLancamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinLancamentoEvento" ADD CONSTRAINT "FinLancamentoEvento_lancamentoId_fkey"
        FOREIGN KEY ("lancamentoId") REFERENCES "FinLancamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
