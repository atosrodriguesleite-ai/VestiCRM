-- BUSCA POR PALAVRA DENTRO DA CONVERSA (lupa da Central, 03/09/2026).
--
-- Índice de texto sobre a mensagem, em minúsculas e sem acento — a MESMA
-- expressão que `buscarMensagens` (src/lib/inbox-data.ts) usa na consulta.
-- Sem ele a busca varria a tabela inteira (2,7 s em 200 mil mensagens); com
-- ele, milissegundos. Sem extensão nenhuma: `to_tsvector`, `translate` e
-- `lower` são do próprio Postgres.
--
-- A barra também vira espaço: "azul/branco" e "P/M" são o vocabulário de
-- moda, e para o separador de palavras do Postgres "azul/branco" é UMA
-- palavra — "branco" não acharia.
--
-- Índice de EXPRESSÃO: o Prisma não sabe declará-lo no schema (fica só aqui,
-- ADR-001 — migração escrita à mão). Mudar a expressão da consulta sem mudar
-- este índice faz a busca voltar a varrer a tabela em silêncio.
--
-- CONCURRENTLY: constrói o índice SEM travar a escrita na tabela (o webhook
-- do WhatsApp continua gravando mensagem durante o deploy). Conferido no
-- `prisma migrate deploy` local: a migração não roda dentro de transação.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_busca_palavra_idx"
  ON "Message"
  USING GIN (to_tsvector('simple', translate(lower(body), 'áàâãäéèêëíìîïóòôõöúùûüçñ/', 'aaaaaeeeeiiiiooooouuuucn ')));
