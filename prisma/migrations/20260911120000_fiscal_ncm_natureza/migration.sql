-- RN-054 + RN-055: a informação fiscal passa a morar NO ATACADOPRO.
--
-- Até aqui a nota saía sem NCM e sem natureza, contando com o cadastro de
-- produto e a natureza padrão da conta do Bling. Isso obrigava a loja a mantar
-- um segundo catálogo lá, e fazia TODA nota sair pela mesma natureza — errado
-- para quem vende a lojista com CNPJ e inscrição estadual.
--
-- Escrita à mão (ADR-001). Nada destrutivo: tudo nasce nulo, e loja que não
-- configurar continua emitindo exatamente como emitia.

-- NCM da peça (a exceção; o normal é o da categoria)
ALTER TABLE "Product" ADD COLUMN "ncm" TEXT;

-- NCM por categoria: onde a informação fiscal do atacado mora de verdade
CREATE TABLE "FiscalCategoria" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "ncm" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalCategoria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiscalCategoria_companyId_category_key"
  ON "FiscalCategoria"("companyId", "category");
ALTER TABLE "FiscalCategoria"
  ADD CONSTRAINT "FiscalCategoria_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- configuração fiscal da loja, junto da conexão do Bling
ALTER TABLE "BlingConnection" ADD COLUMN "naturezaContribuinteId" INTEGER;
ALTER TABLE "BlingConnection" ADD COLUMN "naturezaNaoContribuinteId" INTEGER;
ALTER TABLE "BlingConnection" ADD COLUMN "origemMercadoria" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BlingConnection" ADD COLUMN "ncmPadrao" TEXT;
