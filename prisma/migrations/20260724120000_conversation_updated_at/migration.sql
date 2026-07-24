-- Sync incremental da inbox: detectar conversas alteradas desde a última busca
ALTER TABLE "Conversation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Conversation_companyId_updatedAt_idx" ON "Conversation"("companyId", "updatedAt");
