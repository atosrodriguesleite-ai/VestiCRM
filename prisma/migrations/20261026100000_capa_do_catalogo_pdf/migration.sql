-- RN-094 (item 6): a capa do catálogo em PDF é da loja.
-- A IMAGEM mora em tabela própria (1:1): a Company é lida inteira em
-- dezenas de caminhos quentes (vitrine, webhook) e a capa pesa ~500 KB — a
-- lição da logo (RN-070). Na Company ficam só as chavinhas leves: a faixa
-- com a data, e os ajustes da capa automática (título, linha, peças).
ALTER TABLE "Company" ADD COLUMN "catalogPdfCapaFaixa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" ADD COLUMN "catalogPdfTitulo" TEXT;
ALTER TABLE "Company" ADD COLUMN "catalogPdfSubtitulo" TEXT;
ALTER TABLE "Company" ADD COLUMN "catalogPdfCapaFotos" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "CatalogoCapa" (
  "companyId" TEXT NOT NULL,
  "imagem" TEXT NOT NULL,
  "miniatura" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogoCapa_pkey" PRIMARY KEY ("companyId"),
  CONSTRAINT "CatalogoCapa_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
