-- INSCRIÇÃO ESTADUAL DA CLIENTE (pedido do dono, 17/08/2026).
--
-- A cliente de atacado costuma ser LOJISTA (compra com CNPJ) — e algumas
-- transportadoras exigem a Inscrição Estadual para envio a pessoa jurídica.
-- O campo anda junto do CNPJ na ficha e vai na etiqueta do Melhor Envio
-- (state_register).
--
-- IF NOT EXISTS: reexecutável (deploy que cai no meio não quebra na volta).

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "stateRegistration" TEXT;
