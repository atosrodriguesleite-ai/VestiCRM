-- CreateTable
CREATE TABLE "BioView" (
    "id" TEXT NOT NULL,
    "bioPageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioClick" (
    "id" TEXT NOT NULL,
    "bioLinkId" TEXT NOT NULL,
    "bioPageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BioView_bioPageId_createdAt_idx" ON "BioView"("bioPageId", "createdAt");

-- CreateIndex
CREATE INDEX "BioClick_bioPageId_createdAt_idx" ON "BioClick"("bioPageId", "createdAt");

-- CreateIndex
CREATE INDEX "BioClick_bioLinkId_createdAt_idx" ON "BioClick"("bioLinkId", "createdAt");
