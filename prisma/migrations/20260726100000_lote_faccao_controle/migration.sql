-- Controle completo do lote de facção: responsáveis, prazos, pagamento e
-- custo por peça congelado por item (preço histórico — mudar a tabela da
-- facção não altera mais o custo dos lotes já enviados).

ALTER TABLE "SewingBatch" ADD COLUMN "sentBy" TEXT;
ALTER TABLE "SewingBatch" ADD COLUMN "receivedBy" TEXT;
ALTER TABLE "SewingBatch" ADD COLUMN "dueBackDate" TIMESTAMP(3);
ALTER TABLE "SewingBatch" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE "SewingBatch" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "SewingBatch" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "SewingBatch" ADD COLUMN "paidAmount" DOUBLE PRECISION;
ALTER TABLE "SewingBatch" ADD COLUMN "paymentNotes" TEXT;

ALTER TABLE "SewingBatchItem" ADD COLUMN "pricePerPiece" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "SewingBatch_companyId_paymentStatus_idx" ON "SewingBatch"("companyId", "paymentStatus");

-- Congela nos lotes JÁ EXISTENTES o preço atual da facção: daqui pra frente
-- o histórico fica imune a mudanças de tabela (lotes sem facção ficam em 0).
UPDATE "SewingBatchItem" AS i
SET "pricePerPiece" = f."pricePerPiece"
FROM "SewingBatch" AS b
JOIN "SewingFaction" AS f ON f."id" = b."factionId"
WHERE i."batchId" = b."id" AND f."pricePerPiece" > 0;
