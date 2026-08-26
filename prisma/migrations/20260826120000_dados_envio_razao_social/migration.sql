-- Formulário "Dados de envio" + razão social (RN-024).
-- Escrita à mão (ADR-001): só o que esta entrega precisa, nada de diff gerado.
ALTER TABLE "Customer" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "waName" TEXT;
