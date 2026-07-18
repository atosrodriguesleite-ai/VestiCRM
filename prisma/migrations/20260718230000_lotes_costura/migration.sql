-- AlterTable

-- CreateTable
CREATE TABLE "SewingFaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "pricePerPiece" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SewingFaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SewingBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COSTURA',
    "destination" TEXT NOT NULL DEFAULT 'INTERNA',
    "factionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENVIADO',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "SewingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SewingBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "sent" INTEGER NOT NULL,
    "good" INTEGER NOT NULL DEFAULT 0,
    "defect" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SewingBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT,
    "productName" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "pieces" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefectItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SewingFaction_companyId_idx" ON "SewingFaction"("companyId");

-- CreateIndex
CREATE INDEX "SewingBatch_companyId_status_idx" ON "SewingBatch"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SewingBatch_companyId_code_key" ON "SewingBatch"("companyId", "code");

-- CreateIndex
CREATE INDEX "SewingBatchItem_batchId_idx" ON "SewingBatchItem"("batchId");

-- CreateIndex
CREATE INDEX "DefectItem_companyId_status_idx" ON "DefectItem"("companyId", "status");

-- AddForeignKey
ALTER TABLE "SewingBatch" ADD CONSTRAINT "SewingBatch_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "SewingFaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SewingBatchItem" ADD CONSTRAINT "SewingBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SewingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

