-- FICHA DE FUNCIONÁRIO (RN-025) — pedido do dono, 26/08/2026.
--
-- Registro de RH da EMPRESA, sem vínculo com login: a maior parte dos
-- funcionários nunca entra no sistema. Ficha de ex-funcionário NUNCA é
-- apagada (desligamento arquiva). Salário/documentos/CPF: só ADMIN.

DO $$ BEGIN
  CREATE TYPE "FuncionarioVinculo" AS ENUM ('CLT', 'MEI_PJ', 'DIARISTA', 'ESTAGIO', 'INFORMAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodicidadePagamento" AS ENUM ('MENSAL', 'SEMANAL', 'DIARIA', 'POR_PECA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FormaPagamentoFuncionario" AS ENUM ('PIX', 'DINHEIRO', 'TRANSFERENCIA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FuncionarioDocTipo" AS ENUM ('RG', 'CNH', 'CPF_DOC', 'COMPROVANTE_RESIDENCIA', 'TITULO_ELEITOR', 'RESERVISTA', 'ESCOLARIDADE', 'CERTIDAO', 'ASO', 'CONTRATO', 'VACINACAO', 'FREQUENCIA_ESCOLAR', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Funcionario" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "fotoUrl" TEXT,
    "nascimento" TIMESTAMP(3),
    "cpf" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "zip" TEXT,
    "street" TEXT,
    "streetNumber" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "cargo" TEXT,
    "vinculo" "FuncionarioVinculo" NOT NULL DEFAULT 'INFORMAL',
    "inicio" TIMESTAMP(3),
    "desligamento" TIMESTAMP(3),
    "motivoDesligamento" TEXT,
    "remuneracao" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "periodicidade" "PeriodicidadePagamento" NOT NULL DEFAULT 'MENSAL',
    "formaPagamento" "FormaPagamentoFuncionario" NOT NULL DEFAULT 'PIX',
    "chavePix" TEXT,
    "banco" TEXT,
    "agencia" TEXT,
    "conta" TEXT,
    "emergenciaNome" TEXT,
    "emergenciaParentesco" TEXT,
    "emergenciaTelefone" TEXT,
    "restricaoAlimentar" TEXT,
    "alergias" TEXT,
    "beneficios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Funcionario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FuncionarioDependente" (
    "id" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nascimento" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuncionarioDependente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FuncionarioDocumento" (
    "id" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "dependenteId" TEXT,
    "tipo" "FuncionarioDocTipo" NOT NULL,
    "fileName" TEXT NOT NULL,
    "arquivo" TEXT NOT NULL,
    "validade" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuncionarioDocumento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FuncionarioEvento" (
    "id" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuncionarioEvento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Funcionario_companyId_idx" ON "Funcionario"("companyId");
CREATE INDEX IF NOT EXISTS "FuncionarioDependente_funcionarioId_idx" ON "FuncionarioDependente"("funcionarioId");
CREATE INDEX IF NOT EXISTS "FuncionarioDocumento_funcionarioId_idx" ON "FuncionarioDocumento"("funcionarioId");
CREATE INDEX IF NOT EXISTS "FuncionarioEvento_funcionarioId_idx" ON "FuncionarioEvento"("funcionarioId");

DO $$ BEGIN
  ALTER TABLE "Funcionario" ADD CONSTRAINT "Funcionario_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FuncionarioDependente" ADD CONSTRAINT "FuncionarioDependente_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FuncionarioDocumento" ADD CONSTRAINT "FuncionarioDocumento_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FuncionarioDocumento" ADD CONSTRAINT "FuncionarioDocumento_dependenteId_fkey" FOREIGN KEY ("dependenteId") REFERENCES "FuncionarioDependente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FuncionarioEvento" ADD CONSTRAINT "FuncionarioEvento_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
