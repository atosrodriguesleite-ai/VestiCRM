-- Corte multi-rolo/multi-cor: o corte passa a referenciar VÁRIOS rolos
-- (CutRoll, com peso por rolo) e as peças ganham cor. Os cortes existentes
-- (1 rolo) são migrados para o novo formato sem perder nada.

-- DropForeignKey
ALTER TABLE "CutTicket" DROP CONSTRAINT "CutTicket_rollId_fkey";

-- AlterTable
ALTER TABLE "CutItem" ADD COLUMN     "color" TEXT;

-- CreateTable
CREATE TABLE "CutRoll" (
    "id" TEXT NOT NULL,
    "cutId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "plannedKg" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CutRoll_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CutRoll_cutId_idx" ON "CutRoll"("cutId");

-- CreateIndex
CREATE INDEX "CutRoll_rollId_idx" ON "CutRoll"("rollId");

-- AddForeignKey
ALTER TABLE "CutRoll" ADD CONSTRAINT "CutRoll_cutId_fkey" FOREIGN KEY ("cutId") REFERENCES "CutTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CutRoll" ADD CONSTRAINT "CutRoll_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migra os cortes existentes (1 rolo) para o novo formato
INSERT INTO "CutRoll" ("id", "cutId", "rollId", "plannedKg")
SELECT substr(md5((random())::text || (clock_timestamp())::text || "id"), 1, 25),
       "id", "rollId", "plannedKg"
FROM "CutTicket"
WHERE "rollId" IS NOT NULL;

-- Peças dos cortes migrados herdam a cor do (único) rolo
UPDATE "CutItem" ci
SET "color" = fr."color"
FROM "CutTicket" ct
JOIN "FabricRoll" fr ON fr."id" = ct."rollId"
WHERE ci."cutId" = ct."id" AND ci."color" IS NULL;

-- AlterTable
ALTER TABLE "CutTicket" DROP COLUMN "rollId";
