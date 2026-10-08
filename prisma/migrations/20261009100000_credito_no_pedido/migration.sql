-- Crédito de troca abatido no pedido (RN-074). Coluna com padrão constante:
-- no Postgres 11+ é só metadado, não reescreve a tabela. Escrita à mão (ADR-001).
ALTER TABLE "Order" ADD COLUMN "creditoTroca" DOUBLE PRECISION NOT NULL DEFAULT 0;
