-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "minOrderMode" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "minOrderValue" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Preserva travas por peças já configuradas (minOrder > 0 vira modo PECAS)
UPDATE "Company" SET "minOrderMode" = 'PECAS' WHERE "minOrder" > 0;
