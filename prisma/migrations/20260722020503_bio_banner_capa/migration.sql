-- AlterTable
ALTER TABLE "BioLink" ADD COLUMN     "layout" TEXT NOT NULL DEFAULT 'normal';

-- AlterTable
ALTER TABLE "BioPage" ADD COLUMN     "coverUrl" TEXT;
