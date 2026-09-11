-- RN-054 · Os ids de natureza de operação viram TEXTO.
--
-- Motivo (achado da revisão): todo id do Bling neste projeto é String, e os
-- ids de lá passam de 10 dígitos — acima do Int de 32 bits. A loja que
-- colasse um id longo veria "Não consegui salvar" sem nenhuma explicação.
--
-- Seguro: a coluna nasceu na migração 20260911120000, ainda não chegou em
-- produção e está nula em toda loja. O cast de integer para text é direto.
ALTER TABLE "BlingConnection"
  ALTER COLUMN "naturezaContribuinteId" TYPE TEXT USING "naturezaContribuinteId"::text,
  ALTER COLUMN "naturezaNaoContribuinteId" TYPE TEXT USING "naturezaNaoContribuinteId"::text;
