-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "suspended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastActiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CompanyBilling" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TESTE',
    "implementationFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "implementationPaid" BOOLEAN NOT NULL DEFAULT false,
    "implementationPaidAt" TIMESTAMP(3),
    "monthlyFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDay" INTEGER NOT NULL DEFAULT 10,
    "paidThrough" TIMESTAMP(3),
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "competencia" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBilling_companyId_key" ON "CompanyBilling"("companyId");

-- CreateIndex
CREATE INDEX "BillingPayment_companyId_paidAt_idx" ON "BillingPayment"("companyId", "paidAt");

-- AddForeignKey
ALTER TABLE "CompanyBilling" ADD CONSTRAINT "CompanyBilling_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "CompanyBilling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

