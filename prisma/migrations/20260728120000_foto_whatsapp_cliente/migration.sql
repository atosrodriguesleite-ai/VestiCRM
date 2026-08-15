-- Foto de perfil do WhatsApp da cliente.
-- Guardamos só o LINK que o próprio WhatsApp serve (a imagem NUNCA entra no
-- banco). Como esse link vence, `photoSyncAt` registra quando ele foi
-- conferido — passando da validade, o sistema busca de novo.
ALTER TABLE "Customer" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "Customer" ADD COLUMN "photoSyncAt" TIMESTAMP(3);

-- Índice da varredura: acha rápido quem está sem foto ou com foto vencida.
CREATE INDEX "Customer_companyId_photoSyncAt_idx" ON "Customer"("companyId", "photoSyncAt");
