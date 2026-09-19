-- Separação por leitor (RN-060): rascunho descartado quando o pedido sai da
-- fila. Escrita à mão (ADR-001); nada destrutivo.
ALTER TABLE "Separacao" ADD COLUMN "descartadaEm" TIMESTAMP(3);
-- UMA separação ATIVA por pedido: nem concluída nem descartada
DROP INDEX IF EXISTS "Separacao_ativa_key";
CREATE UNIQUE INDEX "Separacao_ativa_key" ON "Separacao"("orderId") WHERE "concluidaEm" IS NULL AND "descartadaEm" IS NULL;
