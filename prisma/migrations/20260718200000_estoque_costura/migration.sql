-- AlterTable

-- AlterTable
ALTER TABLE "CutItem" ADD COLUMN     "size" TEXT;

-- CreateTable
CREATE TABLE "SewingItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cutId" TEXT,
    "cutCode" INTEGER,
    "productName" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "cutPieces" INTEGER NOT NULL,
    "donePieces" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SewingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SewingItem_companyId_idx" ON "SewingItem"("companyId");

