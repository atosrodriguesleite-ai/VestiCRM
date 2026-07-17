-- Ordem das categorias no catálogo público (JSON array de nomes; vazio = ordem natural)
ALTER TABLE "Company" ADD COLUMN "categoryOrder" TEXT NOT NULL DEFAULT '';
