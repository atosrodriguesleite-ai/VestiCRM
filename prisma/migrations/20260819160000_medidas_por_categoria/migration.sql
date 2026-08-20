-- MEDIDAS DE 1 PEÇA POR CATEGORIA (RN-019, 19/08/2026)
--
-- A caixa padrão era UMA para a loja inteira — o mesmo tamanho para 5 ou 50
-- peças, o que no atacado erra sempre. Agora cada categoria guarda as
-- medidas de UMA peça dobrada (comprimento × largura × altura) e o sistema
-- MONTA o pacote empilhando: 23 peças = 23 alturas somadas, 23 pesos.
-- Alimenta a cotação automática do pedido e o simulador de frete.
--
-- Categoria sem medidas → tudo segue como era (caixa padrão da loja).
--
-- Migração REEXECUTÁVEL (o banco tem drift; ver scripts/migrate-deploy.mjs).

ALTER TABLE "MelhorEnvioConnection" ADD COLUMN IF NOT EXISTS "categoryDims" TEXT NOT NULL DEFAULT '';
