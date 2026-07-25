-- Cartão de crédito no Mercado Pago: link parcelado + limite de parcelas
ALTER TABLE "MercadoPagoConnection" ADD COLUMN "maxInstallments" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "Payment" ADD COLUMN "checkoutUrl" TEXT;
