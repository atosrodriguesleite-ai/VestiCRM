-- Parte do crédito de uma troca que já tinha sido usada quando o pedido foi
-- cancelado (RN-074): abatida na devolução, conta como estornada. Escrita à
-- mão (ADR-001); coluna com padrão constante, só metadado.
ALTER TABLE "Troca" ADD COLUMN "creditoAbatidoNaDevolucao" DOUBLE PRECISION NOT NULL DEFAULT 0;
