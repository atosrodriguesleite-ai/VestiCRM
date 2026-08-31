-- RN-027: campos extras do pedido do catálogo, escolhidos por loja.
-- JSON em texto (mesmo padrão do categoryOrder); vazio = formulário de sempre.
ALTER TABLE "Company" ADD COLUMN "catalogFormFields" TEXT NOT NULL DEFAULT '';
