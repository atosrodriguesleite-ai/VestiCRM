-- IA DE VENDAS — Entrega 1 (fundação, sem chave de API):
-- chave do módulo por loja + cérebro configurável + trava de uso mensal.
-- Tudo nasce DESLIGADO: ligar é decisão do Super Admin (módulo) e da loja
-- (comportamentos).

ALTER TABLE "Company" ADD COLUMN "aiSalesEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "atendente" BOOLEAN NOT NULL DEFAULT false,
    "copilot" BOOLEAN NOT NULL DEFAULT false,
    "relatoriosAoDono" BOOLEAN NOT NULL DEFAULT false,
    "tomDeMarca" TEXT NOT NULL DEFAULT '',
    "roteiro" TEXT NOT NULL DEFAULT '',
    "politicas" TEXT NOT NULL DEFAULT '',
    "limiteConversasMes" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiSettings_companyId_key" ON "AiSettings"("companyId");

ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "conversas" INTEGER NOT NULL DEFAULT 0,
    "respostas" INTEGER NOT NULL DEFAULT 0,
    "custoUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsage_companyId_mes_key" ON "AiUsage"("companyId", "mes");
CREATE INDEX "AiUsage_companyId_idx" ON "AiUsage"("companyId");

ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
