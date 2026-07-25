-- Módulo Envios (Melhor Envio): chave por loja, peso no produto,
-- conexão com tokens criptografados e campos de frete comprado no Shipping.

ALTER TABLE "Company" ADD COLUMN "shippingEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product" ADD COLUMN "weightGrams" INTEGER;

ALTER TABLE "Shipping" ADD COLUMN "meOrderId" TEXT;
ALTER TABLE "Shipping" ADD COLUMN "meService" TEXT;
ALTER TABLE "Shipping" ADD COLUMN "meCarrier" TEXT;
ALTER TABLE "Shipping" ADD COLUMN "mePrice" DOUBLE PRECISION;
ALTER TABLE "Shipping" ADD COLUMN "meStatus" TEXT;
ALTER TABLE "Shipping" ADD COLUMN "labelUrl" TEXT;
ALTER TABLE "Shipping" ADD COLUMN "weightKg" DOUBLE PRECISION;

CREATE TABLE "MelhorEnvioConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromName" TEXT,
    "fromDocument" TEXT,
    "fromPhone" TEXT,
    "fromEmail" TEXT,
    "fromZip" TEXT,
    "fromStreet" TEXT,
    "fromNumber" TEXT,
    "fromComplement" TEXT,
    "fromDistrict" TEXT,
    "fromCity" TEXT,
    "fromState" TEXT,
    "defaultWeightGrams" INTEGER NOT NULL DEFAULT 300,
    "boxWidthCm" INTEGER NOT NULL DEFAULT 30,
    "boxHeightCm" INTEGER NOT NULL DEFAULT 15,
    "boxLengthCm" INTEGER NOT NULL DEFAULT 40,
    "categoryWeights" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MelhorEnvioConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MelhorEnvioConnection_companyId_key" ON "MelhorEnvioConnection"("companyId");

ALTER TABLE "MelhorEnvioConnection" ADD CONSTRAINT "MelhorEnvioConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
