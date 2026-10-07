-- Link de fotos para a cliente (RN-070): galeria sem preço, válida por 7
-- dias, filtro sobre as fotos do catálogo. Escrita à mão (ADR-001).
CREATE TABLE "FotosLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categorias" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "soComEstoque" BOOLEAN NOT NULL DEFAULT true,
    "sellerId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "customerId" TEXT,
    "aberturas" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FotosLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FotosLink_code_key" ON "FotosLink"("code");
CREATE INDEX "FotosLink_companyId_createdAt_idx" ON "FotosLink"("companyId", "createdAt");

ALTER TABLE "FotosLink" ADD CONSTRAINT "FotosLink_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
