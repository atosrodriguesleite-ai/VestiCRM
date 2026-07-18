-- AlterTable

-- AlterTable
ALTER TABLE "CutTicket" ADD COLUMN     "piecesWeightKg" DOUBLE PRECISION,
ADD COLUMN     "utilizationPct" DOUBLE PRECISION,
ADD COLUMN     "wasteKg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CutItem" (
    "id" TEXT NOT NULL,
    "cutId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'PRIMEIRA',
    "name" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "pieceWeightG" DOUBLE PRECISION,

    CONSTRAINT "CutItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CutItem_cutId_idx" ON "CutItem"("cutId");

-- AddForeignKey
ALTER TABLE "CutItem" ADD CONSTRAINT "CutItem_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "CutTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

