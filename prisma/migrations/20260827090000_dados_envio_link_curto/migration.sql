-- Link CURTO do formulário "Dados de envio" (RN-024): o crachá sai da URL e
-- vira um código de 11 caracteres guardado aqui. Escrita à mão (ADR-001).
CREATE TABLE "DadosEnvioLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DadosEnvioLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DadosEnvioLink_code_key" ON "DadosEnvioLink"("code");
CREATE INDEX "DadosEnvioLink_customerId_idx" ON "DadosEnvioLink"("customerId");

ALTER TABLE "DadosEnvioLink" ADD CONSTRAINT "DadosEnvioLink_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DadosEnvioLink" ADD CONSTRAINT "DadosEnvioLink_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
