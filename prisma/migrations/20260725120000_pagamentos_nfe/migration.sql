-- Grupo Dinheiro: Mercado Pago (marketplace), contas a receber e NF-e (Bling)

-- Payment: cobrança automática + vencimento
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Payment" ADD COLUMN "mpPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "pixCopiaECola" TEXT;
ALTER TABLE "Payment" ADD COLUMN "pixQrBase64" TEXT;
ALTER TABLE "Payment" ADD COLUMN "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "dueAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Payment_mpPaymentId_key" ON "Payment"("mpPaymentId");
CREATE INDEX "Payment_status_dueAt_idx" ON "Payment"("status", "dueAt");

-- Conexão Mercado Pago (marketplace) por loja
CREATE TABLE "MercadoPagoConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mpUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "publicKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "feePercent" DOUBLE PRECISION,
    "webhookToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MercadoPagoConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MercadoPagoConnection_companyId_key" ON "MercadoPagoConnection"("companyId");
CREATE UNIQUE INDEX "MercadoPagoConnection_webhookToken_key" ON "MercadoPagoConnection"("webhookToken");
ALTER TABLE "MercadoPagoConnection" ADD CONSTRAINT "MercadoPagoConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conexão Bling (NF-e) por loja
CREATE TABLE "BlingConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlingConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BlingConnection_companyId_key" ON "BlingConnection"("companyId");
ALTER TABLE "BlingConnection" ADD CONSTRAINT "BlingConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NF-e no pedido
ALTER TABLE "Order" ADD COLUMN "nfeBlingId" TEXT;
ALTER TABLE "Order" ADD COLUMN "nfeNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "nfeStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "nfeUrl" TEXT;
