-- AlterTable
ALTER TABLE "CommSettings" ADD COLUMN     "defaultSetorId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "setorId" TEXT;

-- CreateTable
CREATE TABLE "Setor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_SetorUsers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SetorUsers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Setor_companyId_idx" ON "Setor"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Setor_companyId_name_key" ON "Setor"("companyId", "name");

-- CreateIndex
CREATE INDEX "_SetorUsers_B_index" ON "_SetorUsers"("B");

-- AddForeignKey
ALTER TABLE "Setor" ADD CONSTRAINT "Setor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_setorId_fkey" FOREIGN KEY ("setorId") REFERENCES "Setor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SetorUsers" ADD CONSTRAINT "_SetorUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "Setor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SetorUsers" ADD CONSTRAINT "_SetorUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
