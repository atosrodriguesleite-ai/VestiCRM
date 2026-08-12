-- ORDEM DAS RESPOSTAS RÁPIDAS (pedido do dono, 11/08/2026).
--
-- A lista era alfabética e imutável: "Boas vindas", a resposta mais usada,
-- ficava para sempre atrás de "Apresentação" e "Após envio catálogo". Agora
-- cada loja escolhe a ordem (setinhas ↑↓ no painel do chat e na tela
-- Configurações).
--
-- Backfill: cada loja recebe a numeração na ordem em que a lista aparecia
-- ATÉ HOJE (categoria, título) — o dia da virada não muda nada na tela.

-- IF NOT EXISTS: reexecutável — se o deploy cair no meio, a nova tentativa
-- não pode quebrar em "coluna já existe"
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

UPDATE "MessageTemplate" m
   SET "order" = numerada.posicao - 1
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "companyId"
             ORDER BY category, title
           ) AS posicao
      FROM "MessageTemplate"
  ) AS numerada
 WHERE m.id = numerada.id
   -- reexecução (deploy caiu depois da coluna, antes do fim): só numera quem
   -- ainda está no padrão zero, sem desfazer ordem já escolhida pela loja
   AND NOT EXISTS (
     SELECT 1 FROM "MessageTemplate" x
      WHERE x."companyId" = m."companyId" AND x."order" <> 0
   );
