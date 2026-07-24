-- Recibos com horário, edição e "apagar para todos" nas mensagens
ALTER TABLE "Message" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "revoked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN "revokedBy" TEXT;
