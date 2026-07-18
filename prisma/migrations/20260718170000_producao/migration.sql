-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "productionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Fabric" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT,
    "supplier" TEXT,
    "grammage" INTEGER,
    "composition" TEXT,
    "widthM" DOUBLE PRECISION NOT NULL,
    "yieldMPerKg" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fabric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricRoll" (
    "id" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "lotCode" TEXT,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "remainingKg" DOUBLE PRECISION NOT NULL,
    "pricePerKg" DOUBLE PRECISION NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "FabricRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CutTicket" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator" TEXT,
    "tableName" TEXT,
    "tableLengthM" DOUBLE PRECISION,
    "rollId" TEXT,
    "sourceScrapId" TEXT,
    "plannedKg" DOUBLE PRECISION NOT NULL,
    "usedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "planName" TEXT,
    "productName" TEXT,
    "gradeInfo" TEXT,
    "lengthM" DOUBLE PRECISION,
    "sheets" INTEGER,
    "piecesFirst" INTEGER,
    "predictedTotal" DOUBLE PRECISION,
    "predictedMin" DOUBLE PRECISION,
    "predictedMax" DOUBLE PRECISION,
    "predictedBasis" INTEGER NOT NULL DEFAULT 0,
    "piecesRest" INTEGER,
    "piecesTotal" INTEGER,
    "errorPieces" DOUBLE PRECISION,
    "fabricCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costItems" TEXT NOT NULL DEFAULT '[]',
    "costPerPiece" DOUBLE PRECISION,
    "notes" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CutTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CutOccurrence" (
    "id" TEXT NOT NULL,
    "cutId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "lostKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lostM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CutOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricScrap" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cutId" TEXT,
    "fabricName" TEXT NOT NULL,
    "color" TEXT,
    "grammage" INTEGER,
    "widthM" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "estimatedM" DOUBLE PRECISION,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geometry" TEXT,
    "quality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISPONIVEL',
    "usedInCutId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FabricScrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tables" TEXT NOT NULL DEFAULT '[]',
    "operators" TEXT NOT NULL DEFAULT '[]',
    "occurrenceTypes" TEXT NOT NULL DEFAULT '["Furo","Mancha","Defeito","Falta de largura","Rasgo","Borda ruim","Torção","Outro"]',
    "costItems" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "ProductionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fabric_companyId_idx" ON "Fabric"("companyId");

-- CreateIndex
CREATE INDEX "FabricRoll_fabricId_idx" ON "FabricRoll"("fabricId");

-- CreateIndex
CREATE INDEX "CutTicket_companyId_status_idx" ON "CutTicket"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CutTicket_companyId_code_key" ON "CutTicket"("companyId", "code");

-- CreateIndex
CREATE INDEX "CutOccurrence_cutId_idx" ON "CutOccurrence"("cutId");

-- CreateIndex
CREATE INDEX "FabricScrap_companyId_status_idx" ON "FabricScrap"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionSettings_companyId_key" ON "ProductionSettings"("companyId");

-- AddForeignKey
ALTER TABLE "Fabric" ADD CONSTRAINT "Fabric_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricRoll" ADD CONSTRAINT "FabricRoll_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CutTicket" ADD CONSTRAINT "CutTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CutTicket" ADD CONSTRAINT "CutTicket_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CutOccurrence" ADD CONSTRAINT "CutOccurrence_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "CutTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricScrap" ADD CONSTRAINT "FabricScrap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricScrap" ADD CONSTRAINT "FabricScrap_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "CutTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

