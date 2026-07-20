-- AlterTable

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "jueriId" TEXT;

-- CreateTable
CREATE TABLE "JueriConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteSistema" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JueriConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JueriConnection_companyId_key" ON "JueriConnection"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_jueriId_key" ON "Product"("companyId", "jueriId");

-- AddForeignKey
ALTER TABLE "JueriConnection" ADD CONSTRAINT "JueriConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

