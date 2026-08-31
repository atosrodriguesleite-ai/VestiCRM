-- MÓDULO FINANCEIRO (RN-027) — Fase 1: chavinha por loja + cadastros-fundação
-- (contas, categorias, centros de custo, coleções, fornecedores).
-- Escrita à mão (ADR-001) e idempotente: rodar duas vezes não quebra.

-- chavinha do módulo (pago à parte; super admin liga por loja)
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "financeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Conta financeira: onde o dinheiro mora (banco, caixinha, digital)
CREATE TABLE IF NOT EXISTS "FinConta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'BANCO',
    "saldoInicial" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saldoInicialEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cor" TEXT NOT NULL DEFAULT '#0E8A5F',
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "arquivadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinConta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinConta_companyId_idx" ON "FinConta"("companyId");

-- Categoria financeira: a etiqueta do dinheiro, em árvore numerada
CREATE TABLE IF NOT EXISTS "FinCategoria" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "paiId" TEXT,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "arquivadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinCategoria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinCategoria_companyId_codigo_key" ON "FinCategoria"("companyId", "codigo");
CREATE INDEX IF NOT EXISTS "FinCategoria_companyId_idx" ON "FinCategoria"("companyId");

-- Centro de custo: a "frente" do negócio (opcional)
CREATE TABLE IF NOT EXISTS "FinCentroCusto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinCentroCusto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinCentroCusto_companyId_idx" ON "FinCentroCusto"("companyId");

-- Coleção: o "Projetos" traduzido para moda ("Inverno 2026 deu lucro?")
CREATE TABLE IF NOT EXISTS "FinColecao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "inicio" TIMESTAMP(3),
    "fim" TIMESTAMP(3),
    "arquivadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinColecao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinColecao_companyId_idx" ON "FinColecao"("companyId");

-- Fornecedor: o outro lado das contas a pagar
CREATE TABLE IF NOT EXISTS "Fornecedor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "cnpj" TEXT,
    "cpf" TEXT,
    "ie" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "chavePix" TEXT,
    "dadosBancarios" TEXT,
    "observacoes" TEXT,
    "categoriaPadraoId" TEXT,
    "arquivadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Fornecedor_companyId_idx" ON "Fornecedor"("companyId");

-- chaves estrangeiras (com guarda: já existir não é erro)
DO $$ BEGIN
    ALTER TABLE "FinConta" ADD CONSTRAINT "FinConta_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinCategoria" ADD CONSTRAINT "FinCategoria_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinCategoria" ADD CONSTRAINT "FinCategoria_paiId_fkey"
        FOREIGN KEY ("paiId") REFERENCES "FinCategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinCentroCusto" ADD CONSTRAINT "FinCentroCusto_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "FinColecao" ADD CONSTRAINT "FinColecao_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_categoriaPadraoId_fkey"
        FOREIGN KEY ("categoriaPadraoId") REFERENCES "FinCategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- só UMA conta padrão por loja, garantido NO BANCO (achado da revisão de
-- 31/08/2026): duas transações concorrentes marcando contas diferentes não
-- se enxergam em read committed — o índice parcial derruba a segunda.
-- (índice parcial não existe no Prisma schema; vive só aqui, drift conhecido)
CREATE UNIQUE INDEX IF NOT EXISTS "FinConta_companyId_padrao_key"
    ON "FinConta"("companyId") WHERE "padrao";
