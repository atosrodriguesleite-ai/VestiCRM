-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "marketingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'INSTAGRAM',
    "utmKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingCampaign_companyId_active_idx" ON "MarketingCampaign"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_companyId_utmKey_key" ON "MarketingCampaign"("companyId", "utmKey");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

