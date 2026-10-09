-- RN-076 · VENDE SOB ENCOMENDA. Escrita à mão (ADR-001).
-- A peça: nulo = segue a categoria; true/false = a peça manda.
ALTER TABLE "Product" ADD COLUMN "sobEncomenda" BOOLEAN;

-- A categoria: a linha existe = a categoria vende além do estoque.
CREATE TABLE "SobEncomendaCategoria" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SobEncomendaCategoria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SobEncomendaCategoria_companyId_category_key"
    ON "SobEncomendaCategoria"("companyId", "category");

ALTER TABLE "SobEncomendaCategoria"
    ADD CONSTRAINT "SobEncomendaCategoria_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
