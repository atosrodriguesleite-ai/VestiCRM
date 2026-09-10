-- RN-053: o envio de estoque para a Nuvemshop não se perde mais calado.
--
-- Relato do dono (10/09/2026): a mesma peça com 0 aqui e 41 na Nuvemshop.
-- A causa é o aviso de baixa que nunca chegou lá — a chamada é solta (a
-- Vercel congela a função junto com a resposta) e a recusa do provedor era
-- ignorada. Escrita à mão (ADR-001); nada destrutivo.
CREATE TABLE "NuvemshopEstoquePendente" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "proximaEm" TIMESTAMP(3),
  "ultimoErro" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NuvemshopEstoquePendente_pkey" PRIMARY KEY ("id")
);
-- uma fila por peça: a venda seguinte da mesma peça ATUALIZA a linha
CREATE UNIQUE INDEX "NuvemshopEstoquePendente_variantId_key"
  ON "NuvemshopEstoquePendente"("variantId");
CREATE INDEX "NuvemshopEstoquePendente_companyId_proximaEm_idx"
  ON "NuvemshopEstoquePendente"("companyId", "proximaEm");
ALTER TABLE "NuvemshopEstoquePendente"
  ADD CONSTRAINT "NuvemshopEstoquePendente_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NuvemshopEstoquePendente"
  ADD CONSTRAINT "NuvemshopEstoquePendente_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Company" ADD COLUMN "nsEstoqueRunAt" TIMESTAMP(3);
