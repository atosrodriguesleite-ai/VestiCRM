-- Módulo Estoque (RN-050): chave por loja, nasce DESLIGADA. Escrita à mão
-- (ADR-001). Nenhuma loja muda de comportamento até o super admin ligar.
ALTER TABLE "Company" ADD COLUMN "estoqueEnabled" BOOLEAN NOT NULL DEFAULT false;
