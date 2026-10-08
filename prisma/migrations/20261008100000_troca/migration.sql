-- Troca de peças (RN-073): registro próprio da troca — o pedido original não
-- muda; o estoque anda pelo livro de movimentos e a diferença de dinheiro
-- fica aqui, com a resolução escolhida. Mais o livro de crédito da cliente.
-- Escrita à mão (ADR-001).

CREATE TYPE "TrocaSentido" AS ENUM ('VOLTA', 'SAI');
CREATE TYPE "TrocaDestino" AS ENUM ('ESTOQUE', 'DEFEITO');
CREATE TYPE "TrocaResolucao" AS ENUM ('SEM_DIFERENCA', 'COBRAR', 'CREDITO', 'DEVOLUCAO');

CREATE TABLE "Troca" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "registradaPorId" TEXT,
    "registradaPorNome" TEXT NOT NULL,
    "motivo" TEXT,
    "freteCombinado" TEXT,
    "valorVolta" DOUBLE PRECISION NOT NULL,
    "valorSai" DOUBLE PRECISION NOT NULL,
    "diferenca" DOUBLE PRECISION NOT NULL,
    "resolucao" "TrocaResolucao" NOT NULL,
    "resolvidaEm" TIMESTAMP(3),
    "resolvidaPorNome" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Troca_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Troca_orderId_numero_key" ON "Troca"("orderId", "numero");
CREATE INDEX "Troca_companyId_createdAt_idx" ON "Troca"("companyId", "createdAt");
CREATE INDEX "Troca_companyId_customerId_idx" ON "Troca"("companyId", "customerId");

ALTER TABLE "Troca" ADD CONSTRAINT "Troca_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Troca" ADD CONSTRAINT "Troca_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Troca" ADD CONSTRAINT "Troca_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Troca" ADD CONSTRAINT "Troca_registradaPorId_fkey"
  FOREIGN KEY ("registradaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TrocaItem" (
    "id" TEXT NOT NULL,
    "trocaId" TEXT NOT NULL,
    "sentido" "TrocaSentido" NOT NULL,
    "orderItemId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "color" TEXT,
    "size" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "destino" "TrocaDestino",
    CONSTRAINT "TrocaItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrocaItem_trocaId_idx" ON "TrocaItem"("trocaId");
CREATE INDEX "TrocaItem_orderItemId_idx" ON "TrocaItem"("orderItemId");
CREATE INDEX "TrocaItem_variantId_idx" ON "TrocaItem"("variantId");
CREATE INDEX "TrocaItem_productId_idx" ON "TrocaItem"("productId");

ALTER TABLE "TrocaItem" ADD CONSTRAINT "TrocaItem_trocaId_fkey"
  FOREIGN KEY ("trocaId") REFERENCES "Troca"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrocaItem" ADD CONSTRAINT "TrocaItem_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrocaItem" ADD CONSTRAINT "TrocaItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrocaItem" ADD CONSTRAINT "TrocaItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CustomerCredit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "origem" TEXT NOT NULL,
    "origemId" TEXT,
    "descricao" TEXT NOT NULL,
    "criadoPorNome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerCredit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerCredit_customerId_idx" ON "CustomerCredit"("customerId");
CREATE INDEX "CustomerCredit_companyId_origemId_idx" ON "CustomerCredit"("companyId", "origemId");

ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
