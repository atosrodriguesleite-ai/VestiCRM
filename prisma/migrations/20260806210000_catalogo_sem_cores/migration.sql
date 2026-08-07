-- Loja sem variação de cor (semijoias, acessórios): o catálogo público
-- esconde a bolinha e o nome da cor. Por loja, desligado por padrão —
-- nenhuma loja existente muda de comportamento.
ALTER TABLE "Company" ADD COLUMN "catalogHideColors" BOOLEAN NOT NULL DEFAULT false;
