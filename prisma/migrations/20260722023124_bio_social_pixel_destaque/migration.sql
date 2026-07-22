-- AlterTable
ALTER TABLE "BioLink" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BioPage" ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "gaId" TEXT,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "metaPixelId" TEXT,
ADD COLUMN     "tiktok" TEXT,
ADD COLUMN     "youtube" TEXT;
