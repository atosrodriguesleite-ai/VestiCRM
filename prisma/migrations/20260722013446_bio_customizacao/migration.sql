-- AlterTable
ALTER TABLE "BioPage" ADD COLUMN     "bgColor" TEXT,
ADD COLUMN     "buttonColor" TEXT,
ADD COLUMN     "buttonShape" TEXT NOT NULL DEFAULT 'rounded',
ADD COLUMN     "buttonTextColor" TEXT,
ADD COLUMN     "font" TEXT;
