-- RECUPERAÇÃO DE CARRINHOS: esteira própria (tela Recuperação).
-- Carrinho abandonado do catálogo e da Nuvemshop num lugar só, com a
-- 1ª mensagem automática opcional por loja (nasce desligada).

ALTER TABLE "Company" ADD COLUMN "recoveryAuto" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AbandonedCart" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "trackSessionId" TEXT,
  "nsCheckoutId" TEXT,
  "customerId" TEXT,
  "items" TEXT NOT NULL DEFAULT '[]',
  "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "checkoutUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NOVO',
  "autoSentAt" TIMESTAMP(3),
  "contactedAt" TIMESTAMP(3),
  "recoveredAt" TIMESTAMP(3),
  "recoveredOrderId" TEXT,
  "lostAt" TIMESTAMP(3),
  "abandonedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AbandonedCart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AbandonedCart_trackSessionId_key" ON "AbandonedCart"("trackSessionId");
CREATE UNIQUE INDEX "AbandonedCart_companyId_nsCheckoutId_key" ON "AbandonedCart"("companyId", "nsCheckoutId");
CREATE INDEX "AbandonedCart_companyId_status_abandonedAt_idx" ON "AbandonedCart"("companyId", "status", "abandonedAt");

ALTER TABLE "AbandonedCart" ADD CONSTRAINT "AbandonedCart_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbandonedCart" ADD CONSTRAINT "AbandonedCart_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AbandonedCart" ADD CONSTRAINT "AbandonedCart_trackSessionId_fkey"
  FOREIGN KEY ("trackSessionId") REFERENCES "TrackSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
